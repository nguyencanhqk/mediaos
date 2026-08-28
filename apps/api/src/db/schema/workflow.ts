import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { goals } from "./goals";
import { users } from "./users";
import { contentItems, projects } from "./media";

// ─── Enums (text columns with CHECK) ────────────────────────────────────────
//
// ⓘ `StepStatus` · `InstanceStatus` · `ApprovalRequestStatus` · `StepEvent` ĐÃ GỠ ở
// `S10-CLEAN-WORKFLOWCLUSTER-2` cùng 14 bảng của cụm workflow/approval (migration 0548).
// `TaskStatus`/`TaskOrigin` GIỮ — chúng thuộc bảng `tasks` ĐANG SỐNG.

export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "waiting_review"
  | "revision"
  | "approved"
  | "completed";

export type TaskOrigin = "initial" | "revision";

// ─── tasks (unified hub — BẤT BIẾN #4) ───────────────────────────────────────
// ⓘ Hai cột `workflow_step_id` / `workflow_instance_id` + unique `tasks_dedup_key_uq` ĐÃ GỠ ở
// migration 0548 (S10-CLEAN-WORKFLOWCLUSTER-2): bảng `workflow_steps`/`workflow_instances` bị DROP.
// Đo trước khi gỡ: 0/12 hàng có hai cột đó NOT NULL. `task_type` GIỮ NGUYÊN CHECK 8 giá trị (kể cả
// 'workflow_step') — giá trị đó vẫn là vế gác thật trong `WORKFLOW_TASK_TYPES` ở tầng service.

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    taskType: text("task_type").notNull().default("workflow_step"),
    contentItemId: uuid("content_item_id").references(() => contentItems.id, {
      onDelete: "set null",
    }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("not_started"),
    origin: text("origin").notNull().default("initial"),
    revisionRound: integer("revision_round").notNull().default(0),
    dueDate: timestamp("due_date", { withTimezone: true }),
    // PM-1 (apps/projects, mig 0420 — ADDITIVE; status/task_type CHECK cũ GIỮ chạy cho FSM studio):
    priority: text("priority").notNull().default("none"),
    description: text("description"),
    stateId: uuid("state_id").references((): AnyPgColumn => projectStates.id, {
      onDelete: "set null",
    }),
    sequence: integer("sequence"),
    startDate: timestamp("start_date", { withTimezone: true }),
    // S5-NOTI-FIX-2 (mig 0478 cột + 0498 seed/backfill) — mã hiển thị công khai TASK-0001… Nullable: task
    // cũ trước cut-over đã backfill (0498); task mới cấp qua SequenceService TRƯỚC insert. Map để HR task
    // (hr-tasks.service, drizzle insert) GHI type-safe qua .values({ taskCode }) — S5-TASK-HRCODE-1.
    // uq_tasks_company_task_code_active (0478) chặn trùng còn-sống. KHÔNG migration mới (cột đã tồn tại).
    taskCode: text("task_code"),
    // S5-TASK-SUBTASK-1 (DECISIONS-05 D-31) — cây việc con 1 CẤP. Cột + CHECK (parent_task_id <> id) đã
    // tồn tại từ mig 0478; WO này chỉ TYPED cho drizzle (KHÔNG migration cột). NULL = task GỐC.
    // ⚠️ Đường CRUD chính đi raw SQL ở task-core.repository (docblock đầu file đó) — typed ở đây phục vụ
    // đường HR-task + an toàn kiểu. Bất biến cây (1 cấp · cùng project · khoá hàng) ép ở SERVICE, không
    // ở drizzle: xem DECISIONS-05 D-33/D-36/D-36a và task-core.service.assertParentAssignable.
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "set null",
    }),
    // Thứ tự việc con trong một cha (TASK-API-702). Cột có từ 0478, WO này là nơi ĐẦU TIÊN dùng.
    sortOrder: integer("sort_order"),
    // S5-GOAL-DB-1 (mig 0505) — liên kết đo tiến độ mode 'tasks' (GOAL-DEC-006). FK ĐƠN CỘT → goals(id) ON
    // DELETE SET NULL (xoá cứng goal ⇒ task rớt liên kết, company_id KHÔNG đổi). NULL = task không gắn goal.
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_company_id_idx").on(t.companyId),
    index("tasks_assignee_user_id_idx").on(t.assigneeUserId),
    // G9-1: filter the unified board by project context.
    index("tasks_project_id_idx").on(t.projectId),
    // G16-2 perf (migration 0220): covering indexes for hot reads — partial on the
    // active set (deleted_at IS NULL) since every board/dashboard read filters it out.
    // Board list + My Tasks order by created_at DESC; dashboard groups/ranges on status+due_date.
    index("tasks_company_created_active_idx")
      .on(t.companyId, t.createdAt.desc())
      .where(sql`deleted_at IS NULL`),
    index("tasks_company_assignee_active_idx")
      .on(t.companyId, t.assigneeUserId, t.createdAt.desc())
      .where(sql`deleted_at IS NULL`),
    index("tasks_company_status_active_idx")
      .on(t.companyId, t.status, t.dueDate)
      .where(sql`deleted_at IS NULL`),
    check(
      "tasks_status_check",
      sql`status IN ('not_started', 'in_progress', 'waiting_review', 'revision', 'approved', 'completed')`,
    ),
    check("tasks_origin_check", sql`origin IN ('initial', 'revision')`),
    // G9-1 (ADR-0024): 7 spec types + `workflow_step` kept for backward-compat (G4/G7 emit it).
    check(
      "tasks_task_type_check",
      sql`task_type IN ('workflow_step', 'production', 'review', 'revision', 'meeting_action', 'office', 'finance', 'hr')`,
    ),
    // PM-1 (mig 0420): work item kiểu Plane.
    check("tasks_priority_check", sql`priority IN ('urgent', 'high', 'medium', 'low', 'none')`),
    index("tasks_company_priority_active_idx")
      .on(t.companyId, t.priority)
      .where(sql`deleted_at IS NULL`),
    index("tasks_company_state_active_idx")
      .on(t.companyId, t.stateId)
      .where(sql`deleted_at IS NULL`),
    index("tasks_project_sequence_idx")
      .on(t.companyId, t.projectId, t.sequence)
      .where(sql`deleted_at IS NULL AND project_id IS NOT NULL`),
    // S5-GOAL-DB-1 (mig 0505) — đo goal mode 'tasks': đếm task Done gắn goal_id (DB-11 §8).
    index("idx_tasks_company_goal")
      .on(t.companyId, t.goalId)
      .where(sql`goal_id IS NOT NULL AND deleted_at IS NULL`),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

