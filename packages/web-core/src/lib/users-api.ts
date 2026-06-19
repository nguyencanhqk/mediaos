import {
  logoutResponseSchema,
  type LogoutResponse,
  type UpdateProfileRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Users API client (Module 2a — self-service hồ sơ). Authenticated (apiFetch gắn Bearer mặc định).
 * Nền cho Module 2b (admin user CRUD) mở rộng sau.
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
};
