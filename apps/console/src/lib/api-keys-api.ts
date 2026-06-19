import { z } from "zod";
import {
  apiKeyScopeSchema,
  apiKeySchema,
  createApiKeyRequestSchema,
  createApiKeyResponseSchema,
  type ApiKeyDto,
  type ApiKeyScopeDto,
  type CreateApiKeyRequest,
  type CreateApiKeyResponse,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * AC-5 API key / PAT API client cho apps/console (Hệ thống — tenant self-service, aud=user).
 *
 * Mọi route gate `manage:api-key` (is_sensitive) ở BE + chạy withTenant(actor.companyId) — KHÔNG cross-tenant.
 * FE chỉ ẩn/hiện affordance. Token plaintext trả về CHỈ 1 LẦN ở response create (state local, không lưu/log).
 *
 * Hợp đồng route (api-keys.controller.ts, dưới global prefix /api/v1):
 *   - GET  /api-keys            → danh sách PAT (DTO an toàn — KHÔNG token material).
 *   - GET  /api-keys/scopes     → scope actor được phép gán (catalog ∩ grant actor).
 *   - POST /api-keys            → tạo PAT (trả { token, apiKey }; token chỉ hiển thị 1 lần).
 *   - POST /api-keys/:id/revoke → thu hồi PAT (trả DTO đã revoke).
 */
export const apiKeysApi = {
  /** GET /api-keys — danh sách PAT của tenant. */
  list: (): Promise<ApiKeyDto[]> => apiFetch("/api-keys", z.array(apiKeySchema)),

  /** GET /api-keys/scopes — scope actor được phép gán cho PAT. */
  scopes: (): Promise<ApiKeyScopeDto[]> => apiFetch("/api-keys/scopes", z.array(apiKeyScopeSchema)),

  /** POST /api-keys — tạo PAT mới. Response chứa token plaintext (hiển thị 1 lần). */
  create: (body: CreateApiKeyRequest): Promise<CreateApiKeyResponse> => {
    const validated = createApiKeyRequestSchema.parse(body);
    return apiFetch("/api-keys", createApiKeyResponseSchema, {
      method: "POST",
      body: JSON.stringify(validated),
    });
  },

  /** POST /api-keys/:id/revoke — thu hồi 1 PAT. */
  revoke: (id: string): Promise<ApiKeyDto> =>
    apiFetch(`/api-keys/${id}/revoke`, apiKeySchema, { method: "POST" }),
};