// ─── PM-1 (apps/projects, mig 0420): project_states · labels · task_labels ───────
// `task`=work item, `project`=project. Mở rộng ADDITIVE domain tasks/projects — KHÔNG bảng issue riêng.

/**
 * project_states — trạng thái tùy biến theo project (6 nhóm: backlog/unstarted/started/review/
 * completed/cancelled — 'review' thêm 0499, SPEC-06 §6.8). Thay thế DẦN tasks.status (giữ song song
 * để FSM studio tiếp tục dùng status legacy).
 * Soft-delete + reorder (sort_order) + recolor. App role SELECT/INSERT/UPDATE (không hard-DELETE).
 */
export const projectStates = pgTable(
  "project_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    stateGroup: text("state_group").notNull(),
    color: text("color").notNull().default("#64748b"),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_states_company_id_idx").on(t.companyId),
    index("project_states_company_project_idx").on(t.companyId, t.projectId),
    uniqueIndex("project_states_project_name_active_uq")
      .on(t.companyId, t.projectId, t.name)
      .where(sql`deleted_at IS NULL`),
    check(
      "project_states_group_check",
      // 'review' thêm ở 0499 (S5-TASK-PIPELINE-1 — owner chốt 18/07/2026): cột duyệt của quy trình
      // sản xuất quy về In Review thay vì gộp vào started. APPEND giá trị — không bớt (hot-file UNION).
      sql`state_group IN ('backlog', 'unstarted', 'started', 'review', 'completed', 'cancelled')`,
    ),
  ],
);

export type ProjectState = typeof projectStates.$inferSelect;
export type NewProjectState = typeof projectStates.$inferInsert;

/** labels — nhãn màu theo project. Soft-delete + rename/recolor. */
export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#6366f1"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("labels_company_id_idx").on(t.companyId),
    index("labels_company_project_idx").on(t.companyId, t.projectId),
    uniqueIndex("labels_project_name_active_uq")
      .on(t.companyId, t.projectId, t.name)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;

/** task_labels — gán nhãn cho work item (M:N). Link thuần: hard-DELETE khi gỡ (tiền lệ project_teams). */
export const taskLabels = pgTable(
  "task_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_labels_task_id_idx").on(t.taskId),
    index("task_labels_label_id_idx").on(t.labelId),
    uniqueIndex("task_labels_uq").on(t.companyId, t.taskId, t.labelId),
  ],
);

export type TaskLabel = typeof taskLabels.$inferSelect;
export type NewTaskLabel = typeof taskLabels.$inferInsert;


// ─── task_comments ────────────────────────────────────────────────────────────
// Thread of comments on a task. Append-only; no edit/delete for audit integrity.

export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_comments_task_id_idx").on(t.taskId),
    index("task_comments_company_id_idx").on(t.companyId),
  ],
);

export type TaskComment = typeof taskComments.$inferSelect;
export type NewTaskComment = typeof taskComments.$inferInsert;

// ─── task_attachments (B4 — real file upload, BẤT BIẾN #4: child of tasks) ──────
// Metadata-only row pointing at an object in S3/MinIO. The actual bytes live in object storage under
// a SERVER-derived tenant-scoped key `{company_id}/tasks/{task_id}/{uuid}` (NEVER client-supplied).
// APPEND-ONLY (BẤT BIẾN #2): app role has GRANT SELECT,INSERT only (NO UPDATE/DELETE) — removal is a
// soft-delete via `deleted_at` performed by a privileged path, never an app-role UPDATE. No signed URL
// / credential is ever stored here (BẤT BIẾN #3) — presigned URLs are ephemeral and computed on demand.
// RLS+FORCE + tenant policy live in migration 0190.

export const taskAttachments = pgTable(
  "task_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_attachments_company_id_idx").on(t.companyId),
    index("task_attachments_company_task_idx").on(t.companyId, t.taskId),
  ],
);

export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type NewTaskAttachment = typeof taskAttachments.$inferInsert;
