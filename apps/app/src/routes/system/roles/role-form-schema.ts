import { z } from "zod";
import type { CreateRoleRequest, RoleDto, UpdateRoleRequest } from "@mediaos/contracts";

/**
 * RHF+Zod schema cho form tạo/sửa role — S2-FE-AUTH-4 (lane FE batch C).
 * Message dùng i18n KEY (component resolve qua t()) — khớp pattern employee-form-schema.ts.
 */
export const roleFormSchema = z.object({
  name: z.string().min(1, "roleForm.errors.nameRequired").max(100, "roleForm.errors.nameTooLong"),
  description: z.string().max(500, "roleForm.errors.descriptionTooLong").optional(),
});
export type RoleFormValues = z.infer<typeof roleFormSchema>;

export const EMPTY_ROLE_FORM: RoleFormValues = { name: "", description: "" };

/** Role đã tải (list hoặc write-result) → giá trị form. */
export function roleToFormValues(role: Pick<RoleDto, "name" | "description">): RoleFormValues {
  return { name: role.name, description: role.description ?? "" };
}

/** Form values → CreateRoleRequest. description rỗng → null (server chuẩn hoá "không có mô tả"). */
export function toCreateRoleDto(values: RoleFormValues): CreateRoleRequest {
  return {
    name: values.name,
    description: values.description?.trim() ? values.description : null,
  };
}

/** Form values → UpdateRoleRequest CHỈ field dirty (patch tối thiểu — mirror toUpdateDto employee). */
export function toUpdateRoleDto(
  values: RoleFormValues,
  dirty: Partial<Record<keyof RoleFormValues, boolean | undefined>>,
): UpdateRoleRequest {
  const patch: UpdateRoleRequest = {};
  if (dirty.name) patch.name = values.name;
  if (dirty.description) {
    patch.description = values.description?.trim() ? values.description : null;
  }
  return patch;
}
