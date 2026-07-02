import { z } from "zod";
import {
  loginResponseSchema,
  logoutResponseSchema,
  meResponseSchema,
  redirectAllowedResponseSchema,
  sessionListItemSchema,
  sessionRevokeResponseSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type LoginResponse,
  type LogoutResponse,
  type MeResponse,
  type RedirectAllowedResponse,
  type SessionListItem,
  type SessionRevokeResponse,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { getAccessToken } from "../stores/auth";

/**
 * Auth API client (G16-real-login). Thay thế mock G1.
 * - login: POST /auth/login → LoginResponse (AuthTokens | TwoFactorChallenge).
 * - me: GET /auth/me → MeResponse (user profile + capabilities + mustSetupTwoFactor).
 */
export const authApi = {
  /**
   * Đăng nhập thật. Trả AuthTokens (2FA tắt) hoặc TwoFactorChallenge (2FA bật). @Public + skipAuth: KHÔNG gắn
   * Bearer phiên cũ, và 401 (sai mật khẩu) KHÔNG kích hoạt refresh-on-401 (sẽ thành vòng lặp/redirect oan ở
   * apps/auth — chưa có phiên để refresh). Login thành công → server đặt refresh+CSRF cookie (web-core SSO).
   */
  login: (body: LoginRequest): Promise<LoginResponse> =>
    apiFetch(
      "/auth/login",
      loginResponseSchema,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
      { skipAuth: true },
    ),

  /** Lấy profile + capabilities của user đã đăng nhập (cần access token). */
  me: (): Promise<MeResponse> => {
    const token = getAccessToken();
    return apiFetch("/auth/me", meResponseSchema, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },

  /**
   * Đổi mật khẩu khi ĐÃ đăng nhập (self-service, Module 2a). Authenticated (KHÔNG skipAuth — gắn Bearer).
   * Server re-auth bằng mật khẩu hiện tại + thu hồi MỌI phiên (refresh token) khi thành công ⇒ caller PHẢI
   * `logoutSession()` để đăng xuất + điều hướng về /login (đăng nhập lại bằng mật khẩu mới).
   */
  changePassword: (body: ChangePasswordRequest): Promise<LogoutResponse> =>
    apiFetch("/auth/change-password", logoutResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * FS-1b — hỏi server `?redirect` có nằm trong allowlist origin không (chống open-redirect). apps/auth gọi
   * SAU khi đăng nhập, TRƯỚC khi `window.location` về app đích. Server là nguồn allowlist DUY NHẤT — client
   * KHÔNG tự phán. @Public → skipAuth (apps/auth chưa giữ access token in-memory; phiên ở cookie).
   */
  checkRedirect: (redirect: string | null | undefined): Promise<RedirectAllowedResponse> =>
    apiFetch(
      `/auth/redirect-allowed?redirect=${encodeURIComponent(redirect ?? "")}`,
      redirectAllowedResponseSchema,
      undefined,
      { skipAuth: true },
    ),

  // ── S2-AUTH-BE-7 — session self-service (Own scope, CHỈ Authenticated — KHÔNG permission pair riêng,
  //    giống pattern /auth/me. `is_current` do SERVER đánh dấu từ jti access-token của request). ──────

  /** GET /auth/sessions — phiên ACTIVE của CHÍNH user (KHÔNG lộ token/hash — BẤT BIẾN #3). */
  listSessions: (): Promise<SessionListItem[]> =>
    apiFetch("/auth/sessions", z.array(sessionListItemSchema)),

  /** POST /auth/sessions/:id/revoke — thu hồi 1 phiên của CHÍNH user (owner-check ở service). */
  revokeSession: (id: string): Promise<SessionRevokeResponse> =>
    apiFetch(`/auth/sessions/${id}/revoke`, sessionRevokeResponseSchema, { method: "POST" }),

  /** POST /auth/sessions/revoke-others — thu hồi MỌI phiên khác, GIỮ phiên hiện tại (từ jti request). */
  revokeOtherSessions: (): Promise<SessionRevokeResponse> =>
    apiFetch("/auth/sessions/revoke-others", sessionRevokeResponseSchema, { method: "POST" }),
};
