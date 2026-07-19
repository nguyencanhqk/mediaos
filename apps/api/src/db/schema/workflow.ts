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
import { users } from "./users";
import { contentItems, projects } from "./media";

// ─── Enums (text columns with CHECK) ────────────────────────────────────────

export type StepStatus =
  | "not_started"
  | "in_progress"
  | "waiting_review"
  | "approved"
  | "revision"
  | "blocked";

export type InstanceStatus = "active" | "completed" | "cancelled";

export type TaskStatus =
  | "not_started"
  | "in_progress"
  | "waiting_review"
  | "revision"
  | "approved"
  | "completed";

export type TaskOrigin = "initial" | "revision";

export type ApprovalRequestStatus = "pending" | "approved" | "revision_requested";

export type StepEvent =
  | "start"
  | "submit"
  | "approve"
  | "request_revision"
  | "open_next"
  | "complete_workflow";

// ─── workflow_definitions ─────────────────────────────────────────────────────

export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    appliesTo: text("applies_to").notNull().default("content_item"),
    maxApprovalLevel: integer("max_approval_level").notNull().default(1),
    allowParallelSteps: boolean("allow_parallel_steps").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    // G7: versioning (D4). Published version is immutable; edits clone to version+1 (status=draft).
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("workflow_defs_company_id_idx").on(t.companyId),
    uniqueIndex("workflow_defs_company_code_version_active_uq")
      .on(t.companyId, t.code, t.version)
      .where(sql`deleted_at IS NULL`),
    check("workflow_defs_status_check", sql`status IN ('draft', 'published', 'archived')`),
  ],
);

export type WorkflowDefinition = typeof workflowDefinitions.$inferSelect;

// ─── workflow_definition_steps ────────────────────────────────────────────────

export const workflowDefinitionSteps = pgTable(
  "workflow_definition_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowDefinitionId: uuid("workflow_definition_id")
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    assigneeRoleCode: text("assignee_role_code"),
    reviewerRoleCode: text("reviewer_role_code"),
    isRequired: boolean("is_required").notNull().default(true),
    defaultTaskTitle: text("default_task_title").notNull(),
    // G7: node_key = stable identity for DAG deps + canvas (decoupled from step_order pointer).
    nodeKey: text("node_key").notNull(),
    stepType: text("step_type").notNull().default("task"),
    positionX: integer("position_x"),
    positionY: integer("position_y"),
    // Forward ref to checklists (defined below) — resolved lazily via thunk.
    // AnyPgColumn return annotation breaks the circular-ref implicit-any (TS7022/7024).
    defaultChecklistId: uuid("default_checklist_id").references((): AnyPgColumn => checklists.id, {
      onDelete: "set null",
    }),
    // G7-4 (4a): evaluation hook — POINTER only, no engine in G7. requires_evaluation flags a step
    // that must emit step.evaluation_required when approved (consumer = G8). evaluation_template_id is
    // a SOFT ref (real eval table lives in G8) — bare uuid, no FK, deferred like content_types (G6-4).
    requiresEvaluation: boolean("requires_evaluation").notNull().default(false),
    evaluationTemplateId: uuid("evaluation_template_id"),
  },
  (t) => [
    index("wf_def_steps_def_id_idx").on(t.workflowDefinitionId),
    uniqueIndex("wf_def_steps_def_order_uq")
      .on(t.workflowDefinitionId, t.stepOrder)
      .where(sql`1=1`),
    uniqueIndex("wf_def_steps_def_node_key_uq").on(t.workflowDefinitionId, t.nodeKey),
    index("wf_def_steps_default_checklist_id_idx")
      .on(t.defaultChecklistId)
      .where(sql`default_checklist_id IS NOT NULL`),
  ],
);

export type WorkflowDefinitionStep = typeof workflowDefinitionSteps.$inferSelect;

// ─── G7 Workflow Builder: checklists + checklist_items + step dependencies ─────
// checklists.workflowDefinitionStepId ↔ workflowDefinitionSteps.defaultChecklistId is a circular FK;
// Drizzle resolves both via lazy thunks. RLS+FORCE for these tables lives in migration 0032.

