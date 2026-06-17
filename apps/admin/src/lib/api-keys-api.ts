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
import { apiFetch } from "./api-client";

/**
 * AC-5 API key / PAT API client (self-service company-admin).
 *
 * Mọi route gate `manage:api-key` (is_sensitive) ở BE + chạy withTenant(actor.companyId). companyId trên
 * path `/tenant/:companyId/api-keys` chỉ self-scope điều hướng UI — BE ép tenant theo token của user.
 *
 * Hợp đồng route (api-keys.controller.ts):
 *   - GET  /api-keys            → danh sách PAT (DTO an toàn — KHÔNG token material).
 *   - POST /api-keys            → tạo PAT (trả { token, apiKey }; token chỉ hiển thị 1 lần).
 *   - POST /api-keys/:id/revoke → thu hồi PAT (trả DTO đã revoke).
 */
export const apiKeysApi = {
  /** GET /api-keys — danh sách PAT của tenant. */
  list: (): Promise<ApiKeyDto[]> => apiFetch("/api-keys", z.array(apiKeySchema)),

  /** GET /api-keys/scopes — scope actor được phép gán cho PAT (catalog ∩ grant actor). */
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
