import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { attendancePeriods } from "./hr";
import { companies } from "./companies";
import { users } from "./users";
import { tasks, defects } from "./workflow";
import { kpiResults } from "./kpi";

/**
 * salary_profiles — hồ sơ lương nhân sự (G12-1, CROWN JEWEL).
 *
 * ⚠️ LƯƠNG LÀ DỮ LIỆU NHẠY CẢM (ADR-0010, BẤT BIẾN #3):
 *  - base_salary + allowances là trường nhạy cảm: Service PHẢI mask theo quyền
 *    (view-salary-profile, is_sensitive=TRUE) trước khi trả DTO. KHÔNG kế thừa qua wildcard *:*.
 *  - Mọi sửa lương ghi audit_logs (object_type='salary_profile') TRONG cùng tx (reveal⟹audit atomic).
 *  - KHÔNG secret plaintext, KHÔNG log lương, KHÔNG vào DTO của role không quyền.
 *
 * DDL/RLS/grant ở migration 0091. Soft-delete: deleted_at (KHÔNG hard-delete — BẤT BIẾN #2 spirit,
 * GRANT cho mediaos_app CHỈ SELECT/INSERT/UPDATE). Partial-unique: 1 active profile / (company, user).
 * effective_date có sẵn cho lịch sử lương G12-2 (KHÔNG over-engineer ở G12-1 — YAGNI).
 */
export const salaryProfiles = pgTable(
  "salary_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    salaryType: text("salary_type").notNull().default("monthly"),
    payCycle: text("pay_cycle").notNull().default("monthly"),
    effectiveDate: date("effective_date").notNull(),
    baseSalary: numeric("base_salary", { precision: 18, scale: 2 }).notNull(),
    allowances: jsonb("allowances")
      .notNull()
      .default(sql`'[]'::jsonb`),
    currency: text("currency").notNull().default("VND"),
    status: text("status").notNull().default("active"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("salary_profiles_company_id_idx").on(t.companyId),
    // Composite (company_id, user_id) — phải khớp migration 0091 (company_id leading cho lookup tenant-scoped).
    index("salary_profiles_user_id_idx").on(t.companyId, t.userId),
    // 1 hồ sơ lương ACTIVE / (company, user) khi chưa xoá mềm.
    uniqueIndex("salary_profiles_company_user_active_uq")
      .on(t.companyId, t.userId)
      .where(sql`deleted_at IS NULL AND status = 'active'`),
    check("salary_profile_type_check", sql`salary_type IN ('monthly','hourly','project')`),
    check("salary_profile_pay_cycle_check", sql`pay_cycle IN ('monthly','biweekly','weekly')`),
    check("salary_profile_status_check", sql`status IN ('active','inactive')`),
    check("salary_profile_base_positive_check", sql`base_salary > 0`),
  ],
);

export type SalaryProfile = typeof salaryProfiles.$inferSelect;
export type NewSalaryProfile = typeof salaryProfiles.$inferInsert;

/**
 * payroll_periods — kỳ lương (G12-2, CROWN JEWEL). MUTABLE draft→locked (ADR-0005).
 * DDL/RLS/grant + trigger lock-guard (locked→draft chặn) ở migration 0094. Soft-delete deleted_at.
 * attendance_period_id: BR khoá kỳ công/KPI trước khi chạy lương. kpi_locked = SLOT cho G8-4.
 * GRANT app SELECT/INSERT/UPDATE (NO DELETE — soft-delete). KHÔNG over-engineer (YAGNI).
 */
