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
    /**
     * Nhạy cảm — danh sách `{ name, amount }`.
     *
     * ⚠️ **EXPAND-CONTRACT đang dở (mig 0570, DB-13 §12.2)**: cột này đã được backfill sang bảng con
     * `salary_profile_items` và **CỐ Ý GIỮ LẠI** (đọc được, còn ghi được) để BE-1 ghi CẢ HAI. CONTRACT (gỡ
     * cột) là WO RIÊNG, chỉ sau khi đo 0 đường đọc còn lại trong `apps/api/**`.
     */
    allowances: jsonb("allowances")
      .notNull()
      .default(sql`'[]'::jsonb`),
    // ─── v2 (mig 0570 · DB-13 §12.1 · PAY-DEC-015/016) ───
    /**
     * `GROSS` | `NET`. `NET` ⇒ máy tính lương chạy gross-up (SPEC-11 §13.8).
     *
     * ⚠️ **TÊN TRÙNG, NGHĨA KHÁC**: `employee_profiles.salary_type` (`employees.ts:59`, CHECK
     * `emp_salary_type_check` ∈ `monthly`/`hourly`/`project`) KHÔNG liên quan tới cột này. Vì vậy CHECK ở đây
     * mang tiền tố bảng: `salary_profiles_salary_type_check`. `grep salary_type` sẽ ra hai chỗ.
     */
    salaryType: text("salary_type").notNull().default("GROSS"),
    /** `EMPLOYEE` | `COMPANY` — ai chịu TNCN (SPEC-11 §13.7 E). */
    pitPayer: text("pit_payer").notNull().default("EMPLOYEE"),
    /**
     * Lương đóng BH. **NULL = dùng `base_salary`** — quy tắc fallback sống ở SERVICE, một chỗ.
     *
     * ⚠️ **TUYỆT ĐỐI KHÔNG backfill = `base_salary`** (DB-13 §12.1): backfill biến «chưa khai» thành «đã khai
     * bằng lương», và lần sau đổi `base_salary` thì căn cứ đóng BH KHÔNG đổi theo ⇒ sai âm thầm số nộp BH.
     */
    insuranceSalary: numeric("insurance_salary", { precision: 18, scale: 2 }),
    probationSalary: numeric("probation_salary", { precision: 18, scale: 2 }),
    /** Tỉ lệ hưởng. ⚠️ Áp lên LƯƠNG, **KHÔNG** áp lên căn cứ đóng BH (SPEC-11 §13.7 B) — DB không ép được. */
    payRatioPct: numeric("pay_ratio_pct", { precision: 5, scale: 2 }).notNull().default("100.00"),
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
    // ─── v2 (mig 0570 · DB-13 §12.1) ───
    check("salary_profiles_salary_type_check", sql`salary_type IN ('GROSS','NET')`),
    check("salary_profiles_pit_payer_check", sql`pit_payer IN ('EMPLOYEE','COMPANY')`),
    check(
      "salary_profiles_insurance_salary_check",
      sql`insurance_salary IS NULL OR insurance_salary > 0`,
    ),
    check(
      "salary_profiles_probation_salary_check",
      sql`probation_salary IS NULL OR probation_salary > 0`,
    ),
    check("salary_profiles_pay_ratio_check", sql`pay_ratio_pct > 0 AND pay_ratio_pct <= 100`),
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
    // ─── v2 (mig 0570 · DB-13 §12.4 · PAY-DEC-012) ───
    /**
     * Snapshot giá trị TỪNG thành phần của mẫu. Dòng tính bằng mẫu thì `<> '{}'`.
     *
     * ⚠️ **CÓ DEFAULT `'{}'`, khác `payslips.input_snapshot_json` (không default) — có chủ đích.** Dòng v1
     * hợp lệ KHÔNG có giá trị thành phần nào nên `{}` là trạng thái đúng của chúng. Vì vậy **KHÔNG** thêm
     * CHECK `<> '{}'`: ràng buộc «dòng tính bằng mẫu phải có component values» phụ thuộc `template_id` của
     * KỲ (bảng khác) ⇒ CHECK không biểu diễn được. Ép ở service + ca test (DB-13 §12.4).
     */
    componentValuesJson: jsonb("component_values_json")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** SHA-256 hex(64) của tập công thức hiệu lực + `statutory_rate_id` (SPEC-11 §13.6 G). NULL cho dòng v1. */
    templateFingerprint: text("template_fingerprint"),
    /** Số vòng gross-up. NULL khi `salary_type = 'GROSS'`. */
    grossUpIterations: integer("gross_up_iterations"),
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
    // ─── v2 (mig 0570 · DB-13 §12.4) ───
    check(
      "payroll_period_lines_grossup_check",
      sql`gross_up_iterations IS NULL OR (gross_up_iterations >= 0 AND gross_up_iterations <= 30)`,
    ),
    check(
      "payroll_period_lines_fingerprint_check",
      sql`template_fingerprint IS NULL OR template_fingerprint ~ '^[0-9a-f]{64}$'`,
    ),
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// PHẦN v2 — wave S15-PAYROLL-V2, lô DB-1 (mig 0570 · DB-13 §13.1–§13.7)
//
// Bảy bảng dưới đây giữ NGUYÊN ba bất biến của khối v1 ở đầu file, cộng hai điểm RIÊNG của v2:
//  • PII MỚI trong PAYROLL: `payroll_employee_settings.bank_account_number` và `payroll_dependents.*`
//    là PII hạng `tax_code` — lưu plaintext + MASK Ở SERVER (vắng khoá) + audit lượt xem. KHÔNG
//    envelope-encryption/KMS (SPEC-11 §3.12) — ghi ở đây để lượt sau không "nâng cấp" lệch với
//    `employee_profiles.tax_code`.
//  • `mediaos_worker` KHÔNG được cấp SELECT trên `salary_profile_items` · `payroll_employee_settings`
//    · `payroll_dependents` (DB-13 §13.2 · P7).
//
// Composite tenant-FK, RLS policy, GRANT và EXCLUDE sống Ở SQL (mig 0570) — drizzle không biểu diễn
// được. File này là PARITY viết tay; KHÔNG chạy `db:generate` cho band này.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * salary_profile_items — phụ cấp/khấu trừ có định mức của MỘT phiên bản hồ sơ lương (DB-13 §13.1).
 *
 * Thay `salary_profiles.allowances` jsonb theo EXPAND-CONTRACT (§12.2): mig 0570 tạo bảng + backfill,
 * cột jsonb GIỮ NGUYÊN; CONTRACT là WO riêng.
 */
