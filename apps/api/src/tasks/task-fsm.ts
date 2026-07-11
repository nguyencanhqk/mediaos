/**
 * S4-TASK-BE-3 — FSM transition table THUẦN (SPEC-06 §14.11:1458-1472 — "bảng transition chuẩn (nguồn gốc)
 * cho toàn hệ thống"; BACKEND-08 §9.7:490-496). KHÔNG side-effect, KHÔNG DB — unit-test được (task-fsm.spec.ts).
 *
 * Reopen Done→In Progress: mặc định TẮT (hard-off, BACKEND-08:495 "không mặc định"); hook setting để WO sau.
 * Cancelled: terminal (SPEC-06:1464,1479) — MỌI đích → 422 TASK-ERR-TASK-CLOSED (kể cả chính nó).
 * from = NULL (hàng legacy chưa backfill, CHECK 0478 cho phép NULL) → coalesce 'Todo' rồi áp bảng.
 * from === to (KHÔNG Cancelled) → no-op (open q #6): ok=true + noop=true; caller BỎ QUA (0 event/activity).
 */

export const TASK_CORE_STATUSES = [
  "Todo",
  "In Progress",
  "In Review",
  "Done",
  "Cancelled",
] as const;
export type TaskCoreStatus = (typeof TASK_CORE_STATUSES)[number];

/** Bảng transition hợp lệ (Cancelled xử lý riêng = terminal; Done = tập rỗng vì reopen hard-off). */
const TRANSITIONS: Record<TaskCoreStatus, ReadonlySet<TaskCoreStatus>> = {
  Todo: new Set(["In Progress", "Cancelled"]),
  "In Progress": new Set(["In Review", "Done", "Cancelled"]),
  "In Review": new Set(["In Progress", "Done", "Cancelled"]),
  Done: new Set(), // reopen mặc định TẮT
  Cancelled: new Set(), // terminal — mọi đích chặn ở evaluateTransition (422)
};

export type TaskTransitionErrorCode = "TASK-ERR-WORKFLOW-INVALID" | "TASK-ERR-TASK-CLOSED";

export interface TransitionOk {
  ok: true;
  from: TaskCoreStatus;
  to: TaskCoreStatus;
  /** from === to (không Cancelled) → caller trả 200 im lặng, KHÔNG mutate/event/activity. */
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
 * Đánh giá 1 transition. KHÔNG throw — trả kết quả để service ánh xạ HTTP (Conflict 409 / Unprocessable 422).
 *   - from='Cancelled' (terminal) → 422 TASK-ERR-TASK-CLOSED (ưu tiên cao nhất, kể cả to='Cancelled').
 *   - from===to (không Cancelled) → ok + noop.
 *   - to ∈ TRANSITIONS[from] → ok, noop=false.
 *   - else → 409 TASK-ERR-WORKFLOW-INVALID.
 */
export function evaluateTransition(
  fromRaw: string | null | undefined,
  to: TaskCoreStatus,
): TransitionResult {
  const from = coalesceTaskStatus(fromRaw);
  if (from === "Cancelled") {
    return { ok: false, from, to, code: "TASK-ERR-TASK-CLOSED", httpStatus: 422 };
  }
  if (from === to) {
    return { ok: true, from, to, noop: true };
  }
  if (TRANSITIONS[from].has(to)) {
    return { ok: true, from, to, noop: false };
  }
  return { ok: false, from, to, code: "TASK-ERR-WORKFLOW-INVALID", httpStatus: 409 };
}
