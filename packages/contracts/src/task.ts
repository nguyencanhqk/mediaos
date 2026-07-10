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

// ─── PM-1 (apps/projects, mig 0420): priority · state group · label ─────────────
// Định nghĩa TRƯỚC taskSchema vì taskSchema tham chiếu (const không hoisted — tránh TDZ).

/** Mức ưu tiên kiểu Plane. 'none' = chưa đặt (mặc định). */
export const prioritySchema = z.enum(["urgent", "high", "medium", "low", "none"]);
export type PriorityDto = z.infer<typeof prioritySchema>;

/** 5 nhóm trạng thái Plane (project_states.state_group). */
export const projectStateGroupSchema = z.enum([
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
]);
export type ProjectStateGroupDto = z.infer<typeof projectStateGroupSchema>;

/** Nhãn màu theo project (labels). */
export const labelSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type LabelDto = z.infer<typeof labelSchema>;

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
  // ── PM-1 (apps/projects, mig 0420) — work item kiểu Plane (ADDITIVE; mọi endpoint task trả các cột này) ──
  priority: prioritySchema,
  description: z.string().nullable(),
  startDate: z.string().datetime().nullable(),
  sequence: z.number().int().nullable(),
  /** {projectIdentifier}-{sequence}, vd "WEB-12". null nếu project chưa đặt identifier hoặc task không có project. */
  displayId: z.string().nullable(),
  projectIdentifier: z.string().nullable(),
  // State tùy biến (joined từ project_states; null cho task chưa map state — fallback `status` legacy).
  stateId: z.string().uuid().nullable(),
  stateName: z.string().nullable(),
  stateGroup: projectStateGroupSchema.nullable(),
  stateColor: z.string().nullable(),
});
export type TaskDto = z.infer<typeof taskSchema>;

// ─── Board work item (TaskDto + nhãn gắn) ───────────────────────────────────────
// Dùng cho GET /tasks/board + detail: trả thêm labels[] (aggregate). My Tasks giữ TaskDto (rẻ, không join nhãn).
export const boardTaskSchema = taskSchema.extend({
  labels: z.array(labelSchema),
});
export type BoardTaskDto = z.infer<typeof boardTaskSchema>;

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
  // PM-1: tạo work item kèm thuộc tính Plane (đều optional — luồng office cũ không cần).
  priority: prioritySchema.optional(),
  description: z.string().max(50000).nullable().optional(),
  stateId: z.string().uuid().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskSchema>;

/**
 * PM-1 — cập nhật field work item (PATCH /tasks/:id, mở rộng khỏi luồng status-only office). Mọi field
 * optional (partial update). CHỈ áp cho task KHÔNG thuộc FSM (service giữ guard WORKFLOW_TASK_TYPES).
 * `status` CỐ Ý không có ở đây — đổi trạng thái đi qua state_id (PM) hoặc PATCH /status (office legacy).
 */
export const updateTaskFieldsSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(50000).nullable(),
    priority: prioritySchema,
    stateId: z.string().uuid().nullable(),
    assigneeUserId: z.string().uuid().nullable(),
    dueDate: z.string().datetime().nullable(),
    startDate: z.string().datetime().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Cần ít nhất 1 field để cập nhật." });
export type UpdateTaskFieldsRequest = z.infer<typeof updateTaskFieldsSchema>;

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
  // PM-1: lọc board theo state tùy biến / ưu tiên / nhãn.
  stateId: z.string().uuid().optional(),
  priority: prioritySchema.optional(),
  labelId: z.string().uuid().optional(),
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

