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

// ─── Board list query (G9-3) ────────────────────────────────────────────────────
/**
 * Task Board query — source of truth for the GET /tasks/board DTO (BĐ §contracts).
 * All filters optional (board lists across the tenant); page bounds are CLAMPED here at the
 * boundary so a malicious/huge limit cannot scan the table (repo also re-clamps to MAX_PAGE_SIZE
 * = defense-in-depth). `coerce` lets the controller pass raw @Query strings straight through.
 *
 * `taskType` accepts ALL 8 accepted types (taskTypeSchema) — board surfaces every source, not just
 * the hand-created ones. `status` accepts the full task lifecycle (taskStatusSchema) for filtering;
 * it does NOT loosen the write-side OfficeTaskStatusDto guard (that stays on the PATCH path).
 */
export const BOARD_PAGE_LIMIT_MAX = 200;
export const listTasksQuerySchema = z.object({
  taskType: taskTypeSchema.optional(),
  status: taskStatusSchema.optional(),
  projectId: z.string().uuid().optional(),
  assigneeUserId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(BOARD_PAGE_LIMIT_MAX).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ListTasksQueryRequest = z.infer<typeof listTasksQuerySchema>;

// ─── Task attachments (B4 — real file upload) ────────────────────────────────────
/**
 * Allowlist + max-size are the SINGLE SOURCE OF TRUTH here (contracts) — both the DTO at the
 * controller boundary AND the service boundary re-validate against these (defense-in-depth, the
 * service does NOT trust the DTO alone). Whitelist over blacklist: only known-safe content types
 * for office artifacts (docs/images/pdf/archives). Executables/SVG (XSS) are intentionally excluded.
 */
export const ATTACHMENT_ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

/** Max upload size = 50 MiB. Client-declared at intent time; server enforces this ceiling. */
export const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;

export const attachmentContentTypeSchema = z.enum(ATTACHMENT_ALLOWED_CONTENT_TYPES);
export type AttachmentContentType = z.infer<typeof attachmentContentTypeSchema>;

/**
 * Request body for POST /tasks/:taskId/attachments — client declares the file it intends to upload.
 * The server NEVER accepts a storage key/path from the client: it derives the tenant-scoped key
 * itself (`{companyId}/tasks/{taskId}/{uuid}`) and returns a presigned PUT URL.
 * `sizeBytes` is client-declared and bounded here; the server re-checks at the service boundary.
 */
export const createAttachmentIntentSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: attachmentContentTypeSchema,
  sizeBytes: z.number().int().positive().max(ATTACHMENT_MAX_BYTES),
});
export type CreateAttachmentIntentRequest = z.infer<typeof createAttachmentIntentSchema>;

/** Metadata DTO returned to the client — NO signed URL / credential is ever persisted (BẤT BIẾN #3). */
export const attachmentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  uploadedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type AttachmentDto = z.infer<typeof attachmentSchema>;

/** Response of the create-intent call: metadata row + the EPHEMERAL presigned PUT url (not persisted). */
export const attachmentUploadIntentSchema = z.object({
  attachment: attachmentSchema,
  uploadUrl: z.string().url(),
});
export type AttachmentUploadIntentDto = z.infer<typeof attachmentUploadIntentSchema>;

/** Response of GET /tasks/:taskId/attachments/:id/download — ephemeral presigned GET url. */
export const attachmentDownloadUrlSchema = z.object({
  downloadUrl: z.string().url(),
});
export type AttachmentDownloadUrlDto = z.infer<typeof attachmentDownloadUrlSchema>;
