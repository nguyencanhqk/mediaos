import { z } from "zod";
import { taskCorePrioritySchema, taskCoreResponseSchema, taskCoreStatusSchema } from "./task";

// ═══════════════════════════════════════════════════════════════════════════════
// S4-TASK-BE-3 — Task actions crown-FSM (SPEC-06 §14, API-06 §14 · TASK-API-206..209).
//
// 6 route mới dưới /tasks/:taskId: assign · change-status · change-priority · change-deadline
// (verb canonical SPEC-06 §16.3 TK-4 — KHÔNG PUT .../status) · watchers add/remove (self-only MVP).
//
// PHÂN BIỆT với `updateTaskCoreSchema` (BE-2, PATCH /tasks/:id — KHÔNG đổi status). Ở đây mỗi action là
// 1 chuyển-trạng-thái/side-effect riêng qua FSM (Todo→In Progress→In Review→Done/Cancelled), phát outbox
// event canonical §9.5 + activity + audit trong CÙNG tx. File TÁCH khỏi task.ts (đã 665 dòng, sát trần 800).
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /tasks/:taskId/assign (TASK-API-206, assign:task). `assigneeEmployeeId` là nguồn sự thật —
 * server resolve employee_profiles + validate active/có-tài-khoản + trong-phạm-vi-người-giao. MVP CHỈ Main
 * assignee (BACKEND-08:486); `co_assignee_employee_ids` NGOÀI phạm vi WO này.
 */
export const assignTaskSchema = z
  .object({
    assigneeEmployeeId: z.string().uuid(),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
export type AssignTaskRequest = z.infer<typeof assignTaskSchema>;

/**
 * POST /tasks/:taskId/change-status (TASK-API-207, update-status:task). `status` ∈ enum core; transition
 * hợp lệ do FSM server quyết (sai bảng → 409 TASK-ERR-WORKFLOW-INVALID). `reason` (tự do) CHỈ vào
 * task_activity_logs.message / audit — KHÔNG BAO GIỜ vào payload outbox (có thể nhạy cảm, §19).
 */
export const changeTaskStatusSchema = z
  .object({
    status: taskCoreStatusSchema,
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
export type ChangeTaskStatusRequest = z.infer<typeof changeTaskStatusSchema>;

/** POST /tasks/:taskId/change-priority (TASK-API-208, update-priority:task). */
export const changeTaskPrioritySchema = z
  .object({
    priority: taskCorePrioritySchema,
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
export type ChangeTaskPriorityRequest = z.infer<typeof changeTaskPrioritySchema>;

/**
 * POST /tasks/:taskId/change-deadline (TASK-API-209, update-deadline:task). `dueAt` nullable (null = gỡ
 * hạn). due < start_at → 400 TASK-ERR-INVALID-DATE-RANGE (khớp CHECK chk_tasks_due_after_start 0478).
 */
export const changeTaskDeadlineSchema = z
  .object({
    dueAt: z.string().datetime({ offset: true }).nullable(),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
export type ChangeTaskDeadlineRequest = z.infer<typeof changeTaskDeadlineSchema>;

/**
 * POST /tasks/:taskId/watchers (watch:task) — SELF-ONLY MVP (open question #4). KHÔNG nhận `employee_id`
 * trong body — actor luôn tự-watch (giảm bề mặt tấn công + tránh scope-path under-tested). Body rỗng hợp lệ.
 */
export const addWatcherSchema = z.object({}).strict();
export type AddWatcherRequest = z.infer<typeof addWatcherSchema>;

/**
 * Mã cảnh báo (KHÔNG chặn) trả trong `warnings[]` — SPEC-06:1412 / API-06:1327.
 *   • ASSIGNEE-ON-LEAVE: assignee có leave_requests Approved trùm mốc due/deadline (MVP không chặn).
 *   • ASSIGNEE-NOT-MEMBER: assignee không là project member (CHỈ phát khi task có project_id — open q #5).
 * Enum KHAI Ở CONTRACTS (nguồn sự thật) — SPEC không định nghĩa slug WARN nên chốt ở đây.
 */
export const taskActionWarningCodeSchema = z.enum([
  "TASK-WARN-ASSIGNEE-ON-LEAVE",
  "TASK-WARN-ASSIGNEE-NOT-MEMBER",
]);
export type TaskActionWarningCode = z.infer<typeof taskActionWarningCodeSchema>;

export const taskActionWarningSchema = z.object({
  code: taskActionWarningCodeSchema,
  message: z.string(),
});
export type TaskActionWarning = z.infer<typeof taskActionWarningSchema>;

/**
 * Response chung cho action mutate vòng đời task (assign/status/priority/deadline/watch-add): task đã reload
 * + `warnings[]` (rỗng khi không có cảnh báo). DELETE /watchers/:id trả 204 (không body).
 */
export const taskActionResponseSchema = z.object({
  task: taskCoreResponseSchema,
  warnings: z.array(taskActionWarningSchema),
});
export type TaskActionResponseDto = z.infer<typeof taskActionResponseSchema>;