export const salaryProfileItems = pgTable(
  "salary_profile_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // composite FK → salary_profiles (company_id, id) NO ACTION.
    salaryProfileId: uuid("salary_profile_id").notNull(),
    /**
     * Mã thành phần (§13.4). **TEXT, KHÔNG FK cứng sang `salary_components.code`** — có chủ đích: hồ sơ
     * lương là bản ghi versioned ĐÓNG BĂNG theo `effective_date`; FK cứng biến một thao tác catalog
     * (ngưng dùng một thành phần) thành thao tác đụng dữ liệu lịch sử. Đổi lại, service PHẢI kiểm mã tồn
     * tại khi GHI ⇒ 422 PAYROLL-ERR-018.
     *
     * ⚠️ Hàng DI SẢN do backfill 0570 sinh mang mã `PC_nnn` (DB-13 §12.2.a) — **ngoài catalog**. Đường ĐỌC
     * trả nguyên kèm `note`; đường GHI từ chối 422 (nợ của S15-PAYROLL-BE-1).
     */
    componentCode: text("component_code").notNull(),
    /** Nhạy cảm — mask ở server. */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    uniqueIndex("salary_profile_items_profile_component_uq")
      .on(t.companyId, t.salaryProfileId, t.componentCode)
      .where(sql`deleted_at IS NULL`),
    index("salary_profile_items_company_profile_idx")
      .on(t.companyId, t.salaryProfileId)
      .where(sql`deleted_at IS NULL`),
    check("salary_profile_items_amount_check", sql`amount >= 0`),
  ],
);

export type SalaryProfileItem = typeof salaryProfileItems.$inferSelect;
export type NewSalaryProfileItem = typeof salaryProfileItems.$inferInsert;

