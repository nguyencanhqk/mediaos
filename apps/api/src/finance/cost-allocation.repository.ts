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
   * Cross-tenant target guard (batch): target tồn tại trong tenant hiện tại (RLS lọc). Polymorphic —
   * không FK, nên kiểm tay qua bảng tương ứng. Soft-deleted (deleted_at) coi như KHÔNG tồn tại (các
   * bảng target này đều có cột deleted_at). Chạy CÙNG tx (RLS đã set company_id).
   *
   * G16-2 perf — batch cross-tenant target guard. Thay vòng N lần targetExistsTx (≤200 round-trip,
   * AllocateCostRequest.targets.max(200)) bằng 1 query / loại target (≤6 loại). Cùng ngữ nghĩa:
   * target tồn tại trong tenant (RLS lọc company_id) AND deleted_at IS NULL.
   *
   * Trả Set "targetType:targetId" của các target HIỆN HỮU — caller so với input để tìm target thiếu.
   * table là literal từ map cố định (KHÔNG nhận từ input) → an toàn raw; targetId qua bind-param ($n).
   */
  async existingTargetsTx(
    tx: TenantTx,
    targets: readonly { targetType: AllocationTargetType; targetId: string }[],
  ): Promise<Set<string>> {
    const found = new Set<string>();
    if (targets.length === 0) return found;

    // Gom id theo loại → 1 query / loại (mỗi loại có bảng riêng, polymorphic không FK).
    const idsByType = new Map<AllocationTargetType, string[]>();
    for (const t of targets) {
      const list = idsByType.get(t.targetType);
      if (list) list.push(t.targetId);
      else idsByType.set(t.targetType, [t.targetId]);
    }

    for (const [targetType, ids] of idsByType) {
      if (ids.length === 0) continue; // sql.join([]) → "IN ()" = lỗi cú pháp; guard phòng vỡ tương lai.
      const table = TARGET_TABLE[targetType];
      if (!table) {
        // targetType là khoá discriminated-union từ contracts; map cố định PHẢI phủ hết. Nếu thêm
        // loại target mới mà quên cập nhật TARGET_TABLE → fail LOUD thay vì SQL hỏng/identifier(undefined).
        throw new Error(`existingTargetsTx: thiếu TARGET_TABLE cho targetType '${targetType}'`);
      }
      const idList = sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      );
      const res = await tx.execute(
        sql`SELECT id FROM ${sql.identifier(table)}
            WHERE id IN (${idList}) AND deleted_at IS NULL`,
      );
      for (const row of res.rows) {
        const id = row.id;
        if (typeof id !== "string" || id.length === 0) {
          // Mọi PK là UUID (driver trả string). Cast ngầm "as string" che sai lệch type → key lệch →
          // false-missing 400 trên target THẬT SỰ tồn tại. Ép kiểm để fail LOUD nếu giả định vỡ.
          throw new Error(
            `existingTargetsTx: id không phải string từ ${table}: ${JSON.stringify(id)}`,
          );
        }
        found.add(`${targetType}:${id}`);
      }
    }
    return found;
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
