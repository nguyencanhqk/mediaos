import { z } from "zod";
import { periodMonthSchema } from "./attendance";

/**
 * MediaOS — Payroll contracts (G12-1 Salary Profile).
 *
 * NGUỒN SỰ THẬT DTO cho salary profile. Lương là dữ liệu NHẠY CẢM (ADR-0010, BẤT BIẾN #3):
 *  - baseSalary / allowances chỉ rời server cho role có quyền view-salary-profile (server mask).
 *  - Masked DTO (baseSalary=null, allowances=null) là mặc định — role không quyền KHÔNG nhận lương.
 *  - KHÔNG secret plaintext, KHÔNG field nào chứa lương dạng "rõ" ngoài baseSalary/allowances có kiểm soát.
 */

export const salaryTypeEnum = z.enum(["monthly", "hourly", "project"]);
export type SalaryType = z.infer<typeof salaryTypeEnum>;

export const payCycleEnum = z.enum(["monthly", "biweekly", "weekly"]);
export type PayCycle = z.infer<typeof payCycleEnum>;

export const salaryProfileStatusEnum = z.enum(["active", "inactive"]);
export type SalaryProfileStatus = z.infer<typeof salaryProfileStatusEnum>;

/** 1 khoản phụ cấp: tên + số tiền không âm. */
export const allowanceSchema = z.object({
  name: z.string().min(1),
  amount: z.number().nonnegative(),
});
export type Allowance = z.infer<typeof allowanceSchema>;

/**
 * DTO salary profile trả về client. baseSalary + allowances NULLABLE:
 * null = caller không có quyền view-salary-profile (đã mask phía server).
 */
export const salaryProfileSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  salaryType: salaryTypeEnum,
  payCycle: payCycleEnum,
  effectiveDate: z.string().date(),
  baseSalary: z.number().nullable(),
  allowances: z.array(allowanceSchema).nullable(),
  currency: z.string().nullable().optional(),
  status: salaryProfileStatusEnum,
  note: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SalaryProfileDto = z.infer<typeof salaryProfileSchema>;

/** Hàng list — cùng masking như detail (baseSalary/allowances nullable). */
export const salaryProfileListItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  salaryType: salaryTypeEnum,
  payCycle: payCycleEnum,
  effectiveDate: z.string().date(),
  baseSalary: z.number().nullable(),
  allowances: z.array(allowanceSchema).nullable(),
  status: salaryProfileStatusEnum,
});
export type SalaryProfileListItemDto = z.infer<typeof salaryProfileListItemSchema>;

/**
 * Create salary profile — baseSalary BẮT BUỘC > 0 (lương cơ bản phải dương).
 * allowances mặc định [] (mảng rỗng hợp lệ).
 */
export const createSalaryProfileSchema = z.object({
  userId: z.string().uuid(),
  salaryType: salaryTypeEnum.default("monthly"),
  payCycle: payCycleEnum.default("monthly"),
  effectiveDate: z.string().date(),
  baseSalary: z.number().positive(),
  allowances: z.array(allowanceSchema).default([]),
  currency: z.string().min(1).optional(),
  note: z.string().optional(),
});
export type CreateSalaryProfileRequest = z.infer<typeof createSalaryProfileSchema>;

/**
 * Update salary profile — mọi field optional; baseSalary nếu có PHẢI > 0.
 * status đổi active/inactive. effectiveDate có thể dời (G12-1 giữ 1 active/user).
 */
export const updateSalaryProfileSchema = z.object({
  salaryType: salaryTypeEnum.optional(),
  payCycle: payCycleEnum.optional(),
  effectiveDate: z.string().date().optional(),
  baseSalary: z.number().positive().optional(),
  allowances: z.array(allowanceSchema).optional(),
  currency: z.string().min(1).optional(),
  status: salaryProfileStatusEnum.optional(),
  note: z.string().nullable().optional(),
});
export type UpdateSalaryProfileRequest = z.infer<typeof updateSalaryProfileSchema>;

