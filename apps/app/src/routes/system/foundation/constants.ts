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
  // S2-FE-FND-8 — /system/settings (System Settings admin, UI-SYSTEM-SCREEN-004). Cặp seed THẬT mig
  // 0435:343 (system-manage:foundation-setting, is_sensitive=TRUE) — GATE DUY NHẤT cho CẢ đọc lẫn sửa (BE
  // KHÔNG tách view/manage cho system-scope, xem docs/plans/S2-FND-SYSSET-1.md RECONCILE DECISION).
  // company-admin thường KHÔNG có (chỉ per-user cấp tường minh) — ĐÚNG thiết kế, không phải bug FE.
  SYSTEM_MANAGE_SETTING: { action: "system-manage", resourceType: "foundation-setting" },
  // S5-FND-JOBS-OBS-1 — /system/jobs (System Jobs observability, READ-ONLY). Cặp seed THẬT mig 0435:365
  // (view:foundation-job, KHÔNG sensitive — company-admin có sẵn qua bulk-grant). `run:foundation-job`
  // (is_sensitive=true, mig 0435:366) tồn tại trong catalog NHƯNG KHÔNG có endpoint/nút trigger ở FE
  // (out-of-scope WO này — BE SystemJobsController chỉ có route GET).
  VIEW_JOB: { action: "view", resourceType: "foundation-job" },
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
  // S5-FND-JOBS-OBS-1
  SYSTEM_JOBS: "SYSTEM-SCREEN-JOBS",
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
  // S5-FND-JOBS-OBS-1
  SYSTEM_JOBS: "/system/jobs",
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

// ---------------------------------------------------------------------------
// S2-FE-FND-7 (H8 + §7) — NGUỒN CHUNG cặp quyền cho route meta + sidebar entry.
//
// Bài học pair-drift (S1-FND-MODULE / S3-FE-wave2): sidebar và route-meta gõ literal
// RỜI NHAU → dễ lệch cặp → hố "FE hiện / BE 403" hoặc "ẩn nhầm". Ở đây route meta (router.tsx)
// VÀ sidebar entry (sidebar-registry.ts) CÙNG import 1 nguồn = FOUNDATION_ENGINE_PAIRS, chống drift.
// Spec registry-guard khẳng định sidebar.requiredAnyPermissions === route-meta.requiredAnyPermissions.
// ---------------------------------------------------------------------------
import { type RouteMeta } from "@mediaos/web-core";
import { SYSTEM_ENGINE_PAIRS } from "../constants";

type EnginePair = { action: string; resourceType: string };

/** Cặp engine → chuỗi quyền literal "action:resourceType" (khớp thẳng capabilities map /auth/me). */
export function foundationPairToPermission(pair: EnginePair): string {
  return `${pair.action}:${pair.resourceType}`;
}

// Chuỗi quyền dẫn xuất từ FOUNDATION_ENGINE_PAIRS (KHÔNG literal magic-string).
export const FOUNDATION_HOLIDAY_VIEW_PERMISSION = foundationPairToPermission(
  FOUNDATION_ENGINE_PAIRS.VIEW_HOLIDAY,
);
export const FOUNDATION_RETENTION_VIEW_PERMISSION = foundationPairToPermission(
  FOUNDATION_ENGINE_PAIRS.VIEW_RETENTION,
);
export const FOUNDATION_FILE_ACCESS_LOG_VIEW_PERMISSION = foundationPairToPermission(
  FOUNDATION_ENGINE_PAIRS.VIEW_FILE_ACCESS_LOG,
);
// S5-FND-JOBS-OBS-1
export const FOUNDATION_JOB_VIEW_PERMISSION = foundationPairToPermission(
  FOUNDATION_ENGINE_PAIRS.VIEW_JOB,
);

/**
 * requiredAnyPermissions cho MỖI route/sidebar — 1 mảng DUY NHẤT dùng chung cả router + sidebar.
 * Health: ĐỦ CẢ 2 cặp (view:foundation-setting + view:user) khớp systemHealthMeta gốc — 1 cặp = mismatch.
 * Retention: view:foundation-retention (KHÔNG dùng manage — manage sensitive, ẩn nhầm với company-admin thường).
 */
export const FOUNDATION_HOLIDAY_ROUTE_PERMISSIONS: string[] = [FOUNDATION_HOLIDAY_VIEW_PERMISSION];
export const FOUNDATION_HEALTH_ROUTE_PERMISSIONS: string[] = [
  foundationPairToPermission(FOUNDATION_ENGINE_PAIRS.VIEW_SETTING_BASELINE),
  foundationPairToPermission(SYSTEM_ENGINE_PAIRS.READ_USER),
];
export const FOUNDATION_RETENTION_ROUTE_PERMISSIONS: string[] = [
  FOUNDATION_RETENTION_VIEW_PERMISSION,
];
export const FOUNDATION_FILE_ACCESS_LOG_ROUTE_PERMISSIONS: string[] = [
  FOUNDATION_FILE_ACCESS_LOG_VIEW_PERMISSION,
];
// S5-FND-JOBS-OBS-1
export const FOUNDATION_JOB_ROUTE_PERMISSIONS: string[] = [FOUNDATION_JOB_VIEW_PERMISSION];

