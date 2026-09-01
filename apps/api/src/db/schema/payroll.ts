import { sql } from "drizzle-orm";
import {
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

/**
 * PAYROLL — tiền lương (SPEC-11 · DB-13, wave S13-PAYROLL).
 *
 * ⚠️ CROWN-JEWEL. Ba bất biến áp cho CẢ BẢY bảng dưới đây:
 *  #1 company_id + RLS ENABLE/FORCE + policy tenant_isolation (mig 0091/0094/0095/0096/0098/0131 cho 6 bảng
 *     di sản, 0564 cho `payroll_period_lines`); mọi repository đi qua withTenant.
 *  #2 append-only / soft delete: `payslips` · `payslip_items` · `payslip_acknowledgements` là SỔ CHỈ-INSERT
 *     (GRANT app SELECT+INSERT). KHÔNG bảng PAYROLL nào có DELETE cho app role.
 *  #3 mọi trường tiền MASK Ở SERVER theo cặp quyền (13 cặp is_sensitive — SPEC-11 §11.1); payload NOTI/audit
 *     KHÔNG mang số tiền; lượt đọc lương người khác ghi audit trong CÙNG transaction.
 *
 * Tiền: numeric(18,2), **VND duy nhất** (mọi cột `currency` đã GỠ ở 0564) — tính/làm tròn/clamp Ở SQL.
 * FSM ép ở SERVICE (assertPeriodTransition, SPEC-11 §13.1); DB chỉ CHECK TẬP GIÁ TRỊ + UNIQUE/CHECK-cặp làm
 * chốt cuối (check-cannot-enforce-fsm-transitions).
 *
 * DDL nguồn: 0091/0094/0095/0096/0098/0130/0131 (band di sản G12, BẤT KHẢ XÂM PHẠM) + **0564** (reconcile).
 * File này là PARITY viết tay — KHÔNG chạy `db:generate` cho band này.
 */

/**
 * salary_profiles — hồ sơ lương **versioned theo `effective_date`** (PAY-DEC-003).
 *
 * Nguồn DUY NHẤT cho tính lương; `employee_profiles.base_salary` KHÔNG tham gia (giữ vai trò hiển thị HR).
 * Phiên bản hiệu lực = bản `effective_date <= ngày` mới nhất chưa xoá mềm. Cờ `status` cũ đã GỠ — hai cơ chế
 * song song (cờ active + versioned) là nguồn mâu thuẫn.
 * GRANT app SELECT/INSERT/UPDATE (NO DELETE — soft delete). `user_id` FK **NO ACTION** (0564 P2) ⇒ teardown
 * PHẢI xoá tường minh trước `DELETE FROM users` (cleanupTenants).
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
      .references(() => users.id, { onDelete: "no action" }),
    effectiveDate: date("effective_date").notNull(),
    /** Nhạy cảm — mask ở server theo cặp ('view','salary-profile'). */
    baseSalary: numeric("base_salary", { precision: 18, scale: 2 }).notNull(),
    /** Nhạy cảm — danh sách `{ name, amount }`. */
    allowances: jsonb("allowances")
      .notNull()
      .default(sql`'[]'::jsonb`),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    index("salary_profiles_company_id_idx").on(t.companyId),
    // Composite (company_id, user_id) — company_id leading cho lookup tenant-scoped (mig 0091).
    index("salary_profiles_user_id_idx").on(t.companyId, t.userId),
    // Versioned: MỘT phiên bản / ngày hiệu lực. Chốt cuối PAYROLL-ERR-014 (thay unique '1 active' của 0091).
    uniqueIndex("salary_profiles_company_user_effective_uq")
      .on(t.companyId, t.userId, t.effectiveDate)
      .where(sql`deleted_at IS NULL`),
    check("salary_profile_base_positive_check", sql`base_salary > 0`),
  ],
);

export type SalaryProfile = typeof salaryProfiles.$inferSelect;
export type NewSalaryProfile = typeof salaryProfiles.$inferInsert;