/** GET /salary-profiles query filters. */
export const salaryProfileListQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: salaryProfileStatusEnum.optional(),
});
export type SalaryProfileListQuery = z.infer<typeof salaryProfileListQuerySchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// G12-2 — Payroll period + payslip snapshot (append-only, ADR-0005)
//   - payroll_periods: kỳ lương MUTABLE draft→locked.
//   - payslips/payslip_items: SNAPSHOT BẤT BIẾN append-only (sửa = ghi mới entry_kind adjustment/void).
//   - kpi/bonus/penalty NULLABLE = SLOT cho G8-4 — KHÔNG implement logic KPI/thưởng/phạt lượt này.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// period_month dùng chung periodMonthSchema (DRY — nguồn ở attendance.ts, cùng regex YYYY-MM).

// G12-4: vòng duyệt draft→approved→published (thay draft→locked của G12-2).
export const payrollPeriodStatusEnum = z.enum(["draft", "approved", "published"]);
export type PayrollPeriodStatus = z.infer<typeof payrollPeriodStatusEnum>;

/** DTO kỳ lương trả về client. Vết duyệt: created_by → approved_by/at → published_by/at. */
export const payrollPeriodSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  periodMonth: periodMonthSchema,
  status: payrollPeriodStatusEnum,
  attendancePeriodId: z.string().uuid().nullable(),
  kpiLocked: z.boolean(),
  createdBy: z.string().uuid().nullable(),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().datetime().nullable(),
  publishedBy: z.string().uuid().nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PayrollPeriodDto = z.infer<typeof payrollPeriodSchema>;

/** Create payroll period — chỉ cần kỳ + (tuỳ chọn) gắn attendance_period nguồn công. */
export const createPayrollPeriodSchema = z.object({
  periodMonth: periodMonthSchema,
  attendancePeriodId: z.string().uuid().optional(),
});
export type CreatePayrollPeriodRequest = z.infer<typeof createPayrollPeriodSchema>;

export const payslipEntryKindEnum = z.enum(["original", "adjustment", "void"]);
export type PayslipEntryKind = z.infer<typeof payslipEntryKindEnum>;

/**
 * DTO payslip (SNAPSHOT). kpi/bonus/penalty NULLABLE (slot G8-4 — null khi chưa nối KPI).
 * Append-only: KHÔNG có updated_at/deleted_at. "Sửa" = bản ghi mới entry_kind adjustment/void.
 */
export const payslipSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  payrollPeriodId: z.string().uuid(),
  userId: z.string().uuid(),
  salaryProfileId: z.string().uuid().nullable(),
  baseSalary: z.number(),
  totalAllowances: z.number(),
  gross: z.number(),
  net: z.number(),
  currency: z.string(),
  workDays: z.number(),
  presentDays: z.number(),
  lateMinutes: z.number().int(),
  kpiAmount: z.number().nullable(),
  bonusAmount: z.number().nullable(),
  penaltyAmount: z.number().nullable(),
  entryKind: payslipEntryKindEnum,
  replacesPayslipId: z.string().uuid().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type PayslipDto = z.infer<typeof payslipSchema>;

export const payslipItemTypeEnum = z.enum([
  "earning",
  "deduction",
  "allowance",
  "attendance",
  "kpi",
  "bonus",
  "penalty",
]);
export type PayslipItemType = z.infer<typeof payslipItemTypeEnum>;

/** DTO dòng chi tiết payslip (append-only). */
export const payslipItemSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  payslipId: z.string().uuid(),
  itemType: payslipItemTypeEnum,
  label: z.string(),
  amount: z.number(),
  meta: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type PayslipItemDto = z.infer<typeof payslipItemSchema>;

/**
 * Run payroll — chạy lương cho 1 kỳ. Aggregate công G11 → snapshot payslip.
 * userIds optional: rỗng/không có ⇒ toàn bộ nhân sự có salary_profile active.
 */
export const runPayrollRequestSchema = z.object({
  payrollPeriodId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).optional(),
});
export type RunPayrollRequest = z.infer<typeof runPayrollRequestSchema>;

/** GET /payroll-periods query filters. */
export const payrollPeriodListQuerySchema = z.object({
  status: payrollPeriodStatusEnum.optional(),
});
export type PayrollPeriodListQuery = z.infer<typeof payrollPeriodListQuerySchema>;

