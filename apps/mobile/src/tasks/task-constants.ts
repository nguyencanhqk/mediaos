import type { TaskDto, OfficeTaskStatusDto } from "@mediaos/contracts";

/**
 * Shared task display constants — mirrors apps/web/src/components/tasks/task-status-constants.ts
 * so mobile and web speak the same Vietnamese labels (CLAUDE.md §5 FE: "status/text dùng constants chung").
 * The server is the source of truth for status transitions; these are display + UX-gating mirrors only.
 */

export const TASK_STATUS_LABELS: Record<TaskDto["status"], string> = {
  not_started: "Chưa bắt đầu",
  in_progress: "Đang làm",
  waiting_review: "Chờ duyệt",
  revision: "Đang sửa",
  approved: "Đã duyệt",
  completed: "Hoàn thành",
};

export const TASK_STATUS_COLORS: Record<TaskDto["status"], string> = {
  not_started: "#6b7280",
  in_progress: "#2563eb",
  waiting_review: "#b45309",
  revision: "#c2410c",
  approved: "#15803d",
  completed: "#166534",
};

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

/** Shortened office flow (G9-3): Chưa bắt đầu → Đang làm → Hoàn thành. */
export const SHORTENED_FLOW_STATUSES: readonly OfficeTaskStatusDto[] = [
  "not_started",
  "in_progress",
  "completed",
];

/**
 * Task types whose lifecycle is OWNED by the workflow FSM — their status is NOT hand-editable on the
 * client (mirror BE WORKFLOW_TASK_TYPES + officeTaskStatusSchema). office/meeting_action/finance/hr
 * go through the shortened flow.
 */
export const WORKFLOW_TASK_TYPES: ReadonlySet<TaskDto["taskType"]> = new Set([
  "workflow_step",
  "production",
  "review",
  "revision",
]);

/**
 * Does this task go through the shortened (hand-editable) flow?
 * Condition: NOT bound to a workflow step (stepId == null) AND taskType is not FSM-owned.
 */
export function isShortenedFlowTask(task: Pick<TaskDto, "taskType" | "stepId">): boolean {
  return task.stepId == null && !WORKFLOW_TASK_TYPES.has(task.taskType);
}

/** Statuses considered "open" (count toward the home "việc cần làm" summary). */
export const OPEN_TASK_STATUSES: ReadonlySet<TaskDto["status"]> = new Set([
  "not_started",
  "in_progress",
  "revision",
]);
