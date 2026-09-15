import { z } from "zod";
import { periodMonthSchema } from "./attendance";
import {
  bonusKindEnum,
  csvEnumList,
  paymentBatchMethodEnum,
  paymentBatchStatusEnum,
  payrollAdvanceStatusEnum,
  payrollPageQuery,
  payrollPeriodStatusEnum,
} from "./payroll";

/**
 * MediaOS — PAYROLL v2 track C contracts (S15-PAYROLL-BE-4 · SPEC-11 §13 · §15.1 hàng 059–077 · DB-13 §14):
 * tạm ứng · đợt chi trả + dòng chi · ngân sách lương · import thu nhập/khấu trừ khác.
 *
 * Tách khỏi `./payroll` (file đó đã vượt trần 800 dòng). Import NGƯỢC enum/helper của `./payroll`,
 * **KHÔNG re-export** tên nào của nó (trùng tên ở hai star-export là lỗi mơ hồ lúc build — cùng luật
 * `./payroll-employees` · `./payroll-catalog`).
 *
 * Hai luật của `./payroll` áp NGUYÊN ở đây:
 *  1. **MIRROR CHECK HAI CHIỀU, ĐÚNG BẰNG** (mig `0572`): `amount > 0` · `fiscal_year 2000..2100` ·
 *     `planned_amount >= 0` · `deduct_period_month` dạng `YYYY-MM` · enum method/status.
 *  2. **MASK LÀ VIỆC CỦA SERVER, biểu hiện là VẮNG KHOÁ**: mọi trường tiền `.optional()`. Số tài khoản
 *     ngân hàng **KHÔNG BAO GIỜ** có mặt ở DTO đọc — chỉ `bankAccountLast4` (dẫn xuất từ SNAPSHOT của dòng
 *     chi, SPEC-11 §3.12 · §18.1 A); bản đầy đủ chỉ rời server qua tệp UNC (PAYROLL-API-071).
 *
 * Route GHI (060 · 062 · 063 · 064 · 067 · 069 · 072 · 074 · 075 · 076) trả envelope **0 khoá tiền**
 * (`{ id, status?, warnings }`) — cùng luật `payrollWriteResultSchema`: cặp GHI không phải cửa sau để đọc tiền.
 */

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. Tạm ứng — PAYROLL-API-059..065 (DB-13 §14.1)
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const PAYROLL_ADVANCE_REASON_MAX = 500;
export const PAYROLL_ADVANCE_NOTE_MAX = 500;

/**
 * DTO tạm ứng. `amount` là tiền per-người ⇒ `.optional()` (route Own 065 vẫn trả — của chính mình, C13).
 * `createdBy` nullable ở kiểu cột dù trigger `insert-shape` ép NOT NULL khi INSERT — DTO mirror CỘT.
 */
export const payrollAdvanceSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  amount: z.number().positive().optional(),
  deductPeriodMonth: periodMonthSchema,
  reason: z.string(),
  status: payrollAdvanceStatusEnum,
  decidedBy: z.string().uuid().nullable(),
  decidedAt: z.string().datetime().nullable(),
  decisionNote: z.string().nullable(),
  payrollPeriodId: z.string().uuid().nullable(),
  consumedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PayrollAdvanceDto = z.infer<typeof payrollAdvanceSchema>;

/**
 * 060 — tạo (luôn `Pending`; `created_by` lấy từ JWT, KHÔNG nhận từ body — security DB-2 MEDIUM-3).
 * `amount > 0` mirror `payroll_advances_amount_check`; `reason` NOT NULL + lớp nội dung `.trim().min(1)`.
 * `.strict()`: khoá lạ (`createdBy`, `status`…) ⇒ 400 — không âm thầm bỏ qua.
 */
export const createPayrollAdvanceSchema = z
  .object({
    userId: z.string().uuid(),
    amount: z.number().positive(),
    deductPeriodMonth: periodMonthSchema,
    reason: z.string().trim().min(1).max(PAYROLL_ADVANCE_REASON_MAX),
  })
  .strict();
export type CreatePayrollAdvanceRequest = z.infer<typeof createPayrollAdvanceSchema>;

