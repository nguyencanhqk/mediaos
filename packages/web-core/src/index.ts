/**
 * @mediaos/web-core — logic FE dùng chung cho mọi app (auth store, api client,
 * permission, i18n setup, nav types + helper, formatters).
 *
 * Component thuần (shadcn primitives + layout) ở @mediaos/ui (depends-on package này).
 */

// Auth store + token accessor
export { useAuthStore, getAccessToken } from "./stores/auth";

// API client (Bearer + envelope + cấu hình base URL)
export {
  apiFetch,
  ApiError,
  unwrapEnvelope,
  configureApiBaseUrl,
  getApiBaseUrl,
} from "./lib/api-client";
export { getHealth, type Health } from "./lib/api";
export { authApi } from "./lib/auth-api";
export { twoFactorApi } from "./lib/two-factor-api";

// Permission
export { useCan } from "./hooks/use-can";
export { PermissionGate } from "./components/permission-gate";

// Nav types + helper (NAV_ITEMS cụ thể do mỗi app tự khai)
export {
  NAV_CATEGORIES,
  navItemsByCategory,
  type NavCategory,
  type NavItem,
  type NavCategoryMeta,
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
