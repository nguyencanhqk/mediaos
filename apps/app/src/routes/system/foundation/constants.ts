/**
 * Hằng quyền + cấu hình cho 3 màn System/Foundation (S2-FE-FND-1 · lane FND1-APP).
 *
 * Cặp quyền engine (action:resourceType) = seed THẬT mig 0435 (controller Foundation dùng *:foundation-*):
 *   - view:foundation-company / update:foundation-company  (company/current GET·PATCH)
 *   - view:foundation-setting / update:foundation-setting  (settings resolve · company-settings PATCH)
 *
 * KHÔNG dùng nhãn-ma FRONTEND-13 §7.1 (FOUNDATION.SYSTEM.VIEW / SETTING.SYSTEM_MANAGE chưa seed) và KHÔNG
 * namespace CŨ read/update:company (mig 0005). Đọc ≠ sửa (pair-as-gate). Đồng bộ PERMISSION_CODE_TO_PAIR
 * trong packages/web-core/src/lib/registry.ts (drift-guard spec chặn tái diễn pair-drift).
 */
export const FOUNDATION_ENGINE_PAIRS = {
  VIEW_COMPANY: { action: "view", resourceType: "foundation-company" },
  UPDATE_COMPANY: { action: "update", resourceType: "foundation-company" },
  VIEW_SETTING: { action: "view", resourceType: "foundation-setting" },
  UPDATE_SETTING: { action: "update", resourceType: "foundation-setting" },
  // S2-FE-FND-4 — Public Holidays. Cặp seed THẬT mig 0435 (is_sensitive=false cả 2 → wildcard OK, dùng useCan).
  VIEW_HOLIDAY: { action: "view", resourceType: "foundation-holiday" },
  MANAGE_HOLIDAY: { action: "manage", resourceType: "foundation-holiday" },
  // S2-FE-FND-4 — /system/health: KHÔNG có cặp 'foundation-health'/'system-health' seed ở BE (controller
  // HealthController @Public(), KHÔNG @RequirePermission — liveness/readiness probe cố ý mở, xem BE code).
  // done_when yêu cầu PermissionGate FOUNDATION.HEALTH.VIEW nhưng cặp đó CHƯA seed → dùng baseline "đang ở
  // khu vực quản trị hệ thống" GIỐNG HỆT system.overview (ROUTE_REGISTRY: FOUNDATION.SETTING.VIEW OR
  // AUTH.USER.VIEW) thay vì bịa cặp không tồn tại (gate phải phản ánh cặp THẬT — CLAUDE.md §5). Nếu BE seed
  // cặp foundation-health sau này, đổi route meta + đây cho khớp (KHÔNG đổi HealthController @Public()).
  VIEW_SETTING_BASELINE: { action: "view", resourceType: "foundation-setting" },
  // S2-FE-FND-6 — Retention Policies + File Access Logs. Cặp seed THẬT mig 0435 (S2-FND-BE-3):
  //   view:foundation-retention (KHÔNG sensitive, company-admin có sẵn) / manage:foundation-retention
  //   (is_sensitive=true — KHÔNG tự động cấp qua role seed, chỉ System-scope per-user → nút Sửa
  //   ẨN với company-admin thường, ĐÚNG thiết kế "confirm hậu quả rõ", KHÔNG phải bug FE).
  //   view:foundation-file-access-log (KHÔNG sensitive, company-admin có sẵn — viewer append-only).
  VIEW_RETENTION: { action: "view", resourceType: "foundation-retention" },
  MANAGE_RETENTION: { action: "manage", resourceType: "foundation-retention" },
  VIEW_FILE_ACCESS_LOG: { action: "view", resourceType: "foundation-file-access-log" },
} as const;

/** Mã màn hình (SPEC-01 §9). */
export const FOUNDATION_SCREEN = {
  COMPANY: "SYSTEM-SCREEN-COMPANY",
  COMPANY_SETTINGS: "SYSTEM-SCREEN-COMPANY-SETTINGS",
  SYSTEM_SETTINGS: "SYSTEM-SCREEN-SETTINGS",
  // S2-FE-FND-4 — FRONTEND-13 §7.1 UI-SYSTEM-SCREEN-012/016.
  PUBLIC_HOLIDAYS: "SYSTEM-SCREEN-PUBLIC-HOLIDAYS",
  HEALTH: "SYSTEM-SCREEN-HEALTH",
  // S2-FE-FND-6 — FRONTEND-13 §7.1 UI-SYSTEM-SCREEN-009/014.
  RETENTION: "SYSTEM-SCREEN-RETENTION",
  FILE_ACCESS_LOGS: "SYSTEM-SCREEN-FILE-ACCESS-LOGS",
} as const;

/** Đường dẫn route (thêm ADDITIVE vào router + sidebar). */
export const FOUNDATION_PATH = {
  OVERVIEW: "/system",
  COMPANY: "/system/company",
  COMPANY_SETTINGS: "/system/company/settings",
  SYSTEM_SETTINGS: "/system/settings",
  // S2-FE-FND-4
  PUBLIC_HOLIDAYS: "/system/public-holidays",
  HEALTH: "/system/health",
  // S2-FE-FND-6
  RETENTION: "/system/retention",
  FILE_ACCESS_LOGS: "/system/file-access-logs",
} as const;

/**
 * Danh sách key cấu hình công ty ĐÃ BIẾT để batch-resolve (POST /foundation/settings/resolve).
 * Đồng bộ SETTING_DEFAULTS (apps/api setting-defaults.ts) — chỉ key MVP công khai. Server precedence
 * company_settings → system_settings → default; value sensitive (nếu có) đã mask bởi server.
 */
export const KNOWN_SETTING_KEYS: readonly string[] = [
  "system.default_timezone",
  "system.default_locale",
  "file.max_upload_size_mb",
  "file.allowed_mime_types",
  "audit.default_retention_days",
] as const;

/**
 * Field hồ sơ công ty EDITABLE (allow-list) — read-only id/slug/status/companyCode KHÔNG nằm đây, cũng
 * KHÔNG bao giờ gửi company_id (server resolve từ AuthContext — BẤT BIẾN #1).
 */
export const COMPANY_EDITABLE_FIELDS = [
  "name",
  "shortName",
  "taxCode",
  "businessType",
  "address",
  "phone",
  "email",
  "website",
] as const;
export type CompanyEditableField = (typeof COMPANY_EDITABLE_FIELDS)[number];
