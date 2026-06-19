/**
 * @mediaos/web-core — logic FE dùng chung cho mọi app (auth store, api client,
 * permission, i18n setup, nav types + helper, formatters).
 *
 * Component thuần (shadcn primitives + layout) ở @mediaos/ui (depends-on package này).
 */

// Auth store + token accessor
export { useAuthStore, getAccessToken } from "./stores/auth";

// API client (Bearer + envelope + cấu hình base URL) + SSO session lifecycle (FS-1b)
export {
  apiFetch,
  ApiError,
  unwrapEnvelope,
  configureApiBaseUrl,
  getApiBaseUrl,
  configureAuthAppUrl,
  refreshAccessToken,
  redirectToAuth,
  getAuthRedirectUrl,
  invalidateSession,
  logoutSession,
} from "./lib/api-client";
export { bootstrapSession } from "./lib/session";
export { getHealth, type Health } from "./lib/api";
export { authApi } from "./lib/auth-api";
export { usersApi } from "./lib/users-api";
export { twoFactorApi } from "./lib/two-factor-api";
export { notificationApi } from "./lib/notification-api";

// Permission
export { useCan } from "./hooks/use-can";
export { PermissionGate } from "./components/permission-gate";

// CS-9 idle auto-logout (client UX layer; backstop = short access-token TTL + server refresh enforce)
export { useIdleLogout, type UseIdleLogoutOptions } from "./hooks/use-idle-logout";

// Nav types + helper (NAV_ITEMS cụ thể do mỗi app tự khai)
export {
  NAV_CATEGORIES,
  navItemsByCategory,
  navItemsGrouped,
  type NavCategory,
  type NavItem,
  type NavCategoryMeta,
  type NavSubgroup,
  type NavCategoryGroup,
} from "./lib/nav";

// Định dạng nhân sự
export {
  EMPLOYEE_STATUS_VARIANT,
  formatSalary,
  type EmployeeStatus,
} from "./lib/employee-format";

// i18n: instance dùng chung + helper đăng ký namespace feature
export { default as i18n, registerI18nResources } from "./i18n";

// Định dạng ngày/giờ/số/tiền (vi)
export {
  VI_LOCALE,
  DEFAULT_TIMEZONE,
  formatDate,
  formatDateTime,
  formatTime,
  formatNumber,
  formatCurrency,
} from "./i18n/format";
