import { z } from "zod";
import {
  authUserSchema,
  authUserListSchema,
  roleListSchema,
  userRoleSchema,
  type AuthUserDto,
  type AuthUserListDto,
  type CreateAuthUserRequest,
  type ListAuthUsersQuery,
  type LockAuthUserRequest,
  type RoleListDto,
  type UpdateAuthUserRequest,
  type AssignRoleRequest,
  type UserRoleDto,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

// 204 No Content — schema rỗng để apiFetch bỏ qua parse body (finishResponse short-circuit ở 204).
const authUserVoidSchema = z.undefined();

/**
 * S2-FE-AUTH-3 — Auth admin user API client cho /auth/users + /auth/roles (S2-AUTH-BE-3) và
 * /permissions/users/:userId/roles (assign-role mutation-path, G3-4).
 *
 * Masking do SERVER: DTO view KHÔNG passwordHash — client chỉ render gì nhận được.
 * KHÔNG dùng lại `usersApi.listUsers` (đó là surface ACCT-2 cũ `/users/admin`, khác cặp quyền
 * manage:user — S2-FE-AUTH-3 done_when đòi CẶP CANONICAL view/create/update/lock/unlock:user).
 */
export const authUsersApi = {
  /** GET /auth/users — danh sách (data-scope-aware, server bound theo scope). */
  listUsers: (query?: Partial<ListAuthUsersQuery>): Promise<AuthUserListDto> => {
    const qs = buildQueryString(query ?? {});
    return apiFetch(`/auth/users${qs}`, authUserListSchema);
  },

  /** GET /auth/users/:id — chi tiết 1 user. */
  getUser: (id: string): Promise<AuthUserDto> => apiFetch(`/auth/users/${id}`, authUserSchema),

  /** POST /auth/users — tạo user (mật khẩu hash ở SERVER). */
  createUser: (body: CreateAuthUserRequest): Promise<AuthUserDto> =>
    apiFetch("/auth/users", authUserSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /auth/users/:id — CHỈ field non-sensitive (fullName). */
  updateUser: (id: string, body: UpdateAuthUserRequest): Promise<AuthUserDto> =>
    apiFetch(`/auth/users/${id}`, authUserSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /auth/users/:id/lock — khoá tài khoản (chặn login). Self-guard ở SERVER. */
  lockUser: (id: string, body: LockAuthUserRequest): Promise<AuthUserDto> =>
    apiFetch(`/auth/users/${id}/lock`, authUserSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /auth/users/:id/unlock — mở khoá tài khoản. */
  unlockUser: (id: string): Promise<AuthUserDto> =>
    apiFetch(`/auth/users/${id}/unlock`, authUserSchema, {
      method: "POST",
      body: "{}",
    }),

  /**
   * GET /auth/roles — catalog role gán được (own-tenant + system, loại operator-audience ở server).
   * Dùng cho màn /system/users/:id/roles (assign-role picker).
   */
  listRoles: (): Promise<RoleListDto> => apiFetch("/auth/roles", roleListSchema),

  /**
   * POST /permissions/users/:userId/roles — gán role cho user (G3-4 mutation-path, isSensitive).
   * Idempotent cùng role+expiry; đổi expiry → server tự DELETE+INSERT.
   */
  assignRole: (userId: string, body: AssignRoleRequest): Promise<UserRoleDto> =>
    apiFetch(`/permissions/users/${userId}/roles`, userRoleSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * DELETE /permissions/users/:userId/roles/:roleId — thu role khỏi user (G3-4 mutation-path).
   * Server trả 404 nếu user KHÔNG đang giữ role này — caller xử lý như lỗi rõ ràng (KHÔNG no-op ngầm).
   */
  revokeRole: (userId: string, roleId: string): Promise<void> =>
    apiFetch(`/permissions/users/${userId}/roles/${roleId}`, authUserVoidSchema, {
      method: "DELETE",
    }),
};