export const checklists = pgTable(
  "checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    workflowDefinitionStepId: uuid("workflow_definition_step_id").references(
      (): AnyPgColumn => workflowDefinitionSteps.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("checklists_company_id_idx").on(t.companyId),
    index("checklists_def_step_id_idx").on(t.workflowDefinitionStepId),
  ],
);

export type Checklist = typeof checklists.$inferSelect;

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    checklistId: uuid("checklist_id")
      .notNull()
      .references(() => checklists.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    isRequired: boolean("is_required").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("checklist_items_company_id_idx").on(t.companyId),
    index("checklist_items_checklist_id_idx").on(t.checklistId),
  ],
);

export type ChecklistItem = typeof checklistItems.$inferSelect;

// workflow_step_dependencies — DAG edges at template level (step B waits for step A).
// DB enforces only no-self-loop; acyclicity is enforced app-side (DagValidatorService, G7-2a).

export const workflowStepDependencies = pgTable(
  "workflow_step_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowDefinitionId: uuid("workflow_definition_id")
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: "cascade" }),
    fromStepId: uuid("from_step_id")
      .notNull()
      .references(() => workflowDefinitionSteps.id, { onDelete: "cascade" }),
    toStepId: uuid("to_step_id")
      .notNull()
      .references(() => workflowDefinitionSteps.id, { onDelete: "cascade" }),
    dependencyType: text("dependency_type").notNull().default("finish_to_start"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wf_step_deps_company_id_idx").on(t.companyId),
    index("wf_step_deps_def_id_idx").on(t.workflowDefinitionId),
    index("wf_step_deps_from_step_id_idx").on(t.fromStepId),
    index("wf_step_deps_to_step_id_idx").on(t.toStepId),
    uniqueIndex("wf_step_deps_edge_uq").on(t.workflowDefinitionId, t.fromStepId, t.toStepId),
    check("wf_step_deps_no_self_loop", sql`from_step_id <> to_step_id`),
    check(
      "wf_step_deps_type_check",
      sql`dependency_type IN ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')`,
    ),
  ],
);

export type WorkflowStepDependency = typeof workflowStepDependencies.$inferSelect;

// ─── step_transitions ─────────────────────────────────────────────────────────
// Data-driven FSM guard table. Engine rejects any (from_state, event) pair not found here.

export const stepTransitions = pgTable(
  "step_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowDefinitionId: uuid("workflow_definition_id")
      .notNull()
      .references(() => workflowDefinitions.id, { onDelete: "cascade" }),
    fromState: text("from_state").notNull(),
    event: text("event").notNull(),
    toState: text("to_state").notNull(),
    // null = applies to all step codes; non-null limits to specific step code
    appliesToStepCode: text("applies_to_step_code"),
    writtenBy: text("written_by").notNull().default("service"),
  },
  (t) => [
    index("step_transitions_def_id_idx").on(t.workflowDefinitionId),
    uniqueIndex("step_transitions_def_from_event_uq").on(
      t.workflowDefinitionId,
      t.fromState,
      t.event,
    ),
  ],
);

export type StepTransition = typeof stepTransitions.$inferSelect;

// ─── workflow_instances ───────────────────────────────────────────────────────

