import { z } from "zod";
import { periodMonthSchema } from "./attendance";

/**
 * MediaOS — PAYROLL contracts (SPEC-11 · DB-13 §7, wave S13-PAYROLL).
 *
 * ⚠️ NGUỒN SỰ THẬT DTO cho tiền lương. Hai luật chi phối cả file:
 *
 * 1. **MIRROR CHECK HAI CHIỀU, ĐÚNG BẰNG.** Mỗi enum/ràng buộc dưới đây soi đúng một CHECK đang SỐNG trong DB
 *    (mig `0564`). Lỏng hơn ⇒ payload hợp lệ với Zod nổ **500** ở DB; chặt hơn ⇒ chặn oan hàng DB vẫn nhận và
 *    đẻ mã lỗi CHẾT (`equal-caps-at-zod-and-service-make-dead-error-code`). Đổi một bên mà quên bên kia là
 *    đúng lớp lỗi đó.
 * 2. **MASK LÀ VIỆC CỦA SERVER, biểu hiện là VẮNG KHOÁ.** Trường tiền chỉ CÓ MẶT khi caller giữ cặp quyền
 *    tương ứng (13 cặp `is_sensitive` — SPEC-11 §11.1); ngược lại **vắng khoá** — không `null`, không `0`.
 *    Vì vậy mọi trường tiền khai `.optional()` (`server-masking-needs-optional-fe-schema`). FE là phòng thủ
 *    chiều sâu; server mới là nguồn sự thật strip.
 *
 * VND duy nhất ⇒ KHÔNG có trường `currency` nào (mọi cột `currency` đã GỠ ở `0564`).
 * Tiền là `numeric(18,2)` ở DB; DTO dùng `number` sau khi server đã làm tròn — tính toán/clamp Ở SQL.
 */

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. Enum — mirror CHECK (DB-13 §7)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** SPEC-01 §17.15 — mirror `payroll_periods_status_check`. FSM (chuyển tiếp) ép ở SERVICE, không ở đây. */
export const payrollPeriodStatusEnum = z.enum([
  "Draft",
  "CollectingData",
  "Calculated",
  "Reviewing",
  "Approved",
  "Paid",
  "Locked",
]);
export type PayrollPeriodStatus = z.infer<typeof payrollPeriodStatusEnum>;

/**
 * SPEC-01 §17.16 — **DẪN XUẤT, KHÔNG có cột, KHÔNG có CHECK** (SPEC-11 §13.2). Server tính trong DTO từ
 * `payroll_periods.status` + sự tồn tại hàng `payslip_acknowledgements`. `null` = không nhánh nào khớp
 * (fail-closed) — phiếu KHÔNG lộ ra đường Own.
 */
export const payslipDerivedStatusEnum = z.enum(["Generated", "Published", "Acknowledged"]);
export type PayslipDerivedStatus = z.infer<typeof payslipDerivedStatusEnum>;

/** SPEC-01 §17.17 — mirror `bonus_penalties_status_check`. */
export const bonusPenaltyStatusEnum = z.enum(["Pending", "Approved", "Rejected"]);
export type BonusPenaltyStatus = z.infer<typeof bonusPenaltyStatusEnum>;

/** mirror `bonus_penalties_kind_check`. `amount > 0` luôn — kind tách dấu, KHÔNG dùng số âm. */
export const bonusKindEnum = z.enum(["bonus", "penalty"]);
export type BonusKind = z.infer<typeof bonusKindEnum>;

/**
 * mirror `payslip_items_type_check` — **7 giá trị** (0564 bỏ `'kpi'`, thêm `'adjustment'`).
 * ⚠️ `amount` CÓ DẤU: earning/allowance/bonus dương · deduction/attendance/penalty âm · `adjustment` theo dấu
 * người nhập ⇒ bất biến `SUM(amount) = gross − deductionAmount + adjustmentAmount` (ép ở service — `0096`
 * vốn không ràng buộc dấu, nên KHÔNG khai `.positive()`/`.negative()` ở đây).
 */
