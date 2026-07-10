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
  authUsersKeys,
  dashboardKeys,
  hrKeys,
  attendanceKeys,
  leaveKeys,
  taskKeys,
  notificationKeys,
  foundationKeys,
  attendanceInvalidation,
  leaveInvalidation,
  foundationInvalidation,
  hrInvalidation,
  // S4-FE-NOTI-1: My-Notification mutation → list/dropdown/unread-count/detail invalidation.
  notificationInvalidation,
  // S2-FE-HR-5 (lane HR5-WC): HR master-data mutation → list invalidation.
  hrMasterDataInvalidation,
  // S2-FE-HR-7: employee contracts mutation → list invalidation.
  hrContractsInvalidation,
  // S3-FE-ATT-4: remote-work-request mutation → list/detail invalidation.
  remoteWorkRequestInvalidation,
} from "./lib/query-keys";

// Query retry policy (FRONTEND-04 §16.2) — pure fn, no react-query dep
export { shouldRetryQuery } from "./lib/query-retry";
export { bootstrapSession } from "./lib/session";
export { getHealth, type Health, getHealthDb, type HealthDb } from "./lib/api";
export { authApi } from "./lib/auth-api";
// S2-FE-AUTH-4 (lane FE batch C) — role & permission admin (create/update role, assign/revoke permission).
export { roleAdminApi } from "./lib/role-admin-api";
// S2-FE-FND-5 (lane FE batch C) — sequence counters + seed run status (ops admin).
export { foundationOpsApi } from "./lib/foundation-ops-api";
export { usersApi } from "./lib/users-api";
export { authUsersApi } from "./lib/auth-users-api";
export { twoFactorApi } from "./lib/two-factor-api";
// S4-FE-NOTI-1 — My-Notification API THẬT (MyNotificationsController, S4-NOTI-BE-1).
// `notificationApi` legacy G10-2 đã xoá hẳn (S4-FE-NOTI-CLEANUP-1 — route bị gỡ ở PR #133).
export { myNotificationApi } from "./lib/my-notification-api";
// S4-FE-REGISTRY-1 — TASK/DASH API skeleton typed qua @mediaos/contracts (page thật = S4-FE-TASK-1/DASH-1).
export { tasksApi } from "./lib/tasks-api";
export { dashboardApi } from "./lib/dashboard-api";
export { hrApi } from "./lib/hr-api";
// S2-FE-HR-6 — Org chart (GET /org/units/tree, read mở) + HR audit-logs (tái dùng /foundation/audit-logs).
export { orgApi, orgTreeNodeSchema, type OrgTreeNode } from "./lib/hr-org-api";
export { hrAuditApi, type HrAuditLogQuery } from "./lib/hr-audit-api";
// S2-FE-HR-8 — Employee-code CONFIG admin (view/update config + read-only preview mã tiếp theo).
export {
  employeeCodeConfigApi,
  EMPLOYEE_CODE_NUMBER_LENGTH_MIN,
  EMPLOYEE_CODE_NUMBER_LENGTH_MAX,
  type EmployeeCodeConfigDto,
  type EmployeeCodePreviewResponse,
  type UpdateEmployeeCodeConfigRequest,
} from "./lib/hr-employee-code-config-api";
// S2-FE-HR-5 (lane HR5-WC): HR master-data CRUD spine (departments/positions/job-levels/contract-types).
export { hrMasterDataApi, type HrDepartment } from "./lib/hr-master-data-api";
export { leaveApi } from "./lib/leave-api";
export { attendanceApi } from "./lib/attendance-api";
// S2-FE-HR-7: employee contracts (hợp đồng lao động) CRUD client.
export { contractsApi } from "./lib/contracts-api";
// S2-FE-HR-7: file download-url client (foundation file subsystem, TTL-ngắn, KHÔNG lộ storage_path).
export { filesApi } from "./lib/files-api";
// S2-FE-HR-9: Employee Files tab client (list/upload 4-pha có tiến độ/xóa mềm, UI-HR-SCREEN-015).
export { employeeFilesApi, type UploadEmployeeFileOptions } from "./lib/employee-file-api";
export {
  foundationApi,
  safeSettingViewSchema,
  safeSettingViewListSchema,
  settingsResolveResponseSchema,
  settingValueTypeSchema,
  SETTING_VALUE_TYPES,
  type SafeSettingView,
  type SettingsResolveResponse,
  type SettingValueType,
  type ResolveSettingsBody,
  type UpdateCompanySettingBody,
  type UpdateCompanyBody,
  // S2-FE-FND-8 — System settings GLOBAL (gate system-manage:foundation-setting)
  type SystemSettingsQueryParams,
  type UpdateSystemSettingBody,
  // S2-FE-FND-4 — Public Holidays
  holidayApi,
  holidayViewSchema,
  holidayTypeSchema,
  HOLIDAY_TYPES,
  type HolidayView,
  type HolidayType,
  type HolidayListParams,
  type CreateHolidayBody,
  type UpdateHolidayBody,
  type DeleteHolidayResult,
  // S2-FE-FND-6 — Retention Policies + File Access Logs
  retentionApi,
  fileAccessLogApi,
  CLEANUP_ACTIONS,
  cleanupActionSchema,
  FILE_ACCESS_ACTIONS,
  type RetentionPolicyView,
  type PatchRetentionPolicyDto,
  type FileAccessLogView,
  type FileAccessActionDto,
  type FileAccessLogListParams,
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