/**
 * payroll_employee_settings — BH · công đoàn · tài khoản ngân hàng của MỘT nhân sự (DB-13 §13.2).
 *
 * 1 hàng / (company, user). `bank_account_number` là **PII thanh toán**: mọi DTO mặc định chỉ trả
 * `bankAccountLast4` (trường DẪN XUẤT, không phải cột); số đầy đủ CHỈ rời server qua tệp UNC của đợt
 * chi trả (PAYROLL-API-071, assert BA cặp) + audit bắt buộc.
 */
export const payrollEmployeeSettings = pgTable(
  "payroll_employee_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // composite FK → users (company_id, id) NO ACTION ⇒ teardown xoá tường minh trước DELETE FROM users.
    userId: uuid("user_id").notNull(),
    joinsSocialInsurance: boolean("joins_social_insurance").notNull().default(false),
    socialInsuranceNo: text("social_insurance_no"),
    joinsUnion: boolean("joins_union").notNull().default(false),
    /** PII — mask 4 số cuối ở mọi DTO (SPEC-11 §3.12). */
    bankAccountNumber: text("bank_account_number"),
    bankName: text("bank_name"),
    bankBranch: text("bank_branch"),
    accountHolder: text("account_holder"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    uniqueIndex("payroll_employee_settings_user_uq")
      .on(t.companyId, t.userId)
      .where(sql`deleted_at IS NULL`),
    // CỐ Ý LỎNG với `bank_branch` (nhiều ngân hàng không cần chi nhánh), nhưng số TK không có tên chủ TK
    // là một dòng UNC KHÔNG GỬI ĐƯỢC ⇒ cặp number + holder + bank_name ép ở DB (DB-13 §13.2).
    check(
      "payroll_employee_settings_bank_pair_check",
      sql`bank_account_number IS NULL OR (bank_name IS NOT NULL AND account_holder IS NOT NULL)`,
    ),
  ],
);

export type PayrollEmployeeSetting = typeof payrollEmployeeSettings.$inferSelect;
export type NewPayrollEmployeeSetting = typeof payrollEmployeeSettings.$inferInsert;

/**
 * payroll_dependents — người phụ thuộc giảm trừ TNCN (DB-13 §13.3). Họ tên + MST NPT là **PII**.
 *
 * Chống chồng lấp khoảng hiệu lực bằng `EXCLUDE USING gist` (cần extension `btree_gist`) — khoá theo
 * `full_name` **NOT NULL**, KHÔNG theo `dependent_tax_code` (nullable ⇒ EXCLUDE thành RỖNG: hai hàng NULL
 * không «bằng» nhau nên ràng buộc không loại được gì).
 * ⚠️ EXCLUDE ném **`23P01`**, KHÔNG phải `23505` ⇒ service bóc `23P01` từ `error.cause` → 409 ERR-032.
 */
export const payrollDependents = pgTable(
  "payroll_dependents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // composite FK → users (company_id, id) NO ACTION.
    userId: uuid("user_id").notNull(),
    /** PII. */
    fullName: text("full_name").notNull(),
    relationship: text("relationship").notNull(),
    /** PII — MST người phụ thuộc. */
    dependentTaxCode: text("dependent_tax_code"),
    dateOfBirth: date("date_of_birth"),
    effectiveFrom: date("effective_from").notNull(),
    /** NULL = còn hiệu lực. */
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    index("payroll_dependents_company_user_idx")
      .on(t.companyId, t.userId)
      .where(sql`deleted_at IS NULL`),
    check(
      "payroll_dependents_relationship_check",
      sql`relationship IN ('Child','Spouse','Parent','Other')`,
    ),
    check(
      "payroll_dependents_period_check",
      sql`effective_to IS NULL OR effective_to >= effective_from`,
    ),
    // payroll_dependents_no_overlap_excl (EXCLUDE USING gist) sống Ở SQL — drizzle không biểu diễn được.
  ],
);

export type PayrollDependent = typeof payrollDependents.$inferSelect;
export type NewPayrollDependent = typeof payrollDependents.$inferInsert;

