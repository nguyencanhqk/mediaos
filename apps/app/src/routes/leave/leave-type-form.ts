import { z } from "zod";
import type {
  CreateLeaveTypeAdminRequest,
  UpdateLeaveTypeAdminRequest,
  LeaveTypeAdminView,
} from "@mediaos/contracts";

/**
 * Schema + mappers form Loại nghỉ phép (mặt admin) — S3-FE-LEAVE-5 (LEAVE-SCREEN-010).
 * Endpoint: POST/PATCH /leave/admin/types (create:leave-type / update:leave-type — SENSITIVE).
 * `code` immutable sau khi tạo — field bị `disabled` trên form sửa (xem LeaveTypesPage).
 */
const numberPattern = /^\d+(\.\d+)?$/;
const optionalNumber = z
  .string()
  .refine((v) => v === "" || numberPattern.test(v), "masterData.common.validation.numberInvalid");

export const leaveTypeFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "masterData.common.validation.codeRequired")
    .max(50, "masterData.common.validation.codeTooLong")
    .regex(/^[a-z0-9_-]+$/, "masterData.common.validation.codeRequired"),
  name: z
    .string()
    .trim()
    .min(1, "masterData.common.validation.nameRequired")
    .max(200, "masterData.common.validation.nameTooLong"),
  paid: z.boolean(),
  description: z.string().max(1000, "masterData.common.validation.nameTooLong"),
  deductBalance: z.boolean(),
  balanceUnit: z.enum(["Day", "Hour"]),
  allowFullDay: z.boolean(),
  allowHalfDay: z.boolean(),
  allowHourly: z.boolean(),
  allowMultipleDays: z.boolean(),
  requireReason: z.boolean(),
  requireAttachment: z.boolean(),
  minNoticeDays: optionalNumber,
  maxDaysPerRequest: optionalNumber,
  maxHoursPerRequest: optionalNumber,
  allowNegativeBalance: z.boolean(),
  sortOrder: optionalNumber,
  status: z.enum(["active", "inactive"]),
});

export type LeaveTypeFormValues = z.infer<typeof leaveTypeFormSchema>;

export const EMPTY_LEAVE_TYPE_FORM: LeaveTypeFormValues = {
  code: "",
  name: "",
  paid: true,
  description: "",
  deductBalance: true,
  balanceUnit: "Day",
  allowFullDay: true,
  allowHalfDay: false,
  allowHourly: false,
  allowMultipleDays: true,
  requireReason: false,
  requireAttachment: false,
  minNoticeDays: "",
  maxDaysPerRequest: "",
  maxHoursPerRequest: "",
  allowNegativeBalance: false,
  sortOrder: "",
  status: "active",
};

export function leaveTypeToForm(item: LeaveTypeAdminView): LeaveTypeFormValues {
  return {
    code: item.code,
    name: item.name,
    paid: item.paid,
    description: item.description ?? "",
    deductBalance: item.deductBalance ?? true,
    balanceUnit: (item.balanceUnit as "Day" | "Hour" | null) ?? "Day",
    allowFullDay: item.allowFullDay ?? true,
    allowHalfDay: item.allowHalfDay ?? false,
    allowHourly: item.allowHourly ?? false,
    allowMultipleDays: item.allowMultipleDays ?? true,
    requireReason: item.requireReason ?? false,
    requireAttachment: item.requireAttachment ?? false,
    minNoticeDays: item.minNoticeDays != null ? String(item.minNoticeDays) : "",
    maxDaysPerRequest: item.maxDaysPerRequest != null ? String(item.maxDaysPerRequest) : "",
    maxHoursPerRequest: item.maxHoursPerRequest != null ? String(item.maxHoursPerRequest) : "",
    // BE gap: GET /leave/types (nguồn list mặt admin) không trả field này → mặc định false khi mở sửa
    // (xem leaveApi.listTypesAdmin). Người dùng vẫn set lại được — chỉ ảnh hưởng giá trị PRE-FILL.
    allowNegativeBalance: item.allowNegativeBalance ?? false,
    sortOrder: item.sortOrder != null ? String(item.sortOrder) : "",
    status: item.status === "inactive" ? "inactive" : "active",
  };
}

export function leaveTypeToCreate(values: LeaveTypeFormValues): CreateLeaveTypeAdminRequest {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    paid: values.paid,
    description: values.description.trim() || undefined,
    deductBalance: values.deductBalance,
    balanceUnit: values.balanceUnit,
    allowFullDay: values.allowFullDay,
    allowHalfDay: values.allowHalfDay,
    allowHourly: values.allowHourly,
    allowMultipleDays: values.allowMultipleDays,
    requireReason: values.requireReason,
    requireAttachment: values.requireAttachment,
    minNoticeDays: values.minNoticeDays ? Number(values.minNoticeDays) : undefined,
    maxDaysPerRequest: values.maxDaysPerRequest ? Number(values.maxDaysPerRequest) : undefined,
    maxHoursPerRequest: values.maxHoursPerRequest ? Number(values.maxHoursPerRequest) : undefined,
    allowNegativeBalance: values.allowNegativeBalance,
    sortOrder: values.sortOrder ? Number(values.sortOrder) : undefined,
  };
}

export function leaveTypeToUpdate(values: LeaveTypeFormValues): UpdateLeaveTypeAdminRequest {
  return {
    name: values.name.trim(),
    paid: values.paid,
    status: values.status,
    description: values.description.trim() || null,
    deductBalance: values.deductBalance,
    balanceUnit: values.balanceUnit,
    allowFullDay: values.allowFullDay,
    allowHalfDay: values.allowHalfDay,
    allowHourly: values.allowHourly,
    allowMultipleDays: values.allowMultipleDays,
    requireReason: values.requireReason,
    requireAttachment: values.requireAttachment,
    minNoticeDays: values.minNoticeDays ? Number(values.minNoticeDays) : null,
    maxDaysPerRequest: values.maxDaysPerRequest ? Number(values.maxDaysPerRequest) : null,
    maxHoursPerRequest: values.maxHoursPerRequest ? Number(values.maxHoursPerRequest) : null,
    allowNegativeBalance: values.allowNegativeBalance,
    sortOrder: values.sortOrder ? Number(values.sortOrder) : undefined,
  };
}
