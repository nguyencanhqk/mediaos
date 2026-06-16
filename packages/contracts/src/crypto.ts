import { z } from "zod";

/**
 * G6-2 PR-A — KMS / encryption-key provisioning contracts (BẤT BIẾN #3).
 *
 * `encryption_keys` (migration 0022) là REGISTRY khoá GLOBAL (no-RLS): mỗi hàng chỉ mang `kms_key_id`
 * (đường dẫn Vault transit, KHÔNG phải key material) + version + purpose + status. KHÔNG bao giờ có
 * trường `secret`/`key`/`dek`/`material` trong contract này — provisioning chỉ điều phối version, không
 * lộ bí mật. Schema chỉ phản ánh các cột AN TOÀN dùng được phía web (read-only registry view).
 *
 * Hai schema:
 *   - encryptionKeySchema          : DTO 1 hàng registry trả về (key_version, kms_key_id, purpose, status).
 *   - provisionKeyVersionInputSchema: input gọi provisionKeyVersion(purpose) — sinh key version mới 'active'
 *     + cũ → 'retiring'. `purpose` là enum khớp CHECK của bảng (`platform_account`/`auth_reset_token`).
 */

/** Purpose hợp lệ — khớp CHECK encryption_keys (migration 0022). KHÔNG gồm 'totp_secret' (chưa vào registry). */
export const encryptionKeyPurposeEnum = z.enum(["platform_account", "auth_reset_token"]);
export type EncryptionKeyPurpose = z.infer<typeof encryptionKeyPurposeEnum>;

/** Trạng thái 1 key version (khớp CHECK encryption_keys.status). */
export const encryptionKeyStatusEnum = z.enum(["active", "retiring", "revoked"]);
export type EncryptionKeyStatus = z.infer<typeof encryptionKeyStatusEnum>;

/**
 * DTO 1 hàng registry. `kmsKeyId` = Vault transit PATH (an toàn lộ — không phải key material).
 * TUYỆT ĐỐI không có field secret/key/dek/material ở đây.
 */
export const encryptionKeySchema = z.object({
  keyVersion: z.number().int().positive(),
  kmsKeyId: z.string().min(1),
  purpose: encryptionKeyPurposeEnum,
  status: encryptionKeyStatusEnum,
});
export type EncryptionKey = z.infer<typeof encryptionKeySchema>;

/** Input provisionKeyVersion — chỉ cần purpose; service tự đọc max(key_version) hiện tại để +1. */
export const provisionKeyVersionInputSchema = z.object({
  purpose: encryptionKeyPurposeEnum,
});
export type ProvisionKeyVersionInput = z.infer<typeof provisionKeyVersionInputSchema>;

/** Kết quả provisionKeyVersion — version mới sinh + version cũ vừa retiring (null nếu lần đầu). */
export const provisionKeyVersionResultSchema = z.object({
  purpose: encryptionKeyPurposeEnum,
  newKeyVersion: z.number().int().positive(),
  retiredKeyVersion: z.number().int().positive().nullable(),
});
export type ProvisionKeyVersionResult = z.infer<typeof provisionKeyVersionResultSchema>;

/**
 * G6-2 PR-B — break-glass emergency access contracts (BẤT BIẾN #3).
 *
 * Quyền truy cập KHẨN CẤP để reveal 1 platform_account secret, ép SoD 2-người duyệt KHÁC NHAU. Vòng đời:
 * request → approve (≥2 approver) → active → revoke, có TTL. TUYỆT ĐỐI KHÔNG field secret/key/dek/material
 * ở đây — grant chỉ trỏ `platformAccountId`; secret thật chỉ lộ JIT ở reveal-path (ROUND 2), audit từng lần.
 */

/** Ngưỡng SoD tối thiểu (khớp DB CHECK `required_approvals >= 2`). */
export const BREAK_GLASS_MIN_APPROVALS = 2;
/** Biên TTL hợp lệ cho 1 grant (giây): tối thiểu 5 phút, tối đa 24 giờ — đủ xử lý sự cố, không vô hạn. */
export const BREAK_GLASS_MIN_TTL_SECONDS = 300;
export const BREAK_GLASS_MAX_TTL_SECONDS = 86_400;

/** Trạng thái 1 grant break-glass (khớp CHECK break_glass_grants.status). */
export const breakGlassGrantStatusEnum = z.enum(["pending", "active", "revoked"]);
export type BreakGlassGrantStatus = z.infer<typeof breakGlassGrantStatusEnum>;

/** Input requestBreakGlass — mở 1 yêu cầu khẩn cấp trên 1 account, kèm lý do + TTL (giây). */
export const requestBreakGlassInputSchema = z.object({
  platformAccountId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
  ttlSeconds: z.number().int().min(BREAK_GLASS_MIN_TTL_SECONDS).max(BREAK_GLASS_MAX_TTL_SECONDS),
});
export type RequestBreakGlassInput = z.infer<typeof requestBreakGlassInputSchema>;

/** Input approveBreakGlass / revokeBreakGlass — chỉ cần id của grant. */
export const breakGlassGrantIdInputSchema = z.object({
  grantId: z.string().uuid(),
});
export type BreakGlassGrantIdInput = z.infer<typeof breakGlassGrantIdInputSchema>;

/**
 * DTO 1 grant break-glass trả về web/API. KHÔNG có secret/key — chỉ metadata vòng đời + số phiếu duyệt
 * đã thu (`approvalCount`) để UI hiển thị tiến độ SoD. `reason` là lý do nghiệp vụ (non-secret).
 */
export const breakGlassGrantSchema = z.object({
  id: z.string().uuid(),
  platformAccountId: z.string().uuid(),
  requesterUserId: z.string().uuid(),
  reason: z.string(),
  requiredApprovals: z.number().int().min(BREAK_GLASS_MIN_APPROVALS),
  approvalCount: z.number().int().nonnegative(),
  status: breakGlassGrantStatusEnum,
  expiresAt: z.coerce.date(),
  activatedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type BreakGlassGrantDto = z.infer<typeof breakGlassGrantSchema>;