/**
 * salary_components — catalog thành phần lương (DB-13 §13.4). Hàng `is_system` seed bởi
 * `PayrollMasterDataSeeder` (RUNTIME per-company — mig 0445 cấm seed company-scoped ở migrate-time).
 *
 * 🔴 BỐN NÚT TỔNG HỢP (`TONG_THU_NHAP` · `TONG_BH_NV` · `THU_NHAP_CHIU_THUE` · `TONG_KHAU_TRU`) khai
 * `value_type = 'engine'`, KHÔNG PHẢI `'fixed'` với `fixed_amount = 0`. Lý do: mọi `switch (value_type)`
 * viết ĐÚNG THEO DB sẽ rơi vào nhánh `fixed` và trả **0** cho cả bốn nút ⇒ `net = 0` hoặc `net = gross`
 * **trong khi mọi bất biến SQL vẫn xanh**. Một giá trị enum thứ tư thì TRÌNH BIÊN DỊCH ép xử lý; một quy
 * ước "service cấm đọc fixed_amount" thì không ai ép được.
 */
export const salaryComponents = pgTable(
  "salary_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    valueType: text("value_type").notNull(),
    formula: text("formula"),
    fixedAmount: numeric("fixed_amount", { precision: 18, scale: 2 }),
    /**
     * «Khoản này được trừ khỏi THU NHẬP TÍNH THUẾ». Chỉ có nghĩa với `kind='statutory_employee'`.
     * Seed: `BHXH_NV`/`BHYT_NV`/`BHTN_NV` = true · **`DOAN_PHI` = false** (đoàn phí NV chịu nhưng KHÔNG
     * được trừ thuế — SPEC-11 §13.7 D). Là CỘT DỮ LIỆU, để engine KHÔNG hard-code mã `DOAN_PHI`.
     */
    pitDeductible: boolean("pit_deductible").notNull().default(false),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    uniqueIndex("salary_components_company_code_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL`),
    // Chốt DB cho luật "không gian tên dùng chung" (SPEC-11 §8.2 C1): một thành phần tên `SYS_GROSS` sẽ
    // CHE biến hệ thống trong mọi công thức, không CHECK nào khác bắt.
    // ⚠️ `\\_` trong template literal TS render thành `\_` ở SQL — ĐÚNG thứ LIKE cần (dấu `_` là ký tự đại
    // diện của LIKE; viết `\_` trong nguồn TS thì JS nuốt backslash và luật thành `SYS?%`, RỘNG HƠN chủ ý).
    check(
      "salary_components_code_shape_check",
      sql`code ~ '^[A-Z][A-Z0-9_]{0,31}$' AND code NOT LIKE 'SYS\\_%' AND code NOT LIKE 'TL\\_%' AND code NOT LIKE 'GT\\_%'`,
    ),
    check(
      "salary_components_kind_check",
      sql`kind IN ('earning','deduction','statutory_employee','statutory_employer','tax','tax_exempt','aggregate')`,
    ),
    check(
      "salary_components_value_type_check",
      sql`value_type IN ('formula','fixed','profile_item','engine')`,
    ),
    check(
      "salary_components_value_pair_check",
      sql`(value_type = 'formula'      AND formula IS NOT NULL AND fixed_amount IS NULL)
        OR (value_type = 'fixed'        AND fixed_amount IS NOT NULL AND formula IS NULL)
        OR (value_type = 'profile_item' AND formula IS NULL AND fixed_amount IS NULL)
        OR (value_type = 'engine'       AND formula IS NULL AND fixed_amount IS NULL AND is_system)`,
    ),
    check("salary_components_formula_len_check", sql`formula IS NULL OR length(formula) <= 500`),
    // Hàng hệ thống KHÔNG xoá mềm được — chốt cuối Ở DB, không chỉ ở service. Một lượt xoá mềm lọt qua ⇒
    // hàng rơi khỏi `salary_components_company_code_uq` (partial WHERE deleted_at IS NULL) ⇒ người dùng
    // tạo lại `TONG_KHAU_TRU` với công thức tuỳ ý và CHE nút engine. `code_shape_check` KHÔNG đỡ được:
    // bốn mã đó không mang tiền tố `SYS_`/`TL_`/`GT_`.
    check("salary_components_system_not_deletable", sql`is_system = false OR deleted_at IS NULL`),
    // `engine` chỉ dành cho aggregate, và mọi aggregate đều phải là `engine` — ÉP HAI CHIỀU.
    check(
      "salary_components_engine_kind_check",
      sql`(value_type = 'engine') = (kind = 'aggregate')`,
    ),
  ],
);

export type SalaryComponent = typeof salaryComponents.$inferSelect;
export type NewSalaryComponent = typeof salaryComponents.$inferInsert;