/**
 * S2-FE-FND-8 — /system/settings. Dùng dot-code "FOUNDATION.SETTING.SYSTEM_MANAGE" (KHÔNG derive qua
 * foundationPairToPermission như FND-4/6) để khớp namespace dot-code sẵn có của 2 màn sibling (system.company /
 * system.company-settings) + FRONTEND-13 §224 — mapped qua PERMISSION_CODE_TO_PAIR (packages/web-core/src/lib/
 * registry.ts) sang cặp engine THẬT system-manage:foundation-setting. Route-meta VÀ sidebar entry CÙNG dùng
 * hằng này (chống pair-drift).
 */
export const FOUNDATION_SYSTEM_SETTINGS_MANAGE_PERMISSION = "FOUNDATION.SETTING.SYSTEM_MANAGE";
export const FOUNDATION_SYSTEM_SETTINGS_ROUTE_PERMISSIONS: string[] = [
  FOUNDATION_SYSTEM_SETTINGS_MANAGE_PERMISSION,
];

/**
 * RouteMeta 4 màn đã wired sẵn (S2-FE-FND-4/6) — CHUYỂN về constants để router.tsx VÀ sidebar dùng
 * chung nguồn requiredAnyPermissions (chống pair-drift). KHÔNG định nghĩa lại route (createRoute vẫn ở
 * router.tsx) — chỉ tập trung meta. Không set order/showInSidebar (giữ nguyên hành vi meta gốc).
 */
export const SYSTEM_PUBLIC_HOLIDAYS_ROUTE_META: RouteMeta = {
  routeKey: "system.public-holidays",
  path: FOUNDATION_PATH.PUBLIC_HOLIDAYS,
  layout: "MODULE_WORKSPACE",
  moduleCode: "FOUNDATION",
  screenCode: FOUNDATION_SCREEN.PUBLIC_HOLIDAYS,
  titleKey: "routeTitle.systemPublicHolidays",
  requiredAnyPermissions: FOUNDATION_HOLIDAY_ROUTE_PERMISSIONS,
};

export const SYSTEM_HEALTH_ROUTE_META: RouteMeta = {
  routeKey: "system.health",
  path: FOUNDATION_PATH.HEALTH,
  layout: "MODULE_WORKSPACE",
  moduleCode: "FOUNDATION",
  screenCode: FOUNDATION_SCREEN.HEALTH,
  titleKey: "routeTitle.systemHealth",
  requiredAnyPermissions: FOUNDATION_HEALTH_ROUTE_PERMISSIONS,
};

export const SYSTEM_RETENTION_ROUTE_META: RouteMeta = {
  routeKey: "system.retention",
  path: FOUNDATION_PATH.RETENTION,
  layout: "MODULE_WORKSPACE",
  moduleCode: "FOUNDATION",
  screenCode: FOUNDATION_SCREEN.RETENTION,
  titleKey: "routeTitle.systemRetention",
  requiredAnyPermissions: FOUNDATION_RETENTION_ROUTE_PERMISSIONS,
};

export const SYSTEM_FILE_ACCESS_LOGS_ROUTE_META: RouteMeta = {
  routeKey: "system.file-access-logs",
  path: FOUNDATION_PATH.FILE_ACCESS_LOGS,
  layout: "MODULE_WORKSPACE",
  moduleCode: "FOUNDATION",
  screenCode: FOUNDATION_SCREEN.FILE_ACCESS_LOGS,
  titleKey: "routeTitle.systemFileAccessLogs",
  requiredAnyPermissions: FOUNDATION_FILE_ACCESS_LOG_ROUTE_PERMISSIONS,
};

/**
 * S5-FND-JOBS-OBS-1 — /system/jobs (System Jobs observability, READ-ONLY). Gate = cặp seed THẬT mig 0435
 * (view:foundation-job — KHÔNG sensitive). route-meta VÀ sidebar entry CÙNG dùng hằng này (chống pair-drift,
 * cùng pattern S2-FE-FND-7).
 */
export const SYSTEM_JOBS_ROUTE_META: RouteMeta = {
  routeKey: "system.jobs",
  path: FOUNDATION_PATH.SYSTEM_JOBS,
  layout: "MODULE_WORKSPACE",
  moduleCode: "FOUNDATION",
  screenCode: FOUNDATION_SCREEN.SYSTEM_JOBS,
  titleKey: "routeTitle.systemJobs",
  requiredAnyPermissions: FOUNDATION_JOB_ROUTE_PERMISSIONS,
};

/**
 * S2-FE-FND-8 — /system/settings (System Settings admin, thay placeholder DEFER). router.tsx VÀ sidebar
 * đều import hằng NÀY (KHÔNG gõ lại requiredAnyPermissions rời) → chống pair-drift.
 */
export const SYSTEM_SETTINGS_ROUTE_META: RouteMeta = {
  routeKey: "system.settings",
  path: FOUNDATION_PATH.SYSTEM_SETTINGS,
  layout: "MODULE_WORKSPACE",
  moduleCode: "FOUNDATION",
  screenCode: FOUNDATION_SCREEN.SYSTEM_SETTINGS,
  titleKey: "routeTitle.systemSettings",
  requiredAnyPermissions: FOUNDATION_SYSTEM_SETTINGS_ROUTE_PERMISSIONS,
};
