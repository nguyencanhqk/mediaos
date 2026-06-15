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

export const payrollPeriodStatusEnum = z.enum(["draft", "locked"]);
export type PayrollPeriodStatus = z.infer<typeof payrollPeriodStatusEnum>;

/** DTO kỳ lương trả về client. */
export const payrollPeriodSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  periodMonth: periodMonthSchema,
  status: payrollPeriodStatusEnum,
  attendancePeriodId: z.string().uuid().nullable(),
  kpiLocked: z.boolean(),
  lockedBy: z.string().uuid().nullable(),
  lockedAt: z.string().datetime().nullable(),
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
