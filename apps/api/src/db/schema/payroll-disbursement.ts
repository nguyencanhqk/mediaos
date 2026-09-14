import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";

/**
 * PAYROLL v2 track C — tạm ứng · đợt chi trả · dòng chi · ngân sách (DB-13 §14, mig `0572`,
 * S15-PAYROLL-DB-2). Tách khỏi `payroll.ts` vì file đó đã vượt trần 800 dòng.
 *
 * ⚠️ CROWN-JEWEL — ba bất biến áp cho CẢ BỐN bảng:
 *  #1 company_id + RLS ENABLE/FORCE + policy tenant_isolation; composite tenant-FK `(company_id, x_id)` và
 *     `UNIQUE (company_id, id)` sống ở SQL (drizzle không biểu diễn composite FK kiểu SET NULL (col)).
 *  #2 KHÔNG bảng nào có GRANT DELETE — gỡ = xoá mềm `deleted_at`. `mediaos_worker` 0 quyền.
 *  #3 số tiền MASK ở server; `payroll_payment_lines.bank_account_snapshot` mask 4 số cuối khi đọc (API-070),
 *     bản đầy đủ chỉ rời server qua tệp UNC (API-071) + audit.
 *
 * Ba trigger chốt cuối sống ở SQL (drizzle không biểu diễn): `payroll_payment_batch_freeze` ·
 * `payroll_payment_line_guard` · `payroll_advance_freeze_guard` — mọi cái ném `23514` với message MỞ ĐẦU bằng
 * tên trigger để service map theo tiền tố (S15-PAYROLL-BE-4).
 */

/**
 * payroll_advances — tạm ứng (DB-13 §14.1). FSM 4 trạng thái `Pending → Approved | Rejected`,
 * `Approved → Deducted`; tính lại kỳ chưa `Approved` nhả `Deducted → Approved` kèm NULL CẢ cặp consume.
 *
 * Cặp `(payroll_period_id, consumed_at)` NULL/NOT NULL là khoá chống khấu trừ hai lần (khuôn
 * `bonus_penalties`), cộng hai chiều: đã bind ⇒ `Deducted` (`consume_status_check`) và `Deducted` ⇒ đã bind
 * (`deducted_bound_check`) — thiếu chiều sau thì một khoản «đã trừ» không trỏ kỳ nào.
 */
export const payrollAdvances = pgTable(
  "payroll_advances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // composite FK → users (company_id, id) NO ACTION.
    userId: uuid("user_id").notNull(),
    /** Số tiền — MASK ở server. */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    /** 'YYYY-MM' — kỳ sẽ khấu trừ. */
    deductPeriodMonth: text("deduct_period_month").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("Pending"),
    // composite FK → users SET NULL (decided_by).
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    // composite FK → payroll_periods (company_id, id) NO ACTION.
    payrollPeriodId: uuid("payroll_period_id"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    index("payroll_advances_company_user_month_idx")
      .on(t.companyId, t.userId, t.deductPeriodMonth)
      .where(sql`deleted_at IS NULL`),
    index("payroll_advances_company_status_idx")
      .on(t.companyId, t.status)
      .where(sql`deleted_at IS NULL`),
    index("payroll_advances_company_period_idx")
      .on(t.companyId, t.payrollPeriodId)
      .where(sql`payroll_period_id IS NOT NULL`),
    check(
      "payroll_advances_status_check",
      sql`status IN ('Pending','Approved','Rejected','Deducted')`,
    ),
    check("payroll_advances_amount_check", sql`amount > 0`),
    check("payroll_advances_month_check", sql`deduct_period_month ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    check(
      "payroll_advances_decided_pair_check",
      sql`status = 'Pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)`,
    ),
    check(
      "payroll_advances_reject_note_check",
      sql`status <> 'Rejected' OR decision_note IS NOT NULL`,
    ),
    check(
      "payroll_advances_consumed_pair_check",
      sql`(payroll_period_id IS NULL) = (consumed_at IS NULL)`,
    ),
    check(
      "payroll_advances_consume_status_check",
      sql`payroll_period_id IS NULL OR status = 'Deducted'`,
    ),
    check(
      "payroll_advances_deducted_bound_check",
      sql`status <> 'Deducted' OR payroll_period_id IS NOT NULL`,
    ),
    check(
      "payroll_advances_four_eyes_check",
      sql`decided_by IS NULL OR created_by IS NULL OR decided_by <> created_by`,
    ),
  ],
);

export type PayrollAdvance = typeof payrollAdvances.$inferSelect;
export type NewPayrollAdvance = typeof payrollAdvances.$inferInsert;

/**
 * payroll_payment_batches — đợt chi trả (DB-13 §14.2). MỘT KỲ CÓ NHIỀU ĐỢT (bank + cash, hoặc chia theo
 * đơn vị) ⇒ `company_period_idx` **non-unique có chủ đích**; `Paid` của kỳ bám luật PHỦ (SPEC-11 §13.1),
 * ép ở service dưới row-lock kỳ TRƯỚC · đợt SAU.
 */
