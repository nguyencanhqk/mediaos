import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateCostRequest } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { CostRepository } from "./cost.repository";

/**
 * G13-2 — CostService: sổ cái chi phí APPEND-ONLY (BẤT BIẾN #2), tài chính nhạy cảm (permission).
 * Mirror RevenueService (G13-1) byte-gần.
 *
 * Hợp đồng append-only: CHỈ create()/adjust()/void(). KHÔNG có update()/delete() — "sửa/xoá" = ghi bản
 * ghi mới (entry_kind adjustment|void + replaces_record_id chain). App role chỉ GRANT SELECT,INSERT.
 *
 * 4 chốt fail-closed:
 *  (a) RLS 2-tenant — mọi đọc/ghi qua withTenant (RLS ép company_id ở DB).
 *  (b) Append-only — không update/delete; DB từ chối UPDATE/DELETE cho app role.
 *  (c) Permission — create/adjust/void check create:finance NGOÀI tx → deny ⇒ KHÔNG side-effect.
 *  (d) Audit — create/adjust/void ghi audit_logs object_type='cost_record' CÙNG tx.
 */

const RESOURCE_TYPE = "finance";
const ACTION_WRITE = "create";

/** "Sửa" sổ cái: amount mới + lý do (audit). Giữ nguyên các chiều (channel/project/...) của bản gốc. */
export interface AdjustCostInput {
  amount: number;
  reason: string;
}

/** "Xoá" sổ cái: void + lý do (audit). */
export interface VoidCostInput {
  reason: string;
}

/** numeric (number) → string cho Drizzle; chặn giá trị không hữu hạn ở boundary. */
function numToStr(value: number): string {
  if (!Number.isFinite(value)) throw new BadRequestException(`Invalid amount: ${value}`);
  return value.toFixed(2);
}

