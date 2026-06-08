import { z } from "zod";

/**
 * MediaOS — Platform Account contracts (🔒 G6-2 crown-jewel).
 *
 * Nguồn sự thật DTO cho `platform_accounts` reveal/edit flow.
 * BẤT BIẾN: schema phản hồi (masked) KHÔNG BAO GIỜ chứa cột secret/envelope
 * (secret_ciphertext / encrypted_dek / iv_nonce / auth_tag …) NOR recovery hint
 * (recovery_email / recovery_phone / two_factor_note) — khớp `SafePlatformAccountDto`
 * ở api (masking tại tầng query-projection, plan §6b). Plaintext chỉ qua /reveal.
 */

/** Phản hồi masked cho list/detail/create/update — khớp SafePlatformAccountDto (12 cột an toàn). */
export const safePlatformAccountSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  platformId: z.string().uuid(),
  accountName: z.string().nullable(),
  accountEmail: z.string().nullable(),
  accountIdentifier: z.string().nullable(),
  ownerUserId: z.string().uuid().nullable(),
  securityLevel: z.string().nullable(),
  status: z.string(),
  lastRotatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SafePlatformAccountDto = z.infer<typeof safePlatformAccountSchema>;

/**
 * Tạo tài khoản nền tảng — `secret` là plaintext mã hóa app-side (KHÔNG log, KHÔNG vào phản hồi).
 * recovery hint (recovery_email/phone, two_factor_note) là PII lưu plaintext nhưng KHÔNG vào DTO masked.
 */
export const createPlatformAccountSchema = z.object({
  platformId: z.string().uuid(),
  secret: z.string().min(1).max(8192),
  accountName: z.string().max(200).optional(),
  accountEmail: z.string().email().max(320).optional(),
  accountIdentifier: z.string().max(200).optional(),
  ownerUserId: z.string().uuid().optional(),
  securityLevel: z.string().max(40).optional(),
  recoveryEmail: z.string().email().max(320).optional(),
  recoveryPhone: z.string().max(40).optional(),
  twoFactorNote: z.string().max(1000).optional(),
});
export type CreatePlatformAccountRequest = z.infer<typeof createPlatformAccountSchema>;

/** Đổi secret (rotate-secret, is_sensitive) — DEK+nonce mới mỗi ghi. */
export const updatePlatformAccountSecretSchema = z.object({
  secret: z.string().min(1).max(8192),
});
export type UpdatePlatformAccountSecretRequest = z.infer<typeof updatePlatformAccountSecretSchema>;

/** Step-up (re-auth) — mint cửa sổ per-(userId, accountId). password bắt buộc; otp dành 2FA sau. */
export const reauthRequestSchema = z.object({
  accountId: z.string().uuid(),
  password: z.string().min(1),
  otp: z.string().optional(),
});
export type ReauthRequest = z.infer<typeof reauthRequestSchema>;

/** Phản hồi re-auth — thời điểm hết hạn cửa sổ (FE tính đếm ngược, KHÔNG cache plaintext). */
export const reauthResponseSchema = z.object({
  reauthValidUntil: z.string().datetime(),
});
export type ReauthResponse = z.infer<typeof reauthResponseSchema>;

/** Phản hồi reveal — plaintext trả MỘT LẦN, KHÔNG cache, KHÔNG re-list. */
export const revealSecretResponseSchema = z.object({
  secret: z.string(),
});
export type RevealSecretResponse = z.infer<typeof revealSecretResponseSchema>;

/** Query list — chặn DoS (q ≤ 200) + lọc uuid (mirror ListContentQueryDto fix FULL-gate G6-4). */
export const listPlatformAccountsQuerySchema = z.object({
  platformId: z.string().uuid().optional(),
  status: z.string().max(40).optional(),
  q: z.string().max(200).optional(),
});
export type ListPlatformAccountsQuery = z.infer<typeof listPlatformAccountsQuerySchema>;
