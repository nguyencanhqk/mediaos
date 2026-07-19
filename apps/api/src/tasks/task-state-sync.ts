import type { TaskCoreStatus } from "./task-fsm";

/**
 * S5-TASK-PIPELINE-1 (lane fsm) — D-20/D-21 (DECISIONS-03): ánh xạ nhóm cột pipeline ↔ task_status
 * + bậc thang chọn cột đích cho ĐỒNG BỘ NGƯỢC state_id khi đổi status ngoài board. Thuần, KHÔNG DB.
 *
 * Nhóm 'review' được thêm vào CHECK project_states ở migration 0499 (lane migration) — hằng số khai
 * trước để dùng chung; trước 0499 dữ liệu chưa có nhóm này nên bậc thang tự rơi xuống fallback.
 */

export const PROJECT_STATE_GROUPS = [
  "backlog",
  "unstarted",
  "started",
  "review",
  "completed",
  "cancelled",
] as const;
export type ProjectStateGroup = (typeof PROJECT_STATE_GROUPS)[number];

/** Nhóm cột → status (chiều XUÔI, đơn trị — dùng cho auto-map khi kéo thẻ và guard D-21.2). */
export const STATE_GROUP_TO_STATUS: Record<ProjectStateGroup, TaskCoreStatus> = {
  backlog: "Todo",
  unstarted: "Todo",
  started: "In Progress",
  review: "In Review",
  completed: "Done",
  cancelled: "Cancelled",
};

/**
 * status → danh sách nhóm đích theo THỨ TỰ ưu tiên (chiều NGƯỢC, không đơn trị — D-20: Todo ứng cả
 * unstarted lẫn backlog, chỉ rơi xuống backlog khi dự án không có cột unstarted nào).
 */
const STATUS_TO_GROUP_LADDER: Record<TaskCoreStatus, readonly ProjectStateGroup[]> = {
  Todo: ["unstarted", "backlog"],
  "In Progress": ["started"],
  "In Review": ["review"],
  Done: ["completed"],
  Cancelled: ["cancelled"],
};

/** 1 cột pipeline cho picker — caller PHẢI đưa vào theo ORDER BY sort_order, created_at, id (D-20). */
export interface SyncStateRow {
  id: string;
  stateGroup: string;
  isDefault: boolean;
}

/**
 * Guard D-21.2 — "thẻ ĐÃ ở cột đúng nhóm thì KHÔNG chuyển". Đây là phanh bảo đảm dừng của hệ hai
 * chiều status↔state (DECISIONS-03 D-21.3b): bỏ guard này thì đặt In Progress cho thẻ ở cột Hậu Kỳ
 * sẽ giật thẻ về cột Quay. TASK-TC-026h bảo vệ — đừng "dọn dẹp" thành luôn-chuẩn-hoá.
 */
export function isStateInGroupForStatus(
  stateGroup: string | null | undefined,
  status: TaskCoreStatus,
): boolean {
  if (!stateGroup) return false;
  return STATE_GROUP_TO_STATUS[stateGroup as ProjectStateGroup] === status;
}

/**
 * Bậc thang D-20 chọn cột đích: nhóm đích (theo thứ tự ưu tiên) → cột is_default → cột đầu danh sách
 * (sort_order nhỏ nhất). `states` đã sort ORDER BY sort_order, created_at, id — tie-break XÁC ĐỊNH
 * vì sort_order mặc định 0 trùng nhau và is_default không unique ở tầng DB. Dự án 0 state → null.
 */
export function pickTargetState(
  states: readonly SyncStateRow[],
  toStatus: TaskCoreStatus,
): SyncStateRow | null {
  for (const group of STATUS_TO_GROUP_LADDER[toStatus]) {
    const hit = states.find((s) => s.stateGroup === group);
    if (hit) return hit;
  }
  const fallbackDefault = states.find((s) => s.isDefault);
  if (fallbackDefault) return fallbackDefault;
  return states[0] ?? null;
}