// ─── PM-1 (apps/projects, mig 0420): project states (trạng thái tùy biến) ────────

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const projectStateSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  stateGroup: projectStateGroupSchema,
  color: z.string(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectStateDto = z.infer<typeof projectStateSchema>;

export const createProjectStateSchema = z.object({
  name: z.string().min(1).max(80),
  stateGroup: projectStateGroupSchema,
  color: z.string().regex(HEX_COLOR).optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreateProjectStateRequest = z.infer<typeof createProjectStateSchema>;

export const updateProjectStateSchema = z
  .object({
    name: z.string().min(1).max(80),
    stateGroup: projectStateGroupSchema,
    color: z.string().regex(HEX_COLOR),
    sortOrder: z.number().int().min(0),
    isDefault: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Cần ít nhất 1 field để cập nhật." });
export type UpdateProjectStateRequest = z.infer<typeof updateProjectStateSchema>;

// ─── PM-1: labels (nhãn màu) ─────────────────────────────────────────────────────

export const createLabelSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(HEX_COLOR).optional(),
});
export type CreateLabelRequest = z.infer<typeof createLabelSchema>;

export const updateLabelSchema = z
  .object({
    name: z.string().min(1).max(60),
    color: z.string().regex(HEX_COLOR),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Cần ít nhất 1 field để cập nhật." });
export type UpdateLabelRequest = z.infer<typeof updateLabelSchema>;

// ─── S4-TASK-BE-1 (SPEC-06 §6.1/§6.5/§6.6/§15.1-2, mig 0478 — L1 sync PR trước): Project domain ────
// (Owner/Manager/Member/Viewer). LƯU Ý: đây là project QUẢN LÝ DỰ ÁN (lifecycle Planning→Archived +
// member role) — KHÁC với `projectStateSchema`/`labelSchema` ở trên (thuộc apps/projects kiểu Plane,
// PM-1 mig 0420, board state tùy biến). Hai khái niệm cùng bảng `projects`/cột riêng, KHÔNG trộn field.
//
// ĐẶT TÊN `taskProject*` (không phải `project*` trần): packages/contracts/src/media.ts (park/out-of-scope
// theo CLAUDE.md — code media-era, KHÔNG đụng ở WO này) ĐÃ export `projectStatusSchema`/`projectPrioritySchema`/
// `createProjectSchema`/`updateProjectSchema`/`listProjectsQuerySchema` cho Project media-era khác hẳn (status
// lowercase 'active'/'paused'/'archived'). Barrel `index.ts` dùng `export *` ⇒ trùng tên vỡ build (TS2308).
// Prefix `taskProject` = Project của SPEC-06 TASK module, phân biệt tường minh — build đã verify KHÔNG đụng.
//
// Field ↔ cột DB (apps/api/src/db/schema/media.ts, cột TitleCase MỚI additive mig 0478):
//   code → project_code · name → name (legacy, NOT NULL) · ownerEmployeeId → owner_employee_id (FK
//   employee_profiles) · departmentId → department_id (FK org_units) · priority → project_priority ·
//   status → project_status (CHECK: Planning/Active/On Hold/Completed/Cancelled/Archived, TitleCase —
//   KHÔNG lẫn `status` legacy lowercase 'active'/'paused'/'archived').
//
// Permission pair (mig 0485, DB-06 §12.1): read/create/update:project (non-sensitive) ·
// close/delete/manage-member/archive/view-report:project (sensitive). archive:project +
// view-report:project NGOÀI PHẠM VI WO này (route chưa dựng — xem ghi chú backend).

/** ISO date-only (YYYY-MM-DD) — cột DB là `date` (không giờ), KHÁC `z.string().datetime()` dùng cho
 * timestamptz ở taskSchema phía trên. Mirror packages/contracts/src/hr/contracts.ts `isoDate`. */
const TASK_PROJECT_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const taskProjectStatusSchema = z.enum([
  "Planning",
  "Active",
  "On Hold",
  "Completed",
  "Cancelled",
  "Archived",
]);
export type TaskProjectStatusDto = z.infer<typeof taskProjectStatusSchema>;

export const taskProjectPrioritySchema = z.enum(["Low", "Medium", "High", "Urgent"]);
export type TaskProjectPriorityDto = z.infer<typeof taskProjectPrioritySchema>;

export const projectRoleSchema = z.enum(["Owner", "Manager", "Member", "Viewer"]);
export type ProjectRoleDto = z.infer<typeof projectRoleSchema>;

/** `member_status` (CHECK mig 0478: Active/Inactive/Removed — Inactive dự phòng, chưa dùng trong WO này). */
export const projectMemberStatusSchema = z.enum(["Active", "Inactive", "Removed"]);
export type ProjectMemberStatusDto = z.infer<typeof projectMemberStatusSchema>;

/**
 * POST /api/v1/projects (TASK-API-003, create:project). `name` bắt buộc — mọi field khác optional
 * (server set default: status/priority nếu thiếu; actor có employee mapping → auto-Owner-member —
 * xem ProjectsService, KHÔNG thuộc DTO). `ownerEmployeeId` do client CHỌN owner (khác actor) — server
 * validate employee tồn tại/active ở service layer, DTO chỉ kiểm hình dạng UUID.
 */
export const createTaskProjectSchema = z
  .object({
    name: z.string().min(1, "Tên dự án là bắt buộc").max(255),
    code: z.string().min(1).max(50).optional(),
    description: z.string().max(10000).nullable().optional(),
    ownerEmployeeId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
    priority: taskProjectPrioritySchema.optional(),
    startDate: z.string().regex(TASK_PROJECT_ISO_DATE, "startDate phải là YYYY-MM-DD").optional(),
    endDate: z.string().regex(TASK_PROJECT_ISO_DATE, "endDate phải là YYYY-MM-DD").optional(),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "endDate không được nhỏ hơn startDate",
    path: ["endDate"],
  });
export type CreateTaskProjectRequest = z.infer<typeof createTaskProjectSchema>;

/**
 * PATCH /api/v1/projects/:id (TASK-API-004, update:project). Mọi field optional (partial update) —
 * KHÔNG có `status` ở đây: đổi trạng thái lifecycle đi qua route verb riêng (close — API-006; archive/
 * cancel NGOÀI PHẠM VI WO này), tránh PATCH trần đổi trạng thái không qua rule (TASK-ERR mirror TK-4).
 */
export const updateTaskProjectSchema = z
  .object({
    name: z.string().min(1, "Tên dự án là bắt buộc").max(255),
    code: z.string().min(1).max(50).nullable(),
    description: z.string().max(10000).nullable(),
    ownerEmployeeId: z.string().uuid().nullable(),
    departmentId: z.string().uuid().nullable(),
    priority: taskProjectPrioritySchema.nullable(),
    startDate: z.string().regex(TASK_PROJECT_ISO_DATE, "startDate phải là YYYY-MM-DD").nullable(),
    endDate: z.string().regex(TASK_PROJECT_ISO_DATE, "endDate phải là YYYY-MM-DD").nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Cần ít nhất 1 field để cập nhật." })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "endDate không được nhỏ hơn startDate",
    path: ["endDate"],
  });
export type UpdateTaskProjectRequest = z.infer<typeof updateTaskProjectSchema>;

/** POST /api/v1/projects/:id/close (TASK-API-006, close:project) → project_status='Completed'. `note`
 * tuỳ chọn (mirror packages/contracts/src/leave.ts `approveLeaveRequestSchema`), ghi vào activity log. */
export const closeTaskProjectSchema = z.object({
  note: z.string().max(1000).optional(),
});
export type CloseTaskProjectRequest = z.infer<typeof closeTaskProjectSchema>;

/** Chi tiết dự án (GET /:id) — DTO trả về server-side, join owner_employee_id → employee_profiles.full_name
 * và department_id → org_units.name (ownerName/departmentName null nếu chưa gán/không tồn tại). */
export const taskProjectResponseSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  ownerEmployeeId: z.string().uuid().nullable(),
  ownerName: z.string().nullable(),
  departmentId: z.string().uuid().nullable(),
  departmentName: z.string().nullable(),
  priority: taskProjectPrioritySchema.nullable(),
  status: taskProjectStatusSchema.nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  closedBy: z.string().uuid().nullable(),
});
export type TaskProjectResponseDto = z.infer<typeof taskProjectResponseSchema>;

/** Dòng danh sách (GET /projects, TASK-SCREEN-001 §Cột hiển thị) — nhẹ hơn detail: bỏ description/closedBy. */
export const taskProjectListItemSchema = taskProjectResponseSchema.omit({
  description: true,
  closedBy: true,
});
export type TaskProjectListItemDto = z.infer<typeof taskProjectListItemSchema>;

/**
 * GET /api/v1/projects query (TASK-API-001, read:project). `limit`/`offset` dùng CÙNG pattern
 * `z.coerce.number()` như `listTasksQuerySchema` phía trên — coerce số idempotent tự nhiên
 * (Number(5) === 5 dù ZodValidationPipe chạy 2 lần; KHÁC boolean cần z.preprocess riêng — xem
 * memory zod-query-param-double-pipe-idempotent / packages/contracts/src/my-notification.ts).
 * Repo re-clamp TASK_PROJECT_PAGE_LIMIT_MAX lần nữa (defense-in-depth, mirror BOARD_PAGE_LIMIT_MAX).
 */
export const TASK_PROJECT_PAGE_LIMIT_MAX = 200;
export const listTaskProjectsQuerySchema = z.object({
  status: taskProjectStatusSchema.optional(),
  ownerEmployeeId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(TASK_PROJECT_PAGE_LIMIT_MAX).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ListTaskProjectsQueryRequest = z.infer<typeof listTaskProjectsQuerySchema>;

// ─── S4-TASK-BE-1: Project member (SPEC-06 §6.6/§13.4/§15.2, TASK-API-101..104, manage-member:project) ──

/**
 * POST /api/v1/projects/:id/members (manage-member:project). `employeeId` là NGUỒN SỰ THẬT DUY NHẤT —
 * `user_id` (project_members, legacy NOT NULL) KHÔNG bao giờ nhận từ client: server resolve
 * employee_profiles.user_id ở service layer (fail-loud nếu NULL — nhân viên chưa có tài khoản).
 */
export const addMemberSchema = z.object({
  employeeId: z.string().uuid(),
  projectRole: projectRoleSchema,
});
export type AddMemberRequest = z.infer<typeof addMemberSchema>;

/** PATCH /api/v1/projects/:id/members/:memberId (manage-member:project) — chỉ đổi project_role. */
export const updateMemberRoleSchema = z.object({
  projectRole: projectRoleSchema,
});
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleSchema>;

/** DTO thành viên dự án (GET /:id/members, TASK-SCREEN-004 §Cột hiển thị). `employeeId`/`employeeName`
 * null nếu hàng legacy (employee_id NULL, chưa cut-over) — KHÔNG lộ user_id nội bộ ra response. */
export const memberResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  employeeId: z.string().uuid().nullable(),
  employeeName: z.string().nullable(),
  employeeCode: z.string().nullable(),
  departmentName: z.string().nullable(),
  projectRole: projectRoleSchema.nullable(),
  status: projectMemberStatusSchema.nullable(),
  joinedAt: z.string().datetime().nullable(),
  removedAt: z.string().datetime().nullable(),
});
export type MemberResponseDto = z.infer<typeof memberResponseSchema>;
