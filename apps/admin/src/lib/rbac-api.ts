import { z } from "zod";
import {
  assignRoleSchema,
  employeeSchema,
  objectPermissionSchema,
  removeObjectPermissionSchema,
  setObjectPermissionSchema,
  userRoleSchema,
  type AssignRoleRequest,
  type EmployeeDto,
  type ObjectPermissionDto,
  type RemoveObjectPermissionRequest,
  type SetObjectPermissionRequest,
  type UserRoleDto,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * RBAC self-service API client (AC-3 — nhánh (a) self-service).
 *
 * KHÔNG có endpoint operator chéo-tenant: mọi route đi qua `actor.companyId` của BE
 * (permission-admin reuse nguyên trạng — PRD §4 N2). companyId trên path `/tenant/:companyId`
 * chỉ để self-scope điều hướng UI; quyền + scope dữ liệu do BE ép theo token của user.
 *
 * Hợp đồng route (xem permission-admin.controller.ts + org.controller.ts):
 *   - GET    /org/roles                              → danh mục vai trò (đọc mở cho user tenant).
 *   - GET    /org/employees                          → danh sách user (subject để gán role/object-perm).
 *   - POST   /permissions/users/:userId/roles        → gán role  (gate `assign-role:user`).
 *   - DELETE /permissions/users/:userId/roles/:roleId→ thu role  (gate `assign-role:user`, 204).
 *   - PUT    /permissions/object                     → set object-permission (gate `grant-object-permission:permission`).
 *   - DELETE /permissions/object                     → xoá object-permission (gate `grant-object-permission:permission`, 204).
 *
 * ⚠️ BE KHÔNG có read-API cho "role hiện tại của 1 user" hay "danh sách object-permission".
 * UI thao tác theo danh mục (chọn user + role/permission) — KHÔNG hiển thị state grant hiện hữu.
 */

/** GET /org/roles trả `{ id, name }` (org.repository.listRoles) — không có schema trong contracts → khai tại đây. */
export const roleSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

const voidSchema = z.void();

export const rbacApi = {
  // ── Danh mục (read) ──────────────────────────────────────────────────────────
  /** GET /org/roles — danh mục vai trò của tenant (+ system role). */
  listRoles: (): Promise<RoleSummary[]> => apiFetch("/org/roles", z.array(roleSummarySchema)),

  /** GET /org/employees — user trong tenant (subject của gán role / object-permission). */
  listUsers: (): Promise<EmployeeDto[]> => apiFetch("/org/employees", z.array(employeeSchema)),

  // ── Gán / thu role cho user (gate assign-role:user) ───────────────────────────
  /** POST /permissions/users/:userId/roles — gán role (idempotent ở BE). */
  assignRole: (userId: string, body: AssignRoleRequest): Promise<UserRoleDto> => {
    const validated = assignRoleSchema.parse(body);
    return apiFetch(`/permissions/users/${userId}/roles`, userRoleSchema, {
      method: "POST",
      body: JSON.stringify(validated),
    });
  },

  /** DELETE /permissions/users/:userId/roles/:roleId — thu role (204 No Content). */
  revokeRole: (userId: string, roleId: string): Promise<void> =>
    apiFetch(`/permissions/users/${userId}/roles/${roleId}`, voidSchema, { method: "DELETE" }),

  // ── Object-permission override (gate grant-object-permission:permission) ──────
  /** PUT /permissions/object — set/flip 1 object-permission override. */
  setObjectPermission: (body: SetObjectPermissionRequest): Promise<ObjectPermissionDto> => {
    const validated = setObjectPermissionSchema.parse(body);
    return apiFetch("/permissions/object", objectPermissionSchema, {
      method: "PUT",
      body: JSON.stringify(validated),
    });
  },

  /** DELETE /permissions/object — xoá 1 object-permission override (204 No Content). */
  removeObjectPermission: (body: RemoveObjectPermissionRequest): Promise<void> => {
    const validated = removeObjectPermissionSchema.parse(body);
    return apiFetch("/permissions/object", voidSchema, {
      method: "DELETE",
      body: JSON.stringify(validated),
    });
  },
};
