/**
 * Hằng dùng cho Module Catalog admin (S2-FE-FND-3 · SYSTEM-SCREEN-MODULES/`system.modules`).
 *
 * CỔNG QUYỀN: cặp ENGINE THỰC ('view','foundation-module') — seed mig 0435 dòng 338 (is_sensitive=false,
 * bulk-grant company-admin qua `WHERE resource_type LIKE 'foundation-%'`) — cặp mà ModuleAdminController
 * thật sự @RequirePermission (module-admin.controller.ts). KHÔNG namespace khác, KHÔNG nhãn-ma
 * FRONTEND-13 §7.1 (bài học pair-drift S1-FND-MODULE).
 *
 * Route `system.modules` đăng ký ADDITIVE trong ROUTE_REGISTRY (web-core) — router.tsx tạo route mới
 * trỏ tới ModulesPage (route hoàn toàn mới, KHÔNG thay ModulePlaceholder).
 */
export const FOUNDATION_MODULE_VIEW = {
  action: "view",
  resourceType: "foundation-module",
} as const;

/** Chuỗi quyền route-level literal (cặp engine THẬT) — dùng cho requiredAnyPermissions/sidebar gate. */
export const FOUNDATION_MODULE_VIEW_PERMISSION = `${FOUNDATION_MODULE_VIEW.action}:${FOUNDATION_MODULE_VIEW.resourceType}`;

/** Query keys (React Query). */
export const MODULES_QUERY_KEY = ["system", "modules"] as const;
export const MODULE_DETAIL_QUERY_KEY = ["system", "modules", "detail"] as const;

/** Đường dẫn route. */
export const MODULES_PATH = "/system/modules";
export function moduleDetailPath(code: string): string {
  return `/system/modules/${code}`;
}

/** Endpoint API thật (API-09 FOUNDATION — ModuleAdminController, S2-FND-BE-1). */
export const MODULES_API = "/foundation/modules";
export function moduleDetailApi(code: string): string {
  return `/foundation/modules/${code}`;
}