/** payroll_templates — mẫu bảng lương (DB-13 §13.5). Scope `company` | `org_unit` (PAY-DEC-013). */
export const payrollTemplates = pgTable(
  "payroll_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    scope: text("scope").notNull().default("company"),
    // composite FK → org_units (company_id, id) NO ACTION.
    orgUnitId: uuid("org_unit_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    uniqueIndex("payroll_templates_company_code_uq")
      .on(t.companyId, t.code)
      .where(sql`deleted_at IS NULL`),
    check("payroll_templates_scope_check", sql`scope IN ('company','org_unit')`),
    check(
      "payroll_templates_scope_pair_check",
      sql`(scope = 'org_unit') = (org_unit_id IS NOT NULL)`,
    ),
  ],
);

export type PayrollTemplate = typeof payrollTemplates.$inferSelect;
export type NewPayrollTemplate = typeof payrollTemplates.$inferInsert;

/**
 * payroll_template_components — thành phần trong một mẫu (DB-13 §13.6).
 *
 * 🔴 **BẢNG PAYROLL DUY NHẤT CÓ `GRANT DELETE`** — ngoại lệ CÓ CHỦ ĐÍCH, phá quy tắc §4.3 «không bảng
 * PAYROLL nào có DELETE». Lý do: `PUT /payroll/templates/:id/components` (API-053) ĐẶT LẠI toàn bộ danh
 * sách trong MỘT transaction; làm bằng soft delete thì unique partial phải mang `deleted_at`, và mỗi lần
 * sắp xếp lại cột tích luỹ hàng chết vô hạn trên một bảng CẤU HÌNH THUẦN (0 dữ liệu tiền, 0 giá trị lịch
 * sử — lịch sử nằm ở `component_values_json` + `template_fingerprint` của dòng lương đã tính). Vết đầy đủ
 * của mọi lần sửa nằm ở `audit_logs` (`object_type = 'payroll_template'`, payload kèm diff).
 *
 * Hệ quả: bảng này KHÔNG có cột soft-delete, KHÔNG cần vào `RetentionService.PROTECTED_TABLES`, và
 * `s15-payroll-db1-invariants.int-spec.ts` phải khai nó trong `DELETE_ALLOWED` (assert HAI CHIỀU — cả
 * "chỉ mình nó có DELETE" lẫn "nó PHẢI có DELETE", kẻo ai đó thu hồi rồi API-053 vỡ trong im lặng).
 */
export const payrollTemplateComponents = pgTable(
  "payroll_template_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // composite FK → payroll_templates (company_id, id) NO ACTION.
    templateId: uuid("template_id").notNull(),
    // composite FK → salary_components (company_id, id) NO ACTION.
    componentId: uuid("component_id").notNull(),
    /** NULL = dùng `salary_components.name`. */
    columnLabel: text("column_label"),
    /** NULL = dùng công thức của catalog. */
    formulaOverride: text("formula_override"),
    isVisible: boolean("is_visible").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    // KHÔNG soft delete — xem docblock.
  },
  (t) => [
    uniqueIndex("payroll_template_components_tpl_component_uq").on(
      t.companyId,
      t.templateId,
      t.componentId,
    ),
    index("payroll_template_components_company_tpl_idx").on(t.companyId, t.templateId),
    check(
      "payroll_template_components_formula_len_check",
      sql`formula_override IS NULL OR length(formula_override) <= 500`,
    ),
  ],
);

export type PayrollTemplateComponent = typeof payrollTemplateComponents.$inferSelect;
export type NewPayrollTemplateComponent = typeof payrollTemplateComponents.$inferInsert;