@Injectable()
export class CostService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CostRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Liệt kê cost hiệu lực của tenant (RLS lọc). filter từ ListCostQuery (đã validate ở controller). */
  list(companyId: string, _userId: string, filter: Parameters<CostRepository["list"]>[1] = {}) {
    return this.repo.list(companyId, filter);
  }

  /**
   * Nhập 1 bản ghi chi phí gốc (entry_kind='original'). Permission check TRƯỚC tx → deny ⇒ KHÔNG INSERT.
   */
  async create(companyId: string, userId: string, dto: CreateCostRequest) {
    await this.assertCanWrite(companyId, userId);

    return this.db.withTenant(companyId, async (tx) => {
      const row = await this.repo.insertTx(tx, {
        costType: dto.costType,
        amount: numToStr(dto.amount),
        currency: dto.currency,
        costDate: dto.costDate,
        orgUnitId: dto.orgUnitId ?? null,
        teamId: dto.teamId ?? null,
        projectId: dto.projectId ?? null,
        channelId: dto.channelId ?? null,
        contentItemId: dto.contentItemId ?? null,
        userId: dto.userId ?? null,
        vendorName: dto.vendorName ?? null,
        description: dto.description ?? null,
        attachmentUrl: dto.attachmentUrl ?? null,
        enteredBy: userId,
        entryKind: "original",
        replacesRecordId: null,
      });
      await this.audit.record(tx, {
        action: "CostCreated",
        objectType: "cost_record",
        objectId: row.id,
        actorUserId: userId,
        after: { amount: row.amount, costType: row.costType, costDate: row.costDate },
      });
      await this.outbox.enqueue(tx, {
        eventType: "finance.cost.created",
        payload: { costRecordId: row.id, actorUserId: userId },
      });
      return row;
    });
  }

  /**
   * "Sửa" sổ cái append-only: ghi bản ghi mới entry_kind='adjustment' thay thế bản gốc (chain).
   * Audit action='CostAdjusted'. KHÔNG UPDATE bản gốc.
   */
  async adjust(companyId: string, userId: string, originalId: string, input: AdjustCostInput) {
    await this.assertCanWrite(companyId, userId);

    return this.db.withTenant(companyId, async (tx) => {
      const original = await this.repo.findByIdTx(tx, companyId, originalId);
      if (!original) throw new NotFoundException(`Cost record not found: ${originalId}`);
      if (original.entryKind === "void") {
        throw new BadRequestException("Không thể điều chỉnh bản ghi đã void.");
      }

      const row = await this.repo.insertTx(tx, {
        costType: original.costType,
        amount: numToStr(input.amount),
        currency: original.currency,
        costDate: original.costDate,
        orgUnitId: original.orgUnitId,
        teamId: original.teamId,
        projectId: original.projectId,
        channelId: original.channelId,
        contentItemId: original.contentItemId,
        userId: original.userId,
        vendorName: original.vendorName,
        description: original.description,
        attachmentUrl: original.attachmentUrl,
        enteredBy: userId,
        entryKind: "adjustment",
        replacesRecordId: originalId,
        expenseRequestId: original.expenseRequestId,
      });
      await this.audit.record(tx, {
        action: "CostAdjusted",
        objectType: "cost_record",
        objectId: row.id,
        actorUserId: userId,
        before: { id: originalId, amount: original.amount },
        after: { amount: row.amount, reason: input.reason, replacesRecordId: originalId },
      });
      await this.outbox.enqueue(tx, {
        eventType: "finance.cost.adjusted",
        payload: { costRecordId: row.id, replacesRecordId: originalId, actorUserId: userId },
      });
      return row;
    });
  }

  /**
   * "Xoá" sổ cái append-only: ghi bản ghi mới entry_kind='void' thay thế bản gốc (chain).
   * Audit action='CostVoided'. KHÔNG DELETE bản gốc.
   */
  async void(companyId: string, userId: string, originalId: string, input: VoidCostInput) {
    await this.assertCanWrite(companyId, userId);

    return this.db.withTenant(companyId, async (tx) => {
      const original = await this.repo.findByIdTx(tx, companyId, originalId);
      if (!original) throw new NotFoundException(`Cost record not found: ${originalId}`);
      if (original.entryKind === "void") {
        throw new BadRequestException("Bản ghi đã được void.");
      }

      const row = await this.repo.insertTx(tx, {
        costType: original.costType,
        // void mirror số gốc (amount NOT NULL); trạng thái void suy từ entry_kind.
        amount: original.amount,
        currency: original.currency,
        costDate: original.costDate,
        orgUnitId: original.orgUnitId,
        teamId: original.teamId,
        projectId: original.projectId,
        channelId: original.channelId,
        contentItemId: original.contentItemId,
        userId: original.userId,
        vendorName: original.vendorName,
        description: original.description,
        attachmentUrl: original.attachmentUrl,
        enteredBy: userId,
        entryKind: "void",
        replacesRecordId: originalId,
        expenseRequestId: original.expenseRequestId,
      });
      await this.audit.record(tx, {
        action: "CostVoided",
        objectType: "cost_record",
        objectId: row.id,
        actorUserId: userId,
        before: { id: originalId, amount: original.amount },
        after: { reason: input.reason, replacesRecordId: originalId },
      });
      await this.outbox.enqueue(tx, {
        eventType: "finance.cost.voided",
        payload: { costRecordId: row.id, replacesRecordId: originalId, actorUserId: userId },
      });
      return row;
    });
  }

  /**
   * Fail-closed permission gate cho ghi sổ cái (create/adjust/void). KIỂM TRA NGOÀI tx → deny không mở
   * transaction ⇒ KHÔNG có side-effect (kiểm đếm = 0). Lỗi hạ tầng trong can() ⇒ deny (fail-closed).
   */
  private async assertCanWrite(companyId: string, userId: string): Promise<void> {
    const decision = await this.permissions.can({
      userId,
      companyId,
      action: ACTION_WRITE,
      resourceType: RESOURCE_TYPE,
    });
    if (!decision.allow) {
      throw new ForbiddenException(`Permission denied: ${decision.reason}`);
    }
  }
}
