import { sql } from "drizzle-orm";
import {
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
