import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AllocationTargetType } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { costAllocations } from "../db/schema";

/**
 * G13-2 (FIN-003) — Repository phân bổ chi phí. cost_allocations là mutable CÓ KIỂM SOÁT:
 * GRANT SELECT,INSERT,UPDATE — KHÔNG DELETE (migration 0071). Re-allocate = soft-delete set cũ
 * (deleted_at) + insert set mới CÙNG tx. Mọi truy vấn qua withTenant (RLS ép company_id ở DB).
 *
 * Resolve weight DB-backed (by_video_count/by_task_count/by_revenue_ratio) bằng COUNT/SUM theo target
 * trong kỳ — chạy CÙNG tx (RLS lọc tenant). Cross-tenant target guard: targetExistsTx kiểm tra target
 * tồn tại trong tenant (qua RLS) TRƯỚC khi ghi.
 */

export interface InsertAllocationData {
  costRecordId: string;
  allocationRunId: string;
  allocationTargetType: AllocationTargetType;
  allocationTargetId: string;
  allocationMethod: string;
  allocatedAmount: string; // numeric → string
  allocationPercent?: string | null;
}

/** Bảng + cột id tự nhiên cho mỗi loại target (cross-tenant guard qua RLS). */
const TARGET_TABLE: Record<AllocationTargetType, string> = {
  channel: "channels",
  project: "projects",
  content_item: "content_items",
  team: "teams",
  org_unit: "org_units",
  employee: "employee_profiles",
};

/** Cột FK trong bảng nguồn theo loại target — dùng để COUNT/SUM weight. null = không hỗ trợ resolve DB. */
function targetColumn(
  source: "content_items" | "tasks" | "revenue_records",
  targetType: AllocationTargetType,
): string | null {
  if (targetType === "project") return "project_id";
  if (targetType === "content_item") {
    return source === "content_items" ? "id" : "content_item_id";
  }
  if (targetType === "channel") {
    if (source === "content_items") return "main_channel_id";
    if (source === "revenue_records") return "channel_id";
    return null; // tasks không có channel_id
  }
  return null; // team/org_unit/employee: không có FK trực tiếp ở source → 0 (caller xử lý weight=0)
}