export const workflowInstances = pgTable(
  "workflow_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowDefinitionId: uuid("workflow_definition_id")
      .notNull()
      .references(() => workflowDefinitions.id),
    contentItemId: uuid("content_item_id").references(() => contentItems.id, {
      onDelete: "cascade",
    }),
    // G7-3: instance can target a content_item OR a project (exactly-one — see target check).
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    currentStepOrder: integer("current_step_order").notNull().default(1),
    status: text("status").notNull().default("active"),
    // G7-3 (D4): pin the template version this instance ran against → published version is immutable,
    // deps are read from the template at this version (no separate per-instance dep snapshot).
    definitionVersion: integer("definition_version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wf_instances_company_id_idx").on(t.companyId),
    index("wf_instances_content_item_id_idx").on(t.contentItemId),
    index("wf_instances_project_id_idx").on(t.projectId),
    // 1 content item → 1 active workflow at a time
    uniqueIndex("wf_instances_content_item_active_uq")
      .on(t.contentItemId)
      .where(sql`status = 'active' AND content_item_id IS NOT NULL`),
    // 1 project → 1 active workflow at a time
    uniqueIndex("wf_instances_project_active_uq")
      .on(t.projectId)
      .where(sql`status = 'active' AND project_id IS NOT NULL`),
    check("wf_instances_status_check", sql`status IN ('active', 'completed', 'cancelled')`),
    // Exactly-one target: content_item XOR project (erd §9.1). Byte-identical with migration 0034.
    check(
      "wf_instances_target_check",
      sql`(content_item_id IS NOT NULL)::int + (project_id IS NOT NULL)::int = 1`,
    ),
  ],
);

export type WorkflowInstance = typeof workflowInstances.$inferSelect;

// ─── workflow_steps (projection) ──────────────────────────────────────────────
// ADR-0016: service writes in_progress/waiting_review; ONLY consumer writes approved/revision.

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowInstanceId: uuid("workflow_instance_id")
      .notNull()
      .references(() => workflowInstances.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
    stepCode: text("step_code").notNull(),
    stepName: text("step_name").notNull(),
    // G7-3: map back to the template step's node_key (resolve deps by definition_version). Advisory,
    // nullable; backfilled = step_code for G4-3 rows, set explicitly on apply (3b).
    nodeKey: text("node_key"),
    status: text("status").notNull().default("not_started"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    submissionUrl: text("submission_url"),
    submissionNote: text("submission_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wf_steps_instance_id_idx").on(t.workflowInstanceId),
    index("wf_steps_company_id_idx").on(t.companyId),
    uniqueIndex("wf_steps_instance_order_uq").on(t.workflowInstanceId, t.stepOrder),
    check(
      "wf_steps_status_check",
      sql`status IN ('not_started', 'in_progress', 'waiting_review', 'approved', 'revision', 'blocked')`,
    ),
  ],
);

export type WorkflowStep = typeof workflowSteps.$inferSelect;

// ─── workflow_step_checklist_states ───────────────────────────────────────────
// G7-3: instance-level checklist tick state. A row = the item is checked; un-check = DELETE.
// uq (step, item) → an item is checked at most once per step. checklist_item_id → template layer.

export const workflowStepChecklistStates = pgTable(
  "workflow_step_checklist_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowStepId: uuid("workflow_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "cascade" }),
    checklistItemId: uuid("checklist_item_id")
      .notNull()
      .references(() => checklistItems.id, { onDelete: "cascade" }),
    checkedBy: uuid("checked_by").references(() => users.id, { onDelete: "set null" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wf_step_checklist_states_company_id_idx").on(t.companyId),
    index("wf_step_checklist_states_step_id_idx").on(t.workflowStepId),
    index("wf_step_checklist_states_item_id_idx").on(t.checklistItemId),
    uniqueIndex("wf_step_checklist_states_step_item_uq").on(t.workflowStepId, t.checklistItemId),
  ],
);

export type WorkflowStepChecklistState = typeof workflowStepChecklistStates.$inferSelect;

