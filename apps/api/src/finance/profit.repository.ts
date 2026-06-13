import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { AllocationTargetType } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { profitSnapshots } from "../db/schema";

/**
 * G13-3 — Repository profit_snapshots APPEND-ONLY (BẤT BIẾN #2).
 *
 * KHÔNG có update()/delete() — app role chỉ GRANT SELECT,INSERT (migration 0072). Mỗi lần tính = 1
 * INSERT snapshot mới (calculated_at); "latest" = mới nhất theo thời gian. Mọi truy vấn qua withTenant
 * (RLS ép company_id ở DB). SUM revenue/cost/allocation chạy CÙNG tenant tx (RLS lọc) — KHÔNG join chéo
 * tenant. Tiền tính bằng CENTS integer (round(amount*100)::bigint) — KHÔNG float (khớp money.ts).
 *
 * Quy ước scope (chống đếm đôi — plan §4.5):
 *  - company scope: direct = TOÀN BỘ cost hiệu lực (không lọc cột target); allocated = 0 (service ép).
 *  - scope con: direct = cost gắn ĐÚNG cột target = id; allocated = allocation active trỏ tới target.
 */

/** Scope con MVP: cột FK của revenue/cost theo loại target. company-scope KHÔNG dùng (lấy toàn bộ). */
const REVENUE_TARGET_COLUMN: Record<"channel" | "project" | "content_item", string> = {
  channel: "channel_id",
  project: "project_id",
  content_item: "content_item_id",
};
const COST_TARGET_COLUMN: Record<"channel" | "project" | "content_item", string> = {
  channel: "channel_id",
  project: "project_id",
  content_item: "content_item_id",
};

/** allocation_target_type khớp loại scope con. */
const ALLOCATION_TARGET_TYPE: Record<"channel" | "project" | "content_item", AllocationTargetType> =
  {
    channel: "channel",
    project: "project",
    content_item: "content_item",
  };

export type SubScope = "channel" | "project" | "content_item";

/** Cột tiền đã tính (cents) → chuỗi numeric(18,2) khi INSERT. */
export interface InsertProfitData {
  targetType: string;
  targetId: string | null;
  periodStart: string;
  periodEnd: string;
  totalRevenue: string;
  totalDirectCost: string;
  totalAllocatedCost: string;
  totalCost: string;
  profit: string;
  profitMargin: string | null;
  createdBy: string;
}

export interface ListProfitFilter {
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class ProfitRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * SUM doanh thu HIỆU LỰC (cents) trong kỳ, CÙNG tenant tx (RLS lọc company_id).
   * Hiệu lực = entry_kind <> 'void' AND chưa bị bản ghi khác thay thế (replaces_record_id trỏ tới nó).
   * scope=null (company) ⇒ toàn bộ; scope con ⇒ lọc cột target = id.
   */
  async sumRevenueEffectiveTx(
    tx: TenantTx,
    period: { from: string; to: string },
    scope: { type: SubScope; id: string } | null,
  ): Promise<bigint> {
    const targetFilter = scope
      ? sql`AND ${sql.identifier(REVENUE_TARGET_COLUMN[scope.type])} = ${scope.id}`
      : sql``;
    const res = await tx.execute(sql`
      SELECT COALESCE(SUM(round(amount * 100))::bigint, 0) AS cents FROM revenue_records rr
      WHERE rr.entry_kind <> 'void'
        AND NOT EXISTS (SELECT 1 FROM revenue_records r2 WHERE r2.replaces_record_id = rr.id)
        AND rr.revenue_date >= ${period.from}::date
        AND rr.revenue_date <= ${period.to}::date
        ${targetFilter}
    `);
    return BigInt((res.rows?.[0]?.cents as string | number | undefined) ?? 0);
  }

  /**
   * SUM chi phí trực tiếp HIỆU LỰC (cents) trong kỳ, CÙNG tenant tx.
   * company scope ⇒ TOÀN BỘ cost hiệu lực; scope con ⇒ cost gắn ĐÚNG cột target = id.
   */
  async sumDirectCostEffectiveTx(
    tx: TenantTx,
    period: { from: string; to: string },
    scope: { type: SubScope; id: string } | null,
  ): Promise<bigint> {
    const targetFilter = scope
      ? sql`AND ${sql.identifier(COST_TARGET_COLUMN[scope.type])} = ${scope.id}`
      : sql``;
    const res = await tx.execute(sql`
      SELECT COALESCE(SUM(round(amount * 100))::bigint, 0) AS cents FROM cost_records cr
      WHERE cr.entry_kind <> 'void'
        AND NOT EXISTS (SELECT 1 FROM cost_records c2 WHERE c2.replaces_record_id = cr.id)
        AND cr.cost_date >= ${period.from}::date
        AND cr.cost_date <= ${period.to}::date
        ${targetFilter}
    `);
    return BigInt((res.rows?.[0]?.cents as string | number | undefined) ?? 0);
  }

