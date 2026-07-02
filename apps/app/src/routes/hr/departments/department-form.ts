import { z } from "zod";
import type { CreateDepartmentRequest, UpdateDepartmentRequest } from "@mediaos/contracts";
import type { HrDepartment } from "@mediaos/web-core";

/**
 * Schema + mappers form Phòng ban — S2-FE-HR-5 (lane HR5-SCREENS).
 * Message lỗi là i18n key (resolve qua t ở tầng field). company_id KHÔNG gửi (server resolve).
 */
export const departmentFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "masterData.common.validation.nameRequired")
    .max(200, "masterData.common.validation.nameTooLong"),
  code: z.string().trim().max(50, "masterData.common.validation.codeTooLong"),
  parentId: z.string(),
  description: z.string(),
  status: z.enum(["active", "inactive"]),
});

export type DepartmentFormValues = z.infer<typeof departmentFormSchema>;

export const EMPTY_DEPARTMENT_FORM: DepartmentFormValues = {
  name: "",
  code: "",
  parentId: "",
  description: "",
  status: "active",
};

export function departmentToForm(item: HrDepartment): DepartmentFormValues {
  return {
    name: item.name,
    code: item.code ?? "",
    parentId: item.parentId ?? "",
    description: item.description ?? "",
    status: item.status,
  };
}

export function departmentToCreate(values: DepartmentFormValues): CreateDepartmentRequest {
  return {
    name: values.name.trim(),
    code: values.code.trim() || undefined,
    parentId: values.parentId || undefined,
    description: values.description.trim() || undefined,
    status: values.status,
  };
}

export function departmentToUpdate(values: DepartmentFormValues): UpdateDepartmentRequest {
  return {
    name: values.name.trim(),
    code: values.code.trim() || null,
    parentId: values.parentId || null,
    description: values.description.trim() || null,
    status: values.status,
  };
}