/** GET /payslips query filters. */
export const payslipListQuerySchema = z.object({
  payrollPeriodId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
});
export type PayslipListQuery = z.infer<typeof payslipListQuerySchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// G12-3 — Bonus/Penalty (thưởng/phạt thủ công + sinh từ KPI/lỗi, có duyệt, chảy vào payroll)
//   - bonus_penalties: MUTABLE draft→approved/rejected (đề xuất chờ duyệt). KHÁC payslip snapshot
//     (append-only). Soft-delete deleted_at. Sửa field tiền CHỈ khi draft (trigger DB freeze sau duyệt).
//   - reference (task/defect/kpi_result) là NULLABLE typed-FK; CHECK ép đúng-một-hoặc-không theo
//     reference_type. Self-approve BỊ CHẶN (segregation of duties) ở service.
//   - kind tách bonus/penalty + amount > 0 (KHÔNG dùng số âm — tránh lỗi dấu khi cộng/trừ vào payslip).
//   - Approved + cùng period_month + chưa consume → runPayroll gộp vào payslip.bonus/penaltyAmount,
//     bind payroll_period_id (consume) chống trả 2 lần.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const bonusKindEnum = z.enum(["bonus", "penalty"]);
export type BonusKind = z.infer<typeof bonusKindEnum>;

export const bonusPenaltyStatusEnum = z.enum(["draft", "approved", "rejected"]);
export type BonusPenaltyStatus = z.infer<typeof bonusPenaltyStatusEnum>;

export const bonusSourceEnum = z.enum(["manual", "kpi", "defect"]);
export type BonusSource = z.infer<typeof bonusSourceEnum>;

export const bonusReferenceTypeEnum = z.enum(["task", "defect", "kpi_result"]);
export type BonusReferenceType = z.infer<typeof bonusReferenceTypeEnum>;

/** DTO bonus/penalty trả về client. amount là số tiền per-person (nhạy cảm — gate ở server). */
export const bonusPenaltySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  kind: bonusKindEnum,
  amount: z.number(),
  currency: z.string(),
  periodMonth: periodMonthSchema,
  reason: z.string().nullable(),
  source: bonusSourceEnum,
  referenceType: bonusReferenceTypeEnum.nullable(),
  taskId: z.string().uuid().nullable(),
  defectId: z.string().uuid().nullable(),
  kpiResultId: z.string().uuid().nullable(),
  status: bonusPenaltyStatusEnum,
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().datetime().nullable(),
  payrollPeriodId: z.string().uuid().nullable(),
  consumedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BonusPenaltyDto = z.infer<typeof bonusPenaltySchema>;

/**
 * Đúng-một-hoặc-không reference: reference_type phải khớp đúng cột FK tương ứng được set,
 * các cột còn lại NULL. Parity với CHECK `bonus_penalties_reference_check` (mig 0098).
 */
