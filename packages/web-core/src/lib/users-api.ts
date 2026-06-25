import {
  logoutResponseSchema,
  adminUserListSchema,
  type LogoutResponse,
  type UpdateProfileRequest,
  type AdminUserListDto,
  type ListUsersQuery,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * Users API client (Module 2a — self-service hồ sơ). Authenticated (apiFetch gắn Bearer mặc định).
 * Module 2b (admin user CRUD): listUsers additive — full CRUD deferred to Sprint 3.
 */
export const usersApi = {
  /**
   * Cập nhật hồ sơ của CHÍNH user (full_name). Server ép `WHERE id = self` (không chạm người khác).
   * Trả {ok}; caller refetch `/auth/me` để đồng bộ store. Dùng lại logoutResponseSchema = `{ ok: true }`.
   */
  updateProfile: (body: UpdateProfileRequest): Promise<LogoutResponse> =>
    apiFetch("/users/me", logoutResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * GET /users/admin — danh sách user (admin read-only, S2-FE-HR-3 P1).
   * Yêu cầu: manage:user permission (is_sensitive=false). Masking do server — client render gì nhận được.
   * Full CRUD (suspend/delete/role-assign) dành cho Sprint 3 (S3-FE-SYSTEM-USERS).
   * Route: AdminUsersController @Controller('users/admin') @Get() → GET /api/v1/users/admin.
   */
  listUsers: (query?: Partial<ListUsersQuery>): Promise<AdminUserListDto> => {
    const qs = buildQueryString(query ?? {});
    return apiFetch(`/users/admin${qs}`, adminUserListSchema);
  },
};
