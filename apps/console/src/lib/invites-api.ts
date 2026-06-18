import {
  createUserInviteResultSchema,
  pendingInvitesSchema,
  userInviteSchema,
  type CreateUserInviteRequest,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * CS-10 invites API client cho apps/console (Hệ thống — tenant plane, aud=user).
 *
 * Gate quyền (server ép): invite:user (mời), approve:user (xem hàng đợi + duyệt/từ chối). companyId
 * lấy từ JWT (server) — client KHÔNG gửi. `:id` ở approve/reject = invite id.
 */
export const consoleInvitesApi = {
  /** Hàng đợi: pending (Yêu cầu kích hoạt) + accepted (Chờ duyệt). */
  listPending: () => apiFetch("/users/pending", pendingInvitesSchema),

  /** Mời user (invite:user) — trả invite + emailSent (false ⇒ kiểm tra cấu hình SMTP). */
  invite: (data: CreateUserInviteRequest) =>
    apiFetch("/users/invite", createUserInviteResultSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Duyệt (approve:user) — tạo tài khoản ACTIVE. */
  approve: (id: string) => apiFetch(`/users/${id}/approve`, userInviteSchema, { method: "POST" }),

  /** Từ chối (approve:user). */
  reject: (id: string) => apiFetch(`/users/${id}/reject`, userInviteSchema, { method: "POST" }),
};