/**
 * payroll_periods — kỳ lương tháng, **FSM 7 trạng thái** (SPEC-01 §17.15 · SPEC-11 §13.1).
 *
 * Draft → CollectingData → Calculated → Reviewing → Approved → Paid → Locked. `Locked` là terminal tuyệt đối.
 * ⚠️ KHÔNG CÒN TRIGGER nào trên bảng này (0564 DROP `payroll_period_status_guard` vì nó ép FSM cũ 3 trạng thái
 * chữ thường và chặn oan mọi chuyển tiếp mới). Hệ quả CÓ CHỦ ĐÍCH:
 *   - chuyển tiếp hợp lệ ép ở service qua ĐÚNG MỘT hàm `assertPeriodTransition(from, to, via)`;
 *   - MỌI hành động chạm trạng thái mở tx bắt đầu bằng `SELECT … FOR UPDATE` trên hàng kỳ;
 *   - cấm xoá mềm kỳ non-Draft cũng chuyển lên service (nhánh cũ của 0130 mất theo trigger).
 * `payslips_generated_at/by` là **cờ đã-sinh-phiếu** — nguồn kiểm DUY NHẤT của reopen/publish, đọc DƯỚI
 * row-lock trên chính hàng này (KHÔNG đếm bảng `payslips`: bảng khác không được row-lock bảo vệ).
 * ⚠️ reopen/reject PHẢI xoá vết duyệt cũ theo bảng RESET SPEC-11 §13.1, kẻo vi phạm CHECK four-eyes ⇒ 23514.
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
    status: text("status").notNull().default("Draft"),
    /** Ghi cứng lúc tạo kỳ từ `companies.payroll_config_json.payDay`. */
    payDate: date("pay_date"),
    /** Phải `locked` trước khi tính (PAY-DEC-005). FK NO ACTION — SET NULL sẽ vỡ CHECK needs-attendance. */
    attendancePeriodId: uuid("attendance_period_id").references(() => attendancePeriods.id, {
      onDelete: "no action",
    }),
    note: text("note"),
    /** Lý do mở lại — GHI ĐÈ mỗi lần reopen; lịch sử đầy đủ ở `audit_logs`. */
    reopenReason: text("reopen_reason"),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    calculatedBy: uuid("calculated_by"),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }),
    submittedBy: uuid("submitted_by"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedBy: uuid("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lockedBy: uuid("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    payslipsGeneratedBy: uuid("payslips_generated_by"),
    payslipsGeneratedAt: timestamp("payslips_generated_at", { withTimezone: true }),
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
    check(
      "payroll_periods_status_check",
      sql`status IN ('Draft','CollectingData','Calculated','Reviewing','Approved','Paid','Locked')`,
    ),
    check(
      "payroll_periods_approved_pair_check",
      sql`status NOT IN ('Approved','Paid','Locked') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)`,
    ),
    check(
      "payroll_periods_published_pair_check",
      sql`status NOT IN ('Paid','Locked') OR (published_by IS NOT NULL AND published_at IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)`,
    ),
    check(
      "payroll_periods_locked_pair_check",
      sql`status <> 'Locked' OR (locked_by IS NOT NULL AND locked_at IS NOT NULL)`,
    ),
    // Chốt cuối four-eyes (PAY-DEC-007) — khoá cả super-admin. Service map 23514 → 409 PAYROLL-ERR-005.
    // ⚠️ CẶP với `submitted_pair_check` ngay dưới — KHÔNG tách. Vế `submitted_by IS NULL OR …` là bắt buộc
    // (bảng RESET SPEC-11 §13.1 xoá `submitted_*` khi reject/reopen), nhưng một mình nó thì chỉ cần để
    // `submitted_by` NULL là four-eyes vô hiệu.
    check(
      "payroll_periods_four_eyes_check",
      sql`approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by`,
    ),
    check(
      "payroll_periods_submitted_pair_check",
      sql`status NOT IN ('Reviewing','Approved','Paid','Locked')
        OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)`,
    ),
    // Không tồn tại kỳ đã tính mà không có nguồn công.
    check(
      "payroll_periods_calculated_needs_attendance_check",
      sql`status IN ('Draft','CollectingData') OR attendance_period_id IS NOT NULL`,
    ),
    check(
      "payroll_periods_generated_pair_check",
      sql`(payslips_generated_by IS NULL) = (payslips_generated_at IS NULL)`,
    ),
  ],
);

export type PayrollPeriod = typeof payrollPeriods.$inferSelect;
export type NewPayrollPeriod = typeof payrollPeriods.$inferInsert;

/**
 * payroll_period_lines — **bảng lương NHÁP** (bảng MỚI duy nhất của wave, DB-13 §3.1/§6.4).
 *
 * Mutable trước `Approved`, tính lại được. Bắt buộc kỹ thuật để `payslips` giữ được khuôn append-only mà bảng
 * lương vẫn tính lại được (SPEC-11 §3.4, §22a). KHÔNG có bảng thứ tám kiểu `payroll_period_inputs` — snapshot
 * đầu vào là cột `input_snapshot_json` trên chính dòng nháp và trên `payslips`.
 *
 * ⚠️ Unique là **PARTIAL** `WHERE deleted_at IS NULL`: tính lại = upsert + xoá mềm dòng không còn đủ điều kiện;
 * unique thẳng sẽ nổ 23505 ở lần tính thứ hai. **Mọi JOIN dòng nháp PHẢI lọc `deleted_at IS NULL`**
 * (partial-unique-index-makes-join-duplicate).
 * `mediaos_worker` KHÔNG có quyền nào trên bảng này (PAYROLL v1 không có system job đọc bảng lương).
 */
