import type { TaskDto } from "@mediaos/contracts";
import type { BadgeProps } from "@/components/ui/badge";

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

// ─── Redesign (PHASE 2 MISA): accent + tiến độ theo status ─────────────────────
// Bổ sung-only (DRY): card/kanban đọc các map này để hiển thị chấm màu cột, badge variant và
// thanh tiến độ. KHÔNG đổi nhãn/màu badge cũ (giữ TASK_STATUS_COLORS để không phá test/giao diện cũ).

/** Variant Badge dùng chung (success/warning/danger/muted/brand) cho từng status. */
export const TASK_STATUS_BADGE_VARIANT: Record<TaskDto["status"], NonNullable<BadgeProps["variant"]>> = {
  not_started: "muted",
  in_progress: "brand",
  waiting_review: "warning",
  revision: "danger",
  approved: "success",
  completed: "success",
};

/** Màu chấm tiêu đề cột Kanban (dot) — gợi ý trạng thái bằng màu. */
export const TASK_STATUS_DOT: Record<TaskDto["status"], string> = {
  not_started: "bg-muted-foreground/50",
  in_progress: "bg-brand",
  waiting_review: "bg-amber-500",
  revision: "bg-red-500",
  approved: "bg-emerald-500",
  completed: "bg-emerald-600",
};

/** Tiến độ ước lượng (%) theo vòng đời — chỉ để hiển thị thanh progress trên card. */
export const TASK_STATUS_PROGRESS: Record<TaskDto["status"], number> = {
  not_started: 0,
  in_progress: 40,
  waiting_review: 70,
  revision: 55,
  approved: 90,
  completed: 100,
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