export const payslipItemTypeEnum = z.enum([
  "earning",
  "deduction",
  "allowance",
  "attendance",
  "bonus",
  "penalty",
  "adjustment",
]);
export type PayslipItemType = z.infer<typeof payslipItemTypeEnum>;

/** Một khoản phụ cấp: tên + số tiền không âm (phần tử của `salary_profiles.allowances`). */
export const allowanceSchema = z.object({
  name: z.string().min(1),
  amount: z.number().nonnegative(),
});
export type Allowance = z.infer<typeof allowanceSchema>;

/**
 * Snapshot đầu vào ĐÓNG BĂNG lúc `calculate` (SPEC-11 §3.4).
 * ⚠️ mirror CHECK `<> '{}'::jsonb` trên CẢ `payroll_period_lines` LẪN `payslips`: cột NOT NULL và **KHÔNG có
 * DEFAULT** — object rỗng là "snapshot giả" và sẽ ăn 23514 ở DB.
 */
export const inputSnapshotSchema = z
  .record(z.unknown())
  .refine((v) => Object.keys(v).length > 0, { message: "input snapshot must not be empty" });
export type InputSnapshot = z.infer<typeof inputSnapshotSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. salary_profiles — hồ sơ lương VERSIONED theo effective_date (PAY-DEC-003)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * DTO hồ sơ lương. `baseSalary`/`allowances` là trường NHẠY CẢM ⇒ `.optional()`: caller không giữ
 * `('view','salary-profile')` thì server trả DTO **vắng hai khoá này** (không null, không 0).
 */
export const salaryProfileSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  effectiveDate: z.string().date(),
  baseSalary: z.number().optional(),
  allowances: z.array(allowanceSchema).optional(),
  note: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SalaryProfileDto = z.infer<typeof salaryProfileSchema>;

/** Hàng list — cùng masking như detail. */
export const salaryProfileListItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  effectiveDate: z.string().date(),
  baseSalary: z.number().optional(),
  allowances: z.array(allowanceSchema).optional(),
});
export type SalaryProfileListItemDto = z.infer<typeof salaryProfileListItemSchema>;

/**
 * Tạo phiên bản hồ sơ lương. `baseSalary > 0` mirror CHECK `salary_profile_base_positive_check`.
 * Trùng `(user, effectiveDate)` chưa xoá mềm ⇒ 23505 trên `salary_profiles_company_user_effective_uq`
 * → service map **PAYROLL-ERR-014**.
 */
export const createSalaryProfileSchema = z.object({
  userId: z.string().uuid(),
  effectiveDate: z.string().date(),
  baseSalary: z.number().positive(),
  allowances: z.array(allowanceSchema).default([]),
  note: z.string().max(500).optional(),
});
export type CreateSalaryProfileRequest = z.infer<typeof createSalaryProfileSchema>;

/** Sửa phiên bản — mọi field optional; `baseSalary` nếu có PHẢI > 0 (mirror CHECK). */
export const updateSalaryProfileSchema = z.object({
  effectiveDate: z.string().date().optional(),
  baseSalary: z.number().positive().optional(),
  allowances: z.array(allowanceSchema).optional(),
  note: z.string().max(500).nullable().optional(),
});
export type UpdateSalaryProfileRequest = z.infer<typeof updateSalaryProfileSchema>;

/** GET /salary-profiles query filters. */
export const salaryProfileListQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  /** Lọc phiên bản có hiệu lực tại ngày X (bản `effective_date <= X` mới nhất). */
  effectiveOn: z.string().date().optional(),
});
export type SalaryProfileListQuery = z.infer<typeof salaryProfileListQuerySchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. payroll_periods — kỳ lương, FSM 7 trạng thái
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * DTO kỳ lương. ⚠️ **KHÔNG CHỞ SỐ TIỀN NÀO, kể cả tổng** — màn danh sách kỳ gác bằng
 * `('view','payroll-period')` vốn `is_sensitive = false` (SPEC-11 §18). Tổng đi qua `summary`, gác bằng
 * `('view-line','payroll-period')`.
 * `payslipsGeneratedAt` là cờ đã-sinh-phiếu — nguồn kiểm của reopen/publish, đọc dưới row-lock ở service.
 */
