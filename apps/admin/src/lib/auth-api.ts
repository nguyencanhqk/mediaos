import {
  loginResponseSchema,
  meResponseSchema,
  type LoginRequest,
  type LoginResponse,
  type MeResponse,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Auth API client (operator). Port từ apps/web — nhưng `me()` KHÔNG còn gắn Bearer tay
 * vì `apiFetch` tự gắn token từ store (xem api-client.ts).
 *
 * AC-0b sẽ siết: token `aud=operator`, 2FA bắt buộc cho platform-admin, step-up.
 */
export const authApi = {
  /** Đăng nhập. Trả AuthTokens (2FA tắt) hoặc TwoFactorChallenge (2FA bật → hoàn thiện ở AC-0b). */
  login: (body: LoginRequest): Promise<LoginResponse> =>
    apiFetch("/auth/login", loginResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** Lấy profile + capabilities của user đã đăng nhập (Bearer tự gắn). */
  me: (): Promise<MeResponse> => apiFetch("/auth/me", meResponseSchema),
};
