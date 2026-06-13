import type { TaskDto } from "@mediaos/contracts";

/**
 * Constants dùng chung cho mọi view task (route /tasks + Task Board /tasks/board) — DRY
 * (CLAUDE.md §5 FE: "status/text dùng constants chung"). Nhãn tiếng Việt là nguồn hiển thị duy nhất.
 */

// ─── Status (đầy đủ vòng đời) ───────────────────────────────────────────────────

export const TASK_STATUS_LABELS: Record<TaskDto["status"], string> = {
  not_started: "Chưa bắt đầu",
  in_progress: "Đang làm",
  waiting_review: "Chờ duyệt",
  revision: "Đang sửa",
  approved: "Đã duyệt",
  completed: "Hoàn thành",
};

export const TASK_STATUS_COLORS: Record<TaskDto["status"], string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-700",
  waiting_review: "bg-yellow-100 text-yellow-700",
  revision: "bg-orange-100 text-orange-700",
  approved: "bg-green-100 text-green-700",
  completed: "bg-green-200 text-green-800",
};

// ─── Task type (7 nguồn spec + workflow_step back-compat) ─────────────────────────

export const TASK_TYPE_LABELS: Record<TaskDto["taskType"], string> = {
  workflow_step: "Quy trình",
  production: "Sản xuất",
  review: "Duyệt",
  revision: "Trả sửa",
  meeting_action: "Sau họp",
  office: "Văn phòng",
  finance: "Tài chính",
  hr: "Nhân sự",
};

/**
 * Thứ tự cột Kanban cho luồng rút gọn (office/non-workflow). Workflow status (waiting_review/
 * approved/revision) KHÔNG render cột riêng trong board rút gọn — chúng do FSM quản (G7/ADR-0016).
 * Đây là 3 cột chính + giữ map đầy đủ ở TASK_STATUS_LABELS cho card workflow hiển thị badge.
 */
export const SHORTENED_FLOW_STATUSES = ["not_started", "in_progress", "completed"] as const;
export type ShortenedFlowStatus = (typeof SHORTENED_FLOW_STATUSES)[number];

/** Cột Kanban đầy đủ (gồm cả status workflow) cho board hỗn hợp — order ổn định theo vòng đời. */
export const KANBAN_STATUS_ORDER: ReadonlyArray<TaskDto["status"]> = [
  "not_started",
  "in_progress",
  "waiting_review",
  "revision",
  "approved",
  "completed",
];

/**
 * Task types do workflow engine (FSM) sở hữu vòng đời — KHÔNG cho đổi status tay ở FE
 * (mirror BE WORKFLOW_TASK_TYPES + officeTaskStatusSchema). office/meeting_action/finance/hr đi
 * luồng rút gọn. Server vẫn là sự thật (SEC-2) — đây chỉ là mirror UX.
 */
export const WORKFLOW_TASK_TYPES: ReadonlySet<TaskDto["taskType"]> = new Set([
  "workflow_step",
  "production",
  "review",
  "revision",
]);

/**
 * Task này có đi luồng rút gọn (đổi status tay được) không?
 * Điều kiện: KHÔNG gắn workflow step (stepId == null) VÀ taskType không thuộc FSM.
 */
export function isShortenedFlowTask(task: Pick<TaskDto, "taskType" | "stepId">): boolean {
  return task.stepId == null && !WORKFLOW_TASK_TYPES.has(task.taskType);
}
