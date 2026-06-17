import {
  loginResponseSchema,
  meResponseSchema,
  redirectAllowedResponseSchema,
  type LoginRequest,
  type LoginResponse,
  type MeResponse,
  type RedirectAllowedResponse,
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
};
