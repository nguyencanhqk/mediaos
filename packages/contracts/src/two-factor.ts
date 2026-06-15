import { z } from "zod";
import { authTokensSchema } from "./auth";

/**
 * 2FA TOTP contracts (G16-1, AUTH-003) — nguồn sự thật api ↔ web.
 */

/** Login trả về khi user ĐÃ bật 2FA: chưa có tokens, phải verify mã ở bước 2 với challengeToken. */
export const twoFactorChallengeSchema = z.object({
  twoFactorRequired: z.literal(true),
  challengeToken: z.string(),
});
export type TwoFactorChallenge = z.infer<typeof twoFactorChallengeSchema>;

/** Login response: tokens (2FA tắt) HOẶC challenge (2FA bật). FE phân biệt qua `twoFactorRequired`. */
export const loginResponseSchema = z.union([authTokensSchema, twoFactorChallengeSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Kết quả enroll — otpauthUri (QR) + recovery codes plaintext (HIỂN THỊ 1 LẦN). */
export const twoFactorEnrollResponseSchema = z.object({
  otpauthUri: z.string(),
  recoveryCodes: z.array(z.string()),
});
export type TwoFactorEnrollResponse = z.infer<typeof twoFactorEnrollResponseSchema>;

/** Xác nhận bật 2FA: nhập mã TOTP 6 số hiện tại. */
export const twoFactorEnableRequestSchema = z.object({
  token: z.string().min(6).max(10),
});
export type TwoFactorEnableRequest = z.infer<typeof twoFactorEnableRequestSchema>;

/** Bước 2 login: challengeToken (từ login) + mã (TOTP 6 số hoặc recovery code). */
export const twoFactorVerifyRequestSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(6).max(40),
});
export type TwoFactorVerifyRequest = z.infer<typeof twoFactorVerifyRequestSchema>;

/** Tắt 2FA: phải nhập lại mật khẩu (re-auth chống chiếm phiên). */
export const twoFactorDisableRequestSchema = z.object({
  password: z.string().min(1).max(200),
});
export type TwoFactorDisableRequest = z.infer<typeof twoFactorDisableRequestSchema>;

/** Trạng thái 2FA của user hiện tại. */
export const twoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  required: z.boolean(),
});
export type TwoFactorStatus = z.infer<typeof twoFactorStatusSchema>;