/**
 * 062 — sửa **hoặc** xoá mềm (`delete: true`); chỉ khi `Pending` và chưa khấu trừ (⇒ 409 025). Service
 * tiền-kiểm dưới `FOR UPDATE`; trigger `payroll_advance_freeze_guard` là lưới cuối cho race.
 */
export const updatePayrollAdvanceSchema = z
  .object({
    amount: z.number().positive().optional(),
    deductPeriodMonth: periodMonthSchema.optional(),
    reason: z.string().trim().min(1).max(PAYROLL_ADVANCE_REASON_MAX).optional(),
    delete: z.literal(true).optional(),
  })
  .strict();
export type UpdatePayrollAdvanceRequest = z.infer<typeof updatePayrollAdvanceSchema>;

/** 063 — duyệt; `note` tuỳ chọn (CHECK chỉ bắt buộc note khi `Rejected`). */
export const approvePayrollAdvanceSchema = z.object({
  note: z.string().trim().min(1).max(PAYROLL_ADVANCE_NOTE_MAX).optional(),
});
export type ApprovePayrollAdvanceRequest = z.infer<typeof approvePayrollAdvanceSchema>;

/**
 * 064 — từ chối; `note` **BẮT BUỘC** (SPEC-11 §15.1 hàng 064), mirror ĐÚNG BẰNG CHECK
 * `payroll_advances_reject_note_check` (`status <> 'Rejected' OR decision_note IS NOT NULL`).
 */
export const rejectPayrollAdvanceSchema = z.object({
  note: z.string().trim().min(1).max(PAYROLL_ADVANCE_NOTE_MAX),
});
export type RejectPayrollAdvanceRequest = z.infer<typeof rejectPayrollAdvanceSchema>;

/** 059 — filter `status[]` · `userId` · `deductPeriodMonth` + pagination. */
export const payrollAdvanceListQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: csvEnumList(payrollAdvanceStatusEnum),
  deductPeriodMonth: periodMonthSchema.optional(),
  ...payrollPageQuery,
});
export type PayrollAdvanceListQuery = z.infer<typeof payrollAdvanceListQuerySchema>;

/** 065 — `GET /me/payroll-advances` (Own): KHÔNG có `userId` — chủ thể là chính caller. */
export const mePayrollAdvanceListQuerySchema = z.object({
  status: csvEnumList(payrollAdvanceStatusEnum),
  deductPeriodMonth: periodMonthSchema.optional(),
  ...payrollPageQuery,
});
export type MePayrollAdvanceListQuery = z.infer<typeof mePayrollAdvanceListQuerySchema>;

/**
 * Envelope route GHI tạm ứng (060 · 062 · 063 · 064) — **0 khoá tiền**. `warnings` BẮT BUỘC (không
 * `.default([])`, cùng lý do `payrollWriteResultSchema`): 063 khi kỳ đích đang `Calculated` gửi
 * `["recalculate-required"]` — tín hiệu an toàn, không được biến "server quên gửi" thành "không cảnh báo".
 */
export const payrollAdvanceWriteResultSchema = z.object({
  id: z.string().uuid(),
  status: payrollAdvanceStatusEnum,
  warnings: z.array(z.string()),
});
export type PayrollAdvanceWriteResultDto = z.infer<typeof payrollAdvanceWriteResultSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. Đợt chi trả + dòng chi — PAYROLL-API-066..072 (DB-13 §14.2 · §14.3)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Trần dòng một đợt/một lượt sửa — khớp trần tệp UNC (10.000, SPEC-11 §18 · PAYROLL-ERR-016). */
export const PAYMENT_BATCH_LINES_MAX = 10_000;
export const PAYMENT_BATCH_CODE_MAX = 40;
export const PAYMENT_BATCH_NOTE_MAX = 500;

/** Mã đợt do người dùng đặt (vắng ⇒ server tự sinh `CT-<YYYYMM>-<BANK|CASH>-<8 hex>`). ASCII an toàn cho tên tệp UNC. */
export const paymentBatchCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(PAYMENT_BATCH_CODE_MAX)
  .regex(/^[A-Za-z0-9_-]+$/, "code chỉ gồm chữ, số, gạch ngang, gạch dưới");

