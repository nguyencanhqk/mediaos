import { z } from "zod";
import type {
  CreateLeavePolicyRequest,
  UpdateLeavePolicyRequest,
  LeavePolicyView,
} from "@mediaos/contracts";

/**
 * Schema + mappers form Chính sách nghỉ phép (mặt admin) — S3-FE-LEAVE-5 (LEAVE-SCREEN-011).
 * Endpoint: POST/PATCH /leave/admin/policies (create:leave-policy / update:leave-policy — SENSITIVE).
 * `leaveTypeId` + `policyCode` immutable sau khi tạo (disable trên form sửa — xem LeavePoliciesPage).
 */
const numberPattern = /^\d+(\.\d+)?$/;
const intPattern = /^\d+$/;
const optionalNumber = (msg = "masterData.common.validation.numberInvalid") =>
  z.string().refine((v) => v === "" || numberPattern.test(v), msg);
const optionalInt = (msg = "masterData.common.validation.numberInvalid") =>
  z.string().refine((v) => v === "" || intPattern.test(v), msg);
const uuidOrEmpty = z
  .string()
  .refine(
    (v) => v === "" || z.string().uuid().safeParse(v).success,
    "masterData.common.validation.numberInvalid",
  );
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export const leavePolicyFormSchema = z
  .object({
    leaveTypeId: z.string().uuid("masterData.leavePolicies.validation.dateInvalid"),
    policyCode: z
      .string()
      .trim()
      .min(1, "masterData.common.validation.codeRequired")
      .max(50, "masterData.common.validation.codeTooLong")
      .regex(/^[A-Za-z0-9_-]+$/, "masterData.common.validation.codeRequired"),
    name: z
      .string()
      .trim()
      .min(1, "masterData.common.validation.nameRequired")
      .max(200, "masterData.common.validation.nameTooLong"),
    description: z.string().max(1000, "masterData.common.validation.nameTooLong"),
    policyScope: z.enum(["Company", "Department", "Employee", "JobLevel", "ContractType"]),
    departmentId: uuidOrEmpty,
    employeeId: uuidOrEmpty,
    jobLevelId: uuidOrEmpty,
    contractTypeId: uuidOrEmpty,
    yearlyQuotaDays: optionalNumber(),
    yearlyQuotaHours: optionalNumber(),
    accrualMethod: z.enum(["None", "Monthly", "Yearly", "Manual", "Prorated"]),
    accrualDayOfMonth: optionalInt(),
    prorateOnJoinDate: z.boolean(),
    includeWeekends: z.boolean(),
    includePublicHolidays: z.boolean(),
    reserveBalanceOnPending: z.boolean(),
    allowNegativeBalance: z.boolean(),
    maxNegativeDays: optionalNumber(),
    allowCancelAfterApproved: z.boolean(),
    cancelBeforeDays: optionalInt(),
    requiresManagerApproval: z.boolean(),
    requiresHrApproval: z.boolean(),
    effectiveFrom: z
      .string()
      .regex(isoDatePattern, "masterData.leavePolicies.validation.effectiveFromRequired"),
    effectiveTo: z
      .string()
      .refine(
        (v) => v === "" || isoDatePattern.test(v),
        "masterData.leavePolicies.validation.dateInvalid",
      ),
    priority: optionalInt(),
    status: z.enum(["Active", "Inactive"]),
  })
  .refine((v) => v.policyScope !== "Department" || v.departmentId !== "", {
    message: "masterData.leavePolicies.validation.departmentRequired",
    path: ["departmentId"],
  })
  .refine((v) => v.policyScope !== "Employee" || v.employeeId !== "", {
    message: "masterData.leavePolicies.validation.employeeRequired",
    path: ["employeeId"],
  })
  .refine((v) => v.policyScope !== "JobLevel" || v.jobLevelId !== "", {
    message: "masterData.leavePolicies.validation.jobLevelRequired",
    path: ["jobLevelId"],
  })
  .refine((v) => v.policyScope !== "ContractType" || v.contractTypeId !== "", {
    message: "masterData.leavePolicies.validation.contractTypeRequired",
    path: ["contractTypeId"],
  });

export type LeavePolicyFormValues = z.infer<typeof leavePolicyFormSchema>;

export const EMPTY_LEAVE_POLICY_FORM: LeavePolicyFormValues = {
  leaveTypeId: "",
  policyCode: "",
  name: "",
  description: "",
  policyScope: "Company",
  departmentId: "",
  employeeId: "",
  jobLevelId: "",
  contractTypeId: "",
  yearlyQuotaDays: "",
  yearlyQuotaHours: "",
  accrualMethod: "None",
  accrualDayOfMonth: "",
  prorateOnJoinDate: false,
  includeWeekends: false,
  includePublicHolidays: false,
  reserveBalanceOnPending: true,
  allowNegativeBalance: false,
  maxNegativeDays: "",
  allowCancelAfterApproved: true,
  cancelBeforeDays: "",
  requiresManagerApproval: true,
  requiresHrApproval: false,
  effectiveFrom: "",
  effectiveTo: "",
  priority: "0",
  status: "Active",
};

