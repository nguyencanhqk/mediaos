/**
 * S4-TASK-BE-3 → S5-TASK-PIPELINE-1 — FSM transition table THUẦN (SPEC-06 §6.10.1 — bảng chuyển
 * trạng thái chuẩn, nới 18/07/2026 theo DECISIONS-03 D-18; §14.11 chỉ còn là bản lịch sử).
 * KHÔNG side-effect, KHÔNG DB — unit-test được (task-fsm.spec.ts).
 *
 * Luật nới (D-18): board pipeline ⇒ quy trình nằm ở THỨ TỰ CỘT, không còn ở bảng FSM. 4 status
 * hoạt động thông nhau MỌI HƯỚNG (kéo vượt cấp là thao tác hằng ngày); Cancelled → {Todo, In Progress}
 * để khôi phục. Ca từ chối còn lại duy nhất: Cancelled → In Review/Done (409 — TRA BẢNG, không
 * early-return: mục Cancelled trong bảng phải sống, bẫy M4).
 * from = NULL (hàng legacy chưa backfill, CHECK 0478 cho phép NULL) → coalesce 'Todo' rồi áp bảng.
 * from === to → no-op (ok=true + noop=true; caller BỎ QUA — 0 event/activity), kể cả Cancelled.
 * Task đã huỷ vẫn bị khoá assign/priority/deadline (guard loadMutable ở service — chỉ nới ĐƯỜNG
 * changeStatus, không mở quyền sửa task đã huỷ).
 */

export const TASK_CORE_STATUSES = [
  "Todo",
  "In Progress",
  "In Review",
  "Done",
  "Cancelled",
] as const;
export type TaskCoreStatus = (typeof TASK_CORE_STATUSES)[number];

/** Bảng transition hợp lệ (SPEC-06 §6.10.1). Cancelled chỉ khôi phục về Todo/In Progress. */
const TRANSITIONS: Record<TaskCoreStatus, ReadonlySet<TaskCoreStatus>> = {
  Todo: new Set(["In Progress", "In Review", "Done", "Cancelled"]),
  "In Progress": new Set(["Todo", "In Review", "Done", "Cancelled"]),
  "In Review": new Set(["Todo", "In Progress", "Done", "Cancelled"]),
  Done: new Set(["Todo", "In Progress", "In Review", "Cancelled"]),
  Cancelled: new Set(["Todo", "In Progress"]), // khôi phục (D-18) — KHÔNG cho đi thẳng In Review/Done
};

export type TaskTransitionErrorCode = "TASK-ERR-WORKFLOW-INVALID" | "TASK-ERR-TASK-CLOSED";

export interface TransitionOk {
  ok: true;
  from: TaskCoreStatus;
  to: TaskCoreStatus;
  /** from === to → caller trả 200 im lặng, KHÔNG mutate/event/activity. */
  noop: boolean;
}
export interface TransitionErr {
  ok: false;
  from: TaskCoreStatus;
  to: TaskCoreStatus;
  code: TaskTransitionErrorCode;
  httpStatus: 409 | 422;
}
export type TransitionResult = TransitionOk | TransitionErr;

/** from thô (cột task_status có thể NULL/legacy) → TaskCoreStatus. Giá trị lạ → 'Todo' (an toàn, coalesce). */
export function coalesceTaskStatus(raw: string | null | undefined): TaskCoreStatus {
  if (raw && (TASK_CORE_STATUSES as readonly string[]).includes(raw)) {
    return raw as TaskCoreStatus;
  }
  return "Todo";
}

/**
 * Đánh giá 1 transition. KHÔNG throw — trả kết quả để service ánh xạ HTTP (Conflict 409).
 *   - from===to → ok + noop (kể cả Cancelled — §6.10.1 "chuyển tới cùng trạng thái = không làm gì").
 *   - to ∈ TRANSITIONS[from] → ok, noop=false.
 *   - else → 409 TASK-ERR-WORKFLOW-INVALID (sau nới, thực tế chỉ còn Cancelled → In Review/Done).
 */
export function evaluateTransition(
  fromRaw: string | null | undefined,
  to: TaskCoreStatus,
): TransitionResult {
  const from = coalesceTaskStatus(fromRaw);
  if (from === to) {
    return { ok: true, from, to, noop: true };
  }
  if (TRANSITIONS[from].has(to)) {
    return { ok: true, from, to, noop: false };
  }
  return { ok: false, from, to, code: "TASK-ERR-WORKFLOW-INVALID", httpStatus: 409 };
}

export interface StatusTimestampOps {
  completedAt: "now" | "clear" | "keep";
  cancelledAt: "now" | "clear" | "keep";
}

/**
 * D-19 (DECISIONS-03): vào Done/Cancelled ⇒ set mốc; RỜI Done ⇒ clear completed_at + completed_by;
 * RỜI Cancelled ⇒ clear cancelled_at. Một chiều, không ngoại lệ — giữ mốc cũ làm sai lead-time.
 * (Nhánh 'clear' của task-actions.repository.updateStatusTx xoá cả cột *_by đi kèm.)
 */
export function deriveStatusTimestamps(
  from: TaskCoreStatus,
  to: TaskCoreStatus,
): StatusTimestampOps {
  return {
    completedAt: to === "Done" ? "now" : from === "Done" ? "clear" : "keep",
    cancelledAt: to === "Cancelled" ? "now" : from === "Cancelled" ? "clear" : "keep",
  };
}
