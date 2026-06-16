import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateRevenueRequest, RevenueRecordDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { RevenueRepository } from "./revenue.repository";
import { amountToDbString, centsToNumber, decimalStringToCents, MoneyError } from "./money";

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
const ACTION_VIEW = "view-finance";

/** "Sửa" sổ cái: amount mới + lý do (audit). Giữ nguyên các chiều (platform/channel/...) của bản gốc. */
export interface AdjustRevenueInput {
  amount: number;
  reason: string;
}

/** "Xoá" sổ cái: void + lý do (audit). */
export interface VoidRevenueInput {
  reason: string;
}

/**
 * numeric (number) → chuỗi cho Drizzle, AN TOÀN (B3): đi qua money.ts (cents-exact + guard
 * MAX_SAFE_INTEGER). Vượt khoảng an toàn JS → MoneyError → BadRequestException (400 ở HTTP),
 * KHÔNG `toFixed(2)` lossy âm thầm. Thay `numToStr` cũ (chỉ guard isFinite) — defect B3 residual.
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
export class RevenueService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RevenueRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Liệt kê revenue hiệu lực của tenant (RLS lọc). filter từ ListRevenueQuery (đã validate + clamp
   * limit/offset ở controller). MASK SERVER-side (BẤT BIẾN #3, parity ProfitService): caller KHÔNG có
   * view-finance(isSensitive) → amount = null; có quyền → số THẬT. fail-safe mask (lỗi can() → mask).
   */
  async list(
    companyId: string,
    userId: string,
    filter: Parameters<RevenueRepository["list"]>[1] = {},
  ): Promise<RevenueRecordDto[]> {
    const canView = await this.canViewFinance(companyId, userId);
    const rows = await this.repo.list(companyId, filter);
    return rows.map((r) => this.toMaskedDto(r, canView));
  }

  /**
   * Map row revenue_records → DTO với mask tiền. canView=false ⇒ amount=null (mask). numeric(18,2)
   * Drizzle trả chuỗi → cents (không float) → number khi được phép xem.
   */
  private toMaskedDto(row: RevenueRow, canView: boolean): RevenueRecordDto {
    const amount =
      canView && row.amount != null ? centsToNumber(decimalStringToCents(row.amount)) : null;
    return {
      id: row.id,
      companyId: row.companyId,
      platformId: row.platformId,
      channelId: row.channelId,
      projectId: row.projectId,
      contentItemId: row.contentItemId,
      amount,
      currency: row.currency,
      revenueDate: row.revenueDate,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      source: row.source as RevenueRecordDto["source"],
      description: row.description,
      attachmentUrl: row.attachmentUrl,
      enteredBy: row.enteredBy,
      entryKind: row.entryKind as RevenueRecordDto["entryKind"],
      replacesRecordId: row.replacesRecordId,
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
        amount: amountToDbStringOr400(dto.amount),
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
        amount: amountToDbStringOr400(input.amount),
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

/** Hàng revenue_records đọc từ Drizzle (numeric → string; timestamp → Date). */
interface RevenueRow {
  id: string;
  companyId: string;
  platformId: string | null;
  channelId: string | null;
  projectId: string | null;
  contentItemId: string | null;
  amount: string | null;
  currency: string;
  revenueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  source: string;
  description: string | null;
  attachmentUrl: string | null;
  enteredBy: string;
  entryKind: string;
  replacesRecordId: string | null;
  createdAt: Date | string;
}
