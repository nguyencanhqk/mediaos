import { z } from "zod";
import {
  roleListSchema,
  permissionListSchema,
  roleWriteResultSchema,
  rolePermissionGrantSchema,
  type RoleDto,
  type PermissionCatalogDto,
  type RoleWriteResultDto,
  type RolePermissionGrantDto,
  type CreateRoleRequest,
  type UpdateRoleRequest,
  type AssignRolePermissionRequest,
  type RevokeRolePermissionRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Role & Permission admin API client — S2-FE-AUTH-4 (lane FE batch C).
 *
 * Cặp engine SEED THẬT (nguồn: apps/api/src/permission/role-admin.controller.ts +
 * apps/api/src/permission/auth-roles-permissions.controller.ts — mig 0005/0444/0460):
 *  - GET    /auth/roles                  view:role          (auth-roles-permissions.controller, is_sensitive=false)
 *  - GET    /auth/permissions            view:permission    (auth-roles-permissions.controller, is_sensitive=false)
 *  - POST   /auth/roles                  create:role        (role-admin.controller)
 *  - PATCH  /auth/roles/:id              update:role        (role-admin.controller) — server REJECT 400 khi role.isSystem
 *  - POST   /auth/roles/:id/permissions  assign:permission  (role-admin.controller, is_sensitive=true — ANTI-ESCALATION)
 *  - DELETE /auth/roles/:id/permissions  assign:permission  (role-admin.controller, is_sensitive=true)
 *
 * company_id do SERVER resolve từ AuthContext — client KHÔNG gửi (BẤT BIẾN #1). Masking là việc của SERVER.
 *
 * ⚠️ BE GAP (đã biết, KHÔNG tự thêm endpoint ở lane FE): KHÔNG có route đọc "role_permissions đã gán cho 1
 * role" — S2-AUTH-BE-6 done_when chỉ có assign/revoke, KHÔNG có list. RolePermissionsPage (apps/app) vì vậy
 * là công cụ HÀNH ĐỘNG (assign/revoke theo catalog), KHÔNG hiển thị trạng thái đã-gán hiện tại. Follow-up BE
 * cần thêm GET /auth/roles/:id/permissions để hoàn thiện UX ma trận thật.
 */
export const roleAdminApi = {
  /** GET /auth/roles — catalog role (own-tenant + system, loại operator). Trả mảng đã unwrap `.roles`. */
  listRoles: (): Promise<RoleDto[]> =>
    apiFetch("/auth/roles", roleListSchema).then((res) => res.roles),

  /** GET /auth/permissions — catalog permission toàn cục. Trả mảng đã unwrap `.permissions`. */
  listPermissions: (): Promise<PermissionCatalogDto[]> =>
    apiFetch("/auth/permissions", permissionListSchema).then((res) => res.permissions),

  /** POST /auth/roles — tạo role company-scope (server luôn set isSystem=false). */
  createRole: (body: CreateRoleRequest): Promise<RoleWriteResultDto> =>
    apiFetch("/auth/roles", roleWriteResultSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /auth/roles/:id — sửa name/description (dirty-fields). Role system-defined → server 400. */
  updateRole: (id: string, body: UpdateRoleRequest): Promise<RoleWriteResultDto> =>
    apiFetch(`/auth/roles/${id}`, roleWriteResultSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * POST /auth/roles/:id/permissions — gán 1 cặp permission cho role kèm data_scope. SCOPE CEILING:
   * dataScope PHẢI ≤ Company ('System' bị Zod chặn ở request type + server REJECT 400 nếu lọt qua).
   */
  assignPermission: (
    roleId: string,
    body: AssignRolePermissionRequest,
  ): Promise<RolePermissionGrantDto> =>
    apiFetch(`/auth/roles/${roleId}/permissions`, rolePermissionGrantSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** DELETE /auth/roles/:id/permissions — gỡ đúng 1 cặp permission (theo action+resourceType). 204. */
  revokePermission: (roleId: string, body: RevokeRolePermissionRequest): Promise<void> =>
    apiFetch(`/auth/roles/${roleId}/permissions`, z.void(), {
      method: "DELETE",
      body: JSON.stringify(body),
    }),
};
