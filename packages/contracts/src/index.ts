import { z } from "zod";

/**
 * MediaOS — Shared contracts (nguồn sự thật cho DTO giữa api ↔ web).
 * Mọi schema dùng chung khai báo ở đây bằng Zod, suy ra type bằng z.infer.
 */

/** Envelope phản hồi API thống nhất (xem patterns: API Response Format). */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const paginationMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** Bao phản hồi chuẩn: success + data (nullable on error) + error (nullable on success) + meta. */
export function apiResponseSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.boolean(),
    data: data.nullable(),
    error: apiErrorSchema.nullable(),
    meta: paginationMetaSchema.optional(),
  });
}

/** Placeholder version để verify wiring contracts ↔ api ↔ web. */
export const CONTRACTS_VERSION = "0.0.0" as const;

export * from "./auth";
export * from "./two-factor";
export * from "./org";
export * from "./media";
export * from "./platform-accounts";
export * from "./workflow";
export * from "./approval";
export * from "./task";
export * from "./notification";
export * from "./chat";
export * from "./realtime";
export * from "./settings";
export * from "./positions";
export * from "./employees";
export * from "./attendance";
export * from "./leave";
export * from "./finance";
export * from "./dashboard";
export * from "./evaluation";
export * from "./kpi";
export * from "./payroll";
export * from "./defect";
export * from "./meeting";
export * from "./permission";
export * from "./crypto";
// AC-5 API key / Personal Access Token (PAT)
export * from "./api-key";
// G16-3 SaaS prep
export * from "./platform";
export * from "./subscription";
export * from "./template";
// AC-7 module-registry (lớp module trên feature-flag — catalog system_modules)
export * from "./module-registry";
// AC-4 UI config (branding / navigation / i18n overrides — tenant self-service)
export * from "./ui-config";
// AC-6 Webhooks (tenant self-service — endpoint + subscription + delivery log; HMAC secret envelope-KMS)
export * from "./webhooks";
// AC-8 Observability (audit viewer + queue monitor — tenant self + operator cross-tenant read-only)
export * from "./observability";
// AC-9 db-ops (operator-only data browser tenant-scoped + migration status + break-glass SoD + export scaffold)
export * from "./db-ops-allowlist";
export * from "./db-ops";
// CS-7 Tình hình sử dụng (usage stats per tenant — login count, per-user last-login, task counters)
export * from "./usage";
// CS-8 Cấu hình mail server (SMTP, secret — per-tenant + per-app scope; password envelope-KMS)
export * from "./mail-config";
// CS-9 Bảo mật nâng cao (per-company security policy — IP/time/email-domain/2FA enforce at auth)
export * from "./security-policy";
// CS-10 Đối tượng: Mời / Duyệt / Kích hoạt user (invite token → accept → approve; email-domain at accept)
export * from "./user-invite";