export const payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    /** 'YYYY-MM' (tháng lương). */
    periodMonth: text("period_month").notNull(),
    status: text("status").notNull().default("draft"),
    attendancePeriodId: uuid("attendance_period_id").references(() => attendancePeriods.id, {
      onDelete: "set null",
    }),
    kpiLocked: boolean("kpi_locked").notNull().default(false),
    lockedBy: uuid("locked_by").references(() => users.id, { onDelete: "set null" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("payroll_periods_company_id_idx").on(t.companyId),
    uniqueIndex("payroll_periods_company_month_uq")
      .on(t.companyId, t.periodMonth)
      .where(sql`deleted_at IS NULL`),
    check("payroll_periods_month_check", sql`period_month ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    check("payroll_periods_status_check", sql`status IN ('draft','locked')`),
  ],
);

export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type NewPayrollPeriod = typeof payrollPeriods.$inferInsert;

/**
 * payslips — SNAPSHOT APPEND-ONLY (G12-2, ADR-0005, BẤT BIẾN #2). DDL/RLS/grant ở migration 0095.
 * GRANT app SELECT,INSERT ONLY (KHÔNG UPDATE/DELETE). "Sửa" = ghi entry_kind adjustment/void mới.
 * KHÔNG updated_at/deleted_at. kpi/bonus/penalty NULLABLE = SLOT cho G8-4 (KHÔNG compute lượt này).
 */
export const payslips = pgTable(
  "payslips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    payrollPeriodId: uuid("payroll_period_id")
      .notNull()
      .references(() => payrollPeriods.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    salaryProfileId: uuid("salary_profile_id").references(() => salaryProfiles.id),
    baseSalary: numeric("base_salary", { precision: 18, scale: 2 }).notNull(),
    totalAllowances: numeric("total_allowances", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    gross: numeric("gross", { precision: 18, scale: 2 }).notNull(),
    net: numeric("net", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("VND"),
    workDays: numeric("work_days", { precision: 8, scale: 2 }).notNull().default("0"),
    presentDays: numeric("present_days", { precision: 8, scale: 2 }).notNull().default("0"),
    lateMinutes: integer("late_minutes").notNull().default(0),
    kpiAmount: numeric("kpi_amount", { precision: 18, scale: 2 }),
    bonusAmount: numeric("bonus_amount", { precision: 18, scale: 2 }),
    penaltyAmount: numeric("penalty_amount", { precision: 18, scale: 2 }),
    entryKind: text("entry_kind").notNull().default("original"),
    replacesPayslipId: uuid("replaces_payslip_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payslips_company_period_user_idx").on(t.companyId, t.payrollPeriodId, t.userId),
    index("payslips_company_user_idx").on(t.companyId, t.userId),
    uniqueIndex("payslips_replaces_uq")
      .on(t.replacesPayslipId)
      .where(sql`replaces_payslip_id IS NOT NULL`),
    check("payslips_entry_kind_check", sql`entry_kind IN ('original','adjustment','void')`),
    check(
      "payslips_chain_check",
      sql`(entry_kind = 'original' AND replaces_payslip_id IS NULL) OR (entry_kind IN ('adjustment','void') AND replaces_payslip_id IS NOT NULL)`,
    ),
    check("payslips_amounts_check", sql`base_salary >= 0 AND total_allowances >= 0 AND gross >= 0`),
  ],
);

export type Payslip = typeof payslips.$inferSelect;
export type NewPayslip = typeof payslips.$inferInsert;

/**
 * payslip_items — dòng chi tiết lương APPEND-ONLY (G12-2). DDL/RLS/grant ở migration 0096.
 * GRANT app SELECT,INSERT ONLY. item_type 'kpi'/'bonus'/'penalty' = SLOT cho G8-4 (KHÔNG sinh lượt này).
 */
export const payslipItems = pgTable(
  "payslip_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    payslipId: uuid("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    itemType: text("item_type").notNull(),
    label: text("label").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payslip_items_company_payslip_idx").on(t.companyId, t.payslipId),
    check(
      "payslip_items_type_check",
      sql`item_type IN ('earning','deduction','allowance','attendance','kpi','bonus','penalty')`,
    ),
  ],
);

export type PayslipItem = typeof payslipItems.$inferSelect;
export type NewPayslipItem = typeof payslipItems.$inferInsert;

/**
 * bonus_penalties — thưởng/phạt (G12-3, CROWN JEWEL). MUTABLE draft→approved/rejected (đề xuất chờ duyệt).
 * DDL/RLS/grant + trigger guard ở migration 0098. Soft-delete deleted_at (GRANT app SELECT/INSERT/UPDATE,
 * NO DELETE). KHÁC payslip snapshot (append-only) — đây là bản ghi đề xuất, payslip mới là sổ bất biến.
 *
 * BẤT BIẾN #1: company_id + RLS+FORCE (mig 0098). reference (task/defect/kpi_result) = typed-FK NULLABLE
 * + CHECK đúng-một-hoặc-không theo reference_type. ON DELETE RESTRICT giữ chuỗi audit (referent không biến mất).
 * Trigger `enforce_bonus_penalty_guard` (0098): chặn transition sai + đóng băng field tiền sau khi rời draft,
 * MIỄN TRỪ consume (payroll_period_id NULL→set 1 lần). amount > 0 (kind tách bonus/penalty — không số âm).
 */
export const bonusPenalties = pgTable(
  "bonus_penalties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("VND"),
    /** 'YYYY-MM' — kỳ lương đích (gộp vào payroll cùng period_month). */
    periodMonth: text("period_month").notNull(),
    reason: text("reason"),
    source: text("source").notNull().default("manual"),
    referenceType: text("reference_type"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "restrict" }),
    defectId: uuid("defect_id").references(() => defects.id, { onDelete: "restrict" }),
    kpiResultId: uuid("kpi_result_id").references(() => kpiResults.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("draft"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** Bind kỳ lương đã consume (chống trả 2 lần). NULL = chưa vào lương. */
    payrollPeriodId: uuid("payroll_period_id").references(() => payrollPeriods.id, {
      onDelete: "set null",
    }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("bonus_penalties_company_id_idx").on(t.companyId),
    // Khoá gộp khi runPayroll: (company, user, period_month).
    index("bonus_penalties_company_user_month_idx").on(t.companyId, t.userId, t.periodMonth),
    index("bonus_penalties_company_status_idx")
      .on(t.companyId, t.status)
      .where(sql`deleted_at IS NULL`),
    check("bonus_penalties_kind_check", sql`kind IN ('bonus','penalty')`),
    check("bonus_penalties_amount_check", sql`amount > 0`),
    check("bonus_penalties_status_check", sql`status IN ('draft','approved','rejected')`),
    check("bonus_penalties_source_check", sql`source IN ('manual','kpi','defect')`),
    check("bonus_penalties_month_check", sql`period_month ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    // reference đúng-một-hoặc-không (parity với contracts superRefine). CASE → boolean SẠCH (KHÔNG NULL):
    // literal `reference_type='task'` cho NULL khi reference_type NULL ⇒ OR ra NULL ⇒ CHECK pass sai. CASE ELSE false đóng lỗ.
    check(
      "bonus_penalties_reference_check",
      sql`CASE
        WHEN reference_type IS NULL THEN (task_id IS NULL AND defect_id IS NULL AND kpi_result_id IS NULL)
        WHEN reference_type = 'task'       THEN (task_id       IS NOT NULL AND defect_id IS NULL AND kpi_result_id IS NULL)
        WHEN reference_type = 'defect'     THEN (defect_id     IS NOT NULL AND task_id   IS NULL AND kpi_result_id IS NULL)
        WHEN reference_type = 'kpi_result' THEN (kpi_result_id IS NOT NULL AND task_id   IS NULL AND defect_id     IS NULL)
        ELSE false
      END`,
    ),
    // approved ⇒ phải có approver + thời điểm (cặp duyệt đầy đủ).
    check(
      "bonus_penalties_approved_pair_check",
      sql`status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)`,
    ),
    // consume cặp: payroll_period_id ↔ consumed_at cùng NULL hoặc cùng set.
    check(
      "bonus_penalties_consumed_pair_check",
      sql`(payroll_period_id IS NULL AND consumed_at IS NULL)
        OR (payroll_period_id IS NOT NULL AND consumed_at IS NOT NULL)`,
    ),
    // CHỈ hàng approved mới được consume (bind kỳ lương) — chặn ở DB kể cả khi service/repo có bug.
    check(
      "bonus_penalties_consume_approved_check",
      sql`payroll_period_id IS NULL OR status = 'approved'`,
    ),
  ],
);

export type BonusPenalty = typeof bonusPenalties.$inferSelect;
export type NewBonusPenalty = typeof bonusPenalties.$inferInsert;
