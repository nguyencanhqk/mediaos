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

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

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
});
export type MeResponse = z.infer<typeof meResponseSchema>;
