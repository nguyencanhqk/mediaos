/**
 * Hằng dùng chung cho 2 trang viewer nhật ký bảo mật (S2-AUTH-BE-5 · L3-FE-VIEWER):
 *   - Nhật ký đăng nhập   → AUTH-API-401 GET /auth/login-logs
 *   - Sự kiện bảo mật      → AUTH-API-402 GET /auth/security-events
 *
 * CỔNG QUYỀN: cặp ENGINE THỰC ('view','audit-log') — seed mig 0340 (is_sensitive=true,
 * grant company-admin). PIN theo cặp seed, KHÔNG theo mã FE "AUTH.AUDIT_LOG.VIEW"
 * (bài học drift S1-FND-MODULE: BE gate trên cặp seed, FE phải khớp đúng cặp đó).
 *
 * Nguồn cặp = packages/contracts AUTH_AUDIT_LOG (nguồn sự thật dùng chung BE+FE).
 * KHÔNG hard-code role; KHÔNG so sánh role trực tiếp.
 */
import { AUTH_AUDIT_LOG, AUTH_LOG_PAGE_SIZE_DEFAULT } from "@mediaos/contracts";
import { type RouteMeta } from "@mediaos/web-core";

/**
 * Cặp engine gate cả 2 trang. useCan(action, resourceType) đọc thẳng capabilities map
 * (key `action:resourceType`) → khớp `view:audit-log` company-admin thực sự có.
 */
export const AUDIT_LOG_VIEW = {
  action: AUTH_AUDIT_LOG.VIEW.action,
  resourceType: AUTH_AUDIT_LOG.RESOURCE,
} as const;

/**
 * Chuỗi quyền route-level = cặp engine LITERAL ("view:audit-log"). createPermissionChecker
 * khớp TRỰC TIẾP literal này với capabilities map (resolveKey: map.has(permission) trước),
 * nên route-guard chạy đúng mà KHÔNG cần PERMISSION_CODE_TO_PAIR trong web-core (tránh sửa
 * web-core + tránh drift code FE→pair). Dùng cho requiredAnyPermissions của RouteMeta/sidebar.
 */
export const AUDIT_LOG_VIEW_PERMISSION = `${AUDIT_LOG_VIEW.action}:${AUDIT_LOG_VIEW.resourceType}`;

/** Số dòng mỗi trang (khớp mặc định contract — kẹp [1..MAX] ở BE). */
export const AUTH_LOG_PAGE_SIZE = AUTH_LOG_PAGE_SIZE_DEFAULT;

/** Query keys (React Query) — cục bộ feature; theo [scope, resource, params]. */
export const LOGIN_LOGS_QUERY_KEY = ["system", "login-logs"] as const;
export const SECURITY_EVENTS_QUERY_KEY = ["system", "security-events"] as const;

/** Đường dẫn route 2 trang viewer (khu /system — dùng ở router + sidebar). */
export const LOGIN_LOGS_PATH = "/system/login-logs";
export const SECURITY_EVENTS_PATH = "/system/security-events";

/** Endpoint API thật (AUTH-API-401/402) — khác path route (route /system/*, API /auth/*). */
export const LOGIN_LOGS_API = "/auth/login-logs";
export const SECURITY_EVENTS_API = "/auth/security-events";

/**
 * RouteMeta CỤC BỘ (KHÔNG đưa vào ROUTE_REGISTRY của web-core — lane KHÔNG sửa web-core).
 * moduleCode FOUNDATION + requiredAnyPermissions = cặp engine literal để ProtectedRoute
 * (evaluateRouteFromStore) chặn đúng khi thiếu quyền.
 */
export const LOGIN_LOGS_ROUTE_META: RouteMeta = {
  routeKey: "system.login-logs",
  path: LOGIN_LOGS_PATH,
  layout: "MODULE_WORKSPACE",
  moduleCode: "FOUNDATION",
  screenCode: "SYSTEM-SCREEN-LOGIN-LOGS",
  titleKey: "routeTitle.systemLoginLogs",
  requiredAnyPermissions: [AUDIT_LOG_VIEW_PERMISSION],
  showInSidebar: true,
  order: 74,
};

export const SECURITY_EVENTS_ROUTE_META: RouteMeta = {
  routeKey: "system.security-events",
  path: SECURITY_EVENTS_PATH,
  layout: "MODULE_WORKSPACE",
  moduleCode: "FOUNDATION",
  screenCode: "SYSTEM-SCREEN-SECURITY-EVENTS",
  titleKey: "routeTitle.systemSecurityEvents",
  requiredAnyPermissions: [AUDIT_LOG_VIEW_PERMISSION],
  showInSidebar: true,
  order: 75,
};
