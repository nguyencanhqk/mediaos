import type { TenantTx } from "../db/db.service";
import type { GoalRefViewer, TaskGoalRefPolicy } from "./task-goal-ref.policy";

/**
 * S20-TASK-MYTASKSLOAD-1 — cổng của bộ lọc `GET /tasks?goalId=`.
 *
 * Bộ lọc CHỈ thu hẹp trong phạm vi đọc việc sẵn có; thêm một cổng nữa theo quyền xem mục tiêu để không
 * lộ «mục tiêu này có việc» cho người không xem được mục tiêu. Không xem được / không tồn tại / công ty
 * khác / xoá mềm / khoá API ⇒ `false` (người gọi trả danh sách RỖNG — không 403/404, không lộ tồn tại).
 * `viewer` resolve NGOÀI tx (một lượt đọc grant); ở đây tối đa MỘT truy vấn lô trên `tx`.
 */
export async function isGoalFilterVisibleTx(
  policy: Pick<TaskGoalRefPolicy, "visibleGoalIdsTx">,
  tx: TenantTx,
  viewer: GoalRefViewer,
  goalId: string,
): Promise<boolean> {
  if (viewer.scope == null) return false;
  const visible = await policy.visibleGoalIdsTx(tx, viewer, [goalId]);
  return visible.has(goalId);
}
