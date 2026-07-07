/**
 * S2-FND-CONTRACT-1 — FOUNDATION-ERR-* catalog (SPEC-01 §9 `MODULE-ERR-XXX`).
 *
 * NGUỒN SỰ THẬT DTO (CLAUDE.md §4): mã lỗi nghiệp vụ của các service FOUNDATION (company / setting /
 * audit / module-catalog / holiday / retention) sống Ở ĐÂY — apps/api import LẠI (KHÔNG khai báo mã cục
 * bộ để tránh drift, giống `FOUNDATION_FILE_ERROR_CODES` ở files.ts).
 *
 * APPEND-ONLY: thêm mã mới ở CUỐI nhóm, KHÔNG đổi/xoá chuỗi mã đã có (client bắt theo `error.code`).
 *
 * RANH GIỚI (chốt S2-FND-CONTRACT-1):
 *  - Guard-level 403 (PermissionGuard) GIỮ `AUTH-ERR-FORBIDDEN` — KHÔNG dùng mã ở đây.
 *  - ForbiddenException do SERVICE tự ném theo business-rule (vd company-suspended, module core-lock) mới
 *    mang mã FOUNDATION-ERR-*.
 *  - Lỗi 422 do `validation_schema` (setting.service.assertSchema) GIỮ `VALIDATION-ERR-*` (KHÔNG đổi) để
 *    web-core `mapStatusToErrorKind` prefix-match `code.startsWith('VALIDATION-ERR')` không vỡ.
 *
 * File-domain (`file_links`) có catalog RIÊNG `FOUNDATION_FILE_ERROR_CODES` (files.ts) — KHÔNG gộp vào đây.
 */
export const FOUNDATION_ERROR_CODES = {
  // ── Company (company.service + company-status) ──
  /** 404 — company của tenant không tồn tại / đã soft-delete (fail-closed, KHÔNG 500). */
  COMPANY_NOT_FOUND: "FOUNDATION-ERR-COMPANY-NOT-FOUND",
  /** 403 (service-level business rule) — company Suspended ⇒ chặn GHI (BACKEND-04 §8.1 rule 1). */
  COMPANY_SUSPENDED: "FOUNDATION-ERR-COMPANY-SUSPENDED",

  // ── Setting (setting.service — 400/404; 422 validation_schema GIỮ VALIDATION-ERR-*) ──
  /** 404 — system_setting theo key không tồn tại. */
  SETTING_NOT_FOUND: "FOUNDATION-ERR-SETTING-NOT-FOUND",
  /** 400 — value không khớp value_type khai báo (assertValueType). */
  SETTING_VALUE_TYPE: "FOUNDATION-ERR-SETTING-VALUE-TYPE",
  /** 400 — không xác định được value_type cho key (thiếu dto/existing/system/default). */
  SETTING_VALUE_TYPE_UNKNOWN: "FOUNDATION-ERR-SETTING-VALUE-TYPE-UNKNOWN",
  /** 400 — sticky secret guard: không cho đổi value_type của setting nhạy cảm ra khỏi SecretRef. */
  SETTING_SECRET_STICKY: "FOUNDATION-ERR-SETTING-SECRET-STICKY",

  // ── Audit (audit.service) ──
  /** 404 — audit log không tồn tại (hoặc thuộc tenant khác — RLS ẩn). */
  AUDIT_NOT_FOUND: "FOUNDATION-ERR-AUDIT-NOT-FOUND",

  // ── Module catalog (module-catalog.service + module-toggle.service) ──
  /** 404 — module code không tồn tại / đã soft-delete. */
  MODULE_NOT_FOUND: "FOUNDATION-ERR-MODULE-NOT-FOUND",
  /** 400 — module lõi (7 module MVP) KHÓA CỨNG, không thể bật/tắt. */
  MODULE_CORE_LOCKED: "FOUNDATION-ERR-MODULE-CORE-LOCKED",

  // ── Holiday (holidays.service) ──
  /** 404 — ngày nghỉ không tồn tại cho tenant. */
  HOLIDAY_NOT_FOUND: "FOUNDATION-ERR-HOLIDAY-NOT-FOUND",
  /** 409 — trùng (mã + ngày) trong công ty (unique violation). */
  HOLIDAY_DUPLICATE: "FOUNDATION-ERR-HOLIDAY-DUPLICATE",

  // ── Retention (retention.service) ──
  /** 404 — chính sách lưu trữ id không tồn tại cho tenant. */
  RETENTION_POLICY_NOT_FOUND: "FOUNDATION-ERR-RETENTION-POLICY-NOT-FOUND",
} as const;

export type FoundationErrorCode =
  (typeof FOUNDATION_ERROR_CODES)[keyof typeof FOUNDATION_ERROR_CODES];