export const payrollPeriodSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  periodMonth: periodMonthSchema,
  status: payrollPeriodStatusEnum,
  payDate: z.string().date().nullable(),
  attendancePeriodId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  reopenReason: z.string().nullable(),
  createdBy: z.string().uuid().nullable(),
  updatedBy: z.string().uuid().nullable(),
  calculatedBy: z.string().uuid().nullable(),
  calculatedAt: z.string().datetime().nullable(),
  submittedBy: z.string().uuid().nullable(),
  submittedAt: z.string().datetime().nullable(),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().datetime().nullable(),
  publishedBy: z.string().uuid().nullable(),
  publishedAt: z.string().datetime().nullable(),
  lockedBy: z.string().uuid().nullable(),
  lockedAt: z.string().datetime().nullable(),
  payslipsGeneratedBy: z.string().uuid().nullable(),
  payslipsGeneratedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PayrollPeriodDto = z.infer<typeof payrollPeriodSchema>;

export const createPayrollPeriodSchema = z.object({
  periodMonth: periodMonthSchema,
  attendancePeriodId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});
export type CreatePayrollPeriodRequest = z.infer<typeof createPayrollPeriodSchema>;

/** Từ chối bảng lương — **comment BẮT BUỘC** (SPEC-11 §13.1), đi vào audit + NOTI-EVENT-022. */
export const rejectPayrollPeriodSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type RejectPayrollPeriodRequest = z.infer<typeof rejectPayrollPeriodSchema>;

/**
 * Mở lại kỳ — **lý do BẮT BUỘC** (ghi `reopen_reason`, GHI ĐÈ; lịch sử đầy đủ ở `audit_logs`).
 * Bị chặn khi `payslipsGeneratedAt IS NOT NULL` ⇒ 409 **PAYROLL-ERR-004**.
 */
export const reopenPayrollPeriodSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type ReopenPayrollPeriodRequest = z.infer<typeof reopenPayrollPeriodSchema>;

/** approve / submit / publish / lock / collect / generate-payslips — định danh qua :id, actor qua JWT. */
export const decidePayrollPeriodSchema = z.object({});
export type DecidePayrollPeriodRequest = z.infer<typeof decidePayrollPeriodSchema>;

export const payrollPeriodListQuerySchema = z.object({
  status: payrollPeriodStatusEnum.optional(),
  periodMonth: periodMonthSchema.optional(),
});
export type PayrollPeriodListQuery = z.infer<typeof payrollPeriodListQuerySchema>;

/**
 * Envelope của route **GHI** (`collect` 005 · `calculate` 007 · `adjust-line` 009).
 * ⚠️ CỐ Ý KHÔNG CÓ KHOÁ TIỀN NÀO. Cặp ĐỌC tiền (`view-line`) tách khỏi cặp GHI (`calculate`); nếu route ghi
 * trả `gross`/`net`/`adjustmentAmount` thì role có `calculate` mà không `view-line` **đọc được tiền qua cửa
 * sau** (SPEC-11 §11.1). FE tải lại số qua `GET …/lines`.
 */
export const payrollWriteResultSchema = z.object({
  id: z.string().uuid(),
  status: payrollPeriodStatusEnum,
  affectedLines: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
});
export type PayrollWriteResultDto = z.infer<typeof payrollWriteResultSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. payroll_period_lines — bảng lương NHÁP (mutable trước Approved)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * DTO dòng bảng lương nháp — gác bằng `('view-line','payroll-period')` (**is_sensitive**).
 * Mọi trường tiền `.optional()` theo luật masking; `adjustmentAmount` CÓ DẤU nên KHÔNG khai `.nonnegative()`
 * (mirror: nó cố ý nằm NGOÀI `payroll_period_lines_amounts_check`).
 */
