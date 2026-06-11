import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
import { contentItems } from "./media";

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
    currentStepOrder: integer("current_step_order").notNull().default(1),
    status: text("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("wf_instances_company_id_idx").on(t.companyId),
    index("wf_instances_content_item_id_idx").on(t.contentItemId),
    // 1 content item → 1 active workflow at a time
    uniqueIndex("wf_instances_content_item_active_uq")
      .on(t.contentItemId)
      .where(sql`status = 'active' AND content_item_id IS NOT NULL`),
    check("wf_instances_status_check", sql`status IN ('active', 'completed', 'cancelled')`),
    check(
      "wf_instances_target_check",
      sql`content_item_id IS NOT NULL`,
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
    contentItemId: uuid("content_item_id").references(() => contentItems.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("not_started"),
    origin: text("origin").notNull().default("initial"),
    revisionRound: integer("revision_round").notNull().default(0),
    dueDate: timestamp("due_date", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_company_id_idx").on(t.companyId),
    index("tasks_assignee_user_id_idx").on(t.assigneeUserId),
    index("tasks_workflow_step_id_idx").on(t.workflowStepId),
    // Dedup key: chống sinh trùng khi replay outbox (§5.3 spike)
    uniqueIndex("tasks_dedup_key_uq")
      .on(t.companyId, t.workflowStepId, t.revisionRound)
      .where(sql`workflow_step_id IS NOT NULL AND deleted_at IS NULL`),
    check(
      "tasks_status_check",
      sql`status IN ('not_started', 'in_progress', 'waiting_review', 'revision', 'approved', 'completed')`,
    ),
    check("tasks_origin_check", sql`origin IN ('initial', 'revision')`),
    check(
      "tasks_task_type_check",
      sql`task_type IN ('workflow_step', 'office', 'meeting_action', 'hr', 'finance')`,
    ),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

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
    check(
      "approval_steps_decision_check",
      sql`decision IN ('approved', 'revision_requested')`,
    ),
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
    causedByApprovalStepId: uuid("caused_by_approval_step_id").references(
      () => approvalSteps.id,
      { onDelete: "set null" },
    ),
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
