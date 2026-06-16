import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateCostRequest, CostRecordDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { CostRepository } from "./cost.repository";
import { amountToDbString, centsToNumber, decimalStringToCents, MoneyError } from "./money";

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
const ACTION_VIEW = "view-finance";

/** "Sửa" sổ cái: amount mới + lý do (audit). Giữ nguyên các chiều (channel/project/...) của bản gốc. */
export interface AdjustCostInput {
  amount: number;
  reason: string;
}

/** "Xoá" sổ cái: void + lý do (audit). */
export interface VoidCostInput {
  reason: string;
}

/**
 * numeric (number) → chuỗi cho Drizzle, AN TOÀN (B3): đi qua money.ts (cents-exact + guard
 * MAX_SAFE_INTEGER). Vượt khoảng an toàn JS → MoneyError → BadRequestException (400), KHÔNG
 * `toFixed(2)` lossy âm thầm. Thay `numToStr` cũ (chỉ guard isFinite) — defect B3 residual.
 */
function amountToDbStringOr400(value: number): string {
  try {
    return amountToDbString(value);
  } catch (e) {
    if (e instanceof MoneyError) throw new BadRequestException(e.message);
    throw e;
  }
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

  /**
   * Liệt kê cost hiệu lực của tenant (RLS lọc). filter từ ListCostQuery (đã validate + clamp limit/offset
   * ở controller). MASK SERVER-side (BẤT BIẾN #3, parity ProfitService): caller KHÔNG có
   * view-finance(isSensitive) → amount = null; có quyền → số THẬT. fail-safe mask (lỗi can() → mask).
   */
  async list(
    companyId: string,
    userId: string,
    filter: Parameters<CostRepository["list"]>[1] = {},
  ): Promise<CostRecordDto[]> {
    const canView = await this.canViewFinance(companyId, userId);
    const rows = await this.repo.list(companyId, filter);
    return rows.map((r) => this.toMaskedDto(r, canView));
  }

  /**
   * Map row cost_records → DTO với mask tiền. canView=false ⇒ amount=null (mask). numeric(18,2) Drizzle
   * trả chuỗi → cents (không float) → number khi được phép xem.
   */
  private toMaskedDto(row: CostRow, canView: boolean): CostRecordDto {
    const amount =
      canView && row.amount != null ? centsToNumber(decimalStringToCents(row.amount)) : null;
    return {
      id: row.id,
      companyId: row.companyId,
      costType: row.costType as CostRecordDto["costType"],
      amount,
      currency: row.currency,
      costDate: row.costDate,
      orgUnitId: row.orgUnitId,
      teamId: row.teamId,
      projectId: row.projectId,
      channelId: row.channelId,
      contentItemId: row.contentItemId,
      userId: row.userId,
      vendorName: row.vendorName,
      description: row.description,
      attachmentUrl: row.attachmentUrl,
      enteredBy: row.enteredBy,
      entryKind: row.entryKind as CostRecordDto["entryKind"],
      replacesRecordId: row.replacesRecordId,
      expenseRequestId: row.expenseRequestId,
      isEffective: row.entryKind !== "void",
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    };
  }

  /**
   * view-finance(isSensitive) — quyết MASK số tiền. FAIL-SAFE MASK (parity ProfitService): mọi lỗi hạ
   * tầng trong can() → coi như KHÔNG có quyền (mask null), KHÔNG fail-open ra số nhạy cảm.
   */
  private async canViewFinance(companyId: string, userId: string): Promise<boolean> {
    try {
      const decision = await this.permissions.can({
        userId,
        companyId,
        action: ACTION_VIEW,
        resourceType: RESOURCE_TYPE,
        isSensitive: true,
      });
      return decision.allow;
    } catch {
      return false; // fail-safe mask.
    }
  }

  /**
   * Nhập 1 bản ghi chi phí gốc (entry_kind='original'). Permission check TRƯỚC tx → deny ⇒ KHÔNG INSERT.
   */
  async create(companyId: string, userId: string, dto: CreateCostRequest) {
    await this.assertCanWrite(companyId, userId);

    return this.db.withTenant(companyId, async (tx) => {
      const row = await this.repo.insertTx(tx, {
        costType: dto.costType,
        amount: amountToDbStringOr400(dto.amount),
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
        amount: amountToDbStringOr400(input.amount),
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

/** Hàng cost_records đọc từ Drizzle (numeric → string; timestamp → Date). */
interface CostRow {
  id: string;
  companyId: string;
  costType: string;
  amount: string | null;
  currency: string;
  costDate: string;
  orgUnitId: string | null;
  teamId: string | null;
  projectId: string | null;
  channelId: string | null;
  contentItemId: string | null;
  userId: string | null;
  vendorName: string | null;
  description: string | null;
  attachmentUrl: string | null;
  enteredBy: string;
  entryKind: string;
  replacesRecordId: string | null;
  expenseRequestId: string | null;
  createdAt: Date | string;
}
