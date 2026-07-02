/**
 * Zod form schema + mapping helpers cho /hr/settings/employee-code (S2-FE-HR-8).
 *
 * Form gửi NGUYÊN object mỗi lần submit (KHÔNG diff-partial như CompanySettingsPage per-key) — cùng
 * kỹ thuật RetentionEditDialog. Server DTO đã .refine("ít nhất 1 field") nên gửi đủ 5 field luôn thoả.
 */
import { z } from "zod";
import {
  EMPLOYEE_CODE_NUMBER_LENGTH_MAX,
  EMPLOYEE_CODE_NUMBER_LENGTH_MIN,
  type EmployeeCodeConfigDto,
  type UpdateEmployeeCodeConfigRequest,
} from "@mediaos/web-core";

/** Mirror CHECK status IN ('active','inactive') — hr-master schema (employee_code_configs). */
export const EMPLOYEE_CODE_CONFIG_STATUSES = ["active", "inactive"] as const;

export const employeeCodeConfigFormSchema = z.object({
  // "" = KHÔNG set prefix/pattern (map → null khi submit). max theo contract (prefix 20 / pattern 100).
  prefix: z.string().max(20),
  pattern: z.string().max(100),
  numberLength: z.coerce
    .number()
    .int()
    .min(EMPLOYEE_CODE_NUMBER_LENGTH_MIN)
    .max(EMPLOYEE_CODE_NUMBER_LENGTH_MAX),
  allowManualOverride: z.boolean(),
  status: z.enum(EMPLOYEE_CODE_CONFIG_STATUSES),
});
export type EmployeeCodeConfigFormValues = z.infer<typeof employeeCodeConfigFormSchema>;

/** DTO server → giá trị form (nullable prefix/pattern → chuỗi rỗng cho input text). */
export function fromConfigDto(dto: EmployeeCodeConfigDto): EmployeeCodeConfigFormValues {
  return {
    prefix: dto.prefix ?? "",
    pattern: dto.pattern ?? "",
    numberLength: dto.numberLength,
    allowManualOverride: dto.allowManualOverride,
    status: dto.status,
  };
}

/** Giá trị form ĐÃ VALIDATE → PATCH body (chuỗi rỗng → null, khớp contract nullable). */
export function toUpdateBody(
  values: EmployeeCodeConfigFormValues,
): UpdateEmployeeCodeConfigRequest {
  const prefix = values.prefix.trim();
  const pattern = values.pattern.trim();
  return {
    prefix: prefix === "" ? null : prefix,
    pattern: pattern === "" ? null : pattern,
    numberLength: values.numberLength,
    allowManualOverride: values.allowManualOverride,
    status: values.status,
  };
}