// ─── tasks (unified hub — BẤT BIẾN #4) ───────────────────────────────────────
// task_type='workflow_step' links to workflow_steps via ref_id.
// dedup_key prevents duplicate task creation on outbox replay.

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    taskType: text("task_type").notNull().default("workflow_step"),
    workflowStepId: uuid("workflow_step_id").references(() => workflowSteps.id, {
      onDelete: "set null",
    }),
    // G9-1: workflow-instance + project context — both nullable (non-video tasks have neither).
    workflowInstanceId: uuid("workflow_instance_id").references(() => workflowInstances.id, {
      onDelete: "set null",
    }),
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
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_company_id_idx").on(t.companyId),
    index("tasks_assignee_user_id_idx").on(t.assigneeUserId),
    index("tasks_workflow_step_id_idx").on(t.workflowStepId),
    // G9-1: filter the unified board by project + workflow-instance context.
    index("tasks_project_id_idx").on(t.projectId),
    index("tasks_workflow_instance_id_idx").on(t.workflowInstanceId),
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
    // Dedup key: chống sinh trùng khi replay outbox (§5.3 spike)
    uniqueIndex("tasks_dedup_key_uq")
      .on(t.companyId, t.workflowStepId, t.revisionRound)
      .where(sql`workflow_step_id IS NOT NULL AND deleted_at IS NULL`),
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

// ─── approval_requests ────────────────────────────────────────────────────────
// Source of truth for step approval (ADR-0016). Created on submit (T2).

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowStepId: uuid("workflow_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    currentLevel: integer("current_level").notNull().default(1),
    maxLevel: integer("max_level").notNull().default(1),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("approval_reqs_step_id_idx").on(t.workflowStepId),
    index("approval_reqs_company_id_idx").on(t.companyId),
    // 1 active approval request per step at a time
    uniqueIndex("approval_reqs_step_pending_uq")
      .on(t.workflowStepId)
      .where(sql`status = 'pending'`),
    check(
      "approval_reqs_status_check",
      sql`status IN ('pending', 'approved', 'revision_requested')`,
    ),
  ],
);

export type ApprovalRequest = typeof approvalRequests.$inferSelect;

// ─── approval_steps ───────────────────────────────────────────────────────────
// Append-only: each level has exactly 1 decision. Consumer reads this to update step projection.

export const approvalSteps = pgTable(
  "approval_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    approvalRequestId: uuid("approval_request_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    level: integer("level").notNull().default(1),
    approverUserId: uuid("approver_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    comment: text("comment"),
  },
  (t) => [
    index("approval_steps_request_id_idx").on(t.approvalRequestId),
    // Append-only: 1 decision per level per request
    uniqueIndex("approval_steps_request_level_uq").on(t.approvalRequestId, t.level),
    check("approval_steps_decision_check", sql`decision IN ('approved', 'revision_requested')`),
  ],
);

export type ApprovalStepRow = typeof approvalSteps.$inferSelect;

// ─── defects ──────────────────────────────────────────────────────────────────
// Append-only. Created by consumer on StepReturnedForRevision event.

export const defects = pgTable(
  "defects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    workflowStepId: uuid("workflow_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "cascade" }),
    responsibleUserId: uuid("responsible_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    causedByApprovalStepId: uuid("caused_by_approval_step_id").references(() => approvalSteps.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("defects_step_id_idx").on(t.workflowStepId),
    index("defects_company_id_idx").on(t.companyId),
  ],
);

export type Defect = typeof defects.$inferSelect;

// ─── workflow_step_instance_locks ─────────────────────────────────────────────
// MVP-0: 1 lock reason = downstream_blocked_by_revision. Multi-branch lock → G5a.

export const workflowStepInstanceLocks = pgTable(
  "workflow_step_instance_locks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    lockedStepId: uuid("locked_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "cascade" }),
    causedByStepId: uuid("caused_by_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "cascade" }),
    lockReason: text("lock_reason").notNull().default("downstream_blocked_by_revision"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    index("wf_step_locks_locked_step_id_idx").on(t.lockedStepId),
    index("wf_step_locks_caused_by_idx").on(t.causedByStepId),
    // G7-4 (4a): at most 1 ACTIVE lock per (locked_step, caused_by) source — stops replayed
    // revisions from piling duplicate active rows. Released locks (released_at set) don't count.
    uniqueIndex("wf_step_locks_active_uq")
      .on(t.companyId, t.lockedStepId, t.causedByStepId)
      .where(sql`released_at IS NULL`),
  ],
);

export type WorkflowStepInstanceLock = typeof workflowStepInstanceLocks.$inferSelect;

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
