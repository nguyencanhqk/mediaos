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
} as const;

/** Mã màn hình (SPEC-01 §9). */
export const FOUNDATION_SCREEN = {
  COMPANY: "SYSTEM-SCREEN-COMPANY",
  COMPANY_SETTINGS: "SYSTEM-SCREEN-COMPANY-SETTINGS",
  SYSTEM_SETTINGS: "SYSTEM-SCREEN-SETTINGS",
} as const;

/** Đường dẫn route (thêm ADDITIVE vào router + sidebar). */
export const FOUNDATION_PATH = {
  OVERVIEW: "/system",
  COMPANY: "/system/company",
  COMPANY_SETTINGS: "/system/company/settings",
  SYSTEM_SETTINGS: "/system/settings",
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
