import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { CreateProfitSnapshotRequest, ProfitSnapshotDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import {
  ProfitRepository,
  type ListProfitFilter,
  type SubScope,
} from "./profit.repository";
import { computeProfit } from "./profit-calc";
import { centsToDbString, centsToNumber, decimalStringToCents } from "./money";

/**
 * G13-3 — ProfitService: profit_snapshots BẤT BIẾN (BẤT BIẾN #2, append-only), tài chính nhạy cảm.
 *
 * Công thức: profit = revenue − direct − allocated; total_cost = direct + allocated;
 * margin = profit/revenue (null khi revenue=0). Tiền tính bằng CENTS integer (profit-calc.ts) — KHÔNG
 * float. Mỗi lần create() = 1 INSERT snapshot mới (KHÔNG update/delete).
 *
 * 5 chốt fail-closed:
 *  (a) RLS 2-tenant — mọi đọc/ghi + SUM qua withTenant (RLS ép company_id ở DB), KHÔNG join chéo tenant.
 *  (b) Append-only — chỉ create()/list()/findLatest(); DB từ chối UPDATE/DELETE cho app role.
 *  (c) Permission — create:finance check NGOÀI tx → deny ⇒ KHÔNG mở tx ⇒ 0 side-effect.
 *  (d) Audit — create() ghi audit_logs object_type='profit_snapshot' action='ProfitSnapshotCreated' tx.
 *  (e) Mask SERVER-side — số tiền chỉ trả khi view-finance(isSensitive) ALLOW; ngược lại (DENY hoặc lỗi
 *      hạ tầng can()) → null (fail-safe mask, KHÔNG fail-open ra số). Số THẬT vẫn persist trong DB.
 *
 * Chống đếm đôi (plan §4.5):
 *  - company scope ⇒ allocated=0 (phân bổ chỉ tái phân phối nội bộ), direct=TOÀN BỘ cost hiệu lực.
 *  - scope con ⇒ direct=cost gắn đúng cột target, allocated=allocation active trỏ target.
 */

const RESOURCE_TYPE = "finance";
const ACTION_WRITE = "create";
const ACTION_VIEW = "view-finance";

/** MVP compute 4 scope (ERD đủ 7 — phần còn lại chờ module liên quan). */
const MVP_TARGET_TYPES = ["company", "channel", "project", "content_item"] as const;
type MvpTargetType = (typeof MVP_TARGET_TYPES)[number];

function isMvpTargetType(value: string): value is MvpTargetType {
  return (MVP_TARGET_TYPES as readonly string[]).includes(value);
}

@Injectable()
export class ProfitService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ProfitRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Tính + ghi 1 snapshot lợi nhuận bất biến cho scope/kỳ. Permission create:finance check NGOÀI tx
   * (fail-closed). Trả DTO đã MASK theo view-finance của caller.
   */
  async create(
    companyId: string,
    userId: string,
    dto: CreateProfitSnapshotRequest,
  ): Promise<ProfitSnapshotDto> {
    await this.assertCanWrite(companyId, userId);

    // Defend runtime: chỉ compute 4 scope MVP. Ngoài đó (platform/org_unit/team) → 400, KHÔNG ghi.
    if (!isMvpTargetType(dto.targetType)) {
      throw new BadRequestException(
        `Tính lợi nhuận cho targetType='${dto.targetType}' chưa hỗ trợ (MVP: company/channel/project/content_item).`,
      );
    }
    const isCompany = dto.targetType === "company";
    if (!isCompany && dto.targetId == null) {
      throw new BadRequestException("targetId bắt buộc khi targetType khác company.");
    }
    const targetId = isCompany ? null : (dto.targetId as string);
    const scope: { type: SubScope; id: string } | null = isCompany
      ? null
      : { type: dto.targetType as SubScope, id: dto.targetId as string };
    const period = { from: dto.periodStart, to: dto.periodEnd };

    // Mask quyết định NGOÀI tx (đọc số nhạy cảm) — fail-safe mask khi lỗi hạ tầng.
    const canView = await this.canViewFinance(companyId, userId);

    const row = await this.db.withTenant(companyId, async (tx) => {
      // SUM CÙNG tenant tx (RLS lọc). company ⇒ direct toàn bộ + allocated=0; con ⇒ theo target.
      const revenueCents = await this.repo.sumRevenueEffectiveTx(tx, period, scope);
      const directCostCents = await this.repo.sumDirectCostEffectiveTx(tx, period, scope);
      const allocatedCostCents = scope
        ? await this.repo.sumAllocatedActiveTx(tx, period, scope)
        : 0n; // company scope: chống đếm đôi.

      const result = computeProfit({ revenueCents, directCostCents, allocatedCostCents });

      const inserted = await this.repo.insertTx(tx, {
        targetType: dto.targetType,
        targetId,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        totalRevenue: centsToDbString(result.revenueCents),
        totalDirectCost: centsToDbString(result.directCostCents),
        totalAllocatedCost: centsToDbString(result.allocatedCostCents),
        totalCost: centsToDbString(result.totalCostCents),
        profit: centsToDbString(result.profitCents),
        profitMargin: result.profitMargin != null ? result.profitMargin.toFixed(4) : null,
        createdBy: userId,
      });

      await this.audit.record(tx, {
        action: "ProfitSnapshotCreated",
        objectType: "profit_snapshot",
        objectId: inserted.id,
        actorUserId: userId,
        after: {
          targetType: dto.targetType,
          targetId,
          periodStart: dto.periodStart,
          periodEnd: dto.periodEnd,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: "finance.profit.snapshot_created",
        payload: { profitSnapshotId: inserted.id, actorUserId: userId },
      });
      return inserted;
    });

    return this.toDto(row, canView);
  }

  /** Liệt kê snapshot hiệu lực của tenant (RLS lọc), áp mask theo view-finance của caller. */
  async list(
    companyId: string,
    userId: string,
    filter: ListProfitFilter = {},
  ): Promise<ProfitSnapshotDto[]> {
    const canView = await this.canViewFinance(companyId, userId);
    const rows = await this.repo.list(companyId, filter);
    return rows.map((r) => this.toDto(r, canView));
  }

  /** Snapshot mới nhất cho 1 target, đã mask. null nếu chưa có. */
  async findLatest(
    companyId: string,
    userId: string,
    targetType: string,
    targetId: string | null,
  ): Promise<ProfitSnapshotDto | null> {
    const canView = await this.canViewFinance(companyId, userId);
    const row = await this.repo.findLatest(companyId, targetType, targetId);
    return row ? this.toDto(row, canView) : null;
  }

  /**
   * Map row DB → DTO. canView=false ⇒ MỌI số tiền = null (mask SERVER-side). numeric(18,2) Drizzle trả
   * chuỗi → cents (không float) → number. profit_margin numeric(9,4) → number.
   */
  private toDto(row: ProfitRow, canView: boolean): ProfitSnapshotDto {
    const num = (value: string | null): number | null =>
      value == null ? null : centsToNumber(decimalStringToCents(value));
    return {
      id: row.id,
      companyId: row.companyId,
      targetType: row.targetType as ProfitSnapshotDto["targetType"],
      targetId: row.targetId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      totalRevenue: canView ? num(row.totalRevenue) : null,
      totalDirectCost: canView ? num(row.totalDirectCost) : null,
      totalAllocatedCost: canView ? num(row.totalAllocatedCost) : null,
      totalCost: canView ? num(row.totalCost) : null,
      profit: canView ? num(row.profit) : null,
      profitMargin: canView && row.profitMargin != null ? Number(row.profitMargin) : null,
      calculatedAt:
        row.calculatedAt instanceof Date ? row.calculatedAt.toISOString() : String(row.calculatedAt),
      createdBy: row.createdBy,
    };
  }

  /**
   * Fail-closed permission gate ghi snapshot. KIỂM TRA NGOÀI tx → deny không mở tx ⇒ KHÔNG side-effect.
   * Lỗi hạ tầng can() ⇒ deny (PermissionService.can đã fail-closed nội bộ).
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

  /**
   * view-finance(isSensitive) — quyết MASK số tiền. FAIL-SAFE MASK: bất kỳ lỗi hạ tầng nào trong can()
   * → coi như KHÔNG có quyền (mask null), KHÔNG fail-open ra số nhạy cảm.
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
}

/** Hàng profit_snapshots đọc từ Drizzle (numeric → string; timestamp → Date). */
interface ProfitRow {
  id: string;
  companyId: string;
  targetType: string;
  targetId: string | null;
  periodStart: string;
  periodEnd: string;
  totalRevenue: string | null;
  totalDirectCost: string | null;
  totalAllocatedCost: string | null;
  totalCost: string | null;
  profit: string | null;
  profitMargin: string | null;
  calculatedAt: Date | string;
  createdBy: string | null;
}
