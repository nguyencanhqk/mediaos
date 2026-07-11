import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { employeeProfiles } from "./employees";
import { projects } from "./media";
import { users } from "./users";
import { tasks } from "./workflow";

/**
 * task_activity_logs (DB-06 §7.12 — APPEND-ONLY ledger project/task).
 *
 * DDL/RLS+FORCE/policy tenant_isolation/grant ở migration 0478 §5 — file này CHỈ typed model (KHÔNG db:generate).
 *
 * BẤT BIẾN #2 (append-only): app role GRANT SELECT,INSERT ONLY (0478:238) — KHÔNG UPDATE/DELETE.
 *   ⇒ KHÔNG có deleted_at/by (không soft-delete; ledger bất biến). Ghi qua withTenant trong CÙNG tx nghiệp vụ.
 *
 * BẢN ĐỒ TÊN DB-06 → QUAN HỆ THẬT (KHÔNG có bảng `employees`):
 *   actor_employee_id → employee_profiles(id). actor_user_id/project_id/task_id = FK SET NULL để log SỐNG SÓT
 *   khi user/project/task bị xoá (durability ledger).
 */
export const taskActivityLogs = pgTable(
  "task_activity_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorEmployeeId: uuid("actor_employee_id").references(() => employeeProfiles.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    message: text("message"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_task_activity_project_created")
      .on(t.companyId, t.projectId, t.createdAt.desc())
      .where(sql`project_id IS NOT NULL`),
    index("idx_task_activity_task_created")
      .on(t.companyId, t.taskId, t.createdAt.desc())
      .where(sql`task_id IS NOT NULL`),
    index("idx_task_activity_actor_created").on(t.companyId, t.actorUserId, t.createdAt.desc()),
    index("idx_task_activity_action_created").on(t.companyId, t.action, t.createdAt.desc()),
    index("idx_task_activity_target").on(t.companyId, t.targetType, t.targetId, t.createdAt.desc()),
    check(
      "chk_task_activity_target_type",
      sql`target_type IN ('Project','Task','Member','Comment','File','Checklist','ChecklistItem','Watcher','Assignee')`,
    ),
  ],
);

export type TaskActivityLog = typeof taskActivityLogs.$inferSelect;
export type NewTaskActivityLog = typeof taskActivityLogs.$inferInsert;