/**
 * DTO đợt chi trả. `totalNet` (Σ `payslips.net` của dòng sống) là tiền ⇒ `.optional()`.
 * `lineCount`/`paidLineCount` là SỐ ĐẾM dòng sống / dòng đã `paid_at` — không phải tiền.
 */
export const paymentBatchSchema = z.object({
  id: z.string().uuid(),
  payrollPeriodId: z.string().uuid(),
  periodMonth: periodMonthSchema,
  code: z.string(),
  method: paymentBatchMethodEnum,
  status: paymentBatchStatusEnum,
  payDate: z.string().date().nullable(),
  note: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  paidLineCount: z.number().int().nonnegative(),
  totalNet: z.number().optional(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  completedBy: z.string().uuid().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type PaymentBatchDto = z.infer<typeof paymentBatchSchema>;

/**
 * DTO dòng chi (070). 🔴 **`bankAccountLast4`, KHÔNG BAO GIỜ `bankAccountSnapshot`/`bankAccountNumber`** —
 * dẫn xuất từ snapshot ĐÓNG BĂNG lúc lập đợt (không phải settings hiện tại). `net` đọc từ `payslip_id`
 * (một nguồn sự thật cho một khoản tiền) ⇒ `.optional()`. Tên qua điểm chiếu danh tính (null khi ngoài vị từ).
 */
export const paymentLineSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  employeeCode: z.string().nullable(),
  fullName: z.string().nullable(),
  payslipId: z.string().uuid(),
  net: z.number().optional(),
  bankAccountLast4: z.string().nullable(),
  bankName: z.string().nullable(),
  accountHolder: z.string().nullable(),
  paidAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type PaymentLineDto = z.infer<typeof paymentLineSchema>;

/**
 * 067 — lập đợt từ kỳ `Published` (khác ⇒ 409 027 `period-not-published`).
 * `userIds` vắng ⇒ server tự nạp MỌI phiếu của kỳ chưa có dòng sống ở đợt nào, lọc theo `method` (D-1);
 * có ⇒ tường minh (người thiếu TK ở đợt `bank` ⇒ 409 027 `payee-no-bank-account`).
 * 🔴 `.strict()` — body **KHÔNG có trường tài khoản nào**: snapshot TK SINH Ở SERVER từ
 * `payroll_employee_settings` (security DB-2 MEDIUM-3), gửi `bankAccountNumber` lên là 400.
 */
export const createPaymentBatchSchema = z
  .object({
    payrollPeriodId: z.string().uuid(),
    method: paymentBatchMethodEnum,
    code: paymentBatchCodeSchema.optional(),
    payDate: z.string().date().optional(),
    note: z.string().trim().max(PAYMENT_BATCH_NOTE_MAX).optional(),
    userIds: z.array(z.string().uuid()).min(1).max(PAYMENT_BATCH_LINES_MAX).optional(),
  })
  .strict();
export type CreatePaymentBatchRequest = z.infer<typeof createPaymentBatchSchema>;

/**
 * Trạng thái ĐỔI ĐƯỢC qua 069 — **RIÊNG, KHÔNG tái dùng `paymentBatchStatusEnum`** (plan-review B4):
 * `Completed` chỉ tới được qua 072 (luật PHỦ · four-eyes · `completed_by/at`). Nhận `Completed` ở PATCH
 * là lách TOÀN BỘ cổng 072 và trigger T1 chỉ đóng băng khi `OLD.status = 'Completed'`.
 */
export const paymentBatchEditableStatusEnum = z.enum(["Draft", "Ready"]);
export type PaymentBatchEditableStatus = z.infer<typeof paymentBatchEditableStatusEnum>;

/**
 * 069 — sửa đợt khi `Draft`/`Ready` (đợt `Completed` ⇒ 409 027 `batch-already-completed`).
 * `addUserIds` nạp thêm dòng (snapshot đọc LẠI từ settings) · `removeUserIds` xoá mềm dòng CHƯA chi
 * (dòng đã `paid_at` ⇒ 409 027 `line-already-paid`, không gỡ dòng nào — B1) · `markPaidUserIds` ghi
 * `paid_at = now()`. **KHÔNG có đường «bỏ đánh dấu đã chi»** ở v2 (D-2). `.strict()` — không trường TK.
 */
export const updatePaymentBatchSchema = z
  .object({
    status: paymentBatchEditableStatusEnum.optional(),
    payDate: z.string().date().nullable().optional(),
    note: z.string().trim().max(PAYMENT_BATCH_NOTE_MAX).nullable().optional(),
    addUserIds: z.array(z.string().uuid()).min(1).max(PAYMENT_BATCH_LINES_MAX).optional(),
    removeUserIds: z.array(z.string().uuid()).min(1).max(PAYMENT_BATCH_LINES_MAX).optional(),
    markPaidUserIds: z.array(z.string().uuid()).min(1).max(PAYMENT_BATCH_LINES_MAX).optional(),
  })
  .strict();
export type UpdatePaymentBatchRequest = z.infer<typeof updatePaymentBatchSchema>;

/**
 * 072 — hoàn tất đợt. `confirmAllPaid: true` ghi `paid_at` cho MỌI dòng chưa chi trong CÙNG tx trước khi
 * kiểm (D-2); còn dòng chưa chi ⇒ 409 027 `batch-incomplete`. `payDate` ghi vào đợt (ngày chi thật).
 */
export const completePaymentBatchSchema = z.object({
  payDate: z.string().date().optional(),
  confirmAllPaid: z.boolean().optional(),
});
export type CompletePaymentBatchRequest = z.infer<typeof completePaymentBatchSchema>;

/** 066 — filter `payrollPeriodId` · `status[]` · `method` + pagination. */
export const paymentBatchListQuerySchema = z.object({
  payrollPeriodId: z.string().uuid().optional(),
  status: csvEnumList(paymentBatchStatusEnum),
  method: paymentBatchMethodEnum.optional(),
  ...payrollPageQuery,
});
export type PaymentBatchListQuery = z.infer<typeof paymentBatchListQuerySchema>;

/** 070 — pagination. */
export const paymentLineListQuerySchema = z.object({ ...payrollPageQuery });
export type PaymentLineListQuery = z.infer<typeof paymentLineListQuerySchema>;

/** Envelope 067/069 — `{ id, warnings }`; warnings dạng `no-bank-account:<n>` · `zero-net:<n>` (số ĐẾM, không tiền). */
export const paymentBatchWriteResultSchema = z.object({
  id: z.string().uuid(),
  warnings: z.array(z.string()),
});
export type PaymentBatchWriteResultDto = z.infer<typeof paymentBatchWriteResultSchema>;

/**
 * Envelope 072. `periodStatus` = trạng thái kỳ SAU lượt này: `Paid` khi lượt hoàn tất làm PHỦ ĐỦ kỳ,
 * `Published` khi chưa (SPEC-11 §13.1 luật PHỦ — KHÔNG 409). `unpaidPayees` = số phiếu của kỳ chưa có
 * dòng sống thuộc đợt `Completed` (số ĐẾM người, không tiền).
 */
export const completePaymentBatchResultSchema = z.object({
  id: z.string().uuid(),
  batchStatus: paymentBatchStatusEnum,
  periodStatus: payrollPeriodStatusEnum,
  unpaidPayees: z.number().int().nonnegative(),
});
export type CompletePaymentBatchResultDto = z.infer<typeof completePaymentBatchResultSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. Ngân sách lương — PAYROLL-API-073..075 (DB-13 §14.4)
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const PAYROLL_BUDGET_YEAR_MIN = 2000;
export const PAYROLL_BUDGET_YEAR_MAX = 2100;
export const PAYROLL_BUDGET_NOTE_MAX = 500;

/**
 * DTO ngân sách (073). `orgUnitId = null` = toàn công ty. `plannedAmount`/`actualAmount`/`variance` là tiền
 * ⇒ `.optional()`. **`actualAmount` đọc LÚC GỌI, KHÔNG lưu** (DB-13 §14.4): Σ `payslips.gross` của kỳ
 * `Published`/`Paid`/`Locked` có `period_month` thuộc `fiscalYear`, gom theo `employee_profiles.org_unit_id`
 * **HIỆN TẠI** của chủ phiếu (người chuyển phòng làm số năm cũ đổi chỗ giữa đơn vị — plan D-4/C12);
 * hàng toàn công ty = tổng mọi phiếu. Chưa gồm phần BH doanh nghiệp. `variance = planned − actual`.
 */
export const payrollBudgetSchema = z.object({
  id: z.string().uuid(),
  fiscalYear: z.number().int(),
  orgUnitId: z.string().uuid().nullable(),
  orgUnitName: z.string().nullable(),
  plannedAmount: z.number().optional(),
  actualAmount: z.number().optional(),
  variance: z.number().optional(),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PayrollBudgetDto = z.infer<typeof payrollBudgetSchema>;

/** 074 — `fiscalYear 2000..2100` mirror `payroll_budgets_year_check`; `plannedAmount >= 0` mirror `_amount_check`. */
export const createPayrollBudgetSchema = z
  .object({
    fiscalYear: z.number().int().min(PAYROLL_BUDGET_YEAR_MIN).max(PAYROLL_BUDGET_YEAR_MAX),
    orgUnitId: z.string().uuid().nullable().optional(),
    plannedAmount: z.number().nonnegative(),
    note: z.string().trim().max(PAYROLL_BUDGET_NOTE_MAX).optional(),
  })
  .strict();
export type CreatePayrollBudgetRequest = z.infer<typeof createPayrollBudgetSchema>;

/** 075 — sửa `plannedAmount`/`note` hoặc xoá mềm; `fiscalYear`/`orgUnitId` KHÔNG đổi (tạo hàng mới). */
export const updatePayrollBudgetSchema = z
  .object({
    plannedAmount: z.number().nonnegative().optional(),
    note: z.string().trim().max(PAYROLL_BUDGET_NOTE_MAX).nullable().optional(),
    delete: z.literal(true).optional(),
  })
  .strict();
export type UpdatePayrollBudgetRequest = z.infer<typeof updatePayrollBudgetSchema>;

/** 073 — `fiscalYear` vắng ⇒ năm hiện tại (UTC); `orgUnitId` lọc một đơn vị. KHÔNG phân trang (≤ vài chục hàng/năm). */
export const payrollBudgetListQuerySchema = z.object({
  fiscalYear: z.coerce
    .number()
    .int()
    .min(PAYROLL_BUDGET_YEAR_MIN)
    .max(PAYROLL_BUDGET_YEAR_MAX)
    .optional(),
  orgUnitId: z.string().uuid().optional(),
});
export type PayrollBudgetListQuery = z.infer<typeof payrollBudgetListQuerySchema>;

/** Envelope 074/075 — `{ id, warnings }` (0 khoá tiền). */
export const payrollBudgetWriteResultSchema = z.object({
  id: z.string().uuid(),
  warnings: z.array(z.string()),
});
export type PayrollBudgetWriteResultDto = z.infer<typeof payrollBudgetWriteResultSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. Import thu nhập/khấu trừ khác — PAYROLL-API-076..077
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Trần dòng một tệp import (SPEC-11 §12.1 hàng 030 `import-too-large`). */
export const PAYROLL_ADJUSTMENT_IMPORT_MAX_ROWS = 5_000;
/** Trần kích thước tệp (khuôn HR import — multer + service kiểm lại). */
export const PAYROLL_ADJUSTMENT_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * `?dryRun` — mặc định **TRUE** (khuôn HR): xem trước không ghi là đường an toàn; muốn áp phải gửi
 * `dryRun=false` tường minh. Preprocess chấp nhận boolean đã coerce (double-pipe idempotent).
 */
const booleanFromQuery = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return v;
}, z.boolean());

export const payrollAdjustmentImportQuerySchema = z.object({
  dryRun: booleanFromQuery.default(true),
});
export type PayrollAdjustmentImportQuery = z.infer<typeof payrollAdjustmentImportQuerySchema>;

/** Loại khoản của một dòng import — CHÍNH enum của `bonus_penalties.kind` (đích ghi). */
export const payrollAdjustmentImportKindEnum = bonusKindEnum;
export type PayrollAdjustmentImportKind = z.infer<typeof payrollAdjustmentImportKindEnum>;
