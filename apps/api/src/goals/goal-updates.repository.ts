import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { goalUpdates, type GoalUpdate } from "../db/schema/goals";

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

  /** Lịch sử check-in mới nhất trước (GOAL-API-008). Khớp index `idx_goal_updates_goal`. */
  async listByGoalTx(
    tx: TenantTx,
    companyId: string,
    goalId: string,
    limit: number,
    offset: number,
  ): Promise<GoalUpdate[]> {
    return tx
      .select()
      .from(goalUpdates)
      .where(and(eq(goalUpdates.companyId, companyId), eq(goalUpdates.goalId, goalId)))
      .orderBy(desc(goalUpdates.createdAt))
      .limit(limit)
      .offset(offset);
  }
}
