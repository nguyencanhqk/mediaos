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
  configureClientVersion,
  refreshAccessToken,
  redirectToAuth,
  getAuthRedirectUrl,
  invalidateSession,
  logoutSession,
  type ApiFetchOpts,
} from "./lib/api-client";

// API error kind + mapper (FRONTEND-04 §10, §22)
export { type ApiErrorKind, mapStatusToErrorKind, kindFromPayload } from "./lib/api-error-kind";
export {
  mapApiErrorToUi,
  isValidationDetails,
  extractValidationDetails,
  showApiErrorToast,
  configureToast,
  type ErrorUiBehavior,
  type ErrorUiMapping,
  type ToastFn,
} from "./lib/error-mapper";

// API types (FRONTEND-04 §9) — NAMED re-export; no wildcard (contracts exports type ApiError)
export type {
  ApiValidationDetail,
  ApiPagination,
  ApiMeta,
  ApiSuccessResponse,
  ApiListResponse,
  ApiErrorPayload,
  ApiErrorResponse,
  HttpMethod,
  ApiRequestOptions,
  ApiListParams,
  TableQueryState,
} from "./lib/api-types";
export { toApiListParams } from "./lib/api-types";

// Request-id + idempotency helpers (FRONTEND-04 §11)
export { createRequestId } from "./lib/api-request-id";
export { createIdempotencyKey } from "./lib/api-idempotency";

// Query string helpers (FRONTEND-04 §12)
export { buildQueryString } from "./lib/api-params";

// Query key factories (FRONTEND-04 §17) — pure const arrays, no react-query dep
export {
  rootKeys,
  authKeys,
  dashboardKeys,
  hrKeys,
  attendanceKeys,
  leaveKeys,
  taskKeys,
  notificationKeys,
  foundationKeys,
  attendanceInvalidation,
  leaveInvalidation,
  // S2-FE-HR-5 (lane HR5-WC): HR master-data mutation → list invalidation.
  hrMasterDataInvalidation,
  foundationInvalidation,
  // S2-FE-HR-7: employee contracts mutation → list invalidation.
  hrContractsInvalidation,
  // S3-FE-ATT-4: remote-work-request mutation → list/detail invalidation.
  remoteWorkRequestInvalidation,
} from "./lib/query-keys";

// Query retry policy (FRONTEND-04 §16.2) — pure fn, no react-query dep
export { shouldRetryQuery } from "./lib/query-retry";
export { bootstrapSession } from "./lib/session";
export { getHealth, type Health } from "./lib/api";
export { authApi } from "./lib/auth-api";
export { usersApi } from "./lib/users-api";
export { twoFactorApi } from "./lib/two-factor-api";
export { notificationApi } from "./lib/notification-api";
export { hrApi } from "./lib/hr-api";
// S2-FE-HR-5 (lane HR5-WC): HR master-data CRUD spine (departments/positions/job-levels/contract-types).
export { hrMasterDataApi, type HrDepartment } from "./lib/hr-master-data-api";
export { leaveApi } from "./lib/leave-api";
export { attendanceApi } from "./lib/attendance-api";
// S2-FE-HR-7: employee contracts (hợp đồng lao động) CRUD client.
export { contractsApi } from "./lib/contracts-api";
// S2-FE-HR-7: file download-url client (foundation file subsystem, TTL-ngắn, KHÔNG lộ storage_path).
export { filesApi } from "./lib/files-api";
export {
  foundationApi,
  safeSettingViewSchema,
  settingsResolveResponseSchema,
  settingValueTypeSchema,
  SETTING_VALUE_TYPES,
  type SafeSettingView,
  type SettingsResolveResponse,
  type SettingValueType,
  type ResolveSettingsBody,
  type UpdateCompanySettingBody,
  type UpdateCompanyBody,
} from "./lib/foundation-api";

// Permission
export { useCan, useCanExact } from "./hooks/use-can";
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

// Registry: App / Sidebar / Route + Permission Checker (FRONTEND-03 §10–§17)
export {
  // Types — Module & Scope
  type ModuleCode,
  type DataScope,
  type ModuleStatus,
  type ModuleAccessItem,
  // Types — Permission
  type PermissionCode,
  type PermissionRequirement,
  type PermissionCheckResult,
  type UserPermission,
  type PermissionChecker,
  createPermissionChecker,
  // Types — Session
  type AuthStatus,
  type SessionUser,
  type SessionCompany,
  type SessionContext,
  normalizeUserStatus,
  // Route metadata & guard
  type LayoutType,
  type RouteMeta,
  type RouteGuardAction,
  type RouteGuardResult,
  evaluateRouteAccess,
  ROUTE_REGISTRY,
  getRouteMeta,
  // App registry
  type AppRegistryItem,
  APP_REGISTRY,
  getVisibleApps,
  // Sidebar registry
  type SidebarItemMeta,
  filterSidebarItems,
} from "./lib/registry";

// Định dạng nhân sự
export { EMPLOYEE_STATUS_VARIANT, formatSalary, type EmployeeStatus } from "./lib/employee-format";

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
