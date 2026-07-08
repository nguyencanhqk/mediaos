import { z } from "zod";
import {
  roleListSchema,
  roleMemberListSchema,
  rolePermissionGrantsSchema,
  permissionListSchema,
  roleWriteResultSchema,
  roleDeleteResultSchema,
  rolePermissionGrantSchema,
  permissionRulePreviewSchema,
  type RoleDto,
  type RoleMemberListDto,
  type RolePermissionGrantsDto,
  type PermissionCatalogDto,
  type RoleWriteResultDto,
  type RoleDeleteResultDto,
  type RolePermissionGrantDto,
  type PermissionRulePreview,
  type CreateRoleRequest,
  type UpdateRoleRequest,
  type AssignRolePermissionRequest,
  type RevokeRolePermissionRequest,
  type ApplyPermissionRuleRequest,
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
  /**
   * S2-AUTH-ROLEMEM-1 — GET /auth/roles/:id/members: thành viên ACTIVE của role trong tenant
   * (tab Thành viên). Gate BE view:user. Thêm/gỡ member dùng authUsersApi.assignRole/revokeRole.
   */
  getMembers: (roleId: string): Promise<RoleMemberListDto> =>
    apiFetch(`/auth/roles/${roleId}/members`, roleMemberListSchema),

  /**
   * S2-AUTH-PERMUX-1 — GET /auth/roles/:id/permissions: grants ĐÃ GÁN của role (ALLOW + DENY).
   * Nền cho RolePermissionsPage v2 (trạng thái thật) + nhân bản vai trò.
   */
  getRolePermissions: (roleId: string): Promise<RolePermissionGrantsDto> =>
    apiFetch(`/auth/roles/${roleId}/permissions`, rolePermissionGrantsSchema),

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
   * DELETE /auth/roles/:id — xoá MỀM role company-scope + CASCADE gỡ khỏi mọi thành viên. Trả
   * { id, revokedMembers } để FE báo "đã gỡ N thành viên". Role system-defined → server 400.
   */
  deleteRole: (id: string): Promise<RoleDeleteResultDto> =>
    apiFetch(`/auth/roles/${id}`, roleDeleteResultSchema, {
      method: "DELETE",
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

  /**
   * POST /auth/roles/:id/permissions/apply-rule — bung 1 LUẬT thành grant khớp. `dryRun:true` = xem
   * trước (0 ghi); `false` = áp. Trả preview (toAdd/toChangeScope/skipped/excludedSensitive + counts;
   * applied[] khi áp). Gate assign:permission (server) — chỉ company-admin.
   */
  applyPermissionRule: (
    roleId: string,
    body: ApplyPermissionRuleRequest,
  ): Promise<PermissionRulePreview> =>
    apiFetch(`/auth/roles/${roleId}/permissions/apply-rule`, permissionRulePreviewSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
