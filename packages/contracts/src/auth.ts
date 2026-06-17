import { z } from "zod";

/**
 * Auth DTO (G2-6) — nguồn sự thật cho api ↔ web. Login cần `companySlug` vì email chỉ unique theo
 * tenant (plan §3b): {companySlug,email} → resolve company → withTenant → tìm user.
 */

export const loginRequestSchema = z.object({
  companySlug: z.string().min(1).max(100),
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * FS-1a: refreshToken OPTIONAL — luồng SSO cookie đọc refresh token từ HttpOnly cookie (`mediaos_rt`),
 * KHÔNG gửi trong body. Luồng cũ (mobile / Bearer) vẫn gửi `refreshToken` trong body (tương thích ngược).
 */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/**
 * FS-1a: phản hồi refresh ở chế độ COOKIE — refresh token mới nằm trong HttpOnly cookie (đã xoay/rotation),
 * KHÔNG trả trong body (giữ refresh token NGOÀI tầm với của JS — chống XSS đánh cắp). Body chỉ mang access
 * token (in-memory) + TTL. Luồng cũ (body refreshToken) vẫn trả `authTokensSchema` đầy đủ (tương thích ngược).
 */
export const authRefreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AuthRefreshResponse = z.infer<typeof authRefreshResponseSchema>;

/** FS-1a: phản hồi logout — đăng xuất toàn cục (thu hồi cả họ refresh token + xoá cookie). */
export const logoutResponseSchema = z.object({ ok: z.literal(true) });
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;

/**
 * FS-1a: kiểm tra `?redirect` theo allowlist origin subdomain (chống open-redirect, rủi ro #11). `apps/auth`
 * (1b) gọi TRƯỚC khi điều hướng về app đích — server là nguồn allowlist duy nhất. `target` chỉ trả khi hợp lệ.
 */
export const redirectAllowedResponseSchema = z.object({
  allowed: z.boolean(),
  target: z.string().nullable(),
});
export type RedirectAllowedResponse = z.infer<typeof redirectAllowedResponseSchema>;

/**
 * FS-1a — HẰNG SỐ SSO cookie (CONTRACT cho `apps/auth` + `web-core`, chốt shape cho 1b).
 * - `REFRESH_COOKIE_NAME`: cookie HttpOnly chứa refresh token (JS KHÔNG đọc được).
 * - `CSRF_COOKIE_NAME`: cookie double-submit (JS ĐỌC được) — client phải echo qua header.
 * - `CSRF_HEADER_NAME`: header bắt buộc cho endpoint cookie-based (refresh/logout) — chống CSRF.
 */
export const REFRESH_COOKIE_NAME = "mediaos_rt" as const;
export const CSRF_COOKIE_NAME = "mediaos_csrf" as const;
export const CSRF_HEADER_NAME = "x-csrf-token" as const;

export const forgotPasswordRequestSchema = z.object({
  companySlug: z.string().min(1).max(100),
  email: z.string().email().max(255),
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** Cặp token trả về khi login/refresh. */
export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

/** DTO user công khai — TUYỆT ĐỐI không chứa password_hash (BẤT BIẾN #3). */
export const meResponseSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().nullable(),
  status: z.string(),
  /** Non-sensitive action:resourceType capabilities keyed for O(1) FE lookup. Wildcards included as-is. */
  capabilities: z.record(z.boolean()),
  /** true khi role ép 2FA (requires_two_factor) nhưng user CHƯA bật → FE buộc enroll (G16-1, AUTH-003). */
  mustSetupTwoFactor: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
