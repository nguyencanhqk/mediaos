import {
  loginResponseSchema,
  meResponseSchema,
  type LoginRequest,
  type LoginResponse,
  type MeResponse,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { getAccessToken } from "../stores/auth";

/**
 * Auth API client (G16-real-login). Thay thế mock G1.
 * - login: POST /auth/login → LoginResponse (AuthTokens | TwoFactorChallenge).
 * - me: GET /auth/me → MeResponse (user profile + capabilities + mustSetupTwoFactor).
 */
export const authApi = {
  /** Đăng nhập thật. Trả AuthTokens (2FA tắt) hoặc TwoFactorChallenge (2FA bật). */
  login: (body: LoginRequest): Promise<LoginResponse> =>
    apiFetch("/auth/login", loginResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Lấy profile + capabilities của user đã đăng nhập (cần access token). */
  me: (): Promise<MeResponse> => {
    const token = getAccessToken();
    return apiFetch("/auth/me", meResponseSchema, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
};
