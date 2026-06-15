import {
  authTokensSchema,
  twoFactorEnrollResponseSchema,
  twoFactorStatusSchema,
  type AuthTokens,
  type TwoFactorEnrollResponse,
  type TwoFactorStatus,
} from "@mediaos/contracts";
import { z } from "zod";
import { apiFetch } from "./api-client";
import { getAccessToken } from "@/stores/auth";

/**
 * Thin client cho 2FA TOTP (G16-1, AUTH-003). Các endpoint authed gắn Bearer token từ auth store.
 * ⚠️ Token DORMANT cho tới khi real-login FE land — hiện login vẫn mock (G1). Khi đó các hàm này hoạt động.
 */

const okSchema = z.object({ ok: z.literal(true) });

/** Header Authorization cho endpoint cần đăng nhập. */
function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const twoFactorApi = {
  /** Trạng thái 2FA của user hiện tại (đã bật + có bị ép). */
  status: (): Promise<TwoFactorStatus> =>
    apiFetch("/auth/2fa/status", twoFactorStatusSchema, { headers: authHeaders() }),

  /** Bắt đầu enroll — trả otpauthUri (QR) + recovery codes (HIỂN THỊ 1 LẦN). */
  enroll: (): Promise<TwoFactorEnrollResponse> =>
    apiFetch("/auth/2fa/enroll", twoFactorEnrollResponseSchema, {
      method: "POST",
      headers: authHeaders(),
    }),

  /** Xác nhận bật: nhập mã TOTP hiện tại. */
  enable: (token: string): Promise<{ ok: true }> =>
    apiFetch("/auth/2fa/enable", okSchema, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ token }),
    }),

  /** Tắt 2FA — re-auth bằng mật khẩu. */
  disable: (password: string): Promise<{ ok: true }> =>
    apiFetch("/auth/2fa/disable", okSchema, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ password }),
    }),

  /** Bước 2 login (2FA bật): challengeToken + mã (TOTP/recovery) → tokens. @Public (chưa có access token). */
  verifyLogin: (challengeToken: string, code: string): Promise<AuthTokens> =>
    apiFetch("/auth/2fa/verify", authTokensSchema, {
      method: "POST",
      body: JSON.stringify({ challengeToken, code }),
    }),
};