export const payrollPeriodLineSchema = z.object({
  id: z.string().uuid(),
  payrollPeriodId: z.string().uuid(),
  userId: z.string().uuid(),
  salaryProfileId: z.string().uuid().nullable(),
  workDays: z.number(),
  presentDays: z.number(),
  paidLeaveDays: z.number(),
  unpaidLeaveDays: z.number(),
  lateMinutes: z.number().int(),
  baseAmount: z.number().nonnegative().optional(),
  allowanceAmount: z.number().nonnegative().optional(),
  bonusAmount: z.number().nonnegative().optional(),
  penaltyAmount: z.number().nonnegative().optional(),
  deductionAmount: z.number().nonnegative().optional(),
  adjustmentAmount: z.number().optional(),
  adjustmentReason: z.string().nullable().optional(),
  gross: z.number().nonnegative().optional(),
  net: z.number().nonnegative().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PayrollPeriodLineDto = z.infer<typeof payrollPeriodLineSchema>;

/**
 * Điều chỉnh tay một dòng nháp. `adjustmentAmount` CÓ DẤU; **lý do bắt buộc khi khác 0** —
 * mirror ĐÚNG BẰNG CHECK `payroll_period_lines_adjustment_check`
 * (`adjustment_amount = 0 OR adjustment_reason IS NOT NULL`).
 */
export const adjustPayrollLineSchema = z
  .object({
    adjustmentAmount: z.number(),
    adjustmentReason: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.adjustmentAmount !== 0 && v.adjustmentReason == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adjustmentReason"],
        message: "adjustmentReason is required when adjustmentAmount is not 0",
      });
    }
  });
export type AdjustPayrollLineRequest = z.infer<typeof adjustPayrollLineSchema>;