function refineReference(
  v: {
    referenceType?: BonusReferenceType;
    taskId?: string;
    defectId?: string;
    kpiResultId?: string;
  },
  ctx: z.RefinementCtx,
): void {
  const map: Record<BonusReferenceType, string | undefined> = {
    task: v.taskId,
    defect: v.defectId,
    kpi_result: v.kpiResultId,
  };
  const setIds = [v.taskId, v.defectId, v.kpiResultId].filter((x) => x != null);
  if (v.referenceType == null) {
    if (setIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "referenceType is required when a reference id is provided",
      });
    }
    return;
  }
  // referenceType set → đúng cột tương ứng phải có, không cột nào khác được set.
  if (map[v.referenceType] == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${v.referenceType}Id is required when referenceType='${v.referenceType}'`,
    });
  }
  if (setIds.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "exactly one reference id may be set, matching referenceType",
    });
  }
}

/** Create bonus/penalty — amount > 0 (kind tách bonus/penalty). reference đồng nhất với reference_type. */
export const createBonusPenaltySchema = z
  .object({
    userId: z.string().uuid(),
    kind: bonusKindEnum,
    amount: z.number().positive(),
    currency: z.string().min(1).optional(),
    periodMonth: periodMonthSchema,
    reason: z.string().max(500).optional(),
    source: bonusSourceEnum.default("manual"),
    referenceType: bonusReferenceTypeEnum.optional(),
    taskId: z.string().uuid().optional(),
    defectId: z.string().uuid().optional(),
    kpiResultId: z.string().uuid().optional(),
  })
  .superRefine(refineReference);
export type CreateBonusPenaltyRequest = z.infer<typeof createBonusPenaltySchema>;

/** Duyệt/từ chối — lý do tuỳ chọn (ghi vào reason khi reject để lưu vết). */
export const decideBonusPenaltySchema = z.object({
  reason: z.string().max(500).optional(),
});
export type DecideBonusPenaltyRequest = z.infer<typeof decideBonusPenaltySchema>;

/** GET /bonus-penalties query filters. */
export const bonusPenaltyListQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: bonusPenaltyStatusEnum.optional(),
  periodMonth: periodMonthSchema.optional(),
  kind: bonusKindEnum.optional(),
});
export type BonusPenaltyListQuery = z.infer<typeof bonusPenaltyListQuerySchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// G12-4 — Duyệt bảng lương (draft→approved→published) + nhân viên xác nhận/khiếu nại + re-auth payslip
//   - Period FSM: approve (SoD: người duyệt ≠ người chạy lương) → publish (phát hành đến nhân viên).
//   - payslip_acknowledgements: nhân viên xác nhận (acknowledged) hoặc khiếu nại (disputed + reason)
//     phiếu CỦA MÌNH khi kỳ đã 'published'; HR resolve khiếu nại (disputed→resolved). KHÔNG chứa tiền.
//   - Re-auth: xem chi tiết payslip cần step-up (nhập lại mật khẩu) — cửa sổ 5 phút (mirror reveal-secret).
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Approve/publish kỳ lương — không cần body (định danh kỳ qua :id, actor qua JWT). */
export const decidePayrollPeriodSchema = z.object({});
export type DecidePayrollPeriodRequest = z.infer<typeof decidePayrollPeriodSchema>;

export const payslipAckStatusEnum = z.enum(["acknowledged", "disputed", "resolved"]);
export type PayslipAckStatus = z.infer<typeof payslipAckStatusEnum>;

/** DTO xác nhận/khiếu nại payslip. KHÔNG chứa tiền lương (chỉ trạng thái đồng ý + lý do khiếu nại). */
export const payslipAcknowledgementSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  payslipId: z.string().uuid(),
  userId: z.string().uuid(),
  status: payslipAckStatusEnum,
  reason: z.string().nullable(),
  resolvedBy: z.string().uuid().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PayslipAcknowledgementDto = z.infer<typeof payslipAcknowledgementSchema>;

/** Xác nhận đã nhận lương — không cần body. */
export const acknowledgePayslipSchema = z.object({});
export type AcknowledgePayslipRequest = z.infer<typeof acknowledgePayslipSchema>;

/**
 * Khiếu nại lương — lý do BẮT BUỘC, không rỗng/khoảng trắng (parity CHECK payslip_ack_dispute_reason_check).
 * .trim() loại lý do toàn khoảng trắng (DB CHECK chỉ chặn NULL — đây là lớp nội dung).
 */
export const disputePayslipSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type DisputePayslipRequest = z.infer<typeof disputePayslipSchema>;

/** HR xử lý khiếu nại — ghi chú xử lý tuỳ chọn. */
export const resolvePayslipDisputeSchema = z.object({
  resolutionNote: z.string().max(500).optional(),
});
export type ResolvePayslipDisputeRequest = z.infer<typeof resolvePayslipDisputeSchema>;

/** Step-up trước khi xem payslip — nhập lại mật khẩu (mirror reveal-secret reauth). */
export const payslipReauthSchema = z.object({
  password: z.string().min(1),
});
export type PayslipReauthRequest = z.infer<typeof payslipReauthSchema>;

/** GET /payslips/:id/acknowledgements query filters. */
export const payslipAckListQuerySchema = z.object({
  status: payslipAckStatusEnum.optional(),
});
export type PayslipAckListQuery = z.infer<typeof payslipAckListQuerySchema>;