export function leavePolicyToForm(item: LeavePolicyView): LeavePolicyFormValues {
  return {
    leaveTypeId: item.leaveTypeId,
    policyCode: item.policyCode,
    name: item.name,
    description: item.description ?? "",
    policyScope: item.policyScope,
    departmentId: item.departmentId ?? "",
    employeeId: item.employeeId ?? "",
    jobLevelId: item.jobLevelId ?? "",
    contractTypeId: item.contractTypeId ?? "",
    yearlyQuotaDays: item.yearlyQuotaDays != null ? String(item.yearlyQuotaDays) : "",
    yearlyQuotaHours: item.yearlyQuotaHours != null ? String(item.yearlyQuotaHours) : "",
    accrualMethod: item.accrualMethod,
    // BE view không trả lại accrualDayOfMonth/cancelBeforeDays — pre-fill rỗng, người dùng nhập lại khi sửa.
    accrualDayOfMonth: "",
    prorateOnJoinDate: false,
    includeWeekends: false,
    includePublicHolidays: false,
    reserveBalanceOnPending: item.reserveBalanceOnPending,
    allowNegativeBalance: item.allowNegativeBalance,
    maxNegativeDays: item.maxNegativeDays != null ? String(item.maxNegativeDays) : "",
    allowCancelAfterApproved: true,
    cancelBeforeDays: "",
    requiresManagerApproval: item.requiresManagerApproval,
    requiresHrApproval: item.requiresHrApproval,
    effectiveFrom: item.effectiveFrom,
    effectiveTo: item.effectiveTo ?? "",
    priority: String(item.priority),
    status: item.status,
  };
}

function targetIds(values: LeavePolicyFormValues) {
  return {
    departmentId: values.policyScope === "Department" ? values.departmentId : undefined,
    employeeId: values.policyScope === "Employee" ? values.employeeId : undefined,
    jobLevelId: values.policyScope === "JobLevel" ? values.jobLevelId : undefined,
    contractTypeId: values.policyScope === "ContractType" ? values.contractTypeId : undefined,
  };
}

export function leavePolicyToCreate(values: LeavePolicyFormValues): CreateLeavePolicyRequest {
  return {
    leaveTypeId: values.leaveTypeId,
    policyCode: values.policyCode.trim(),
    name: values.name.trim(),
    description: values.description.trim() || undefined,
    policyScope: values.policyScope,
    ...targetIds(values),
    yearlyQuotaDays: values.yearlyQuotaDays ? Number(values.yearlyQuotaDays) : undefined,
    yearlyQuotaHours: values.yearlyQuotaHours ? Number(values.yearlyQuotaHours) : undefined,
    accrualMethod: values.accrualMethod,
    accrualDayOfMonth: values.accrualDayOfMonth ? Number(values.accrualDayOfMonth) : undefined,
    prorateOnJoinDate: values.prorateOnJoinDate,
    includeWeekends: values.includeWeekends,
    includePublicHolidays: values.includePublicHolidays,
    reserveBalanceOnPending: values.reserveBalanceOnPending,
    allowNegativeBalance: values.allowNegativeBalance,
    maxNegativeDays: values.maxNegativeDays ? Number(values.maxNegativeDays) : undefined,
    allowCancelAfterApproved: values.allowCancelAfterApproved,
    cancelBeforeDays: values.cancelBeforeDays ? Number(values.cancelBeforeDays) : undefined,
    requiresManagerApproval: values.requiresManagerApproval,
    requiresHrApproval: values.requiresHrApproval,
    effectiveFrom: values.effectiveFrom,
    effectiveTo: values.effectiveTo || undefined,
    priority: values.priority ? Number(values.priority) : 0,
  };
}

export function leavePolicyToUpdate(values: LeavePolicyFormValues): UpdateLeavePolicyRequest {
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    status: values.status,
    yearlyQuotaDays: values.yearlyQuotaDays ? Number(values.yearlyQuotaDays) : null,
    yearlyQuotaHours: values.yearlyQuotaHours ? Number(values.yearlyQuotaHours) : null,
    accrualMethod: values.accrualMethod,
    accrualDayOfMonth: values.accrualDayOfMonth ? Number(values.accrualDayOfMonth) : null,
    prorateOnJoinDate: values.prorateOnJoinDate,
    includeWeekends: values.includeWeekends,
    includePublicHolidays: values.includePublicHolidays,
    reserveBalanceOnPending: values.reserveBalanceOnPending,
    allowNegativeBalance: values.allowNegativeBalance,
    maxNegativeDays: values.maxNegativeDays ? Number(values.maxNegativeDays) : null,
    allowCancelAfterApproved: values.allowCancelAfterApproved,
    cancelBeforeDays: values.cancelBeforeDays ? Number(values.cancelBeforeDays) : null,
    requiresManagerApproval: values.requiresManagerApproval,
    requiresHrApproval: values.requiresHrApproval,
    effectiveFrom: values.effectiveFrom,
    effectiveTo: values.effectiveTo || null,
    priority: values.priority ? Number(values.priority) : 0,
  };
}