/**
 * payroll_statutory_rates — tỉ lệ · trần · bậc thuế luật định, versioned theo `effective_from`
 * (DB-13 §13.7 · PAY-DEC-014). Kỳ dùng bản `effective_from <= ngày cuối kỳ` mới nhất.
 *
 * ⚠️ **Trần lưu THÀNH TIỀN, KHÔNG lưu hệ số.** Hệ số «20×» và mức nền đổi ĐỘC LẬP nhau qua từng đợt sửa
 * luật; lưu tích số là đúng thứ hệ thống áp, còn `base_wage`/`min_region_wage` lưu kèm CHỈ để giải thích
 * con số đó đến từ đâu. Service **KHÔNG** nhân lại — ca test ghim.
 *
 * ⚠️ CHECK chỉ ép được HÌNH DẠNG `pit_brackets` (mảng, 7 phần tử), KHÔNG ép được tính LIÊN TỤC (không hở,
 * không chồng, `upTo` tăng dần, bậc cuối NULL) — ép đầy đủ cần hàm PL/pgSQL trong CHECK, không immutable.
 * ⇒ kiểm liên tục Ở SERVICE lúc LƯU và lúc TÍNH ⇒ 422 ERR-022 (việc của S15-PAYROLL-BE-2/BE-3).
 *
 * Hệ thống LƯU và ÁP, KHÔNG khẳng định đúng luật (SPEC-11 §3.11) — ca test ghim SỐ SEED, không ghim
 * «đúng luật».
 */
export const payrollStatutoryRates = pgTable(
  "payroll_statutory_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    siEmployeePct: numeric("si_employee_pct", { precision: 5, scale: 2 }).notNull(),
    hiEmployeePct: numeric("hi_employee_pct", { precision: 5, scale: 2 }).notNull(),
    uiEmployeePct: numeric("ui_employee_pct", { precision: 5, scale: 2 }).notNull(),
    siEmployerPct: numeric("si_employer_pct", { precision: 5, scale: 2 }).notNull(),
    hiEmployerPct: numeric("hi_employer_pct", { precision: 5, scale: 2 }).notNull(),
    uiEmployerPct: numeric("ui_employer_pct", { precision: 5, scale: 2 }).notNull(),
    /** KPCĐ — phần DN. */
    unionEmployerPct: numeric("union_employer_pct", { precision: 5, scale: 2 }).notNull(),
    /** Đoàn phí — phần NV. KHÔNG được trừ thuế (`salary_components.pit_deductible = false`). */
    unionEmployeePct: numeric("union_employee_pct", { precision: 5, scale: 2 }).notNull(),
    siCap: numeric("si_cap", { precision: 18, scale: 2 }).notNull(),
    hiCap: numeric("hi_cap", { precision: 18, scale: 2 }).notNull(),
    uiCap: numeric("ui_cap", { precision: 18, scale: 2 }).notNull(),
    baseWage: numeric("base_wage", { precision: 18, scale: 2 }).notNull(),
    minRegionWage: numeric("min_region_wage", { precision: 18, scale: 2 }).notNull(),
    personalDeduction: numeric("personal_deduction", { precision: 18, scale: 2 }).notNull(),
    dependentDeduction: numeric("dependent_deduction", { precision: 18, scale: 2 }).notNull(),
    /** 7 bậc, mỗi phần tử `{ upTo: number | null, rate: number }`; bậc cuối bắt buộc `upTo = null`. */
    pitBrackets: jsonb("pit_brackets").notNull(),
    /** Nguồn văn bản pháp luật (người nhập ghi). */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    uniqueIndex("payroll_statutory_rates_company_effective_uq")
      .on(t.companyId, t.effectiveFrom)
      .where(sql`deleted_at IS NULL`),
    check(
      "payroll_statutory_rates_pct_range_check",
      sql`si_employee_pct BETWEEN 0 AND 100 AND hi_employee_pct BETWEEN 0 AND 100 AND ui_employee_pct BETWEEN 0 AND 100
        AND si_employer_pct BETWEEN 0 AND 100 AND hi_employer_pct BETWEEN 0 AND 100 AND ui_employer_pct BETWEEN 0 AND 100
        AND union_employer_pct BETWEEN 0 AND 100 AND union_employee_pct BETWEEN 0 AND 100`,
    ),
    check(
      "payroll_statutory_rates_amount_check",
      sql`si_cap > 0 AND hi_cap > 0 AND ui_cap > 0 AND base_wage > 0 AND min_region_wage > 0
        AND personal_deduction >= 0 AND dependent_deduction >= 0`,
    ),
    check(
      "payroll_statutory_rates_brackets_check",
      sql`jsonb_typeof(pit_brackets) = 'array' AND jsonb_array_length(pit_brackets) = 7`,
    ),
  ],
);

export type PayrollStatutoryRate = typeof payrollStatutoryRates.$inferSelect;
export type NewPayrollStatutoryRate = typeof payrollStatutoryRates.$inferInsert;
