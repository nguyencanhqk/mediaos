import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateRevenueRequest } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { RevenueRepository } from "./revenue.repository";

/**
 * G13-1 — RevenueService: sổ cái doanh thu APPEND-ONLY (BẤT BIẾN #2), tài chính nhạy cảm (permission).
 *
 * Hợp đồng append-only: CHỈ create()/adjust()/void(). KHÔNG có update()/delete() — "sửa/xoá" = ghi bản
 * ghi mới (entry_kind adjustment|void + replaces_record_id chain). App role chỉ GRANT SELECT,INSERT.
 *
 * 4 chốt fail-closed:
 *  (a) RLS 2-tenant — mọi đọc/ghi qua withTenant (RLS ép company_id ở DB).
 *  (b) Append-only — không update/delete; DB từ chối UPDATE/DELETE cho app role.
 *  (c) Permission — create/adjust/void check create:finance TRƯỚC khi mở tx → deny ⇒ KHÔNG side-effect.
 *  (d) Audit — adjust()/void() ghi audit_logs object_type='revenue_record' CÙNG tx.
 */

const RESOURCE_TYPE = "finance";
const ACTION_WRITE = "create";

/** "Sửa" sổ cái: amount mới + lý do (audit). Giữ nguyên các chiều (platform/channel/...) của bản gốc. */
export interface AdjustRevenueInput {
  amount: number;
  reason: string;
}

/** "Xoá" sổ cái: void + lý do (audit). */
export interface VoidRevenueInput {
  reason: string;
}

/** numeric (number) → string cho Drizzle; chặn giá trị không hữu hạn ở boundary. */
function numToStr(value: number): string {
  if (!Number.isFinite(value)) throw new BadRequestException(`Invalid amount: ${value}`);
  return value.toFixed(2);
}

@Injectable()
export class RevenueService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RevenueRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Liệt kê revenue hiệu lực của tenant (RLS lọc). filter từ ListRevenueQuery (đã validate ở controller). */
  list(companyId: string, _userId: string, filter: Parameters<RevenueRepository["list"]>[1] = {}) {
    return this.repo.list(companyId, filter);
  }

  /**
   * Nhập 1 bản ghi doanh thu gốc (entry_kind='original'). Permission check TRƯỚC tx → deny ⇒ KHÔNG INSERT.
   */
  async create(companyId: string, userId: string, dto: CreateRevenueRequest) {
    await this.assertCanWrite(companyId, userId);

    return this.db.withTenant(companyId, async (tx) => {
      const row = await this.repo.insertTx(tx, {
        platformId: dto.platformId ?? null,
        channelId: dto.channelId ?? null,
        projectId: dto.projectId ?? null,
        contentItemId: dto.contentItemId ?? null,
        amount: numToStr(dto.amount),
        currency: dto.currency,
        revenueDate: dto.revenueDate,
        periodStart: dto.periodStart ?? null,
        periodEnd: dto.periodEnd ?? null,
        source: dto.source,
        description: dto.description ?? null,
        attachmentUrl: dto.attachmentUrl ?? null,
        enteredBy: userId,
        entryKind: "original",
        replacesRecordId: null,
      });
      await this.audit.record(tx, {
        action: "RevenueCreated",
        objectType: "revenue_record",
        objectId: row.id,
        actorUserId: userId,
        after: { amount: row.amount, source: row.source, revenueDate: row.revenueDate },
      });
      await this.outbox.enqueue(tx, {
        eventType: "finance.revenue.created",
        payload: { revenueRecordId: row.id, actorUserId: userId },
      });
      return row;
    });
  }

  /**
   * "Sửa" sổ cái append-only: ghi bản ghi mới entry_kind='adjustment' thay thế bản gốc (chain).
   * Audit action='RevenueAdjusted'. KHÔNG UPDATE bản gốc.
   */
  async adjust(companyId: string, userId: string, originalId: string, input: AdjustRevenueInput) {
    await this.assertCanWrite(companyId, userId);

    return this.db.withTenant(companyId, async (tx) => {
      const original = await this.repo.findByIdTx(tx, companyId, originalId);
      if (!original) throw new NotFoundException(`Revenue record not found: ${originalId}`);
      if (original.entryKind === "void") {
        throw new BadRequestException("Không thể điều chỉnh bản ghi đã void.");
      }

      const row = await this.repo.insertTx(tx, {
        platformId: original.platformId,
        channelId: original.channelId,
        projectId: original.projectId,
        contentItemId: original.contentItemId,
        amount: numToStr(input.amount),
        currency: original.currency,
        revenueDate: original.revenueDate,
        periodStart: original.periodStart,
        periodEnd: original.periodEnd,
        source: original.source,
        description: original.description,
        attachmentUrl: original.attachmentUrl,
        enteredBy: userId,
        entryKind: "adjustment",
        replacesRecordId: originalId,
      });
      await this.audit.record(tx, {
        action: "RevenueAdjusted",
        objectType: "revenue_record",
        objectId: row.id,
        actorUserId: userId,
        before: { id: originalId, amount: original.amount },
        after: { amount: row.amount, reason: input.reason, replacesRecordId: originalId },
      });
      await this.outbox.enqueue(tx, {
        eventType: "finance.revenue.adjusted",
        payload: { revenueRecordId: row.id, replacesRecordId: originalId, actorUserId: userId },
      });
      return row;
    });
  }

  /**
   * "Xoá" sổ cái append-only: ghi bản ghi mới entry_kind='void' thay thế bản gốc (chain).
   * Audit action='RevenueVoided'. KHÔNG DELETE bản gốc.
   */
  async void(companyId: string, userId: string, originalId: string, input: VoidRevenueInput) {
    await this.assertCanWrite(companyId, userId);

    return this.db.withTenant(companyId, async (tx) => {
      const original = await this.repo.findByIdTx(tx, companyId, originalId);
      if (!original) throw new NotFoundException(`Revenue record not found: ${originalId}`);
      if (original.entryKind === "void") {
        throw new BadRequestException("Bản ghi đã được void.");
      }

      const row = await this.repo.insertTx(tx, {
        platformId: original.platformId,
        channelId: original.channelId,
        projectId: original.projectId,
        contentItemId: original.contentItemId,
        // void mirror số gốc (amount NOT NULL); trạng thái void suy từ entry_kind.
        amount: original.amount,
        currency: original.currency,
        revenueDate: original.revenueDate,
        periodStart: original.periodStart,
        periodEnd: original.periodEnd,
        source: original.source,
        description: original.description,
        attachmentUrl: original.attachmentUrl,
        enteredBy: userId,
        entryKind: "void",
        replacesRecordId: originalId,
      });
      await this.audit.record(tx, {
        action: "RevenueVoided",
        objectType: "revenue_record",
        objectId: row.id,
        actorUserId: userId,
        before: { id: originalId, amount: original.amount },
        after: { reason: input.reason, replacesRecordId: originalId },
      });
      await this.outbox.enqueue(tx, {
        eventType: "finance.revenue.voided",
        payload: { revenueRecordId: row.id, replacesRecordId: originalId, actorUserId: userId },
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
