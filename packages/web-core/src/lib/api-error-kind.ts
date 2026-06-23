/**
 * api-error-kind.ts — Phân loại lỗi API (FRONTEND-04 §10).
 *
 * Phân loại lỗi từ HTTP status + error code/type thành `ApiErrorKind` dùng chung
 * cho error-mapper và retry policy. Tách ra module riêng để không tạo circular
 * dependency giữa api-client.ts và error-mapper.ts.
 */

// ── Error kind enum ───────────────────────────────────────────────────────────

export type ApiErrorKind =
  | "NETWORK"
  | "UNAUTHENTICATED"
  | "TOKEN_EXPIRED"
  | "FORBIDDEN"
  | "SCOPE_DENIED"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "BUSINESS_RULE"
  | "RATE_LIMIT"
  | "SERVER"
  | "MAINTENANCE"
  | "UNKNOWN";

// ── Mapping HTTP status → kind ────────────────────────────────────────────────

/**
 * Map HTTP status code + BE error code/type → ApiErrorKind (FRONTEND-04 §10.2).
 *
 * §3.2 DEVIATION vs FRONTEND-04 §10.2: BE `httpStatusToCode` maps BOTH 400 AND 422
 * → `VALIDATION-ERR-001`. So we check code.startsWith('VALIDATION-ERR') / Zod type
 * BEFORE the status===422→BUSINESS_RULE branch. This ensures 422+VALIDATION-ERR-001
 * yields kind=VALIDATION (not BUSINESS_RULE). The 422+BusinessRuleError branch is
 * kept as forward-compat for future business-rule modules.
 *
 * TOKEN_EXPIRED and SCOPE_DENIED codes are forward-compat (BE does not emit them yet
 * — apps/api/src/common/errors/error-codes.ts only emits AUTH-ERR-UNAUTHENTICATED /
 * AUTH-ERR-FORBIDDEN). They fall through correctly via status (401→UNAUTHENTICATED,
 * 403→FORBIDDEN) when BE does not send those specific codes.
 */
export function mapStatusToErrorKind(status: number, code?: string, type?: string): ApiErrorKind {
  // 401 variants (forward-compat: TOKEN_EXPIRED not emitted by BE yet)
  if (status === 401 && code === "AUTH-ERR-TOKEN-EXPIRED") return "TOKEN_EXPIRED";
  if (status === 401) return "UNAUTHENTICATED";

  // 403 variants (forward-compat: SCOPE_DENIED not emitted by BE yet)
  if (status === 403 && code === "AUTH-ERR-SCOPE-DENIED") return "SCOPE_DENIED";
  if (status === 403) return "FORBIDDEN";

  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";

  // §3.2: check VALIDATION-ERR code prefix + Zod type BEFORE status===422→BUSINESS_RULE
  // BE maps both 400 and 422 → VALIDATION-ERR-001; this must win over the status branch.
  if (code?.startsWith("VALIDATION-ERR") || type === "ZodValidationException") {
    return "VALIDATION";
  }

  // 422 + explicit BusinessRuleError type → BUSINESS_RULE (future modules)
  if (status === 422 && type === "BusinessRuleError") return "BUSINESS_RULE";
  // 422 without specific code or type → VALIDATION (BE sends VALIDATION-ERR-001 by default)
  if (status === 422) return "VALIDATION";

  if (status === 429) return "RATE_LIMIT";
  if (status === 503) return "MAINTENANCE";
  if (status >= 500) return "SERVER";

  // Remaining 400 without VALIDATION-ERR code → VALIDATION
  if (status === 400) return "VALIDATION";

  return "UNKNOWN";
}

/**
 * Parse body lỗi từ ApiErrorPayload (envelope chuẩn) và sinh ApiErrorKind.
 * Dùng khi đã có structured payload (error.code, error.type) từ response JSON.
 */
export function kindFromPayload(
  status: number,
  errorPayload?: { code?: string; type?: string },
): ApiErrorKind {
  return mapStatusToErrorKind(status, errorPayload?.code, errorPayload?.type);
}
