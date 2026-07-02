import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { employeeProfiles } from "./employees";
import { files } from "./files";
import { users } from "./users";

/**
 * HR master data (S2-HR-DB-1, mig 0442) — job_levels · contract_types · employee_code_configs.
 * DB-03 §6 / IMPLEMENTATION-05 §12.2. company-scoped, RLS+FORCE+policy tenant_isolation ở migration.
 * Soft-delete: deleted_at. Reconcile-first: bổ sung phần DB-03 mà model media-era chưa có.
 */

/** job_levels — cấp bậc nhân sự (DB-03). rank_order = thứ tự cấp. */
export const jobLevels = pgTable(
  "job_levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code"),
    name: text("name").notNull(),
    rankOrder: integer("rank_order"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("job_levels_company_id_idx").on(t.companyId),
    uniqueIndex("job_levels_company_name_active_uq")
      .on(t.companyId, t.name)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("job_levels_company_code_active_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL AND code IS NOT NULL`),
    check("job_levels_status_check", sql`status IN ('active','inactive')`),
  ],
);

export type JobLevel = typeof jobLevels.$inferSelect;
export type NewJobLevel = typeof jobLevels.$inferInsert;

/** contract_types — loại hợp đồng (DB-03). requires_end_date: hợp đồng có thời hạn. */
export const contractTypes = pgTable(
  "contract_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code"),
    name: text("name").notNull(),
    requiresEndDate: boolean("requires_end_date").notNull().default(false),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("contract_types_company_id_idx").on(t.companyId),
    uniqueIndex("contract_types_company_name_active_uq")
      .on(t.companyId, t.name)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("contract_types_company_code_active_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL AND code IS NOT NULL`),
    check("contract_types_status_check", sql`status IN ('active','inactive')`),
  ],
);

export type ContractType = typeof contractTypes.$inferSelect;
export type NewContractType = typeof contractTypes.$inferInsert;

/**
 * employee_code_configs — cấu hình FORMAT mã nhân viên (DB-03 §4.8). Việc cấp số chạy qua
 * sequence_counters (S1-FND-SEQ-1, FOR UPDATE 0-dup); bảng này CHỈ giữ prefix/pattern/length.
 * 1 config active / company (unique partial trên company_id WHERE deleted_at IS NULL).
 */
export const employeeCodeConfigs = pgTable(
  "employee_code_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    prefix: text("prefix"),
    pattern: text("pattern"),
    numberLength: integer("number_length").notNull().default(4),
    allowManualOverride: boolean("allow_manual_override").notNull().default(true),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("employee_code_configs_company_active_uq")
      .on(t.companyId)
      .where(sql`deleted_at IS NULL`),
    check("employee_code_configs_status_check", sql`status IN ('active','inactive')`),
  ],
);

export type EmployeeCodeConfig = typeof employeeCodeConfigs.$inferSelect;
export type NewEmployeeCodeConfig = typeof employeeCodeConfigs.$inferInsert;

/**
 * employee_contracts — hợp đồng lao động của nhân viên (S2-HR-BE-6, mig 0462 — DB-03 §7.7).
 * company-scoped, RLS+FORCE+policy tenant_isolation ở migration. Soft-delete: deleted_at/deleted_by.
 * employee_id → employee_profiles(id) (reconcile: bảng 'employees' KHÔNG tồn tại). contract_type_id →
 * contract_types(id). file_id → files(id) nullable (file hợp đồng chính; link chi tiết qua file_links).
 * Một employee có nhiều HĐ theo thời gian; ≤1 HĐ primary+Active/employee (partial-unique index ở migration).
 */
export const employeeContracts = pgTable(
  "employee_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employeeProfiles.id, { onDelete: "cascade" }),
    contractTypeId: uuid("contract_type_id")
      .notNull()
      .references(() => contractTypes.id),
    contractCode: text("contract_code"),
    title: text("title"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    signedDate: date("signed_date"),
    status: text("status").notNull().default("Draft"),
    isPrimary: boolean("is_primary").notNull().default(false),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    note: text("note"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("employee_contracts_company_id_idx").on(t.companyId),
    uniqueIndex("uq_employee_contracts_company_code_active")
      .on(t.companyId, t.contractCode)
      .where(sql`contract_code IS NOT NULL AND deleted_at IS NULL`),
    uniqueIndex("uq_employee_contracts_primary_active")
      .on(t.employeeId)
      .where(sql`is_primary = true AND status = 'Active' AND deleted_at IS NULL`),
    index("idx_employee_contracts_employee")
      .on(t.employeeId, t.startDate.desc())
      .where(sql`deleted_at IS NULL`),
    index("idx_employee_contracts_expiring")
      .on(t.companyId, t.status, t.endDate)
      .where(sql`deleted_at IS NULL AND end_date IS NOT NULL`),
    check(
      "chk_employee_contracts_status",
      sql`status IN ('Draft','Active','Expired','Terminated','Cancelled')`,
    ),
    check("chk_employee_contracts_date", sql`end_date IS NULL OR end_date >= start_date`),
  ],
);

export type EmployeeContract = typeof employeeContracts.$inferSelect;
export type NewEmployeeContract = typeof employeeContracts.$inferInsert;
