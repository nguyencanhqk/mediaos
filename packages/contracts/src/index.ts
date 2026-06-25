import { z } from "zod";

/**
 * MediaOS — Shared contracts (nguồn sự thật cho DTO giữa api ↔ web).
 * Mọi schema dùng chung khai báo ở đây bằng Zod, suy ra type bằng z.infer.
 */

/**
 * Envelope phản hồi API thống nhất (API-01 §11/§12).
 *
 * Success: { success:true, message, data, error:null, meta:{request_id,timestamp}, pagination? }
 * Error:   { success:false, message, data:null, error:{code,type,details}, meta:{request_id,timestamp} }
 *
 * BACK-COMPAT (S0-API-CORE-1): `error` GIỮ nullable ở CẢ HAI nhánh (success → error:null) để
 * web-core `unwrapEnvelope` (detect 3 key success/data/error) không phải đổi — api-client reshape
 * đầy đủ thuộc S0-FE-API-1.
 */
export const errorDetailSchema = z.object({
  field: z.string(),
  message: z.string(),
  rule: z.string().optional(),
});
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  /** Tên class exception (API-01 §12.1) — vd "ZodValidationException", "ForbiddenException". */
  type: z.string().optional(),
  /** Lỗi field-level (validation) — null/absent khi không áp dụng. */
  details: z.array(errorDetailSchema).nullable().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Meta đính kèm MỌI response — truy vết request (API-01 §11.2). */
export const responseMetaSchema = z.object({
  request_id: z.string(),
  timestamp: z.string(),
});
export type ResponseMeta = z.infer<typeof responseMetaSchema>;

/** Block phân trang RIÊNG (API-01 §16.1) — KHÔNG nằm trong `meta`. */
export const paginationSchema = z.object({
  page: z.number().int().positive(),
  per_page: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  total_pages: z.number().int().nonnegative(),
  has_next: z.boolean(),
  has_prev: z.boolean(),
});
export type Pagination = z.infer<typeof paginationSchema>;

/**
 * @deprecated Dùng `paginationSchema` (API-01 §16.1). Giữ lại để không phá consumer cũ.
 */
export const paginationMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** Bao phản hồi chuẩn: success + message + data (nullable) + error (nullable) + meta (bắt buộc) + pagination?. */
export function apiResponseSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.boolean(),
    message: z.string(),
    data: data.nullable(),
    error: apiErrorSchema.nullable(),
    meta: responseMetaSchema,
    pagination: paginationSchema.optional(),
  });
}

/** Placeholder version để verify wiring contracts ↔ api ↔ web. */
export const CONTRACTS_VERSION = "0.0.0" as const;

export * from "./auth";
// S2-AUTH-BE-3 (additive): auth admin subdir (user-admin + role/permission list). Đặt SAU flat auth.ts;
// TÊN export RIÊNG (auth*/AUTH_USER…) KHÔNG trùng auth.ts hay users.ts (AdminUser*) → không vỡ barrel.
export * from "./auth/index";
export * from "./users";
export * from "./two-factor";
export * from "./org";
export * from "./media";
export * from "./platform-accounts";
export * from "./workflow";
export * from "./approval";
export * from "./task";
export * from "./notification";
export * from "./foundation";
export * from "./chat";
export * from "./realtime";
export * from "./settings";
export * from "./positions";
export * from "./employees";
export * from "./attendance";
export * from "./leave";
export * from "./finance";
// S1-FND-FILE-1 File subsystem contracts (upload input / metadata / download-url / link DTOs)
export * from "./files";
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
// AI-1 AI Insight (read-only): tóm tắt KPI + chi phí ĐÃ MASK theo permission qua Claude API
export * from "./ai";
// S2-HR-BE-1 HR read-core contracts (list/detail/me-profile + lookups; sensitive fields server-masked)
export * from "./hr";
