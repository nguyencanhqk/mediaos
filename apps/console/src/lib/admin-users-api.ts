import {
  adminUserListSchema,
  adminUserSchema,
  type AdminUserDto,
  type AdminUserListDto,
  type ListUsersQuery,
  type SuspendUserRequest,
  type UpdateUserRequest,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * ACCT-2 (Module 2b) — Admin User CRUD API client (apps/console, tenant aud=user).
 *
 * Permission gates (server ép):
 *   - list/get/update : manage:user (is_sensitive=false)
 *   - suspend/reactivate : suspend:user (is_sensitive=true)
 *   - soft-delete : delete-user:user (is_sensitive=true)
 *
 * companyId lấy từ JWT server-side — client KHÔNG gửi.
 * Mọi mutation trả AdminUserDto (server trả row sau khi cập nhật).
 */

function buildQuery(params: Partial<ListUsersQuery>): string {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : "";
}

export const adminUsersApi = {
  /** GET /users/admin — danh sách phân trang. */
  list: (params: Partial<ListUsersQuery> = {}): Promise<AdminUserListDto> =>
    apiFetch(`/users/admin${buildQuery(params)}`, adminUserListSchema),

  /** GET /users/admin/:id — chi tiết 1 user. */
  get: (id: string): Promise<AdminUserDto> =>
    apiFetch(`/users/admin/${id}`, adminUserSchema),

  /** PATCH /users/admin/:id — cập nhật fullName (non-sensitive). */
  update: (id: string, body: UpdateUserRequest): Promise<AdminUserDto> =>
    apiFetch(`/users/admin/${id}`, adminUserSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** POST /users/admin/:id/suspend — khoá tài khoản (sensitive, is_sensitive=true). */
  suspend: (id: string, body: SuspendUserRequest = {}): Promise<AdminUserDto> =>
    apiFetch(`/users/admin/${id}/suspend`, adminUserSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** POST /users/admin/:id/reactivate — mở khoá tài khoản (sensitive, is_sensitive=true). */
  reactivate: (id: string): Promise<AdminUserDto> =>
    apiFetch(`/users/admin/${id}/reactivate`, adminUserSchema, {
      method: "POST",
    }),

  /** DELETE /users/admin/:id — xoá mềm (sensitive, is_sensitive=true). Server trả 200 + row. */
  softDelete: (id: string): Promise<AdminUserDto> =>
    apiFetch(`/users/admin/${id}`, adminUserSchema, {
      method: "DELETE",
    }),
};
