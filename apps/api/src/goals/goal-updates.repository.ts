import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { goalUpdates, type GoalUpdate } from "../db/schema/goals";
import { users } from "../db/schema/users";
import type { GoalUpdateRowWithActor } from "./goals.mapper";

/**
 * S5-GOAL-BE-2 — sổ `goal_updates` (DB-11 §6.2 · SPEC-10 §13/§15 GOAL-API-007/008/009).
 *
 * ╔══ APPEND-ONLY (BẤT BIẾN #2) ═══════════════════════════════════════════════════════════════════╗
 * ║ Repository này CHỈ có `insert` và `select`. KHÔNG có — và KHÔNG ĐƯỢC THÊM — method update/delete.║
 * ║ Đây là lớp thứ HAI: lớp thứ nhất là GRANT ở DB (migration 0504 chỉ cấp SELECT,INSERT cho app     ║
 * ║ role) và đó mới là lớp thật — nếu ai đó "tiện tay" viết `tx.update(goalUpdates)` thì Postgres     ║
 * ║ từ chối, không phải review từ chối. Đừng đổi thứ tự hai lớp đó trong đầu.                        ║
 * ╚═════════════════════════════════════════════════════════════════════════════════════════════════╝
 *
 * BẤT BIẾN #1: chạy TRONG tx của `withTenant` + AND `company_id` tường minh mọi câu.
 */

export interface GoalUpdateInsertValues {
  goalId: string;
  updateType: "checkin" | "finalize" | "reopen";
  actorUserId: string;
  oldCurrentValue: string | null;
  newCurrentValue: string | null;
  oldProgressPercent: string | null;
  newProgressPercent: string | null;
  confidence: number | null;
  note: string | null;
}

@Injectable()
export class GoalUpdatesRepository {
  async insertTx(tx: TenantTx, companyId: string, v: GoalUpdateInsertValues): Promise<GoalUpdate> {
    const [row] = await tx
      .insert(goalUpdates)
      .values({
        companyId,
        goalId: v.goalId,
        updateType: v.updateType,
        actorUserId: v.actorUserId,
        oldCurrentValue: v.oldCurrentValue,
        newCurrentValue: v.newCurrentValue,
        oldProgressPercent: v.oldProgressPercent,
        newProgressPercent: v.newProgressPercent,
        confidence: v.confidence,
        note: v.note,
      })
      .returning();
    if (!row) throw new Error("insertTx: INSERT goal_updates trả về 0 row");
    return row;
  }

  /**
   * Lịch sử check-in mới nhất trước (GOAL-API-008). Khớp index `idx_goal_updates_goal`.
   * S20-GOAL-OWNERCHECKIN-1 (Q14 = B): LEFT JOIN `users` lấy TÊN HIỂN THỊ người check-in — chỉ cột
   * `full_name`; tài khoản đã xoá mềm ⇒ null («—»). Người gọi đã qua cổng đọc mục tiêu (view:goal).
   */
  async listByGoalTx(
    tx: TenantTx,
    companyId: string,
    goalId: string,
    limit: number,
    offset: number,
  ): Promise<GoalUpdateRowWithActor[]> {
    const rows = await tx
      .select({
        update: goalUpdates,
        actorName: users.fullName,
        actorDeletedAt: users.deletedAt,
      })
      .from(goalUpdates)
      .leftJoin(
        users,
        and(eq(users.id, goalUpdates.actorUserId), eq(users.companyId, goalUpdates.companyId)),
      )
      .where(and(eq(goalUpdates.companyId, companyId), eq(goalUpdates.goalId, goalId)))
      .orderBy(desc(goalUpdates.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({
      ...r.update,
      actorName: r.actorDeletedAt ? null : (r.actorName ?? null),
    }));
  }

  /**
   * S20-GOAL-OWNERCHECKIN-1 — MAX(created_at) check-in theo LÔ mục tiêu bằng MỘT truy vấn GROUP BY
   * (không truy vấn từng mục tiêu). Chỉ `update_type=checkin` — chốt/mở lại kỳ không tính là check-in.
   * Mục tiêu chưa từng check-in vắng khỏi Map. company_id tường minh (BẤT BIẾN #1).
   */
  async lastCheckinByGoalIdsTx(
    tx: TenantTx,
    companyId: string,
    goalIds: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (goalIds.length === 0) return out;
    const rows = await tx
      .select({ goalId: goalUpdates.goalId, lastAt: max(goalUpdates.createdAt) })
      .from(goalUpdates)
      .where(
        and(
          eq(goalUpdates.companyId, companyId),
          inArray(goalUpdates.goalId, [...goalIds]),
          eq(goalUpdates.updateType, "checkin"),
        ),
      )
      .groupBy(goalUpdates.goalId);
    for (const r of rows) {
      if (r.lastAt === null || r.lastAt === undefined) continue;
      out.set(r.goalId, new Date(r.lastAt).toISOString());
    }
    return out;
  }
}