/** Tổng chi phí kỳ — gác bằng `('view-line','payroll-period')` + SÀN scope Company (§9g). */
export const payrollSummarySchema = z.object({
  payrollPeriodId: z.string().uuid(),
  periodMonth: periodMonthSchema,
  status: payrollPeriodStatusEnum,
  headcount: z.number().int().nonnegative(),
  totalGross: z.number().optional(),
  totalNet: z.number().optional(),
});
export type PayrollSummaryDto = z.infer<typeof payrollSummarySchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 5. payslips + payslip_items — PHÁT HÀNH, append-only
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * DTO phiếu lương. KHÔNG có `updatedAt`/`deletedAt` — append-only (bất biến #2).
 * `status` là **DẪN XUẤT** (§13.2), `.nullable()` cho nhánh fail-closed mặc định.
 */
export const payslipSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  payrollPeriodId: z.string().uuid(),
  userId: z.string().uuid(),
  salaryProfileId: z.string().uuid().nullable(),
  status: payslipDerivedStatusEnum.nullable(),
  baseSalary: z.number().nonnegative().optional(),
  totalAllowances: z.number().nonnegative().optional(),
  bonusAmount: z.number().nonnegative().optional(),
  penaltyAmount: z.number().nonnegative().optional(),
  deductionAmount: z.number().nonnegative().optional(),
  /** CÓ DẤU — cố ý không `.nonnegative()` (mirror: ngoài `payslips_amounts_check`). */
  adjustmentAmount: z.number().optional(),
  gross: z.number().nonnegative().optional(),
  net: z.number().nonnegative().optional(),
  workDays: z.number(),
  presentDays: z.number(),
  paidLeaveDays: z.number(),
  unpaidLeaveDays: z.number(),
  lateMinutes: z.number().int(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type PayslipDto = z.infer<typeof payslipSchema>;

/** Dòng chi tiết phiếu. `amount` CÓ DẤU theo `itemType` (ép ở service, không có CHECK dấu ở DB). */
export const payslipItemSchema = z.object({
  id: z.string().uuid(),
  payslipId: z.string().uuid(),
  itemType: payslipItemTypeEnum,
  label: z.string(),
  amount: z.number().optional(),
  sortOrder: z.number().int(),
  /**
   * ⚠️ CÙNG CỔNG MASK với `amount`. `meta` là jsonb TỰ DO hình dạng đứng ngay cạnh một trường tiền đã che —
   * để nó bắt buộc là mở một kênh rò không kiểm soát (đơn giá · mức lương · hệ số rất dễ nằm trong đây).
   * Server strip cả hai cùng lúc theo cặp quyền chở-tiền.
   */
  meta: z.record(z.unknown()).nullable().optional(),
  createdAt: z.string().datetime(),
});
export type PayslipItemDto = z.infer<typeof payslipItemSchema>;

export const payslipListQuerySchema = z.object({
  payrollPeriodId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});
export type PayslipListQuery = z.infer<typeof payslipListQuerySchema>;

/**
 * Xác nhận phiếu lương của mình — không cần body. Hàng tồn tại = đã xác nhận (bảng KHÔNG có cột trạng thái).
 * Xác nhận lần hai ⇒ 23505 trên `payslip_acknowledgements_payslip_user_uq` → **PAYROLL-ERR-015**.
 */
export const acknowledgePayslipSchema = z.object({});
export type AcknowledgePayslipRequest = z.infer<typeof acknowledgePayslipSchema>;

/** DTO xác nhận — sổ chỉ-INSERT, KHÔNG chứa tiền và KHÔNG có trạng thái/khiếu nại (ngoài v1). */
export const payslipAcknowledgementSchema = z.object({
  id: z.string().uuid(),
  payslipId: z.string().uuid(),
  userId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type PayslipAcknowledgementDto = z.infer<typeof payslipAcknowledgementSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 6. bonus_penalties — thưởng/phạt/khấu trừ theo kỳ
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** DTO thưởng/phạt. `amount` là tiền per-người ⇒ `.optional()` theo luật masking. */
export const bonusPenaltySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  kind: bonusKindEnum,
  amount: z.number().positive().optional(),
  periodMonth: periodMonthSchema,
  reason: z.string(),
  status: bonusPenaltyStatusEnum,
  decidedBy: z.string().uuid().nullable(),
  decidedAt: z.string().datetime().nullable(),
  decisionNote: z.string().nullable(),
  payrollPeriodId: z.string().uuid().nullable(),
  consumedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BonusPenaltyDto = z.infer<typeof bonusPenaltySchema>;

/**
 * Tạo thưởng/phạt. `amount > 0` mirror `bonus_penalties_amount_check`; `reason` **bắt buộc** mirror
 * `reason NOT NULL` (`.trim().min(1)` là lớp NỘI DUNG — DB chỉ chặn NULL, không chặn chuỗi khoảng trắng).
 */
export const createBonusPenaltySchema = z.object({
  userId: z.string().uuid(),
  kind: bonusKindEnum,
  amount: z.number().positive(),
  periodMonth: periodMonthSchema,
  reason: z.string().trim().min(1).max(500),
});
export type CreateBonusPenaltyRequest = z.infer<typeof createBonusPenaltySchema>;

/** Sửa — CHỈ khi còn `Pending` và chưa consume (trigger `bonus_penalty_freeze_guard` là chốt cuối ở DB). */
export const updateBonusPenaltySchema = z.object({
  kind: bonusKindEnum.optional(),
  amount: z.number().positive().optional(),
  periodMonth: periodMonthSchema.optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type UpdateBonusPenaltyRequest = z.infer<typeof updateBonusPenaltySchema>;

/** Duyệt — `decisionNote` tuỳ chọn (mirror: CHECK chỉ bắt buộc note khi `Rejected`). */
export const approveBonusPenaltySchema = z.object({
  decisionNote: z.string().trim().min(1).max(500).optional(),
});
export type ApproveBonusPenaltyRequest = z.infer<typeof approveBonusPenaltySchema>;

/**
 * Từ chối — `decisionNote` **BẮT BUỘC**, mirror ĐÚNG BẰNG CHECK `bonus_penalties_reject_note_check`
 * (`status <> 'Rejected' OR decision_note IS NOT NULL`). Để optional ⇒ 23514 = 500 ở vùng đỏ.
 */
export const rejectBonusPenaltySchema = z.object({
  decisionNote: z.string().trim().min(1).max(500),
});
export type RejectBonusPenaltyRequest = z.infer<typeof rejectBonusPenaltySchema>;

export const bonusPenaltyListQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: bonusPenaltyStatusEnum.optional(),
  periodMonth: periodMonthSchema.optional(),
  kind: bonusKindEnum.optional(),
});
export type BonusPenaltyListQuery = z.infer<typeof bonusPenaltyListQuerySchema>;
