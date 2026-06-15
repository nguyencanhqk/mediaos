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