export const payrollPaymentBatches = pgTable(
  "payroll_payment_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // composite FK → payroll_periods (company_id, id) NO ACTION.
    payrollPeriodId: uuid("payroll_period_id").notNull(),
    code: text("code").notNull(),
    method: text("method").notNull(),
    status: text("status").notNull().default("Draft"),
    payDate: date("pay_date"),
    // composite FK → users SET NULL (completed_by).
    completedBy: uuid("completed_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    uniqueIndex("payroll_payment_batches_company_code_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL`),
    // NON-UNIQUE CÓ CHỦ ĐÍCH — «sửa» thành unique là giết kỳ nhiều đợt.
    index("payroll_payment_batches_company_period_idx")
      .on(t.companyId, t.payrollPeriodId)
      .where(sql`deleted_at IS NULL`),
    check("payroll_payment_batches_method_check", sql`method IN ('bank','cash')`),
    check("payroll_payment_batches_status_check", sql`status IN ('Draft','Ready','Completed')`),
    check(
      "payroll_payment_batches_completed_pair_check",
      sql`status <> 'Completed' OR (completed_by IS NOT NULL AND completed_at IS NOT NULL)`,
    ),
  ],
);

export type PayrollPaymentBatch = typeof payrollPaymentBatches.$inferSelect;
export type NewPayrollPaymentBatch = typeof payrollPaymentBatches.$inferInsert;

/**
 * payroll_payment_lines — dòng chi trả per nhân sự (DB-13 §14.3). **KHÔNG lưu số tiền** — đọc từ `payslip_id`
 * (một nguồn sự thật cho một khoản tiền). **Số tài khoản thì NGƯỢC LẠI — đóng băng lúc lập đợt**: tệp UNC đã gửi
 * ngân hàng phải giải thích được bằng số lúc gửi.
 *
 * `payslip_uq` (toàn công ty) là chốt cuối chống TRẢ HAI LẦN — mạnh hơn `batch_user_uq` (chỉ trong CÙNG đợt).
 * Service map `23505` theo TÊN `payroll_payment_lines_payslip_uq` ⇒ 409 ERR-027 `payee-already-in-batch`.
 */
export const payrollPaymentLines = pgTable(
  "payroll_payment_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // composite FK → payroll_payment_batches (company_id, id) NO ACTION.
    batchId: uuid("batch_id").notNull(),
    // composite FK → users (company_id, id) NO ACTION.
    userId: uuid("user_id").notNull(),
    // composite FK → payslips (company_id, id) NO ACTION — NGUỒN số tiền.
    payslipId: uuid("payslip_id").notNull(),
    /** PII — số TK ĐÓNG BĂNG lúc lập đợt; mask 4 số cuối khi đọc qua API-070. */
    bankAccountSnapshot: text("bank_account_snapshot"),
    bankNameSnapshot: text("bank_name_snapshot"),
    accountHolderSnapshot: text("account_holder_snapshot"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    uniqueIndex("payroll_payment_lines_batch_user_uq")
      .on(t.companyId, t.batchId, t.userId)
      .where(sql`deleted_at IS NULL`),
    index("payroll_payment_lines_company_batch_idx")
      .on(t.companyId, t.batchId)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("payroll_payment_lines_payslip_uq")
      .on(t.companyId, t.payslipId)
      .where(sql`deleted_at IS NULL`),
    check(
      "payroll_payment_lines_bank_pair_check",
      sql`bank_account_snapshot IS NULL OR (bank_name_snapshot IS NOT NULL AND account_holder_snapshot IS NOT NULL)`,
    ),
  ],
);

export type PayrollPaymentLine = typeof payrollPaymentLines.$inferSelect;
export type NewPayrollPaymentLine = typeof payrollPaymentLines.$inferInsert;

/**
 * payroll_budgets — ngân sách lương năm × đơn vị (DB-13 §14.4). `org_unit_id NULL` = toàn công ty.
 * «Thực hiện» KHÔNG lưu cột — cộng từ kỳ `Published` trở đi lúc đọc (API-073).
 *
 * ⚠️ Unique dùng `COALESCE(org_unit_id, sentinel toàn-0)`: unique thường coi NULL ≠ NULL ⇒ «toàn công ty năm
 * 2026» tạo được VÔ HẠN lần và ERR-029 thành mã chết.
 */
export const payrollBudgets = pgTable(
  "payroll_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(),
    // composite FK → org_units (company_id, id) NO ACTION; NULL = toàn công ty.
    orgUnitId: uuid("org_unit_id"),
    plannedAmount: numeric("planned_amount", { precision: 18, scale: 2 }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    uniqueIndex("payroll_budgets_year_unit_uq")
      .on(
        t.companyId,
        t.fiscalYear,
        sql`COALESCE(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`deleted_at IS NULL`),
    check("payroll_budgets_year_check", sql`fiscal_year BETWEEN 2000 AND 2100`),
    check("payroll_budgets_amount_check", sql`planned_amount >= 0`),
  ],
);

export type PayrollBudget = typeof payrollBudgets.$inferSelect;
export type NewPayrollBudget = typeof payrollBudgets.$inferInsert;
