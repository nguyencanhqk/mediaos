import { z } from "zod";
import {
  authUserSchema,
  authUserDetailSchema,
  authUserListSchema,
  authUserPasswordResetResultSchema,
  authUserTwoFactorResetSchema,
  roleListSchema,
  userRoleSchema,
  type AuthUserDto,
  type AuthUserDetailDto,
  type AuthUserListDto,
  type AuthUserPasswordResetResultDto,
  type AuthUserTwoFactorResetDto,
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

  /**
   * GET /auth/users/:id — chi tiết 1 user (S2-AUTH-BE-12). Parse authUserDetailSchema = superset của
   * authUserSchema + khối `twoFactor` {enabled, requiredByRole, requiredByUser}. Prefill form KHÔNG vỡ
   * (detail là superset). masking = SERVER: DTO KHÔNG chứa secret TOTP/recovery-code (BẤT BIẾN #3).
   */
  getUser: (id: string): Promise<AuthUserDetailDto> =>
    apiFetch(`/auth/users/${id}`, authUserDetailSchema),

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
   * POST /auth/users/:id/2fa/reset — admin gỡ 2FA của target (S2-AUTH-BE-12, privileged). Gate cặp
   * CANONICAL reset-2fa:user is_sensitive=true (mig 0466) — server tự chặn. Không body (route chỉ nhận :id).
   * Kết quả CHỈ revokedSessionCount (forensic) — KHÔNG secret/recovery-code (BẤT BIẾN #3). Self-reset OK;
   * cross-tenant/không tồn tại → 404 (caller surface message rõ).
   */
  resetTwoFactor: (id: string): Promise<AuthUserTwoFactorResetDto> =>
    apiFetch(`/auth/users/${id}/2fa/reset`, authUserTwoFactorResetSchema, {
      method: "POST",
      body: "{}",
    }),

  /**
   * S2-AUTH-USEROPS-1 — DELETE /auth/users/:id: XÓA MỀM (khôi phục được). Gate cặp CANONICAL
   * delete:user is_sensitive=true (mig 0476) — FE gate nút bằng useCanExact. Self-delete → 400.
   */
  deleteUser: (id: string): Promise<AuthUserDto> =>
    apiFetch(`/auth/users/${id}`, authUserSchema, { method: "DELETE" }),

  /**
   * S2-AUTH-USEROPS-1 — POST /auth/users/:id/restore: KHÔI PHỤC user đã xóa mềm. Gate restore:user
   * is_sensitive=true (mig 0476). Email đã bị user LIVE chiếm → 409 (surface message rõ).
   */
  restoreUser: (id: string): Promise<AuthUserDto> =>
    apiFetch(`/auth/users/${id}/restore`, authUserSchema, { method: "POST", body: "{}" }),

  /**
   * S2-AUTH-USEROPS-1 — POST /auth/users/:id/password/reset: admin đặt lại mật khẩu. Gate
   * reset-password:user is_sensitive=true (mig 0476). Kết quả chứa tempPassword ĐÚNG 1 LẦN —
   * caller CHỈ hiển thị trong dialog, TUYỆT ĐỐI không log/cache/persist (BẤT BIẾN #3); server đã
   * ép must_change_password + thu hồi mọi phiên. Self → 400 (dùng change-password).
   */
  resetPassword: (id: string): Promise<AuthUserPasswordResetResultDto> =>
    apiFetch(`/auth/users/${id}/password/reset`, authUserPasswordResetResultSchema, {
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