  /**
   * SUM chi phí PHÂN BỔ active (cents) trỏ tới scope con trong kỳ, CÙNG tenant tx.
   * active = deleted_at IS NULL. Lọc theo allocation_target_type/id; kỳ lọc theo cost_date của cost cha
   * (join cost_records). CHỈ scope con — company scope allocated=0 (service KHÔNG gọi method này).
   *
   * ⚠️ KHÁC direct-cost sum: allocation KHÔNG dùng "head hiệu lực". `adjust()`/`void()` không đụng
   * cost_allocations (allocation luôn trỏ record được phân bổ lúc đó). Vì vậy:
   *  - cost bị VOID ⇒ LOẠI allocation (cost bị huỷ ⇒ phân bổ theo nó cũng huỷ).
   *  - cost chỉ bị ADJUST ⇒ GIỮ allocation (cost vẫn có thật; phân bổ cũ vẫn hợp lệ tới khi re-allocate
   *    trên bản mới — snapshot là điểm-thời-gian best-effort). Loại nó đi sẽ thổi phồng profit sub-scope.
   * `voided_lineage` = đi NGƯỢC chuỗi replaces từ mọi record entry_kind='void' về gốc (bắt cả chuỗi
   * adjust→void nhiều bước). cost_records có RLS ⇒ CTE chỉ thấy tenant hiện tại.
   */
  async sumAllocatedActiveTx(
    tx: TenantTx,
    period: { from: string; to: string },
    scope: { type: SubScope; id: string },
  ): Promise<bigint> {
    const res = await tx.execute(sql`
      WITH RECURSIVE voided_lineage AS (
        SELECT replaces_record_id AS id FROM cost_records
          WHERE entry_kind = 'void' AND replaces_record_id IS NOT NULL
        UNION ALL
        SELECT c.replaces_record_id AS id FROM cost_records c
          JOIN voided_lineage v ON c.id = v.id
          WHERE c.replaces_record_id IS NOT NULL
      )
      SELECT COALESCE(SUM(round(ca.allocated_amount * 100))::bigint, 0) AS cents
      FROM cost_allocations ca
      JOIN cost_records cr ON cr.id = ca.cost_record_id
      WHERE ca.deleted_at IS NULL
        AND ca.allocation_target_type = ${ALLOCATION_TARGET_TYPE[scope.type]}
        AND ca.allocation_target_id = ${scope.id}
        AND cr.entry_kind <> 'void'
        AND NOT EXISTS (SELECT 1 FROM voided_lineage vl WHERE vl.id = cr.id)
        AND cr.cost_date >= ${period.from}::date
        AND cr.cost_date <= ${period.to}::date
    `);
    return BigInt((res.rows?.[0]?.cents as string | number | undefined) ?? 0);
  }

  /** INSERT 1 snapshot (CÙNG tx với audit). KHÔNG update/delete — append-only. */
  async insertTx(tx: TenantTx, data: InsertProfitData) {
    const [row] = await tx
      .insert(profitSnapshots)
      .values({
        targetType: data.targetType,
        targetId: data.targetId,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        totalRevenue: data.totalRevenue,
        totalDirectCost: data.totalDirectCost,
        totalAllocatedCost: data.totalAllocatedCost,
        totalCost: data.totalCost,
        profit: data.profit,
        profitMargin: data.profitMargin,
        createdBy: data.createdBy,
      })
      .returning();
    return row;
  }

  /** Liệt kê snapshot của tenant (RLS lọc company_id), mới nhất trước. */
  list(companyId: string, filter: ListProfitFilter = {}) {
    return this.db.withTenant(companyId, async (tx) => {
      const conds = [eq(profitSnapshots.companyId, companyId)];
      if (filter.targetType) conds.push(eq(profitSnapshots.targetType, filter.targetType));
      if (filter.targetId) conds.push(eq(profitSnapshots.targetId, filter.targetId));
      if (filter.from) conds.push(gte(profitSnapshots.periodStart, filter.from));
      if (filter.to) conds.push(lte(profitSnapshots.periodEnd, filter.to));

      return tx
        .select()
        .from(profitSnapshots)
        .where(and(...conds))
        .orderBy(desc(profitSnapshots.calculatedAt), desc(profitSnapshots.id));
    });
  }

  /** Snapshot mới nhất cho 1 target (latest = calculated_at lớn nhất). null nếu chưa có. */
  findLatest(companyId: string, targetType: string, targetId: string | null) {
    return this.db.withTenant(companyId, async (tx) => {
      const conds = [
        eq(profitSnapshots.companyId, companyId),
        eq(profitSnapshots.targetType, targetType),
      ];
      conds.push(
        targetId == null
          ? sql`${profitSnapshots.targetId} IS NULL`
          : eq(profitSnapshots.targetId, targetId),
      );
      const [row] = await tx
        .select()
        .from(profitSnapshots)
        .where(and(...conds))
        .orderBy(desc(profitSnapshots.calculatedAt), desc(profitSnapshots.id))
        .limit(1);
      return row ?? null;
    });
  }
}
