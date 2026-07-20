import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { employeeProfiles } from "./employees";
import { projects } from "./media";
import { orgUnits } from "./org";
import { users } from "./users";

/**
 * goals + goal_updates (DB-11 §6.1/§6.2 / SPEC-10) — cây mục tiêu 3 cấp (department/project/employee, chừa
 * company ở tầng service) + sổ check-in APPEND-ONLY. DDL/RLS+FORCE/policy/grant/CHECK/index ở migration 0504.
 * Inference dưới đây PARITY với migration (Drizzle KHÔNG mô tả RLS/grant/policy — migration là chuẩn).
 * KHÔNG db:generate (tránh sinh DROP schema media/finance cũ đang park).
 *
 * company_id NOT NULL (BẤT BIẾN #1): RLS ENABLE + FORCE + policy tenant_isolation literal-GUC (company_id =
 *   NULLIF(current_setting('app.current_company_id',true),'')::uuid) — mẫu 0479/0495. Mọi query qua
 *   withTenant(companyId, fn).
 *
 * ⚠️ BẢN ĐỒ TÊN DB-11 → QUAN HỆ THẬT: departments → org_units · employees → employee_profiles · projects tồn tại.
 */
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    goalCode: varchar("goal_code", { length: 100 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    // company/department/project/employee (MVP service chặn 'company' — GOAL-ERR-004).
    level: varchar("level", { length: 20 }).notNull(),
    // anchor cột — FK ĐƠN CỘT (bẫy composite SET NULL #247). CASCADE: anchor CHECK cấm SET NULL.
    departmentId: uuid("department_id").references(() => orgUnits.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id").references(() => employeeProfiles.id, { onDelete: "cascade" }),
    parentGoalId: uuid("parent_goal_id").references((): AnyPgColumn => goals.id, {
      onDelete: "set null",
    }),
    ownerEmployeeId: uuid("owner_employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    periodType: varchar("period_type", { length: 20 }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    measureType: varchar("measure_type", { length: 20 }).notNull().default("percent"),
    targetValue: numeric("target_value", { precision: 18, scale: 2 }),
    currentValue: numeric("current_value", { precision: 18, scale: 2 }),
    unit: varchar("unit", { length: 50 }),
    progressMode: varchar("progress_mode", { length: 20 }).notNull().default("manual"),
    // cache dẫn xuất (SPEC-10 §13); NULL = "chưa đo" (khác 0%).
    progressPercent: numeric("progress_percent", { precision: 5, scale: 2 }),
    weight: numeric("weight", { precision: 8, scale: 2 }).notNull().default("1"),
    status: varchar("status", { length: 20 }).notNull().default("Draft"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: uuid("finalized_by").references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_goals_company_code_active")
      .on(t.companyId, t.goalCode)
      .where(sql`deleted_at IS NULL`),
    index("idx_goals_company_level_period")
      .on(t.companyId, t.level, t.periodStart.desc())
      .where(sql`deleted_at IS NULL`),
    index("idx_goals_company_department")
      .on(t.companyId, t.departmentId, t.status)
      .where(sql`deleted_at IS NULL AND department_id IS NOT NULL`),
    index("idx_goals_company_project")
      .on(t.companyId, t.projectId)
      .where(sql`deleted_at IS NULL AND project_id IS NOT NULL`),
    index("idx_goals_company_employee")
      .on(t.companyId, t.employeeId, t.periodStart.desc())
      .where(sql`deleted_at IS NULL AND employee_id IS NOT NULL`),
    index("idx_goals_company_parent")
      .on(t.companyId, t.parentGoalId)
      .where(sql`deleted_at IS NULL AND parent_goal_id IS NOT NULL`),
    check("chk_goals_level", sql`level IN ('company', 'department', 'project', 'employee')`),
    check(
      "chk_goals_level_anchor",
      sql`(level = 'company'    AND department_id IS NULL     AND project_id IS NULL     AND employee_id IS NULL) OR
          (level = 'department' AND department_id IS NOT NULL AND project_id IS NULL     AND employee_id IS NULL) OR
          (level = 'project'    AND project_id IS NOT NULL    AND department_id IS NULL  AND employee_id IS NULL) OR
          (level = 'employee'   AND employee_id IS NOT NULL   AND department_id IS NULL  AND project_id IS NULL)`,
    ),
    check("chk_goals_period", sql`period_end >= period_start`),
    check("chk_goals_period_type", sql`period_type IN ('quarter', 'year', 'custom')`),
    check("chk_goals_measure", sql`measure_type IN ('percent', 'number', 'boolean')`),
    check("chk_goals_mode", sql`progress_mode IN ('manual', 'project', 'tasks', 'children')`),
    check("chk_goals_mode_project", sql`progress_mode <> 'project' OR level = 'project'`),
    check("chk_goals_status", sql`status IN ('Draft', 'Active', 'Completed', 'Cancelled')`),
    check(
      "chk_goals_progress",
      sql`progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100)`,
    ),
    check("chk_goals_weight", sql`weight > 0`),
    check("chk_goals_no_self_parent", sql`parent_goal_id IS NULL OR parent_goal_id <> id`),
  ],
);

/**
 * goal_updates — sổ check-in/finalize/reopen APPEND-ONLY (BẤT BIẾN #2, cùng họ task_activity_logs). App role
 * chỉ GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE. KHÔNG updated_at/deleted_at (ledger — DB-11 §6.2).
 */
export const goalUpdates = pgTable(
  "goal_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    updateType: varchar("update_type", { length: 20 }).notNull(),
    // NOT NULL → CASCADE (mirror notification_delivery_logs.recipient_user_id — append-only + NOT NULL user FK).
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    oldCurrentValue: numeric("old_current_value", { precision: 18, scale: 2 }),
    newCurrentValue: numeric("new_current_value", { precision: 18, scale: 2 }),
    oldProgressPercent: numeric("old_progress_percent", { precision: 5, scale: 2 }),
    newProgressPercent: numeric("new_progress_percent", { precision: 5, scale: 2 }),
    confidence: smallint("confidence"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_goal_updates_goal").on(t.companyId, t.goalId, t.createdAt.desc()),
    check("chk_goal_updates_type", sql`update_type IN ('checkin', 'finalize', 'reopen')`),
    check(
      "chk_goal_updates_confidence",
      sql`confidence IS NULL OR (confidence >= 0 AND confidence <= 100)`,
    ),
  ],
);

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type GoalUpdate = typeof goalUpdates.$inferSelect;
export type NewGoalUpdate = typeof goalUpdates.$inferInsert;
