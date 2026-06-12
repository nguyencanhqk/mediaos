import { z } from "zod";

// ─── Task type (G9-1: unified hub — BẤT BIẾN #4) ──────────────────────────────
// Spec mandates 7 sources: production·review·revision·meeting_action·office·finance·hr.
// `workflow_step` is KEPT for backward-compat: G4/G7 emit workflow-driven tasks under it
// (data-migration-free reconcile — see ADR-0024). Total = 8 accepted types.

export const taskTypeSchema = z.enum([
  "workflow_step",
  "production",
  "review",
  "revision",
  "meeting_action",
  "office",
  "finance",
  "hr",
]);
export type TaskTypeDto = z.infer<typeof taskTypeSchema>;

/**
 * Task types that may be CREATED by hand via the manual-assignment endpoint (G9-2).
 * Workflow-driven types (workflow_step/production/review/revision) are EMITTED by the
 * workflow engine, never hand-created — keeping them out preserves the FSM as the only
 * writer of review-cycle tasks.
 */
export const MANUAL_TASK_TYPES = ["office"] as const;
export const manualTaskTypeSchema = z.enum(MANUAL_TASK_TYPES);
export type ManualTaskTypeDto = z.infer<typeof manualTaskTypeSchema>;

// ─── Task status ──────────────────────────────────────────────────────────────

export const taskStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "waiting_review",
  "revision",
  "approved",
  "completed",
]);
export type TaskStatusDto = z.infer<typeof taskStatusSchema>;

/**
 * Shortened flow (G9-3) for tasks WITHOUT a review cycle (office/manual):
 * Chưa bắt đầu → Đang làm → Hoàn thành. Review-cycle statuses (waiting_review/approved/
 * revision) belong to the workflow FSM and are intentionally excluded here.
 */
export const officeTaskStatusSchema = z.enum(["not_started", "in_progress", "completed"]);
export type OfficeTaskStatusDto = z.infer<typeof officeTaskStatusSchema>;

// ─── Task ─────────────────────────────────────────────────────────────────────
// taskType uses the canonical 8-type `taskTypeSchema` defined above (G9-1 unified hub).
// (A stale 5-type duplicate from merge 599609e was removed here — it shadowed the canonical
// schema and broke the contracts build; the 8-type union is the single source of truth.)

export const taskSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  taskType: taskTypeSchema,
  title: z.string(),
  status: taskStatusSchema,
  origin: z.enum(["initial", "revision"]),
  revisionRound: z.number().int().min(0),
  dueDate: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  assigneeUserId: z.string().uuid().nullable(),
  // Joined from workflow_steps (null for non-workflow tasks)
  stepId: z.string().uuid().nullable(),
  stepCode: z.string().nullable(),
  stepName: z.string().nullable(),
  stepStatus: z.string().nullable(),
  submissionUrl: z.string().nullable(),
  submissionNote: z.string().nullable(),
  workflowInstanceId: z.string().uuid().nullable(),
  // Joined from content_items (null for non-video tasks)
  contentItemId: z.string().uuid().nullable(),
  contentTitle: z.string().nullable(),
  // Joined from projects (null when not project-scoped)
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
});
export type TaskDto = z.infer<typeof taskSchema>;

// ─── Comment ──────────────────────────────────────────────────────────────────

export const commentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
  userFullName: z.string().nullable(),
  body: z.string(),
  createdAt: z.string().datetime(),
});
export type CommentDto = z.infer<typeof commentSchema>;

// ─── Requests ─────────────────────────────────────────────────────────────────

export const createCommentSchema = z.object({
  body: z.string().min(1).max(2000),
});
export type CreateCommentRequest = z.infer<typeof createCommentSchema>;

/**
 * Manual task creation (G9-2 / TASK-001). Hand-created tasks are `office` only and need
 * NO content/workflow linkage — that is the whole point of the unified hub (BẤT BIẾN #4):
 * a non-video task is a first-class citizen of the same `tasks` table.
 */
export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  taskType: manualTaskTypeSchema.default("office"),
  assigneeUserId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskSchema>;

/** Update status of a non-workflow task via the shortened flow (G9-3). */
export const updateTaskStatusSchema = z.object({
  status: officeTaskStatusSchema,
});
export type UpdateTaskStatusRequest = z.infer<typeof updateTaskStatusSchema>;
