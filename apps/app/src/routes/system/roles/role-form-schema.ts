import { z } from "zod";
import type { CreateRoleRequest, RoleDto, UpdateRoleRequest } from "@mediaos/contracts";

/**
 * RHF+Zod schema cho form tạo/sửa role — S2-FE-AUTH-4 (lane FE batch C).
 * S2-FE-SYS-SEC-1 (additive): thêm cờ `requiresTwoFactor` (ép 2FA cho MỌI user mang role này —
 * roles.requires_two_factor, mig 0120/0466). Message dùng i18n KEY (component resolve qua t()).
 */
export const roleFormSchema = z.object({
  name: z.string().min(1, "roleForm.errors.nameRequired").max(100, "roleForm.errors.nameTooLong"),
  description: z.string().max(500, "roleForm.errors.descriptionTooLong").optional(),
  requiresTwoFactor: z.boolean(),
});
export type RoleFormValues = z.infer<typeof roleFormSchema>;

export const EMPTY_ROLE_FORM: RoleFormValues = {
  name: "",
  description: "",
  requiresTwoFactor: false,
};

/**
 * Role đã tải (list catalog hoặc write-result) → giá trị form.
 *
 * ⚠️ GIỚI HẠN FE-only (BE-gap, KHÔNG tự thêm endpoint ở lane FE — mirror ghi-chú RolePermissionsPage):
 * `roleSchema` của GET /auth/roles (list) KHÔNG mang cột `requiresTwoFactor`, và KHÔNG có route
 * GET /auth/roles/:id (detail). Vì vậy khi PREFILL form edit, `requiresTwoFactor` mặc định `false` —
 * KHÔNG phản chiếu trạng thái thật của role. Người dùng phải chủ động bật lại nếu muốn giữ. Chỉ khi
 * BE bổ sung cờ này vào list/detail thì mới prefill đúng được. Follow-up BE: thêm requiresTwoFactor
 * vào roleSchema (list) hoặc GET /auth/roles/:id.
 */
export function roleToFormValues(role: Pick<RoleDto, "name" | "description">): RoleFormValues {
  return {
    name: role.name,
    description: role.description ?? "",
    requiresTwoFactor: false,
  };
}

/** Form values → CreateRoleRequest. description rỗng → null (server chuẩn hoá "không có mô tả"). */
export function toCreateRoleDto(values: RoleFormValues): CreateRoleRequest {
  return {
    name: values.name,
    description: values.description?.trim() ? values.description : null,
    requiresTwoFactor: values.requiresTwoFactor,
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
  if (dirty.requiresTwoFactor) patch.requiresTwoFactor = values.requiresTwoFactor;
  return patch;
}
