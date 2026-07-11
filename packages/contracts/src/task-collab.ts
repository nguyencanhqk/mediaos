import { z } from "zod";
import { taskCoreResponseSchema, taskCoreStatusSchema } from "./task";

// ═══════════════════════════════════════════════════════════════════════════════
// S4-TASK-BE-4 — Kanban board + move · comment/mention · checklist/items · activity feed
// (SPEC-06 §14.13/§14.14/§14.16/§14.19, API-06 §15/§16/§17/§16.7 · TASK-API-212/301-304/501-504/602).
// File TÁCH khỏi task.ts (665 dòng, sát trần 800) — mirror lý do tách của task-actions.ts (S4-TASK-BE-3).
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Kanban board (GET /projects/:id/kanban, TASK-API-212, view-kanban:task) ─────

export const taskKanbanColumnSchema = z.object({
  status: taskCoreStatusSchema,
  tasks: z.array(taskCoreResponseSchema),
});
export type TaskKanbanColumnDto = z.infer<typeof taskKanbanColumnSchema>;

export const taskKanbanBoardSchema = z.object({
  projectId: z.string().uuid(),
  columns: z.array(taskKanbanColumnSchema),
});
export type TaskKanbanBoardDto = z.infer<typeof taskKanbanBoardSchema>;

// Move (POST /tasks/:id/move) KHÔNG có schema riêng — controller tái dùng nguyên vẹn
// `changeTaskStatusSchema` (task-actions.ts): "move" chỉ là route sugar cho Kanban drag/drop, PHẢI
// đi qua CHÍNH `TaskActionsService.changeStatus` (không lách FSM — SPEC-06 API-06 §15.2).

// ─── Comments (GET/POST/PATCH/DELETE /tasks/:id/comments, TASK-API-301..304) ─────

const MENTION_MAX = 20;
const uniqueMentions = (v: { mentionEmployeeIds: string[] }) =>
  new Set(v.mentionEmployeeIds).size === v.mentionEmployeeIds.length;

export const createTaskCommentSchema = z
  .object({
    content: z.string().trim().min(1).max(5000),
    mentionEmployeeIds: z.array(z.string().uuid()).max(MENTION_MAX).default([]),
  })
  .strict()
  .refine(uniqueMentions, {
    message: "mentionEmployeeIds không được trùng.",
    path: ["mentionEmployeeIds"],
  });
export type CreateTaskCommentRequest = z.infer<typeof createTaskCommentSchema>;

export const updateTaskCommentSchema = z
  .object({
    content: z.string().trim().min(1).max(5000),
    mentionEmployeeIds: z.array(z.string().uuid()).max(MENTION_MAX).default([]),
  })
  .strict()
  .refine(uniqueMentions, {
    message: "mentionEmployeeIds không được trùng.",
    path: ["mentionEmployeeIds"],
  });
export type UpdateTaskCommentRequest = z.infer<typeof updateTaskCommentSchema>;

export const taskCommentMentionSchema = z.object({
  employeeId: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().nullable(),
});
export type TaskCommentMentionDto = z.infer<typeof taskCommentMentionSchema>;

export const taskCommentResponseSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  userName: z.string().nullable(),
  content: z.string(),
  // Mention KHÔNG có bảng lưu quan hệ (task_comment_mentions chưa tồn tại — DB debt, xem PR desc) —
  // trả lại DANH SÁCH ĐÃ XÁC THỰC của CHÍNH request POST/PATCH vừa gọi; GET list trả rỗng (không tái
  // dựng lịch sử mention từ activity log ở MVP này).
  mentions: z.array(taskCommentMentionSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable(),
});
export type TaskCommentResponseDto = z.infer<typeof taskCommentResponseSchema>;

// ─── Checklists + items (GET/POST/PATCH/DELETE /tasks/:id/checklists[...], update:task) ──

export const createTaskChecklistSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    isRequiredForDone: z.boolean().optional().default(false),
    /** Item khởi tạo cùng lúc (API-06 §17.2) — optional, order_index tự tính theo thứ tự mảng. */
    items: z.array(z.string().trim().min(1).max(500)).max(50).optional().default([]),
  })
  .strict();
export type CreateTaskChecklistRequest = z.infer<typeof createTaskChecklistSchema>;

export const updateTaskChecklistSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    isRequiredForDone: z.boolean(),
    orderIndex: z.number().int().min(0),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Cần ít nhất 1 field để cập nhật." });
export type UpdateTaskChecklistRequest = z.infer<typeof updateTaskChecklistSchema>;

export const createTaskChecklistItemSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    orderIndex: z.number().int().min(0).optional(),
  })
  .strict();
export type CreateTaskChecklistItemRequest = z.infer<typeof createTaskChecklistItemSchema>;

/** PATCH tick (API-06 §17.6): is_done=true → backend tự ghi done_by/done_at; false → clear. */
export const updateTaskChecklistItemSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    isDone: z.boolean(),
    orderIndex: z.number().int().min(0),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Cần ít nhất 1 field để cập nhật." });
export type UpdateTaskChecklistItemRequest = z.infer<typeof updateTaskChecklistItemSchema>;

export const taskChecklistItemResponseSchema = z.object({
  id: z.string().uuid(),
  checklistId: z.string().uuid(),
  title: z.string(),
  isDone: z.boolean(),
  doneBy: z.string().uuid().nullable(),
  doneAt: z.string().datetime().nullable(),
  orderIndex: z.number(),
});
export type TaskChecklistItemResponseDto = z.infer<typeof taskChecklistItemResponseSchema>;

export const taskChecklistResponseSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  isRequiredForDone: z.boolean(),
  orderIndex: z.number(),
  items: z.array(taskChecklistItemResponseSchema),
  createdAt: z.string().datetime(),
});
export type TaskChecklistResponseDto = z.infer<typeof taskChecklistResponseSchema>;

// ─── Activity feed (GET /tasks/:id/activity, TASK-API-602, view:task-audit-log) ──

export const TASK_ACTIVITY_PAGE_LIMIT_MAX = 200;
export const listTaskActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(TASK_ACTIVITY_PAGE_LIMIT_MAX).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ListTaskActivityQueryRequest = z.infer<typeof listTaskActivityQuerySchema>;

export const taskActivityLogResponseSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().uuid().nullable(),
  actorUserId: z.string().uuid().nullable(),
  actorName: z.string().nullable(),
  oldValues: z.unknown().nullable(),
  newValues: z.unknown().nullable(),
  message: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type TaskActivityLogResponseDto = z.infer<typeof taskActivityLogResponseSchema>;
