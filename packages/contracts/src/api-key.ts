import { z } from "zod";

/**
 * AC-5 API key / Personal Access Token (PAT) DTOs — nguồn sự thật cho contract api ↔ admin.
 *
 * BẤT BIẾN #3 (không secret plaintext):
 *   - DTO list/summary KHÔNG bao giờ chứa `tokenHash` / token plaintext — chỉ `tokenPrefix` (vài ký tự
 *     đầu để nhận diện) + metadata. Token plaintext (`mok_<...>`) chỉ trả MỘT LẦN ở `createApiKeyResponse`
 *     ngay khi tạo, server KHÔNG lưu plaintext, KHÔNG log, KHÔNG vào audit detail.
 *   - `scopePermissionIds` trỏ permission catalog (uuid[]), KHÔNG `text[]` tự do.
 *
 * Fail-closed (PermissionGuard mở rộng): quyền hiệu lực của PAT = scopePermissionIds ∩ grant THỰC của user.
 */

/** Trạng thái dẫn xuất của 1 PAT (suy từ revoked_at / expires_at — KHÔNG lưu cột status). */
export const apiKeyStatusEnum = z.enum(["active", "expired", "revoked"]);
export type ApiKeyStatus = z.infer<typeof apiKeyStatusEnum>;

/**
 * DTO 1 PAT cho màn list (KHÔNG token_hash / plaintext). `tokenPrefix` = vài ký tự đầu (vd `mok_ab12`)
 * để người dùng nhận diện key. `lastUsedAt` null nếu chưa dùng. `status` dẫn xuất ở server.
 */
export const apiKeySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tokenPrefix: z.string(),
  scopePermissionIds: z.array(z.string().uuid()),
  status: apiKeyStatusEnum,
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ApiKeyDto = z.infer<typeof apiKeySchema>;

/**
 * POST /api-keys — body tạo PAT. `scopePermissionIds` = tập permission catalog mà key được phép dùng;
 * server còn ép thêm ⊆ grant THỰC của user lúc tạo (không cho mint key vượt quyền user). `expiresAt`
 * null/absent = key không hết hạn (revoke tay).
 */
export const createApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(120),
  scopePermissionIds: z.array(z.string().uuid()).min(1).max(100),
  /** ISO datetime; null/absent = không hết hạn. */
  expiresAt: z.string().datetime().nullable().optional(),
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;

/**
 * Response khi TẠO PAT — chứa `token` plaintext ĐÚNG 1 LẦN (client tự lưu, server không giữ). Tách schema
 * riêng khỏi `apiKeySchema` để token plaintext KHÔNG bao giờ lọt vào DTO list. Phần `apiKey` = DTO an toàn.
 */
export const createApiKeyResponseSchema = z.object({
  /** Plaintext token `mok_<...>` — chỉ hiển thị 1 lần, KHÔNG thể lấy lại. */
  token: z.string(),
  apiKey: apiKeySchema,
});
export type CreateApiKeyResponse = z.infer<typeof createApiKeyResponseSchema>;

/**
 * 1 scope mà actor được phép gán cho PAT (= permission catalog entry ∩ grant THỰC của actor). FE dùng để
 * render bộ chọn scope; chọn id nào → đưa vào createApiKeyRequest.scopePermissionIds. BE vẫn ép lại ⊆ grant.
 */
export const apiKeyScopeSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  resourceType: z.string(),
  isSensitive: z.boolean(),
});
export type ApiKeyScopeDto = z.infer<typeof apiKeyScopeSchema>;

/** Prefix phân biệt PAT của MediaOS với access token JWT (ApiKeyAuthGuard chỉ xử lý token bắt đầu bằng đây). */
export const API_KEY_TOKEN_PREFIX = "mok_" as const;
