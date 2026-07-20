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

/**
 * 6 nhóm trạng thái (project_states.state_group) — 'review' thêm ở mig 0499 (S5-TASK-PIPELINE-1,
 * SPEC-06 §6.8): cột duyệt của quy trình sản xuất quy về In Review thay vì gộp vào started.
 * Đồng bộ với CHECK project_states_group_check (schema workflow.ts).
 */
export const projectStateGroupSchema = z.enum([
  "backlog",
  "unstarted",
  "started",
  "review",
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
  // S5-TASK-PROJROLE-1 (đợt C — DECISIONS-04 D-24/D-25): role của CHÍNH actor trong dự án, server tính
  // từ project_members Active bằng correlated scalar-subquery role-MẠNH-NHẤT (Owner>Manager>Member>Viewer;
  // actor có thể khớp cả hàng legacy user_id-only lẫn hàng employee_id — KHÔNG join nhân bản row).
  // null = không phải member (hoặc Removed/Inactive). FE CHỈ dùng ẩn/hiện (menu ⋯ "Cài đặt quyền",
  // control member) — BE là người quyết cuối qua tầng role service-layer.
  myProjectRole: projectRoleSchema.nullable(),
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
  // S5-TASK-NAV-TREE-1 (đợt B) — lọc theo phòng ban (sidebar cây phòng ban → "Xem báo cáo" deep-link
  // /tasks/projects?departmentId=X). Server AND thêm eq(projects.departmentId) — KHÔNG thay data-scope.
  departmentId: z.string().uuid().optional(),
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

// ═══════════════════════════════════════════════════════════════════════════════
// S4-TASK-BE-2 — Task core (SPEC-06 §7/§9, TASK-API-201..210, DB-06 §7.4 cột TitleCase MỚI mig 0478).
//
// PHÂN BIỆT với 2 nhóm status/priority ĐÃ CÓ trên CÙNG bảng tasks (KHÔNG gộp/nhầm):
//   • taskCoreStatus (Todo/In Progress/In Review/Done/Cancelled) = cột task_status MỚI (chk_tasks_task_status)
//     — KHÁC HẲN legacy `status` (not_started/in_progress/waiting_review/revision/approved/completed) do FSM
//     studio dùng (taskStatusSchema/officeTaskStatusSchema phía trên — GIỮ NGUYÊN, KHÔNG đụng).
//   • taskCorePriority (Low/Medium/High/Urgent) = cột task_priority MỚI — KHÁC legacy `priority`
//     (urgent/high/medium/low/none, prioritySchema phía trên).
// Đặt tên `taskCore*` để tránh mọi va chạm export với taskSchema/taskProject* đã land ở BE-1.
// ═══════════════════════════════════════════════════════════════════════════════

/** Boolean query-param IDEMPOTENT dưới ZodValidationPipe KÉP (memory zod-query-param-double-pipe-idempotent):
 * nhận CẢ "true"/"false" LẪN boolean → boolean|undefined. KHÔNG z.coerce.boolean. Mirror my-notification.ts. */
const taskCoreOptionalBooleanParam = () =>
  z.preprocess(
    (v) => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined),
    z.boolean().optional(),
  );

export const taskCoreStatusSchema = z.enum([
  "Todo",
  "In Progress",
  "In Review",
  "Done",
  "Cancelled",
]);
export type TaskCoreStatusDto = z.infer<typeof taskCoreStatusSchema>;

export const taskCorePrioritySchema = z.enum(["Low", "Medium", "High", "Urgent"]);
export type TaskCorePriorityDto = z.infer<typeof taskCorePrioritySchema>;

/** Nguồn của 1 dòng trong GET /tasks/my (TASK-API-210): được giao · tự tạo · đang theo dõi. */
export const taskCoreSourceSchema = z.enum(["assigned", "created", "watched"]);
export type TaskCoreSourceDto = z.infer<typeof taskCoreSourceSchema>;

export const TASK_CORE_PAGE_LIMIT_MAX = 200;

/**
 * GET /api/v1/tasks query (TASK-API-201, read:task). Filter status/priority/assignee/project/due-range/
 * overdue + pagination. `overdue` boolean idempotent (z.preprocess); `dueFrom`/`dueTo` ISO datetime.
 * limit/offset coerce số (idempotent tự nhiên); repo re-clamp TASK_CORE_PAGE_LIMIT_MAX (defense-in-depth).
 */
export const listTaskCoreQuerySchema = z.object({
  status: taskCoreStatusSchema.optional(),
  priority: taskCorePrioritySchema.optional(),
  assigneeEmployeeId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  dueFrom: z.string().datetime({ offset: true }).optional(),
  dueTo: z.string().datetime({ offset: true }).optional(),
  overdue: taskCoreOptionalBooleanParam(),
  // S5-TASK-SUBTASK-1 (D-36) — chỉ lấy task GỐC (parent_task_id IS NULL). Mặc định FALSE ⇒ hành vi cũ
  // nguyên vẹn (GET /tasks toàn cục + "Việc của tôi" + "Việc quá hạn" vẫn hiện cả con — D-37 "danh
  // sách ≠ con số"). Tab Bảng/Danh sách của vỏ workspace dự án bật cờ này để giữ parity.
  // Dùng CHUNG helper với `overdue`: boolean query param PHẢI idempotent (pipe nestjs-zod chạy 2 LẦN).
  parentOnly: taskCoreOptionalBooleanParam(),
  limit: z.coerce.number().int().min(1).max(TASK_CORE_PAGE_LIMIT_MAX).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ListTaskCoreQueryRequest = z.infer<typeof listTaskCoreQuerySchema>;

/**
 * POST /api/v1/tasks (TASK-API-202, create:task). `title` bắt buộc; project OPTIONAL (task cá nhân MVP).
 * `assigneeEmployeeId` là NGUỒN SỰ THẬT — server resolve employee_profiles + validate active/có-tài-khoản
 * + trong-phạm-vi-người-giao (fail-loud). KHÔNG nhận status (mặc định 'Todo' — đổi status là action riêng).
 */
export const createTaskCoreSchema = z
  .object({
    title: z.string().trim().min(1, "Tiêu đề là bắt buộc").max(500),
    description: z.string().max(20000).optional(),
    projectId: z.string().uuid().optional(),
    assigneeEmployeeId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
    priority: taskCorePrioritySchema.optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    /**
     * S5-TASK-PIPELINE-1 — tạo thẳng vào CỘT pipeline (nút "+ Thêm công việc" đáy cột board).
     * Server: đòi update-state:task + suy task_status khởi tạo từ STATE_GROUP_TO_STATUS (KHÔNG
     * hardcode 'Todo' khi có stateId — chống desync-lúc-sinh, plan 3c). Bỏ trống = is_default.
     */
    stateId: z.string().uuid().optional(),
    /**
     * S5-TASK-SUBTASK-1 (DECISIONS-05 D-31) — tạo VIỆC CON. Server ép: cây ĐÚNG 1 CẤP (cha phải là
     * gốc), con cùng project với cha (projectId suy TỪ CHA — gửi kèm mà lệch ⇒ 400), state_id NULL
     * (D-36: con ẩn khỏi board nên cột không mang nghĩa ⇒ gửi kèm stateId ⇒ 400).
     */
    parentTaskId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => !v.startAt || !v.dueAt || v.dueAt >= v.startAt, {
    message: "dueAt không được sớm hơn startAt",
    path: ["dueAt"],
  });
export type CreateTaskCoreRequest = z.infer<typeof createTaskCoreSchema>;

/**
 * PATCH /api/v1/tasks/:id (TASK-API-204, update:task). Partial (≥1 field). KHÔNG có `status` — đổi trạng
 * thái là action riêng (update-status:task) NGOÀI phạm vi WO này. `null` = xoá liên kết (assignee/project).
 */
export const updateTaskCoreSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20000).nullable(),
    projectId: z.string().uuid().nullable(),
    assigneeEmployeeId: z.string().uuid().nullable(),
    departmentId: z.string().uuid().nullable(),
    priority: taskCorePrioritySchema.nullable(),
    dueAt: z.string().datetime({ offset: true }).nullable(),
    startAt: z.string().datetime({ offset: true }).nullable(),
    /**
     * S5-TASK-PIPELINE-1 — đổi CỘT pipeline qua PATCH (đường ghi thứ hai, plan 3b): gate + auto-map
     * nằm Ở METHOD DÙNG CHUNG của TaskCoreService (hễ stateId KHÁC hiện tại ⇒ resolveAndAssert
     * update-state:task + auto-map status), KHÔNG ở route — PATCH không được thành cửa vòng qua.
     * KHÔNG nullable: spec không có thao tác "gỡ thẻ khỏi board".
     */
    stateId: z.string().uuid(),
    /**
     * S5-TASK-SUBTASK-1 (DECISIONS-05 D-31/D-33) — gán/gỡ cha sau khi tạo. `null` = gỡ khỏi cha (task
     * thành GỐC KHÔNG CỘT — không tự đoán cột mặc định, người dùng kéo vào cột sau bằng move-state).
     * Server ép trong CÙNG tx SAU khi khoá hàng (D-33): cha ≠ chính nó · cha tồn tại cùng company ·
     * cha là GỐC (chặn tầng 3) · task CHƯA có con active (task đang làm cha không được thành con).
     */
    parentTaskId: z.string().uuid().nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Cần ít nhất 1 field để cập nhật." })
  .refine((v) => !v.startAt || !v.dueAt || v.dueAt >= v.startAt, {
    message: "dueAt không được sớm hơn startAt",
    path: ["dueAt"],
  });
export type UpdateTaskCoreRequest = z.infer<typeof updateTaskCoreSchema>;

/**
 * Chi tiết/dòng task core (GET /tasks, GET /tasks/:id) — DTO server-side, join tên project/assignee/creator.
 * `status`/`priority` là cột TitleCase MỚI (nullable — hàng legacy/FSM chưa set). `isOverdue` tính ở server.
 *
 * KHÔNG hợp nhất với `taskSchema`/`boardTaskSchema` phía trên dù chúng CŨNG có stateId/stateName:
 * đó là họ DTO PM-1 legacy (route /tasks/board G9-3, cột `status` lowercase) — FE nghiệp vụ hiện
 * không dùng, sẽ dọn ở WO dead-code. Trộn hai họ = ép cả hai vòng đời đổi cùng lúc (drift 2 chiều).
 */
export const taskCoreResponseSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  taskType: z.string(),
  status: taskCoreStatusSchema.nullable(),
  priority: taskCorePrioritySchema.nullable(),
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  mainAssigneeEmployeeId: z.string().uuid().nullable(),
  assigneeName: z.string().nullable(),
  creatorUserId: z.string().uuid().nullable(),
  creatorName: z.string().nullable(),
  reporterEmployeeId: z.string().uuid().nullable(),
  // S5-TASK-DETAIL-1 (GAP 3) — tên NGƯỜI GIAO VIỆC (join employee_profiles→users như assigneeName).
  // `.optional()` additive (KHÔNG `.default()`): FE Pages và API deploy lệch pha được — client mới
  // parse response API cũ (chưa có field) không gãy; server mới LUÔN điền (null khi không có reporter).
  reporterName: z.string().nullable().optional(),
  departmentId: z.string().uuid().nullable(),
  dueAt: z.string().datetime().nullable(),
  startAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  isOverdue: z.boolean(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // ── S5-TASK-PIPELINE-1 — cột pipeline (resolved từ project_states, READ-ONLY qua DTO này;
  // ghi đi đường stateId của create/update + move-state). `.optional()` chứ KHÔNG bắt buộc:
  // BE mapper điền ở lane be-read — client parse response CŨ (chưa có field) không được gãy,
  // và `.optional()` (không `.default()`) giữ Input=Output cho apiFetch<T> (bẫy suy luận generic
  // đã ghi ở task-collab.ts). stateId NULL = task chưa lên board (legacy/ngoài dự án).
  stateId: z.string().uuid().nullable().optional(),
  stateName: z.string().nullable().optional(),
  stateColor: z.string().nullable().optional(),
  stateGroup: projectStateGroupSchema.nullable().optional(),
  // ── S5-TASK-SUBTASK-1 (DECISIONS-05) — cây việc con. `.optional()` additive, KHÔNG `.default()`
  // (giữ Input=Output cho apiFetch<T> + deploy lệch pha FE/BE không gãy — cùng khuôn reporterName).
  // parentTaskId NULL = task GỐC. subtaskTotal/subtaskDone theo COUNTABLE_CHILD (D-32): mẫu số LOẠI
  // con Cancelled (việc đã huỷ không còn là việc), tử số = con 'Done'. Task 0 con ⇒ total 0 ⇒ FE
  // KHÔNG hiện % (D-34: một nguồn duy nhất, KHÔNG fallback sang checklist — xem D-35).
  parentTaskId: z.string().uuid().nullable().optional(),
  subtaskTotal: z.number().int().nullable().optional(),
  subtaskDone: z.number().int().nullable().optional(),
});
export type TaskCoreResponseDto = z.infer<typeof taskCoreResponseSchema>;

/**
 * GET /api/v1/tasks/:taskId/subtasks (TASK-API-701) — DTO HẸP, KHÔNG phải taskCoreResponseSchema.
 *
 * DECISIONS-05 D-39: quyền ĐỌC thừa hưởng từ cha (đọc được cha ⇒ thấy đủ con, kể cả con giao người
 * khác) — cần thiết để `subtaskDone/subtaskTotal` khớp danh sách hiển thị, nếu không % mất nghĩa.
 * ĐỔI LẠI, tập field phải HẸP NHẤT có thể: panel việc con không cần `description` (tới 20000 ký tự),
 * `projectName`, `creatorName`, `reporterName`, `departmentId` — trả chúng qua đường thừa-hưởng là mở
 * rộng phơi lộ mà không đổi lấy chức năng nào.
 *
 * `canOpen`: con có nằm trong phạm vi ĐỌC riêng của actor không (ghi KHÔNG thừa hưởng — D-39). FE dùng
 * để render con ngoài tầm với ở dạng read-only, KHÔNG link (bấm vào `GET /tasks/:childId` sẽ 404) và
 * KHÔNG nút sửa/xoá (sẽ 403). Server tính bằng 2 truy vấn tập hợp, KHÔNG phải N+1.
 */
export const subtaskListItemSchema = z.object({
  id: z.string().uuid(),
  taskCode: z.string().nullable(),
  title: z.string(),
  status: taskCoreStatusSchema.nullable(),
  priority: taskCorePrioritySchema.nullable(),
  mainAssigneeEmployeeId: z.string().uuid().nullable(),
  assigneeName: z.string().nullable(),
  dueAt: z.string().datetime().nullable(),
  isOverdue: z.boolean(),
  sortOrder: z.number().int().nullable(),
  canOpen: z.boolean(),
});
export type SubtaskListItemDto = z.infer<typeof subtaskListItemSchema>;

/**
 * PATCH /api/v1/tasks/:taskId/subtasks/reorder (TASK-API-702, update:task trên CHA).
 * `subtaskIds` phải KHỚP CHÍNH XÁC tập con active của cha (thiếu/thừa/lạ ⇒ 400) — chống ghi sort_order
 * cho task của cha khác hoặc company khác. Thứ tự trong mảng = sort_order. KHÔNG ghi activity/audit
 * (thay đổi trình bày, không phải vòng đời — DECISIONS-05).
 */
export const reorderSubtasksSchema = z
  .object({ subtaskIds: z.array(z.string().uuid()).min(1).max(200) })
  .strict();
export type ReorderSubtasksRequest = z.infer<typeof reorderSubtasksSchema>;

/** GET /api/v1/tasks/my (TASK-API-210) — mỗi dòng kèm `source` (assigned|created|watched). */
export const myTaskItemSchema = taskCoreResponseSchema.extend({
  source: taskCoreSourceSchema,
});
export type MyTaskItemDto = z.infer<typeof myTaskItemSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// S4-TASK-BE-5 (L3) — Project report (SPEC-06 §16.1 · API-06 · GET /projects/:id/report).
// Gate view-report:project (SENSITIVE, seed 0485). DTO thô — envelope API-01 do interceptor toàn cục.
// Số liệu tổng hợp trên bảng `tasks` (cột 0478 task_status/main_assignee_employee_id/due_at) THEO
// project_id, luôn AND company_id (BẤT BIẾN #1). KHÔNG lộ storage/PII — chỉ đếm + tên nhân viên phụ trách.
// ═══════════════════════════════════════════════════════════════════════════════

/** Trần top-N dòng assigneeWorkload (đề phòng project khổng lồ — SPEC-06 §16.1 báo cáo tóm tắt). */
export const TASK_PROJECT_REPORT_WORKLOAD_LIMIT = 20;

/** Đếm task theo 5 cột `task_status` FSM cố định (taskCoreStatusSchema). Task NULL status gộp vào Todo. */
export const projectReportCountsByStatusSchema = z.object({
  Todo: z.number().int().nonnegative(),
  "In Progress": z.number().int().nonnegative(),
  "In Review": z.number().int().nonnegative(),
  Done: z.number().int().nonnegative(),
  Cancelled: z.number().int().nonnegative(),
});
export type ProjectReportCountsByStatusDto = z.infer<typeof projectReportCountsByStatusSchema>;

/** Tải công việc theo người phụ trách chính — chỉ đếm task ACTIVE (task_status ∉ Done/Cancelled). */
export const projectReportAssigneeWorkloadSchema = z.object({
  employeeId: z.string().uuid(),
  employeeName: z.string().nullable(),
  activeCount: z.number().int().nonnegative(),
});
export type ProjectReportAssigneeWorkloadDto = z.infer<typeof projectReportAssigneeWorkloadSchema>;

/** GET /projects/:id/report — báo cáo tổng hợp 1 dự án (SPEC-06 §16.1). */
export const projectReportSchema = z.object({
  projectId: z.string().uuid(),
  countsByStatus: projectReportCountsByStatusSchema,
  overdueCount: z.number().int().nonnegative(),
  assigneeWorkload: z.array(projectReportAssigneeWorkloadSchema),
});
export type ProjectReportDto = z.infer<typeof projectReportSchema>;
