import { sql } from "drizzle-orm";
import { check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { orgUnits } from "./org";
import { positions } from "./positions";
import { users } from "./users";

/**
 * employee_profiles — hồ sơ nhân sự đầy đủ.
 * ⚠️ base_salary là trường nhạy cảm: Service PHẢI mask theo quyền (view-salary permission)
 *    trước khi trả DTO. Không bao giờ trả base_salary cho role không có quyền.
 * DDL/RLS/grant ở migration 0018. Soft-delete: deleted_at.
 * direct_manager_id = shortcut FK (1 quản lý chính); EMR dùng cho đa quản lý/scope.
 * Service phải đồng bộ: set direct_manager_id → upsert EMR relation_type='direct_manager'.
 */
export const employeeProfiles = pgTable(
  "employee_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    employeeCode: text("employee_code"),
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    positionId: uuid("position_id").references(() => positions.id, { onDelete: "set null" }),
    directManagerId: uuid("direct_manager_id").references(() => users.id, { onDelete: "set null" }),
    workType: text("work_type").notNull().default("offline"),
    employmentType: text("employment_type").notNull().default("full_time"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    contractType: text("contract_type"),
    baseSalary: numeric("base_salary", { precision: 18, scale: 2 }),
    salaryType: text("salary_type").notNull().default("monthly"),
    phone: text("phone"),
    avatarUrl: text("avatar_url"),
    notes: text("notes"),
    status: text("status").notNull().default("active"),
    // G11: ca làm được gán (FK → work_schedules ở migration 0061; không .references() để tránh
    // import vòng employees ↔ hr). NULL = dùng ca mặc định công ty (is_default).
    workScheduleId: uuid("work_schedule_id"),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("employee_profiles_company_id_idx").on(t.companyId),
    index("employee_profiles_user_id_idx").on(t.userId),
    uniqueIndex("employee_profiles_company_user_active_uq")
      .on(t.companyId, t.userId)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("employee_profiles_company_code_active_uq")
      .on(t.companyId, t.employeeCode)
      .where(sql`deleted_at IS NULL AND employee_code IS NOT NULL`),
    check("emp_work_type_check", sql`work_type IN ('offline','remote','hybrid')`),
    check(
      "emp_employment_type_check",
      sql`employment_type IN ('full_time','part_time','freelancer','intern','probation')`,
    ),
    check("emp_salary_type_check", sql`salary_type IN ('monthly','hourly','project')`),
    check(
      "emp_status_check",
      sql`status IN ('active','inactive','resigned','terminated')`,
    ),
  ],
);

export type EmployeeProfile = typeof employeeProfiles.$inferSelect;
export type NewEmployeeProfile = typeof employeeProfiles.$inferInsert;

/**
 * employee_manager_relations — quan hệ quản lý đa chiều (đa quản lý / scope).
 * DDL/RLS/grant ở migration 0018. Soft-delete: deleted_at.
 */
export const employeeManagerRelations = pgTable(
  "employee_manager_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeUserId: uuid("employee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    managerUserId: uuid("manager_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    scopeType: text("scope_type"),
    scopeId: uuid("scope_id"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("emr_company_id_idx").on(t.companyId),
    index("emr_employee_user_id_idx").on(t.employeeUserId),
    index("emr_manager_user_id_idx").on(t.managerUserId),
    check(
      "emr_relation_type_check",
      sql`relation_type IN ('direct_manager','project_manager','professional_manager','temporary_manager')`,
    ),
    check(
      "emr_scope_type_check",
      sql`scope_type IS NULL OR scope_type IN ('company','org_unit','project','team')`,
    ),
    check("emr_status_check", sql`status IN ('active','inactive')`),
    check("emr_no_self_manage", sql`employee_user_id <> manager_user_id`),
  ],
);

export type EmployeeManagerRelation = typeof employeeManagerRelations.$inferSelect;
export type NewEmployeeManagerRelation = typeof employeeManagerRelations.$inferInsert;