@Injectable()
export class CostAllocationRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Allocation ĐANG hiệu lực (deleted_at IS NULL) của 1 cost — CÙNG tx. */
  async listActiveByCostTx(tx: TenantTx, companyId: string, costRecordId: string) {
    return tx
      .select()
      .from(costAllocations)
      .where(
        and(
          eq(costAllocations.companyId, companyId),
          eq(costAllocations.costRecordId, costRecordId),
          isNull(costAllocations.deletedAt),
        ),
      );
  }

  /**
   * Soft-delete TẤT CẢ allocation active của 1 cost (re-allocate). KHÔNG DELETE — set deleted_at.
   * Trả số dòng bị soft-delete.
   */
  async softDeleteActiveTx(tx: TenantTx, companyId: string, costRecordId: string): Promise<number> {
    const rows = await tx
      .update(costAllocations)
      .set({ deletedAt: sql`now()` })
      .where(
        and(
          eq(costAllocations.companyId, companyId),
          eq(costAllocations.costRecordId, costRecordId),
          isNull(costAllocations.deletedAt),
        ),
      )
      .returning({ id: costAllocations.id });
    return rows.length;
  }

  /** INSERT 1 dòng allocation (CÙNG tx với audit). */
  async insertTx(tx: TenantTx, data: InsertAllocationData) {
    const [row] = await tx
      .insert(costAllocations)
      .values({
        costRecordId: data.costRecordId,
        allocationRunId: data.allocationRunId,
        allocationTargetType: data.allocationTargetType,
        allocationTargetId: data.allocationTargetId,
        allocationMethod: data.allocationMethod,
        allocatedAmount: data.allocatedAmount,
        allocationPercent: data.allocationPercent ?? null,
      })
      .returning();
    return row;
  }

  /**
   * BATCH INSERT N dòng allocation trong 1 câu lệnh (gỡ N+1 — B2(b)). CÙNG tx với audit/soft-delete.
   * Mảng rỗng → trả [] KHÔNG gọi DB (Drizzle .values([]) ném lỗi). Giữ cents-exact (caller đã chia).
   */
  async insertManyTx(tx: TenantTx, rows: readonly InsertAllocationData[]) {
    if (rows.length === 0) return [];
    return tx
      .insert(costAllocations)
      .values(
        rows.map((data) => ({
          costRecordId: data.costRecordId,
          allocationRunId: data.allocationRunId,
          allocationTargetType: data.allocationTargetType,
          allocationTargetId: data.allocationTargetId,
          allocationMethod: data.allocationMethod,
          allocatedAmount: data.allocatedAmount,
          allocationPercent: data.allocationPercent ?? null,
        })),
      )
      .returning();
  }

  /**
   * Cross-tenant target guard: target tồn tại trong tenant hiện tại (RLS lọc). Polymorphic — không FK,
   * nên kiểm tay qua bảng tương ứng. Soft-deleted (deleted_at) coi như KHÔNG tồn tại (trừ bảng không có
   * cột deleted_at — đều có ở các target này). Chạy CÙNG tx (RLS đã set company_id).
   */
  async targetExistsTx(
    tx: TenantTx,
    targetType: AllocationTargetType,
    targetId: string,
  ): Promise<boolean> {
    const table = TARGET_TABLE[targetType];
    // table là literal từ map cố định (KHÔNG nhận từ input) → an toàn raw. targetId qua bind-param.
    const res = await tx.execute(
      sql`SELECT 1 FROM ${sql.identifier(table)}
          WHERE id = ${targetId} AND deleted_at IS NULL LIMIT 1`,
    );
    return (res.rows?.length ?? 0) > 0;
  }

  /**
   * BATCH cross-tenant target guard (gỡ N+1 — B2(b)): với mỗi loại target, 1 query `id = ANY($ids)`
   * (≤6 query bất kể N target). Trả Set "type:id" của target TỒN TẠI trong tenant (soft-deleted = không
   * tồn tại). Chạy CÙNG tx (RLS đã set company_id). sql.identifier(table) = literal từ map cố định
   * (KHÔNG nhận input); ids qua bind-param (an toàn SQLi).
   */
  async existingTargetKeysTx(
    tx: TenantTx,
    targets: readonly { targetType: AllocationTargetType; targetId: string }[],
  ): Promise<Set<string>> {
    const existing = new Set<string>();
    // Gom id theo bảng (targetType → bảng cố định).
    const byType = new Map<AllocationTargetType, string[]>();
    for (const t of targets) {
      const list = byType.get(t.targetType) ?? [];
      list.push(t.targetId);
      byType.set(t.targetType, list);
    }
    for (const [targetType, ids] of byType) {
      const table = TARGET_TABLE[targetType];
      // dedupe để bind gọn. ids là uuid hợp lệ (Zod .uuid() ở contract).
      const uniqueIds = [...new Set(ids)];
      // string_to_array(csv,',')::uuid[] = 1 param an toàn (mirror kpi.repository): bind THẲNG mảng JS
      // vào sql`` → "malformed array literal" / "cannot cast record to uuid[]". CSV-join (uuid đã
      // validate) qua bind-param đơn → string_to_array ép thành uuid[]. 1 round-trip cho cả bảng này.
      const idCsv = uniqueIds.join(",");
      const res = await tx.execute(
        sql`SELECT id FROM ${sql.identifier(table)}
            WHERE id = ANY(string_to_array(${idCsv}, ',')::uuid[]) AND deleted_at IS NULL`,
      );
      for (const row of res.rows ?? []) {
        existing.add(`${targetType}:${(row as { id: string }).id}`);
      }
    }
    return existing;
  }

  /**
   * Resolve weight DB-backed cho 1 target trong kỳ (CÙNG tx, RLS lọc tenant):
   *  - by_video_count → COUNT content_items theo target (project/channel/content_item).
   *  - by_task_count  → COUNT tasks theo target (project/content_item).
   *  - by_revenue_ratio → SUM revenue HIỆU LỰC (entry_kind<>'void' AND chưa bị thay thế) theo target.
   *
   * Target không có FK trực tiếp ở nguồn (team/org_unit/employee với content/tasks) → weight 0.
   * Lọc kỳ tùy chọn (periodStart/periodEnd) theo cột ngày của nguồn.
   */
  async resolveWeightTx(
    tx: TenantTx,
    method: "by_video_count" | "by_task_count" | "by_revenue_ratio",
    targetType: AllocationTargetType,
    targetId: string,
    period: { from?: string; to?: string },
  ): Promise<number> {
    if (method === "by_video_count") {
      const col = targetColumn("content_items", targetType);
      if (!col) return 0;
      const res = await tx.execute(sql`
        SELECT count(*)::int AS n FROM content_items
        WHERE ${sql.identifier(col)} = ${targetId} AND deleted_at IS NULL
          ${period.from ? sql`AND created_at >= ${period.from}::date` : sql``}
          ${period.to ? sql`AND created_at < (${period.to}::date + 1)` : sql``}
      `);
      return Number(res.rows?.[0]?.n ?? 0);
    }

    if (method === "by_task_count") {
      const col = targetColumn("tasks", targetType);
      if (!col) return 0;
      const res = await tx.execute(sql`
        SELECT count(*)::int AS n FROM tasks
        WHERE ${sql.identifier(col)} = ${targetId} AND deleted_at IS NULL
          ${period.from ? sql`AND created_at >= ${period.from}::date` : sql``}
          ${period.to ? sql`AND created_at < (${period.to}::date + 1)` : sql``}
      `);
      return Number(res.rows?.[0]?.n ?? 0);
    }

    // by_revenue_ratio — SUM amount của revenue HIỆU LỰC theo target. Weight = cents (số nguyên).
    const col = targetColumn("revenue_records", targetType);
    if (!col) return 0;
    const res = await tx.execute(sql`
      SELECT COALESCE(SUM(round(amount * 100))::bigint, 0) AS cents FROM revenue_records rr
      WHERE ${sql.identifier(col)} = ${targetId}
        AND rr.entry_kind <> 'void'
        AND NOT EXISTS (SELECT 1 FROM revenue_records r2 WHERE r2.replaces_record_id = rr.id)
        ${period.from ? sql`AND rr.revenue_date >= ${period.from}::date` : sql``}
        ${period.to ? sql`AND rr.revenue_date <= ${period.to}::date` : sql``}
    `);
    return Number(res.rows?.[0]?.cents ?? 0);
  }
}