export const payrollPeriodLines = pgTable(
  "payroll_period_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    payrollPeriodId: uuid("payroll_period_id").notNull(),
    userId: uuid("user_id").notNull(),
    /** Phiên bản lương đã dùng — vết giải thích được. */
    salaryProfileId: uuid("salary_profile_id"),
    workDays: numeric("work_days", { precision: 8, scale: 2 }).notNull().default("0"),
    presentDays: numeric("present_days", { precision: 8, scale: 2 }).notNull().default("0"),
    paidLeaveDays: numeric("paid_leave_days", { precision: 8, scale: 2 }).notNull().default("0"),
    unpaidLeaveDays: numeric("unpaid_leave_days", { precision: 8, scale: 2 })
      .notNull()
      .default("0"),
    lateMinutes: integer("late_minutes").notNull().default(0),
    /** Ảnh chụp đầu vào lúc `calculate` — ĐÓNG BĂNG (SPEC-11 §3.4). CHECK <> '{}'. */
    inputSnapshotJson: jsonb("input_snapshot_json").notNull(),
    baseAmount: numeric("base_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    allowanceAmount: numeric("allowance_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    bonusAmount: numeric("bonus_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    penaltyAmount: numeric("penalty_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    deductionAmount: numeric("deduction_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    /** CÓ DẤU (dương = truy lĩnh · âm = truy thu) — nằm NGOÀI gross/deduction. */
    adjustmentAmount: numeric("adjustment_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    adjustmentReason: text("adjustment_reason"),
    gross: numeric("gross", { precision: 18, scale: 2 }).notNull().default("0"),
    /** net = GREATEST(gross − deduction_amount + adjustment_amount, 0) — clamp Ở SQL. */
    net: numeric("net", { precision: 18, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    uniqueIndex("payroll_period_lines_period_user_uq")
      .on(t.companyId, t.payrollPeriodId, t.userId)
      .where(sql`deleted_at IS NULL`),
    index("payroll_period_lines_company_period_idx")
      .on(t.companyId, t.payrollPeriodId)
      .where(sql`deleted_at IS NULL`),
    index("payroll_period_lines_company_user_idx").on(t.companyId, t.userId),
    // ⚠️ adjustment_amount CỐ Ý ngoài CHECK này — nó CÓ DẤU.
    check(
      "payroll_period_lines_amounts_check",
      sql`base_amount >= 0 AND allowance_amount >= 0 AND bonus_amount >= 0
        AND penalty_amount >= 0 AND deduction_amount >= 0 AND gross >= 0 AND net >= 0`,
    ),
    check(
      "payroll_period_lines_adjustment_check",
      sql`adjustment_amount = 0 OR adjustment_reason IS NOT NULL`,
    ),
    check("payroll_period_lines_snapshot_check", sql`input_snapshot_json <> '{}'::jsonb`),
  ],
);

export type PayrollPeriodLine = typeof payrollPeriodLines.$inferSelect;
export type NewPayrollPeriodLine = typeof payrollPeriodLines.$inferInsert;

/**
 * payslips — phiếu lương PHÁT HÀNH, **APPEND-ONLY** (bất biến #2, GRANT app SELECT+INSERT duy nhất).
 *
 * KHÔNG có `updated_at`/`deleted_at`, KHÔNG có cột trạng thái: ba giá trị của SPEC-01 §17.16
 * (`Generated`/`Published`/`Acknowledged`) là **DẪN XUẤT**, server tính trong DTO từ `payroll_periods.status`
 * + sự tồn tại của hàng `payslip_acknowledgements` (SPEC-11 §13.2, có nhánh mặc định fail-closed).
 * v1 KHÔNG có đường tạo `adjustment`/`void` (0564 GỠ `entry_kind`/`replaces_payslip_id`) — sai sót sau phát
 * hành xử lý bằng thưởng/phạt kỳ SAU.
 * ⚠️ `input_snapshot_json` NOT NULL và **KHÔNG DEFAULT** — cặp với CHECK `<> '{}'`: để DEFAULT thì mọi INSERT
 * bỏ trống cột đều 23514 (DEFAULT thành giá trị CHẾT). Mọi fixture/test INSERT payslips PHẢI ghi tường minh.
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
      .references(() => payrollPeriods.id, { onDelete: "no action" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "no action" }),
    salaryProfileId: uuid("salary_profile_id").references(() => salaryProfiles.id, {
      onDelete: "no action",
    }),
    baseSalary: numeric("base_salary", { precision: 18, scale: 2 }).notNull(),
    totalAllowances: numeric("total_allowances", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    bonusAmount: numeric("bonus_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    penaltyAmount: numeric("penalty_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    deductionAmount: numeric("deduction_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    /** CÓ DẤU — cố ý KHÔNG có CHECK >= 0 (SPEC-11 §13.4). */
    adjustmentAmount: numeric("adjustment_amount", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    gross: numeric("gross", { precision: 18, scale: 2 }).notNull(),
    net: numeric("net", { precision: 18, scale: 2 }).notNull(),
    workDays: numeric("work_days", { precision: 8, scale: 2 }).notNull().default("0"),
    presentDays: numeric("present_days", { precision: 8, scale: 2 }).notNull().default("0"),
    paidLeaveDays: numeric("paid_leave_days", { precision: 8, scale: 2 }).notNull().default("0"),
    unpaidLeaveDays: numeric("unpaid_leave_days", { precision: 8, scale: 2 })
      .notNull()
      .default("0"),
    lateMinutes: integer("late_minutes").notNull().default(0),
    /** KHÔNG DEFAULT — xem ghi chú trên. */
    inputSnapshotJson: jsonb("input_snapshot_json").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "no action" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payslips_company_period_user_idx").on(t.companyId, t.payrollPeriodId, t.userId),
    index("payslips_company_user_idx").on(t.companyId, t.userId),
    // Chốt cuối chống sinh phiếu HAI LẦN (PAYROLL-ERR-006) — unique THẲNG, không partial.
    uniqueIndex("payslips_period_user_uq").on(t.companyId, t.payrollPeriodId, t.userId),
    // ⚠️ adjustment_amount CỐ Ý ngoài CHECK này — nó có dấu.
    check(
      "payslips_amounts_check",
      sql`base_salary >= 0 AND total_allowances >= 0 AND deduction_amount >= 0 AND gross >= 0 AND net >= 0`,
    ),
    check("payslips_snapshot_check", sql`input_snapshot_json <> '{}'::jsonb`),
  ],
);

export type Payslip = typeof payslips.$inferSelect;
export type NewPayslip = typeof payslips.$inferInsert;

/**
 * payslip_items — dòng chi tiết phiếu, **APPEND-ONLY** (GRANT app SELECT+INSERT).
 *
 * `amount` **CÓ DẤU**: earning/allowance/bonus dương · deduction/attendance/penalty âm · `adjustment` theo dấu
 * người nhập ⇒ bất biến kiểm được `SUM(amount) = gross − deduction_amount + adjustment_amount` (ép ở service —
 * `0096` vốn không ràng buộc dấu).
 * FK `payslip_id` **NO ACTION** (0564 P3): CASCADE trên bảng chỉ-INSERT là đường xoá ẩn.
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
      .references(() => payslips.id, { onDelete: "no action" }),
    itemType: text("item_type").notNull(),
    label: text("label").notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    /** Breakdown hiển thị đúng thứ tự, không phụ thuộc created_at (now() per-statement làm ties là THẬT). */
    sortOrder: integer("sort_order").notNull().default(0),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payslip_items_company_payslip_idx").on(t.companyId, t.payslipId),
    check(
      "payslip_items_type_check",
      sql`item_type IN ('earning','deduction','allowance','attendance','bonus','penalty','adjustment')`,
    ),
  ],
);

export type PayslipItem = typeof payslipItems.$inferSelect;
export type NewPayslipItem = typeof payslipItems.$inferInsert;

/**
 * bonus_penalties — thưởng/phạt/khấu trừ theo kỳ, nhập tay, có duyệt (SPEC-01 §17.17).
 *
 * `Pending → Approved | Rejected`; hai đích là TERMINAL (⇒ PAYROLL-ERR-011). Chỉ hàng `Approved` cùng
 * `period_month`, chưa consume mới được máy tính lương gộp; lúc gộp ghi cặp `payroll_period_id`/`consumed_at`
 * (CHECK cặp) làm khoá chống cộng hai lần.
 *
 * ⚠️ Trigger `bonus_penalty_freeze_guard` (0564) là lớp DB DUY NHẤT so được OLD/NEW — CHECK không làm được.
 * BỐN nhánh: (A) đóng băng {amount, kind, user_id, period_month, reason, decision_note} sau khi rời `Pending`
 * HOẶC đã consume · (B) cấm xoá mềm ở cùng điều kiện · (C) cấm RE-BIND `payroll_period_id` sang kỳ KHÁC
 * (vẫn cho `x → NULL` = nhả consume khi tính lại kỳ chưa Approved) · (D) câu lệnh duyệt không được kèm sửa
 * tiền. KHÔNG nhánh nào ép chuyển tiếp FSM — đó là việc của service.
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
      .references(() => users.id, { onDelete: "no action" }),
    kind: text("kind").notNull(),
    /** > 0 luôn — `kind` tách bonus/penalty, KHÔNG dùng số âm (tránh lỗi dấu). */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    /** 'YYYY-MM' — kỳ lương đích. */
    periodMonth: text("period_month").notNull(),
    /** BẮT BUỘC (PL-02). */
    reason: text("reason").notNull(),
    status: text("status").notNull().default("Pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Reject BẮT BUỘC có (CHECK). */
    decisionNote: text("decision_note"),
    /** Bind kỳ lương đã consume (chống trả 2 lần). NULL = chưa vào lương. FK NO ACTION (0564 B2). */
    payrollPeriodId: uuid("payroll_period_id").references(() => payrollPeriods.id, {
      onDelete: "no action",
    }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "no action" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedBy: uuid("deleted_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("bonus_penalties_company_id_idx").on(t.companyId),
    // Khoá gộp khi tính lương: (company, user, period_month).
    index("bonus_penalties_company_user_month_idx").on(t.companyId, t.userId, t.periodMonth),
    index("bonus_penalties_company_status_idx")
      .on(t.companyId, t.status)
      .where(sql`deleted_at IS NULL`),
    index("bonus_penalties_decided_by_idx")
      .on(t.decidedBy)
      .where(sql`decided_by IS NOT NULL`),
    check("bonus_penalties_kind_check", sql`kind IN ('bonus','penalty')`),
    check("bonus_penalties_amount_check", sql`amount > 0`),
    check("bonus_penalties_status_check", sql`status IN ('Pending','Approved','Rejected')`),
    check("bonus_penalties_month_check", sql`period_month ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    check(
      "bonus_penalties_decided_pair_check",
      sql`status = 'Pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)`,
    ),
    check(
      "bonus_penalties_reject_note_check",
      sql`status <> 'Rejected' OR decision_note IS NOT NULL`,
    ),
    // consume cặp: payroll_period_id ↔ consumed_at cùng NULL hoặc cùng set.
    check(
      "bonus_penalties_consumed_pair_check",
      sql`(payroll_period_id IS NULL AND consumed_at IS NULL)
        OR (payroll_period_id IS NOT NULL AND consumed_at IS NOT NULL)`,
    ),
    // CHỈ hàng Approved mới được consume — chặn ở DB kể cả khi service/repo có bug.
    check(
      "bonus_penalties_consume_approved_check",
      sql`payroll_period_id IS NULL OR status = 'Approved'`,
    ),
  ],
);

export type BonusPenalty = typeof bonusPenalties.$inferSelect;
export type NewBonusPenalty = typeof bonusPenalties.$inferInsert;

/**
 * payslip_acknowledgements — **sổ CHỈ-INSERT** xác nhận đã nhận phiếu lương.
 *
 * Hàng tồn tại = ĐÃ XÁC NHẬN — KHÔNG có cột trạng thái. Đường khiếu nại (`disputed`/`resolved`) NGOÀI phạm vi
 * v1 (SPEC-11 §5.2, §22f): `0564` GỠ 6 cột + 3 CHECK + trigger và **REVOKE UPDATE** để bảng về đúng khuôn
 * append-only (bất biến #2). Mở lại cùng PARK-PAYROLL-001.
 * Unique (company, payslip, user) là chốt cuối PAYROLL-ERR-015 `already-acknowledged`.
 */
export const payslipAcknowledgements = pgTable(
  "payslip_acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    payslipId: uuid("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "no action" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "no action" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payslip_ack_company_id_idx").on(t.companyId),
    index("payslip_ack_company_payslip_idx").on(t.companyId, t.payslipId),
    uniqueIndex("payslip_acknowledgements_payslip_user_uq").on(t.companyId, t.payslipId, t.userId),
  ],
);

export type PayslipAcknowledgement = typeof payslipAcknowledgements.$inferSelect;
export type NewPayslipAcknowledgement = typeof payslipAcknowledgements.$inferInsert;
