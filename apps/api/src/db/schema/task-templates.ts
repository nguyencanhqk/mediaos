import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { orgUnits } from "./org";
import { users } from "./users";

/**
 * task_templates + task_template_items (DB-11 §6.3/§6.4 / SPEC-10 đợt D) — header template phân rã mục tiêu →
 * task + từng task mẫu. DDL/RLS+FORCE/policy/grant/CHECK/index ở migration 0526. Inference dưới đây PARITY với
 * migration (Drizzle KHÔNG mô tả RLS/grant/policy — migration là chuẩn). KHÔNG db:generate (tránh sinh DROP
 * schema media/finance cũ đang park).
 *
 * company_id NOT NULL (BẤT BIẾN #1): RLS ENABLE + FORCE + policy tenant_isolation literal-GUC (mẫu 0479/0504).
 * Cả 2 bảng soft-delete (deleted_at) — app GRANT SELECT,INSERT,UPDATE (KHÔNG DELETE), worker SELECT.
 *
 * ⚠️ BẢN ĐỒ TÊN DB-11 → QUAN HỆ THẬT: departments → org_units.
 */
export const taskTemplates = pgTable(
  "task_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    // NULL = template dùng chung công ty; FK org_units ON DELETE SET NULL (xoá phòng ⇒ template thành dùng-chung).
    departmentId: uuid("department_id").references(() => orgUnits.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_task_templates_company_name")
      .on(t.companyId, t.name)
      .where(sql`deleted_at IS NULL`),
    index("idx_task_templates_company_dept")
      .on(t.companyId, t.departmentId)
      .where(sql`deleted_at IS NULL`),
  ],
);

/**
 * task_template_items — từng task mẫu trong template. FK template_id ON DELETE CASCADE (item là con). Áp
 * template (TPL-1) → tạo task mang goal_id; checklist (mảng string) map sang task_checklists.
 */
export const taskTemplateItems = pgTable(
  "task_template_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => taskTemplates.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    // task priority DB-06 §8.5 (workflow.ts:480): urgent/high/medium/low/none. NULL = dùng default lúc áp.
    defaultPriority: varchar("default_priority", { length: 50 }),
    estimateHours: numeric("estimate_hours", { precision: 8, scale: 2 }),
    checklist: jsonb("checklist"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_task_template_items_tpl")
      .on(t.companyId, t.templateId, t.sortOrder)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_task_template_items_priority",
      sql`default_priority IS NULL OR default_priority IN ('urgent', 'high', 'medium', 'low', 'none')`,
    ),
  ],
);

export type TaskTemplate = typeof taskTemplates.$inferSelect;
export type NewTaskTemplate = typeof taskTemplates.$inferInsert;
export type TaskTemplateItem = typeof taskTemplateItems.$inferSelect;
export type NewTaskTemplateItem = typeof taskTemplateItems.$inferInsert;
