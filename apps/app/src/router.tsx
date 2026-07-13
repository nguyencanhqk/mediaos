import React from "react";
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { getAuthRedirectUrl, useAuthStore, type RouteMeta } from "@mediaos/web-core";
import { Skeleton } from "@mediaos/ui";
import { ForbiddenPage } from "@/routes/forbidden";
import { ProtectedShell } from "@/layouts/protected/ProtectedShell";
import { ProtectedRoute } from "@/layouts/protected/ProtectedRoute";
import { HomePortalLayout } from "@/layouts/home/HomePortalLayout";
import { ModuleWorkspaceLayout } from "@/layouts/workspace/ModuleWorkspaceLayout";

// ---------------------------------------------------------------------------
// Auth guard — `beforeLoad` CHỈ làm REDIRECT_LOGIN khi CHƯA có phiên (redirect SSO).
//
// Phân quyền theo route (SHOW_403 / SHOW_404 / SHOW_DISABLED / SHOW_LOADING) KHÔNG nằm ở đây:
// nó do <ProtectedRoute meta> TIÊU THỤ guardResult ở TẦNG COMPONENT (evaluateRouteFromStore) —
// nội dung module CHỈ render khi action === "ALLOW". `beforeLoad` chạy ngoài React tree nên không
// thể render trạng thái; vì vậy nó giới hạn ở đúng việc redirect (cổng quyền thật vẫn ở server).
// ---------------------------------------------------------------------------
const authGuard = () => {
  if (!useAuthStore.getState().isAuthenticated) {
    throw redirect({ href: getAuthRedirectUrl() });
  }
};

// ---------------------------------------------------------------------------
// Route tree
// ---------------------------------------------------------------------------

const rootRoute = createRootRoute();

// Home — canonical Home Portal landing after login
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/home",
  beforeLoad: authGuard,
  component: () => (
    <ProtectedShell>
      <HomePortalLayout />
    </ProtectedShell>
  ),
});

// Index redirect → /home
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: authGuard,
  component: () => (
    <ProtectedShell>
      <HomePortalLayout />
    </ProtectedShell>
  ),
});

// ---------------------------------------------------------------------------
// Guarded module routes — wrap with ModuleWorkspaceLayout
// ---------------------------------------------------------------------------
import { ROUTE_REGISTRY } from "@mediaos/web-core";

export function getMeta(routeKey: string): RouteMeta {
  const meta = ROUTE_REGISTRY.find((r) => r.routeKey === routeKey);
  if (!meta) throw new Error(`[router] RouteMeta not found for key: ${routeKey}`);
  return meta;
}

type ModuleCodeArg = Parameters<typeof ModuleWorkspaceLayout>[0]["moduleCode"];

/**
 * Nội dung 1 route module: ProtectedShell → ProtectedRoute(meta) → ModuleWorkspaceLayout → page.
 *
 * <ProtectedRoute meta> TIÊU THỤ guardResult: nó CHỈ render workspace + page khi ALLOW; ngược lại
 * render trạng thái 403/404/disabled/loading. Nhờ vậy MỌI route module (kể cả ModulePlaceholder) bị
 * chặn ở tầng route khi user thiếu quyền — không chỉ HR. Tách ra để route detail tái dùng + test wiring.
 */
// ---------------------------------------------------------------------------
// Route-level Suspense — mỗi trang module nạp qua dynamic import (React.lazy bên dưới) để Vite
// TÁCH CHUNK theo module: mở /hr KHÔNG kéo bundle TASK/LEAVE/ATT. Fallback là skeleton (KHÔNG chuỗi
// cứng, tái dùng @mediaos/ui) — bọc TRONG buildModuleRouteContent nên MỌI route module dùng chung.
// Path/meta/gate KHÔNG đổi: chỉ đổi CÁCH nạp component (component ⇒ lazy exotic).
// ---------------------------------------------------------------------------
function RouteSuspenseFallback(): React.ReactElement {
  return (
    <div className="space-y-4 p-2" aria-busy="true" data-testid="route-loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function buildModuleRouteContent(
  meta: RouteMeta,
  moduleCode: ModuleCodeArg,
  page: React.ReactNode,
): React.ReactElement {
  return (
    <ProtectedShell>
      <ProtectedRoute meta={meta}>
        <ModuleWorkspaceLayout moduleCode={moduleCode}>
          <React.Suspense fallback={<RouteSuspenseFallback />}>{page}</React.Suspense>
        </ModuleWorkspaceLayout>
      </ProtectedRoute>
    </ProtectedShell>
  );
}

/**
 * Vỏ tối giản cho trang self-service (KHÔNG ModuleWorkspaceLayout / không permission pair —
 * mirror homeRoute wiring): vẫn bọc Suspense để lazy page có fallback trong lúc nạp chunk.
 */
function buildShellRouteContent(page: React.ReactNode): React.ReactElement {
  return (
    <ProtectedShell>
      <React.Suspense fallback={<RouteSuspenseFallback />}>{page}</React.Suspense>
    </ProtectedShell>
  );
}

function makeModuleRoute(
  path: string,
  metaKey: string,
  moduleCode: ModuleCodeArg,
  PageComponent: React.ComponentType,
) {
  const meta = getMeta(metaKey);
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    // beforeLoad: CHỈ REDIRECT_LOGIN (xem ghi chú authGuard). Phân quyền route do ProtectedRoute lo.
    beforeLoad: authGuard,
    component: () => buildModuleRouteContent(meta, moduleCode, <PageComponent />),
  });
}

// ModulePlaceholder đã bị gỡ (S4-FE-DASH-1): dashboardRoute là consumer CUỐI CÙNG của nó — mọi module route
// khác đã thay bằng page thật từ trước (Tasks/System/HR...). Giữ hàm chết lại sẽ đỏ noUnusedLocals.

// Dashboard — S4-FE-DASH-1: DashboardMePage THAY ModulePlaceholder (shell + widget P0 lazy-load).
const DashboardMePage = React.lazy(() =>
  import("@/routes/dashboard/DashboardMePage").then((m) => ({ default: m.DashboardMePage })),
);
// S4-FE-DASH-3 — DashboardConfigPage (admin: cấu hình widget theo dashboard-type, nối S4-DASH-BE-3).
const DashboardConfigPage = React.lazy(() =>
  import("@/routes/dashboard/DashboardConfigPage").then((m) => ({
    default: m.DashboardConfigPage,
  })),
);

const dashboardRoute = makeModuleRoute("/dashboard", "dashboard", "DASH", DashboardMePage);
// Cấu hình widget dashboard — path TĨNH 2-segment "/dashboard/configs" tự xếp hạng TRÊN route param
// (TanStack Router disambiguates static trước param — mirror notificationEventsRoute vs $id). Gate
// route-level = view:dashboard-config (ROUTE_REGISTRY dashboard.configs); toggle gate TINH hơn TRONG
// page bằng useCanExact(update:dashboard-config).
const dashboardConfigsRoute = makeModuleRoute(
  "/dashboard/configs",
  "dashboard.configs",
  "DASH",
  DashboardConfigPage,
);

// HR
import { useNavigate } from "@tanstack/react-router";
import { HR_ENGINE_PAIRS } from "@/routes/hr/constants";
import { HR_AUDIT_LOG_VIEW_PERMISSION } from "@/routes/hr/audit-logs/constants";
import {
  EMPLOYEE_CODE_CONFIG_PATH,
  EMPLOYEE_CODE_CONFIG_ROUTE_META,
} from "@/routes/hr/settings/constants";
import {
  PCR_ME_PATH,
  PCR_LIST_PATH,
  PCR_ME_ROUTE_META,
  PCR_LIST_ROUTE_META,
  PCR_DETAIL_ROUTE_META,
} from "@/routes/hr/profile-change-requests/constants";
const EmployeeListPage = React.lazy(() =>
  import("@/routes/hr/employees/EmployeeListPage").then((m) => ({ default: m.EmployeeListPage })),
);
const EmployeeDetailPage = React.lazy(() =>
  import("@/routes/hr/employees/EmployeeDetailPage").then((m) => ({
    default: m.EmployeeDetailPage,
  })),
);
const EmployeeFormPage = React.lazy(() =>
  import("@/routes/hr/employees/EmployeeFormPage").then((m) => ({ default: m.EmployeeFormPage })),
);
const MyProfilePage = React.lazy(() =>
  import("@/routes/hr/me/MyProfilePage").then((m) => ({ default: m.MyProfilePage })),
);
const OrgChartPage = React.lazy(() =>
  import("@/routes/hr/org-chart/OrgChartPage").then((m) => ({ default: m.OrgChartPage })),
);
const HrAuditLogsPage = React.lazy(() =>
  import("@/routes/hr/audit-logs/HrAuditLogsPage").then((m) => ({ default: m.HrAuditLogsPage })),
);
const EmployeeCodeConfigPage = React.lazy(() =>
  import("@/routes/hr/settings/EmployeeCodeConfigPage").then((m) => ({
    default: m.EmployeeCodeConfigPage,
  })),
);
// HR — Profile change request workflow (S2-FE-HR-4)
const MyChangeRequestPage = React.lazy(() =>
  import("@/routes/hr/profile-change-requests/MyChangeRequestPage").then((m) => ({
    default: m.MyChangeRequestPage,
  })),
);
const ProfileChangeRequestListPage = React.lazy(() =>
  import("@/routes/hr/profile-change-requests/ProfileChangeRequestListPage").then((m) => ({
    default: m.ProfileChangeRequestListPage,
  })),
);
const ProfileChangeRequestDetailPage = React.lazy(() =>
  import("@/routes/hr/profile-change-requests/ProfileChangeRequestDetailPage").then((m) => ({
    default: m.ProfileChangeRequestDetailPage,
  })),
);
// HR — Master-data admin screens (S2-FE-HR-5)
const DepartmentsPage = React.lazy(() =>
  import("@/routes/hr/departments/DepartmentsPage").then((m) => ({ default: m.DepartmentsPage })),
);
const PositionsPage = React.lazy(() =>
  import("@/routes/hr/positions/PositionsPage").then((m) => ({ default: m.PositionsPage })),
);
const JobLevelsPage = React.lazy(() =>
  import("@/routes/hr/job-levels/JobLevelsPage").then((m) => ({ default: m.JobLevelsPage })),
);
const ContractTypesPage = React.lazy(() =>
  import("@/routes/hr/contract-types/ContractTypesPage").then((m) => ({
    default: m.ContractTypesPage,
  })),
);
// S2-FE-HR-7 — Hợp đồng lao động (company-wide + theo nhân viên)
const ContractsPage = React.lazy(() =>
  import("@/routes/hr/contracts/ContractsPage").then((m) => ({ default: m.ContractsPage })),
);
const EmployeeContractsPage = React.lazy(() =>
  import("@/routes/hr/employees/EmployeeContractsPage").then((m) => ({
    default: m.EmployeeContractsPage,
  })),
);

// Attendance
const AttendanceTodayPage = React.lazy(() =>
  import("@/routes/attendance/AttendanceTodayPage").then((m) => ({
    default: m.AttendanceTodayPage,
  })),
);
const MyAttendanceRecordsPage = React.lazy(() =>
  import("@/routes/attendance/MyAttendanceRecordsPage").then((m) => ({
    default: m.MyAttendanceRecordsPage,
  })),
);
const TeamAttendanceRecordsPage = React.lazy(() =>
  import("@/routes/attendance/TeamAttendanceRecordsPage").then((m) => ({
    default: m.TeamAttendanceRecordsPage,
  })),
);
const AttendanceCompanyRecordsPage = React.lazy(() =>
  import("@/routes/attendance/AttendanceCompanyRecordsPage").then((m) => ({
    default: m.AttendanceCompanyRecordsPage,
  })),
);
const AttendanceRecordDetailPage = React.lazy(() =>
  import("@/routes/attendance/AttendanceRecordDetailPage").then((m) => ({
    default: m.AttendanceRecordDetailPage,
  })),
);
const AttendanceShiftsPage = React.lazy(() =>
  import("@/routes/attendance/AttendanceShiftsPage").then((m) => ({
    default: m.AttendanceShiftsPage,
  })),
);
const AttendanceShiftAssignmentsPage = React.lazy(() =>
  import("@/routes/attendance/AttendanceShiftAssignmentsPage").then((m) => ({
    default: m.AttendanceShiftAssignmentsPage,
  })),
);
const AttendanceRulesPage = React.lazy(() =>
  import("@/routes/attendance/AttendanceRulesPage").then((m) => ({
    default: m.AttendanceRulesPage,
  })),
);
// S3-FE-ATT-4 — Remote/onsite-work requests
const RemoteWorkRequestsPage = React.lazy(() =>
  import("@/routes/attendance/remote-work/RemoteWorkRequestsPage").then((m) => ({
    default: m.RemoteWorkRequestsPage,
  })),
);
const CreateRemoteWorkRequestPage = React.lazy(() =>
  import("@/routes/attendance/remote-work/CreateRemoteWorkRequestPage").then((m) => ({
    default: m.CreateRemoteWorkRequestPage,
  })),
);
const RemoteWorkRequestDetailPage = React.lazy(() =>
  import("@/routes/attendance/remote-work/RemoteWorkRequestDetailPage").then((m) => ({
    default: m.RemoteWorkRequestDetailPage,
  })),
);
// S3-FE-ATT-6 — Reports + audit logs
const AttendanceReportsPage = React.lazy(() =>
  import("@/routes/attendance/reports/AttendanceReportsPage").then((m) => ({
    default: m.AttendanceReportsPage,
  })),
);
const AttendanceAuditLogsPage = React.lazy(() =>
  import("@/routes/attendance/audit/AttendanceAuditLogsPage").then((m) => ({
    default: m.AttendanceAuditLogsPage,
  })),
);
// Attendance — Đơn điều chỉnh công (S3-FE-ATT-3)
const CreateAdjustmentRequestPage = React.lazy(() =>
  import("@/routes/attendance/adjustment/CreateAdjustmentRequestPage").then((m) => ({
    default: m.CreateAdjustmentRequestPage,
  })),
);
const MyAdjustmentRequestsPage = React.lazy(() =>
  import("@/routes/attendance/adjustment/MyAdjustmentRequestsPage").then((m) => ({
    default: m.MyAdjustmentRequestsPage,
  })),
);
const AdjustmentRequestsPage = React.lazy(() =>
  import("@/routes/attendance/adjustment/AdjustmentRequestsPage").then((m) => ({
    default: m.AdjustmentRequestsPage,
  })),
);
const AdjustmentRequestDetailPage = React.lazy(() =>
  import("@/routes/attendance/adjustment/AdjustmentRequestDetailPage").then((m) => ({
    default: m.AdjustmentRequestDetailPage,
  })),
);
const DirectAdjustPage = React.lazy(() =>
  import("@/routes/attendance/adjustment/DirectAdjustPage").then((m) => ({
    default: m.DirectAdjustPage,
  })),
);

// Leave
import { LEAVE_ENGINE_PAIRS, LEAVE_PATHS } from "@/routes/leave/constants";
const LeaveOverviewPage = React.lazy(() =>
  import("@/routes/leave/LeaveOverviewPage").then((m) => ({ default: m.LeaveOverviewPage })),
);
const MyLeaveBalancePage = React.lazy(() =>
  import("@/routes/leave/MyLeaveBalancePage").then((m) => ({ default: m.MyLeaveBalancePage })),
);
const MyLeaveRequestsPage = React.lazy(() =>
  import("@/routes/leave/MyLeaveRequestsPage").then((m) => ({ default: m.MyLeaveRequestsPage })),
);
const CreateLeaveRequestPage = React.lazy(() =>
  import("@/routes/leave/CreateLeaveRequestPage").then((m) => ({
    default: m.CreateLeaveRequestPage,
  })),
);
const LeaveRequestDetailPage = React.lazy(() =>
  import("@/routes/leave/LeaveRequestDetailPage").then((m) => ({
    default: m.LeaveRequestDetailPage,
  })),
);
const LeaveApprovalPage = React.lazy(() =>
  import("@/routes/leave/LeaveApprovalPage").then((m) => ({ default: m.LeaveApprovalPage })),
);
const AllLeaveRequestsPage = React.lazy(() =>
  import("@/routes/leave/AllLeaveRequestsPage").then((m) => ({ default: m.AllLeaveRequestsPage })),
);
const EditLeaveDraftPage = React.lazy(() =>
  import("@/routes/leave/EditLeaveDraftPage").then((m) => ({ default: m.EditLeaveDraftPage })),
);
const LeaveCalendarPage = React.lazy(() =>
  import("@/routes/leave/LeaveCalendarPage").then((m) => ({ default: m.LeaveCalendarPage })),
);
// S3-FE-LEAVE-5 — admin (LEAVE-SCREEN-010/011/012/013): loại nghỉ / chính sách / số dư phép + ledger.
const LeaveTypesPage = React.lazy(() =>
  import("@/routes/leave/LeaveTypesPage").then((m) => ({ default: m.LeaveTypesPage })),
);
const LeavePoliciesPage = React.lazy(() =>
  import("@/routes/leave/LeavePoliciesPage").then((m) => ({ default: m.LeavePoliciesPage })),
);
const LeaveBalancesPage = React.lazy(() =>
  import("@/routes/leave/LeaveBalancesPage").then((m) => ({ default: m.LeaveBalancesPage })),
);
const LeaveBalanceTransactionsPage = React.lazy(() =>
  import("@/routes/leave/LeaveBalanceTransactionsPage").then((m) => ({
    default: m.LeaveBalanceTransactionsPage,
  })),
);
// S3-FE-LEAVE-6 — báo cáo tổng hợp nghỉ (LEAVE-SCREEN-013) + audit log nghỉ phép (LEAVE-SCREEN-014A).
const LeaveReportsPage = React.lazy(() =>
  import("@/routes/leave/reports/LeaveReportsPage").then((m) => ({ default: m.LeaveReportsPage })),
);
const LeaveAuditLogsPage = React.lazy(() =>
  import("@/routes/leave/audit/LeaveAuditLogsPage").then((m) => ({
    default: m.LeaveAuditLogsPage,
  })),
);

// Notifications — S4-FE-NOTI-1-WIRE (wire NotificationListPage/DetailPage đã build ở S4-FE-NOTI-1/a7be971)
import { NOTI_ENGINE_PAIRS, NOTI_PATHS, NOTI_SCREEN } from "@/routes/notifications/constants";
const NotificationListPage = React.lazy(() =>
  import("@/routes/notifications/NotificationListPage").then((m) => ({
    default: m.NotificationListPage,
  })),
);
const NotificationDetailPage = React.lazy(() =>
  import("@/routes/notifications/NotificationDetailPage").then((m) => ({
    default: m.NotificationDetailPage,
  })),
);
// S4-FE-NOTI-2 — Quản lý loại thông báo (admin catalog, UI-NOTI-SCREEN-004).
const NotificationEventsPage = React.lazy(() =>
  import("@/routes/notifications/NotificationEventsPage").then((m) => ({
    default: m.NotificationEventsPage,
  })),
);
// S4-FE-NOTI-3 — Delivery logs viewer (UI-NOTI-SCREEN-006, append-only).
const NotificationDeliveryLogsPage = React.lazy(() =>
  import("@/routes/notifications/NotificationDeliveryLogsPage").then((m) => ({
    default: m.NotificationDeliveryLogsPage,
  })),
);

// System
import {
  LOGIN_LOGS_PATH,
  LOGIN_LOGS_ROUTE_META,
  SECURITY_EVENTS_PATH,
  SECURITY_EVENTS_ROUTE_META,
} from "@/routes/system/auth-logs/constants";
import {
  FOUNDATION_PATH,
  FOUNDATION_SCREEN,
  SYSTEM_PUBLIC_HOLIDAYS_ROUTE_META,
  SYSTEM_HEALTH_ROUTE_META,
  SYSTEM_RETENTION_ROUTE_META,
  SYSTEM_FILE_ACCESS_LOGS_ROUTE_META,
  SYSTEM_SETTINGS_ROUTE_META,
  SYSTEM_JOBS_ROUTE_META,
} from "@/routes/system/foundation/constants";
import { ACCOUNT_SETUP_2FA_PATH, ACCOUNT_PROFILE_PATH } from "@/routes/account/constants";
import { FILES_PATH } from "@/routes/system/files/constants";
import { MODULES_PATH } from "@/routes/system/modules/constants";
const UsersPage = React.lazy(() =>
  import("@/routes/system/UsersPage").then((m) => ({ default: m.UsersPage })),
);
const RolesPage = React.lazy(() =>
  import("@/routes/system/RolesPage").then((m) => ({ default: m.RolesPage })),
);
// System / Users CRUD — S2-FE-AUTH-3
const UserFormPage = React.lazy(() =>
  import("@/routes/system/users/UserFormPage").then((m) => ({ default: m.UserFormPage })),
);
const UserDetailPage = React.lazy(() =>
  import("@/routes/system/users/UserDetailPage").then((m) => ({ default: m.UserDetailPage })),
);
const UserRolesPage = React.lazy(() =>
  import("@/routes/system/users/UserRolesPage").then((m) => ({ default: m.UserRolesPage })),
);
const LoginLogsPage = React.lazy(() =>
  import("@/routes/system/auth-logs/LoginLogsPage").then((m) => ({ default: m.LoginLogsPage })),
);
const SecurityEventsPage = React.lazy(() =>
  import("@/routes/system/auth-logs/SecurityEventsPage").then((m) => ({
    default: m.SecurityEventsPage,
  })),
);
// System / Foundation — S2-FE-FND-1 (FND1-APP)
const SystemOverviewPage = React.lazy(() =>
  import("@/routes/system/foundation/SystemOverviewPage").then((m) => ({
    default: m.SystemOverviewPage,
  })),
);
const CompanyProfilePage = React.lazy(() =>
  import("@/routes/system/foundation/CompanyProfilePage").then((m) => ({
    default: m.CompanyProfilePage,
  })),
);
const CompanySettingsPage = React.lazy(() =>
  import("@/routes/system/foundation/CompanySettingsPage").then((m) => ({
    default: m.CompanySettingsPage,
  })),
);
const SystemSettingsPage = React.lazy(() =>
  import("@/routes/system/foundation/SystemSettingsPage").then((m) => ({
    default: m.SystemSettingsPage,
  })),
);
// System / Foundation — Public Holidays + Health — S2-FE-FND-4
const PublicHolidaysPage = React.lazy(() =>
  import("@/routes/system/foundation/PublicHolidaysPage").then((m) => ({
    default: m.PublicHolidaysPage,
  })),
);
const HealthPage = React.lazy(() =>
  import("@/routes/system/foundation/HealthPage").then((m) => ({ default: m.HealthPage })),
);
// System / Foundation — Retention Policies + File Access Logs — S2-FE-FND-6
const RetentionPoliciesPage = React.lazy(() =>
  import("@/routes/system/foundation/RetentionPoliciesPage").then((m) => ({
    default: m.RetentionPoliciesPage,
  })),
);
const FileAccessLogsPage = React.lazy(() =>
  import("@/routes/system/foundation/FileAccessLogsPage").then((m) => ({
    default: m.FileAccessLogsPage,
  })),
);
// System / Foundation — System Jobs observability (READ-ONLY) — S5-FND-JOBS-OBS-1
const SystemJobsPage = React.lazy(() =>
  import("@/routes/system/foundation/SystemJobsPage").then((m) => ({ default: m.SystemJobsPage })),
);
// System / Roles + Permissions admin — S2-FE-AUTH-4 (lane FE batch C)
const RoleFormPage = React.lazy(() =>
  import("@/routes/system/roles/RoleFormPage").then((m) => ({ default: m.RoleFormPage })),
);
const RoleDetailPage = React.lazy(() =>
  import("@/routes/system/roles/RoleDetailPage").then((m) => ({ default: m.RoleDetailPage })),
);
const RolePermissionsPage = React.lazy(() =>
  import("@/routes/system/roles/RolePermissionsPage").then((m) => ({
    default: m.RolePermissionsPage,
  })),
);
const PermissionsPage = React.lazy(() =>
  import("@/routes/system/PermissionsPage").then((m) => ({ default: m.PermissionsPage })),
);
// System / Foundation ops admin — S2-FE-FND-5 (lane FE batch C)
const SequencesPage = React.lazy(() =>
  import("@/routes/system/ops/SequencesPage").then((m) => ({ default: m.SequencesPage })),
);
const SeedsPage = React.lazy(() =>
  import("@/routes/system/ops/SeedsPage").then((m) => ({ default: m.SeedsPage })),
);
// Account self-service — S2-FE-AUTH-5 (lane FE batch C)
const AccountSessionsPage = React.lazy(() =>
  import("@/routes/account/AccountSessionsPage").then((m) => ({ default: m.AccountSessionsPage })),
);
// Account self-service — S2-FE-AUTH-6: /account/setup-2fa (ép enroll, AUTH-003) + /account/profile (đọc).
const TwoFactorSetupPage = React.lazy(() =>
  import("@/routes/account/TwoFactorSetupPage").then((m) => ({ default: m.TwoFactorSetupPage })),
);
const AccountProfilePage = React.lazy(() =>
  import("@/routes/account/AccountProfilePage").then((m) => ({ default: m.AccountProfilePage })),
);
// System / Foundation — Audit log viewer (S2-FE-FND-2)
const AuditLogsPage = React.lazy(() =>
  import("@/routes/system/foundation/audit-logs/AuditLogsPage").then((m) => ({
    default: m.AuditLogsPage,
  })),
);
const AuditLogDetailPage = React.lazy(() =>
  import("@/routes/system/foundation/audit-logs/AuditLogDetailPage").then((m) => ({
    default: m.AuditLogDetailPage,
  })),
);
// System / Foundation — File metadata viewer (S2-FE-FND-2)
const FilesPage = React.lazy(() =>
  import("@/routes/system/files/FilesPage").then((m) => ({ default: m.FilesPage })),
);
const FileDetailPage = React.lazy(() =>
  import("@/routes/system/files/FileDetailPage").then((m) => ({ default: m.FileDetailPage })),
);
// System / Foundation — Module catalog admin (S2-FE-FND-3)
const ModulesPage = React.lazy(() =>
  import("@/routes/system/modules/ModulesPage").then((m) => ({ default: m.ModulesPage })),
);
const ModuleDetailPage = React.lazy(() =>
  import("@/routes/system/modules/ModuleDetailPage").then((m) => ({ default: m.ModuleDetailPage })),
);
// Account — self-service (S2-FE-AUTH-2)
const ChangePasswordPage = React.lazy(() =>
  import("@/routes/account/ChangePasswordPage").then((m) => ({ default: m.ChangePasswordPage })),
);

const hrRoute = makeModuleRoute("/hr", "hr.overview", "HR", EmployeeListPage);
const hrEmployeesRoute = makeModuleRoute("/hr/employees", "hr.employees", "HR", EmployeeListPage);
const hrMeRoute = makeModuleRoute("/hr/me", "hr.me", "HR", MyProfilePage);

// HR Org chart (S2-FE-HR-6) — RouteMeta CỤC BỘ (KHÔNG ở ROUTE_REGISTRY web-core, cùng pattern
// systemLoginLogsRoute). Gate = read:department (cặp seed thật — CÙNG cặp "phòng ban" HR đang dùng,
// KHÔNG bịa permission "org-chart" chưa seed).
const hrOrgChartMeta: RouteMeta = {
  routeKey: "hr.org-chart",
  path: "/hr/org-chart",
  layout: "MODULE_WORKSPACE",
  moduleCode: "HR",
  screenCode: "HR-SCREEN-ORG-CHART",
  titleKey: "routeTitle.hrOrgChart",
  requiredAnyPermissions: [
    `${HR_ENGINE_PAIRS.ORG_CHART_VIEW.action}:${HR_ENGINE_PAIRS.ORG_CHART_VIEW.resourceType}`,
  ],
  showInSidebar: true,
  order: 23,
};
const hrOrgChartRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hr/org-chart",
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(hrOrgChartMeta, "HR", <OrgChartPage />),
});

// HR audit-logs (S2-FE-HR-6) — tái dùng GET /foundation/audit-logs?moduleCode=HR. Gate = view:audit-log
// (cặp seed thật mig 0340, is_sensitive=true) — literal engine pair, cùng kỹ thuật
// LOGIN_LOGS_ROUTE_META (constants.ts cục bộ).
const hrAuditLogsMeta: RouteMeta = {
  routeKey: "hr.audit-logs",
  path: "/hr/audit-logs",
  layout: "MODULE_WORKSPACE",
  moduleCode: "HR",
  screenCode: "HR-SCREEN-AUDIT-LOGS",
  titleKey: "routeTitle.hrAuditLogs",
  requiredAnyPermissions: [HR_AUDIT_LOG_VIEW_PERMISSION],
  showInSidebar: true,
  order: 24,
};
const hrAuditLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hr/audit-logs",
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(hrAuditLogsMeta, "HR", <HrAuditLogsPage />),
});

// HR employee-code config (S2-FE-HR-8) — /hr/settings/employee-code. Local RouteMeta (KHÔNG ở
// ROUTE_REGISTRY web-core, cùng pattern hrOrgChartRoute/hrAuditLogsRoute).
const hrEmployeeCodeConfigRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: EMPLOYEE_CODE_CONFIG_PATH,
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(EMPLOYEE_CODE_CONFIG_ROUTE_META, "HR", <EmployeeCodeConfigPage />),
});

// Profile change request workflow (S2-FE-HR-4) — RouteMeta CỤC BỘ (literal engine pair, KHÔNG đụng
// ROUTE_REGISTRY của web-core — cùng kỹ thuật system.login-logs/system.files).
const hrMeChangeRequestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: PCR_ME_PATH,
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(PCR_ME_ROUTE_META, "HR", <MyChangeRequestPage />),
});
const hrProfileChangeRequestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: PCR_LIST_PATH,
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(PCR_LIST_ROUTE_META, "HR", <ProfileChangeRequestListPage />),
});
const hrProfileChangeRequestDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hr/profile-change-requests/$id",
  beforeLoad: authGuard,
  component: () => {
    const { id } = hrProfileChangeRequestDetailRoute.useParams();
    return buildModuleRouteContent(
      PCR_DETAIL_ROUTE_META,
      "HR",
      <ProfileChangeRequestDetailPage requestId={id} />,
    );
  },
});
// S2-FE-HR-5 — HR master-data admin screens (list + CRUD). Cổng route = cặp ĐỌC (departments/positions)
// hoặc manage:master-data DUY NHẤT (job-levels/contract-types) qua RouteMeta trong ROUTE_REGISTRY.
const hrDepartmentsRoute = makeModuleRoute(
  "/hr/departments",
  "hr.departments",
  "HR",
  DepartmentsPage,
);
const hrPositionsRoute = makeModuleRoute("/hr/positions", "hr.positions", "HR", PositionsPage);
const hrJobLevelsRoute = makeModuleRoute("/hr/job-levels", "hr.job-levels", "HR", JobLevelsPage);
const hrContractTypesRoute = makeModuleRoute(
  "/hr/contract-types",
  "hr.contract-types",
  "HR",
  ContractTypesPage,
);
// S2-FE-HR-7 — Hợp đồng lao động toàn công ty (đọc, theo data-scope). Cổng route = HR.CONTRACT.VIEW.
const hrContractsRoute = makeModuleRoute("/hr/contracts", "hr.contracts", "HR", ContractsPage);

// HR employee create — static "new" segment ranks above the "$employeeId" param route, so it never
// collides with detail. Reuses hr.employees meta (route-level VIEW gate); EmployeeFormPage applies the
// finer create:employee useCan check, and the server PermissionGuard is the real gate.
const hrEmployeeCreateMeta = getMeta("hr.employees");
const hrEmployeeCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hr/employees/new",
  beforeLoad: authGuard,
  component: () => {
    const navigate = useNavigate();
    return buildModuleRouteContent(
      hrEmployeeCreateMeta,
      "HR",
      <EmployeeFormPage
        onSuccess={(id) =>
          void navigate({ to: "/hr/employees/$employeeId", params: { employeeId: id } })
        }
        onCancel={() => void navigate({ to: "/hr/employees" as "/" })}
      />,
    );
  },
});

// HR detail — no sidebar entry; path param resolved via useParams.
// Dùng CÙNG ProtectedRoute như các route module khác (KHÔNG authGuard trần) để guardResult được
// tiêu thụ ở tầng route: thiếu HR.EMPLOYEE.VIEW → 403, không render detail. Meta tái dùng hr.employees
// (cùng yêu cầu HR.EMPLOYEE.VIEW); masking field nhạy cảm do server + useCan trong EmployeeDetailPage.
const hrEmployeeDetailMeta = getMeta("hr.employees");
const hrEmployeeDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hr/employees/$employeeId",
  beforeLoad: authGuard,
  component: () => {
    const { employeeId } = hrEmployeeDetailRoute.useParams();
    const navigate = useNavigate();
    return buildModuleRouteContent(
      hrEmployeeDetailMeta,
      "HR",
      <EmployeeDetailPage
        employeeId={employeeId}
        onEdit={() =>
          void navigate({ to: "/hr/employees/$employeeId/edit", params: { employeeId } })
        }
        onContracts={() =>
          void navigate({ to: "/hr/employees/$employeeId/contracts", params: { employeeId } })
        }
      />,
    );
  },
});

// HR employee edit — reuses hr.employees meta; EmployeeFormPage applies the update:employee useCan gate.
const hrEmployeeEditMeta = getMeta("hr.employees");
const hrEmployeeEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hr/employees/$employeeId/edit",
  beforeLoad: authGuard,
  component: () => {
    const { employeeId } = hrEmployeeEditRoute.useParams();
    const navigate = useNavigate();
    const toDetail = () =>
      void navigate({ to: "/hr/employees/$employeeId", params: { employeeId } });
    return buildModuleRouteContent(
      hrEmployeeEditMeta,
      "HR",
      <EmployeeFormPage employeeId={employeeId} onSuccess={toDetail} onCancel={toDetail} />,
    );
  },
});

// HR employee contracts — /hr/employees/:id/contracts (S2-FE-HR-7). Reuses hr.employees meta (route-level
// HR.EMPLOYEE.VIEW gate); EmployeeContractsPage applies the finer view/manage:contract useCan checks —
// server PermissionGuard is the real gate (mirrors hrEmployeeEditRoute pattern).
const hrEmployeeContractsMeta = getMeta("hr.employees");
const hrEmployeeContractsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/hr/employees/$employeeId/contracts",
  beforeLoad: authGuard,
  component: () => {
    const { employeeId } = hrEmployeeContractsRoute.useParams();
    const navigate = useNavigate();
    return buildModuleRouteContent(
      hrEmployeeContractsMeta,
      "HR",
      <EmployeeContractsPage
        employeeId={employeeId}
        onBack={() => void navigate({ to: "/hr/employees/$employeeId", params: { employeeId } })}
      />,
    );
  },
});

// Attendance
const attTodayRoute = makeModuleRoute("/attendance/today", "att.today", "ATT", AttendanceTodayPage);
const attMyRecordsRoute = makeModuleRoute(
  "/attendance/my-records",
  "att.my-records",
  "ATT",
  MyAttendanceRecordsPage,
);
const attTeamRecordsRoute = makeModuleRoute(
  "/attendance/team-records",
  "att.team-records",
  "ATT",
  TeamAttendanceRecordsPage,
);
// Company-wide records (att.records) — S3-FE-ATT-5.
const attRecordsRoute = makeModuleRoute(
  "/attendance/records",
  "att.records",
  "ATT",
  AttendanceCompanyRecordsPage,
);

// Shift / shift-assignment / rule (admin, read-only minimum) — S3-FE-ATT-5. CRUD carry-over CO-S4-007.
const attShiftsRoute = makeModuleRoute(
  "/attendance/shifts",
  "att.shifts",
  "ATT",
  AttendanceShiftsPage,
);
const attShiftAssignmentsRoute = makeModuleRoute(
  "/attendance/shift-assignments",
  "att.shift-assignments",
  "ATT",
  AttendanceShiftAssignmentsPage,
);
const attRulesRoute = makeModuleRoute("/attendance/rules", "att.rules", "ATT", AttendanceRulesPage);

// Attendance record detail — local RouteMeta (no sidebar entry).
// ANY of VIEW_OWN/VIEW_TEAM/VIEW_COMPANY grants route access; actual 403/404 from server.
// Pattern: systemLoginLogsRoute (local meta, buildModuleRouteContent → ProtectedRoute guard).
const attRecordDetailMeta: RouteMeta = {
  routeKey: "att.record-detail",
  path: "/attendance/records/:recordId",
  layout: "MODULE_WORKSPACE",
  moduleCode: "ATT",
  screenCode: "ATT-SCREEN-004",
  titleKey: "routeTitle.attRecordDetail",
  requiredAnyPermissions: [
    "ATT.ATTENDANCE.VIEW_OWN",
    "ATT.ATTENDANCE.VIEW_TEAM",
    "ATT.ATTENDANCE.VIEW_COMPANY",
  ],
};
const attRecordDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/records/$recordId",
  beforeLoad: authGuard,
  component: () => {
    const { recordId } = attRecordDetailRoute.useParams();
    return buildModuleRouteContent(
      attRecordDetailMeta,
      "ATT",
      <AttendanceRecordDetailPage recordId={recordId} />,
    );
  },
});

// Remote/onsite-work requests — S3-FE-ATT-4. Gate = CẶP ENGINE THỰC trực tiếp (KHÔNG qua
// PERMISSION_CODE_TO_PAIR — cùng kỹ thuật att.shifts/att.rules, tránh drift).
const attRemoteWorkRequestsMeta: RouteMeta = {
  routeKey: "att.remote-work-requests",
  path: "/attendance/remote-work-requests",
  layout: "MODULE_WORKSPACE",
  moduleCode: "ATT",
  screenCode: "ATT-SCREEN-012",
  titleKey: "routeTitle.attRemoteWorkRequests",
  requiredAnyPermissions: [
    "create-own:remote-request",
    "view-own:remote-request",
    "view-team:remote-request",
    "view-company:remote-request",
  ],
};
const attRemoteWorkRequestsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/remote-work-requests",
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(attRemoteWorkRequestsMeta, "ATT", <RemoteWorkRequestsPage />),
});

// Create — static "new" segment ranks above the "$requestId" param route.
const attRemoteWorkRequestNewMeta: RouteMeta = {
  routeKey: "att.remote-work-requests.new",
  path: "/attendance/remote-work-requests/new",
  layout: "MODULE_WORKSPACE",
  moduleCode: "ATT",
  screenCode: "ATT-SCREEN-011",
  titleKey: "routeTitle.attRemoteWorkRequests",
  requiredAnyPermissions: ["create-own:remote-request"],
};
const attRemoteWorkRequestNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/remote-work-requests/new",
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(attRemoteWorkRequestNewMeta, "ATT", <CreateRemoteWorkRequestPage />),
});

const attRemoteWorkRequestDetailMeta: RouteMeta = {
  routeKey: "att.remote-work-requests.detail",
  path: "/attendance/remote-work-requests/:requestId",
  layout: "MODULE_WORKSPACE",
  moduleCode: "ATT",
  screenCode: "ATT-SCREEN-013",
  titleKey: "routeTitle.attRemoteWorkRequests",
  requiredAnyPermissions: [
    "view-own:remote-request",
    "view-team:remote-request",
    "view-company:remote-request",
  ],
};
const attRemoteWorkRequestDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/remote-work-requests/$requestId",
  beforeLoad: authGuard,
  component: () => {
    const { requestId } = attRemoteWorkRequestDetailRoute.useParams();
    return buildModuleRouteContent(
      attRemoteWorkRequestDetailMeta,
      "ATT",
      <RemoteWorkRequestDetailPage requestId={requestId} />,
    );
  },
});

// Reports + audit logs — S3-FE-ATT-6. Gate = CẶP ENGINE THỰC trực tiếp (view-team/view-company:attendance
// dùng chung với records; view:attendance-audit-log RIÊNG của ATT).
const attReportsMeta: RouteMeta = {
  routeKey: "att.reports",
  path: "/attendance/reports",
  layout: "MODULE_WORKSPACE",
  moduleCode: "ATT",
  screenCode: "ATT-SCREEN-018",
  titleKey: "routeTitle.attReports",
  requiredAnyPermissions: ["view-team:attendance", "view-company:attendance"],
};
const attReportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/reports",
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(attReportsMeta, "ATT", <AttendanceReportsPage />),
});

const attAuditLogsMeta: RouteMeta = {
  routeKey: "att.audit-logs",
  path: "/attendance/audit-logs",
  layout: "MODULE_WORKSPACE",
  moduleCode: "ATT",
  screenCode: "ATT-SCREEN-019",
  titleKey: "routeTitle.attAuditLogs",
  requiredAnyPermissions: ["view:attendance-audit-log"],
};
const attAuditLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/audit-logs",
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(attAuditLogsMeta, "ATT", <AttendanceAuditLogsPage />),
});

// Đơn điều chỉnh công (S3-FE-ATT-3, ATT-SCREEN-006..010) — local RouteMeta (cùng kỹ thuật
// attRecordDetailMeta). view-own/view-team/view-company/approve/reject:adjustment + adjust-direct:attendance
// đều SENSITIVE nhưng KHÔNG allowlisted (permission.service.ts SENSITIVE_CAPABILITY_ALLOWLIST) → dùng
// reach-permission ALLOWLISTED liên quan (view-own/team/company:attendance) làm gợi ý hiển thị route; cổng
// thật vẫn ở server (403/404 theo response — xem adjustment/constants.ts).
const attAdjustmentNewMeta: RouteMeta = {
  routeKey: "att.adjustment-requests.new",
  path: "/attendance/adjustment-requests/new",
  layout: "MODULE_WORKSPACE",
  moduleCode: "ATT",
  screenCode: "ATT-SCREEN-006",
  titleKey: "routeTitle.attAdjustmentNew",
  requiredAnyPermissions: ["create-own:adjustment"],
};
const attAdjustmentNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/adjustment-requests/new",
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(attAdjustmentNewMeta, "ATT", <CreateAdjustmentRequestPage />),
});

const attAdjustmentMyMeta: RouteMeta = {
  routeKey: "att.adjustment-requests.my",
  path: "/attendance/adjustment-requests/my",
  layout: "MODULE_WORKSPACE",
  moduleCode: "ATT",
  screenCode: "ATT-SCREEN-007",
  titleKey: "routeTitle.attAdjustmentMy",
  requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_OWN"],
  showInSidebar: true,
  order: 37,
};
const attAdjustmentMyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/adjustment-requests/my",
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(attAdjustmentMyMeta, "ATT", <MyAdjustmentRequestsPage />),
});

const attAdjustmentListMeta: RouteMeta = {
  routeKey: "att.adjustment-requests",
  path: "/attendance/adjustment-requests",
  layout: "MODULE_WORKSPACE",
  moduleCode: "ATT",
  screenCode: "ATT-SCREEN-008",
  titleKey: "routeTitle.attAdjustmentList",
  requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_TEAM", "ATT.ATTENDANCE.VIEW_COMPANY"],
  showInSidebar: true,
  order: 38,
};
const attAdjustmentListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/adjustment-requests",
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(attAdjustmentListMeta, "ATT", <AdjustmentRequestsPage />),
});

const attAdjustmentDetailMeta: RouteMeta = {
  routeKey: "att.adjustment-requests.detail",
  path: "/attendance/adjustment-requests/:requestId",
  layout: "MODULE_WORKSPACE",
  moduleCode: "ATT",
  screenCode: "ATT-SCREEN-009",
  titleKey: "routeTitle.attAdjustmentDetail",
  requiredAnyPermissions: [
    "ATT.ATTENDANCE.VIEW_OWN",
    "ATT.ATTENDANCE.VIEW_TEAM",
    "ATT.ATTENDANCE.VIEW_COMPANY",
  ],
};
const attAdjustmentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/adjustment-requests/$requestId",
  beforeLoad: authGuard,
  component: () => {
    const { requestId } = attAdjustmentDetailRoute.useParams();
    return buildModuleRouteContent(
      attAdjustmentDetailMeta,
      "ATT",
      <AdjustmentRequestDetailPage requestId={requestId} />,
    );
  },
});

const attRecordAdjustMeta: RouteMeta = {
  routeKey: "att.records.adjust",
  path: "/attendance/records/:recordId/adjust",
  layout: "MODULE_WORKSPACE",
  moduleCode: "ATT",
  screenCode: "ATT-SCREEN-010",
  titleKey: "routeTitle.attRecordAdjust",
  requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_TEAM", "ATT.ATTENDANCE.VIEW_COMPANY"],
};
const attRecordAdjustRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attendance/records/$recordId/adjust",
  beforeLoad: authGuard,
  component: () => {
    const { recordId } = attRecordAdjustRoute.useParams();
    return buildModuleRouteContent(
      attRecordAdjustMeta,
      "ATT",
      <DirectAdjustPage recordId={recordId} />,
    );
  },
});

// Leave
// S3-FE-LEAVE-7 — /leave nay là LeaveOverviewPage (hub tổng quan). Số dư phép self-service DỜI sang
// /leave/me/balances (leaveMyBalancesRoute) — REUSE meta leave.overview (requiredAny LEAVE.REQUEST.VIEW_OWN,
// đã map PERMISSION_CODE_TO_PAIR → view-own:leave). KHÔNG dùng LEAVE.BALANCE.VIEW_OWN (chưa map → SHOW_403).
const leaveRoute = makeModuleRoute("/leave", "leave.overview", "LEAVE", LeaveOverviewPage);
const leaveMyBalancesMeta = getMeta("leave.overview");
const leaveMyBalancesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave/me/balances",
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(leaveMyBalancesMeta, "LEAVE", <MyLeaveBalancePage />),
});
const leaveMyRequestsRoute = makeModuleRoute(
  "/leave/me/requests",
  "leave.my-requests",
  "LEAVE",
  MyLeaveRequestsPage,
);
const leaveApprovalsRoute = makeModuleRoute(
  "/leave/approvals",
  "leave.approvals",
  "LEAVE",
  LeaveApprovalPage,
);

// S3-FE-LEAVE-3 — LEAVE-SCREEN-006 (tất cả đơn nghỉ, HR/Admin).
const leaveAllRequestsRoute = makeModuleRoute(
  "/leave/requests",
  "leave.all-requests",
  "LEAVE",
  AllLeaveRequestsPage,
);

// S3-FE-LEAVE-4 — LEAVE-SCREEN-007/008/009 (lịch nghỉ own/team/company).
const leaveCalendarRoute = makeModuleRoute(
  "/leave/calendar",
  "leave.calendar",
  "LEAVE",
  LeaveCalendarPage,
);

// Leave edit draft — static "$requestId/edit" ranks BELOW the exact "/leave/requests" list route
// (TanStack router disambiguates static-segment routes from param routes automatically). Reuses
// leave.my-requests meta (route-level gate = LEAVE.REQUEST.VIEW_OWN, đủ để render workspace; gate
// TINH hơn — update-draft:leave — áp trong EditLeaveDraftPage, khớp pattern hrEmployeeEditRoute).
const leaveEditMeta = getMeta("leave.my-requests");
const leaveEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave/requests/$requestId/edit",
  beforeLoad: authGuard,
  component: () => {
    const { requestId } = leaveEditRoute.useParams();
    return buildModuleRouteContent(
      leaveEditMeta,
      "LEAVE",
      <EditLeaveDraftPage requestId={requestId} />,
    );
  },
});

// Leave create — static "new" segment before "$requestId" param route
const leaveCreateMeta = getMeta("leave.my-requests");
const leaveCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave/me/requests/new",
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(leaveCreateMeta, "LEAVE", <CreateLeaveRequestPage />),
});

// Leave detail — local RouteMeta (no sidebar entry; reuses leave.my-requests permission).
// Pattern mirrors systemLoginLogsRoute: local meta, buildModuleRouteContent → ProtectedRoute guard.
const leaveDetailMeta = getMeta("leave.my-requests");
const leaveDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave/me/requests/$requestId",
  beforeLoad: authGuard,
  component: () => {
    const { requestId } = leaveDetailRoute.useParams();
    return buildModuleRouteContent(
      leaveDetailMeta,
      "LEAVE",
      <LeaveRequestDetailPage requestId={requestId} />,
    );
  },
});

// S3-FE-LEAVE-5 — admin: Loại nghỉ phép (LEAVE-SCREEN-010). Gate = view:leave-type (KHÔNG sensitive,
// mig 0455) — cặp ENGINE THỰC trực tiếp (KHÔNG qua PERMISSION_CODE_TO_PAIR, tránh drift đã gặp
// S1-FND-MODULE — cùng kỹ thuật att.shifts/hr.org-chart).
const leaveTypesMeta: RouteMeta = {
  routeKey: "leave.types",
  path: LEAVE_PATHS.TYPES,
  layout: "MODULE_WORKSPACE",
  moduleCode: "LEAVE",
  screenCode: "LEAVE-SCREEN-010",
  titleKey: "routeTitle.leaveTypes",
  requiredAnyPermissions: [
    `${LEAVE_ENGINE_PAIRS.VIEW_LEAVE_TYPE.action}:${LEAVE_ENGINE_PAIRS.VIEW_LEAVE_TYPE.resourceType}`,
  ],
  showInSidebar: true,
  order: 60,
};
const leaveTypesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LEAVE_PATHS.TYPES,
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(leaveTypesMeta, "LEAVE", <LeaveTypesPage />),
});

// S3-FE-LEAVE-5 — admin: Chính sách nghỉ phép (LEAVE-SCREEN-011). Gate = view:leave-policy (SENSITIVE,
// Company-scope hr/company-admin, mig 0455).
const leavePoliciesMeta: RouteMeta = {
  routeKey: "leave.policies",
  path: LEAVE_PATHS.POLICIES,
  layout: "MODULE_WORKSPACE",
  moduleCode: "LEAVE",
  screenCode: "LEAVE-SCREEN-011",
  titleKey: "routeTitle.leavePolicies",
  requiredAnyPermissions: [
    `${LEAVE_ENGINE_PAIRS.VIEW_LEAVE_POLICY.action}:${LEAVE_ENGINE_PAIRS.VIEW_LEAVE_POLICY.resourceType}`,
  ],
  showInSidebar: true,
  order: 61,
};
const leavePoliciesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LEAVE_PATHS.POLICIES,
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(leavePoliciesMeta, "LEAVE", <LeavePoliciesPage />),
});

// S3-FE-LEAVE-5 — admin: Số dư phép nhân viên (LEAVE-SCREEN-012). Gate = view:leave-balance (SENSITIVE,
// Company-scope hr/company-admin, mig 0455).
const leaveBalancesMeta: RouteMeta = {
  routeKey: "leave.balances",
  path: LEAVE_PATHS.BALANCES,
  layout: "MODULE_WORKSPACE",
  moduleCode: "LEAVE",
  screenCode: "LEAVE-SCREEN-012",
  titleKey: "routeTitle.leaveBalances",
  requiredAnyPermissions: [
    `${LEAVE_ENGINE_PAIRS.VIEW_BALANCE.action}:${LEAVE_ENGINE_PAIRS.VIEW_BALANCE.resourceType}`,
  ],
  showInSidebar: true,
  order: 62,
};
const leaveBalancesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LEAVE_PATHS.BALANCES,
  beforeLoad: authGuard,
  component: () => {
    const navigate = useNavigate();
    return buildModuleRouteContent(
      leaveBalancesMeta,
      "LEAVE",
      <LeaveBalancesPage
        onViewTransactions={(balanceId) =>
          void navigate({
            to: "/leave/balances/$balanceId/transactions",
            params: { balanceId },
          })
        }
      />,
    );
  },
});

// Ledger giao dịch số dư (LEAVE-SCREEN-013) — local RouteMeta (no sidebar entry, path param). Gate =
// view-transaction:leave-balance (SENSITIVE, mirrors leaveBalancesMeta pattern).
const leaveBalanceTransactionsMeta: RouteMeta = {
  routeKey: "leave.balances.transactions",
  path: "/leave/balances/:balanceId/transactions",
  layout: "MODULE_WORKSPACE",
  moduleCode: "LEAVE",
  screenCode: "LEAVE-SCREEN-013",
  titleKey: "routeTitle.leaveBalanceTransactions",
  requiredAnyPermissions: [
    `${LEAVE_ENGINE_PAIRS.VIEW_TRANSACTION_BALANCE.action}:${LEAVE_ENGINE_PAIRS.VIEW_TRANSACTION_BALANCE.resourceType}`,
  ],
};
const leaveBalanceTransactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/leave/balances/$balanceId/transactions",
  beforeLoad: authGuard,
  component: () => {
    const { balanceId } = leaveBalanceTransactionsRoute.useParams();
    const navigate = useNavigate();
    return buildModuleRouteContent(
      leaveBalanceTransactionsMeta,
      "LEAVE",
      <LeaveBalanceTransactionsPage
        balanceId={balanceId}
        onBack={() => void navigate({ to: LEAVE_PATHS.BALANCES as "/" })}
      />,
    );
  },
});

// S3-FE-LEAVE-6 — Báo cáo tổng hợp nghỉ (LEAVE-SCREEN-013) + Audit log nghỉ phép (LEAVE-SCREEN-014A).
// Gate = CẶP ENGINE THỰC trực tiếp (KHÔNG qua PERMISSION_CODE_TO_PAIR — cùng kỹ thuật att.reports/
// att.audit-logs, tránh drift). export:leave + view:leave-audit-log là cặp SENSITIVE seed Company-scope
// hr/company-admin (mig 0455) — phơi qua /auth/me nhờ S2-AUTH-CAP-1 (allowlist) nên route-guard resolve
// được; page tự gate lại bằng useCanExact. KHÔNG dựng biến thể team/manager (seed KHÔNG grant manager).
const leaveReportsMeta: RouteMeta = {
  routeKey: "leave.reports",
  path: LEAVE_PATHS.REPORTS,
  layout: "MODULE_WORKSPACE",
  moduleCode: "LEAVE",
  screenCode: "LEAVE-SCREEN-013",
  titleKey: "routeTitle.leaveReports",
  requiredAnyPermissions: [
    `${LEAVE_ENGINE_PAIRS.EXPORT_LEAVE.action}:${LEAVE_ENGINE_PAIRS.EXPORT_LEAVE.resourceType}`,
  ],
};
const leaveReportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LEAVE_PATHS.REPORTS,
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(leaveReportsMeta, "LEAVE", <LeaveReportsPage />),
});

const leaveAuditLogsMeta: RouteMeta = {
  routeKey: "leave.audit-logs",
  path: LEAVE_PATHS.AUDIT_LOGS,
  layout: "MODULE_WORKSPACE",
  moduleCode: "LEAVE",
  screenCode: "LEAVE-SCREEN-014A",
  titleKey: "routeTitle.leaveAuditLogs",
  requiredAnyPermissions: [
    `${LEAVE_ENGINE_PAIRS.VIEW_AUDIT_LOG.action}:${LEAVE_ENGINE_PAIRS.VIEW_AUDIT_LOG.resourceType}`,
  ],
};
const leaveAuditLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LEAVE_PATHS.AUDIT_LOGS,
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(leaveAuditLogsMeta, "LEAVE", <LeaveAuditLogsPage />),
});

// Tasks — S4-FE-TASK-2: List (TASK-SCREEN-005) + My Tasks (TASK-SCREEN-009) THAY ModulePlaceholder.
const TaskListPage = React.lazy(() =>
  import("@/routes/tasks/TaskListPage").then((m) => ({ default: m.TaskListPage })),
);
const MyTasksPage = React.lazy(() =>
  import("@/routes/tasks/MyTasksPage").then((m) => ({ default: m.MyTasksPage })),
);
const TaskDetailPage = React.lazy(() =>
  import("@/routes/tasks/TaskDetailPage").then((m) => ({ default: m.TaskDetailPage })),
);

const tasksRoute = makeModuleRoute("/tasks", "task.overview", "TASK", TaskListPage);
const tasksMyTasksRoute = makeModuleRoute("/tasks/my-tasks", "task.my-tasks", "TASK", MyTasksPage);

// S4-FE-TASK-1 — Project List (TASK-SCREEN-001) + Detail (TASK-SCREEN-003, deep link $projectId).
const ProjectListPage = React.lazy(() =>
  import("@/routes/tasks/ProjectListPage").then((m) => ({ default: m.ProjectListPage })),
);
const ProjectDetailPage = React.lazy(() =>
  import("@/routes/tasks/ProjectDetailPage").then((m) => ({ default: m.ProjectDetailPage })),
);

const tasksProjectsRoute = makeModuleRoute(
  "/tasks/projects",
  "task.projects.list",
  "TASK",
  ProjectListPage,
);

// Project detail — no sidebar entry; path param resolved via useParams (mirror hrEmployeeDetailRoute).
const tasksProjectDetailMeta = getMeta("task.projects.detail");
const tasksProjectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/projects/$projectId",
  beforeLoad: authGuard,
  component: () => {
    const { projectId } = tasksProjectDetailRoute.useParams();
    const navigate = useNavigate();
    return buildModuleRouteContent(
      tasksProjectDetailMeta,
      "TASK",
      <ProjectDetailPage
        projectId={projectId}
        onBack={() => void navigate({ to: "/tasks/projects" as "/" })}
      />,
    );
  },
});

// Task detail — S4-FE-TASK-2 (TASK-SCREEN-007). No sidebar entry; path param resolved via useParams
// (mirror tasksProjectDetailRoute). Reuses "task.overview" meta (route-level gate = TASK.TASK.VIEW →
// read:task) — finer per-action gate (update/delete/assign/comment/…) applied inside TaskDetailPage via
// useCan/useCanExact. Static "/tasks/projects" and "/tasks/my-tasks" rank ABOVE this param route
// (TanStack Router disambiguates static segments before param — mirror hrEmployeeCreateRoute note).
const tasksTaskDetailMeta = getMeta("task.overview");
const tasksTaskDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tasks/$taskId",
  beforeLoad: authGuard,
  component: () => {
    const { taskId } = tasksTaskDetailRoute.useParams();
    const navigate = useNavigate();
    return buildModuleRouteContent(
      tasksTaskDetailMeta,
      "TASK",
      <TaskDetailPage taskId={taskId} onBack={() => void navigate({ to: "/tasks" as "/" })} />,
    );
  },
});

// Notifications
const notificationsRoute = makeModuleRoute(
  "/notifications",
  "noti.list",
  "NOTI",
  NotificationListPage,
);

// Notification detail — /notifications/$id (NOTI-SCREEN-DETAIL), path param NOTI_PATHS.DETAIL(id).
// Reuses noti.list meta (cùng gate NOTI.NOTIFICATION.VIEW_OWN) — mirrors hrEmployeeDetailRoute pattern:
// no sidebar entry, path param resolved via useParams, page tự gate tinh hơn bằng useCan(NOTI_ENGINE_PAIRS.*).
const notificationDetailMeta = getMeta("noti.list");
const notificationDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications/$id",
  beforeLoad: authGuard,
  component: () => {
    const { id } = notificationDetailRoute.useParams();
    return buildModuleRouteContent(
      notificationDetailMeta,
      "NOTI",
      <NotificationDetailPage notificationId={id} />,
    );
  },
});

// Notification events (admin catalog) — S4-FE-NOTI-2 (UI-NOTI-SCREEN-004). Path TĨNH 2-segment
// "/notifications/events" — TanStack Router tự xếp hạng route tĩnh trên route param $id (mirror
// tasksProjectRoute/tasksMyTasksRoute vs tasksTaskDetailRoute), KHÔNG cần chỉnh thứ tự mảng addChildren.
// Gate route-level = view:notification-config (ROUTE_REGISTRY noti.events); toggle gate TINH hơn TRONG
// page bằng useCanExact(update:notification-config).
const notificationEventsRoute = makeModuleRoute(
  "/notifications/events",
  "noti.events",
  "NOTI",
  NotificationEventsPage,
);

// Notification delivery-logs viewer (S4-FE-NOTI-3, UI-NOTI-SCREEN-006) — /notifications/delivery-logs.
// Local RouteMeta (KHÔNG ở ROUTE_REGISTRY web-core, cùng pattern hrAuditLogsMeta/systemFileAccessLogsMeta).
// Gate = cặp seed THẬT mig 0481 (view:notification-delivery-log, is_sensitive=true) — literal string,
// page tự double-gate bằng useCanExact (fail-closed, KHÔNG wildcard fallback).
const notificationDeliveryLogsMeta: RouteMeta = {
  routeKey: "noti.delivery-logs",
  path: NOTI_PATHS.DELIVERY_LOGS,
  layout: "MODULE_WORKSPACE",
  moduleCode: "NOTI",
  screenCode: NOTI_SCREEN.DELIVERY_LOGS,
  titleKey: "routeTitle.notificationDeliveryLogs",
  requiredAnyPermissions: [
    `${NOTI_ENGINE_PAIRS.VIEW_DELIVERY_LOG.action}:${NOTI_ENGINE_PAIRS.VIEW_DELIVERY_LOG.resourceType}`,
  ],
};
const notificationDeliveryLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: NOTI_PATHS.DELIVERY_LOGS,
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(notificationDeliveryLogsMeta, "NOTI", <NotificationDeliveryLogsPage />),
});

// System / Foundation — /system landing THAY ModulePlaceholder = System Overview (S2-FE-FND-1).
const systemRoute = makeModuleRoute("/system", "system.overview", "FOUNDATION", SystemOverviewPage);

// Company profile view+edit — RouteMeta CỤC BỘ (KHÔNG ở ROUTE_REGISTRY web-core). Gate = FOUNDATION.COMPANY.VIEW
// (→ view:foundation-company, cặp seed thật mig 0435). ProtectedRoute tiêu thụ guardResult (thiếu → 403).
const systemCompanyMeta: RouteMeta = {
  routeKey: "system.company",
  path: FOUNDATION_PATH.COMPANY,
  layout: "MODULE_WORKSPACE",
  moduleCode: "FOUNDATION",
  screenCode: FOUNDATION_SCREEN.COMPANY,
  titleKey: "routeTitle.systemCompany",
  requiredAnyPermissions: ["FOUNDATION.COMPANY.VIEW"],
};
const systemCompanyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: FOUNDATION_PATH.COMPANY,
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(systemCompanyMeta, "FOUNDATION", <CompanyProfilePage />),
});

// Company settings — gate = FOUNDATION.SETTING.VIEW (→ view:foundation-setting). Path tĩnh sâu hơn
// /system/company nên rank cao hơn (không đụng nhau).
const systemCompanySettingsMeta: RouteMeta = {
  routeKey: "system.company-settings",
  path: FOUNDATION_PATH.COMPANY_SETTINGS,
  layout: "MODULE_WORKSPACE",
  moduleCode: "FOUNDATION",
  screenCode: FOUNDATION_SCREEN.COMPANY_SETTINGS,
  titleKey: "routeTitle.systemCompanySettings",
  requiredAnyPermissions: ["FOUNDATION.SETTING.VIEW"],
};
const systemCompanySettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: FOUNDATION_PATH.COMPANY_SETTINGS,
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(systemCompanySettingsMeta, "FOUNDATION", <CompanySettingsPage />),
});

// System settings (S2-FE-FND-8, UI-SYSTEM-SCREEN-004) — gate DUY NHẤT FOUNDATION.SETTING.SYSTEM_MANAGE
// (→ system-manage:foundation-setting, cặp seed thật mig 0435:343, is_sensitive=TRUE). Meta CHUYỂN về
// foundation/constants (nguồn CHUNG với sidebar entry — chống pair-drift, cùng pattern S2-FE-FND-7).
const systemSettingsMeta: RouteMeta = SYSTEM_SETTINGS_ROUTE_META;
const systemSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: FOUNDATION_PATH.SYSTEM_SETTINGS,
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(systemSettingsMeta, "FOUNDATION", <SystemSettingsPage />),
});

// Public Holidays (list + CRUD) — S2-FE-FND-4. Gate = cặp seed THẬT mig 0435 (view:foundation-holiday).
// S2-FE-FND-7: meta CHUYỂN về foundation/constants (nguồn CHUNG với sidebar entry — chống pair-drift).
const systemPublicHolidaysMeta: RouteMeta = SYSTEM_PUBLIC_HOLIDAYS_ROUTE_META;
const systemPublicHolidaysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: FOUNDATION_PATH.PUBLIC_HOLIDAYS,
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(systemPublicHolidaysMeta, "FOUNDATION", <PublicHolidaysPage />),
});

// Health (read-only) — S2-FE-FND-4. HealthController BE @Public() (KHÔNG @RequirePermission, KHÔNG cặp
// 'foundation-health' seed) → gate route bằng baseline "khu vực quản trị hệ thống" GIỐNG system.overview
// (xem constants.ts VIEW_SETTING_BASELINE) thay vì bịa permission code không tồn tại.
// S2-FE-FND-7: meta CHUYỂN về foundation/constants — sidebar entry health dùng CHUNG cả 2 cặp
// (view:foundation-setting + view:user); 1 cặp = mismatch route↔sidebar.
const systemHealthMeta: RouteMeta = SYSTEM_HEALTH_ROUTE_META;
const systemHealthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: FOUNDATION_PATH.HEALTH,
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(systemHealthMeta, "FOUNDATION", <HealthPage />),
});

// Retention Policies (config, governs purge) — S2-FE-FND-6. Gate = cặp seed THẬT mig 0435
// (view:foundation-retention — KHÔNG sensitive). Nút Sửa trong page gate riêng bằng
// manage:foundation-retention (is_sensitive=true, System-scope — KHÔNG tự động cấp company-admin).
// S2-FE-FND-7: meta CHUYỂN về foundation/constants (nguồn CHUNG với sidebar entry).
const systemRetentionMeta: RouteMeta = SYSTEM_RETENTION_ROUTE_META;
const systemRetentionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: FOUNDATION_PATH.RETENTION,
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(systemRetentionMeta, "FOUNDATION", <RetentionPoliciesPage />),
});

// File Access Logs (viewer, append-only) — S2-FE-FND-6. Gate = cặp seed THẬT mig 0435
// (view:foundation-file-access-log — KHÔNG sensitive).
// S2-FE-FND-7: meta CHUYỂN về foundation/constants (nguồn CHUNG với sidebar entry).
const systemFileAccessLogsMeta: RouteMeta = SYSTEM_FILE_ACCESS_LOGS_ROUTE_META;
const systemFileAccessLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: FOUNDATION_PATH.FILE_ACCESS_LOGS,
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(systemFileAccessLogsMeta, "FOUNDATION", <FileAccessLogsPage />),
});

// System Jobs observability (READ-ONLY) — S5-FND-JOBS-OBS-1. Gate = cặp seed THẬT mig 0435
// (view:foundation-job — KHÔNG sensitive). Meta ở foundation/constants (nguồn CHUNG với sidebar entry).
const systemJobsMeta: RouteMeta = SYSTEM_JOBS_ROUTE_META;
const systemJobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: FOUNDATION_PATH.SYSTEM_JOBS,
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(systemJobsMeta, "FOUNDATION", <SystemJobsPage />),
});

const systemUsersRoute = makeModuleRoute("/system/users", "system.users", "FOUNDATION", UsersPage);
const systemRolesRoute = makeModuleRoute("/system/roles", "system.roles", "FOUNDATION", RolesPage);

// S2-FE-AUTH-4 (lane FE batch C) — permission catalog (sidebar) + role create/detail/edit/permissions
// sub-routes. Sub-routes TÁI DÙNG meta "system.roles" (route-level gate = AUTH.ROLE.VIEW) — mirror
// hrEmployeeDetailRoute/hrEmployeeEditRoute (finer create/update/assign gate áp trong page).
const systemPermissionsRoute = makeModuleRoute(
  "/system/permissions",
  "system.permissions",
  "FOUNDATION",
  PermissionsPage,
);

const systemRoleCreateMeta = getMeta("system.roles");
const systemRoleCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/roles/new",
  beforeLoad: authGuard,
  component: () => {
    const navigate = useNavigate();
    return buildModuleRouteContent(
      systemRoleCreateMeta,
      "FOUNDATION",
      <RoleFormPage
        onSuccess={(id) => void navigate({ to: "/system/roles/$roleId", params: { roleId: id } })}
        onCancel={() => void navigate({ to: "/system/roles" as "/" })}
      />,
    );
  },
});

const systemRoleDetailMeta = getMeta("system.roles");
const systemRoleDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/roles/$roleId",
  beforeLoad: authGuard,
  component: () => {
    const { roleId } = systemRoleDetailRoute.useParams();
    const navigate = useNavigate();
    return buildModuleRouteContent(
      systemRoleDetailMeta,
      "FOUNDATION",
      <RoleDetailPage
        roleId={roleId}
        onBack={() => void navigate({ to: "/system/roles" as "/" })}
        onEdit={() => void navigate({ to: "/system/roles/$roleId/edit", params: { roleId } })}
        onManagePermissions={() =>
          void navigate({ to: "/system/roles/$roleId/permissions", params: { roleId } })
        }
        onOpenRole={(newRoleId) =>
          void navigate({ to: "/system/roles/$roleId", params: { roleId: newRoleId } })
        }
      />,
    );
  },
});

const systemRoleEditMeta = getMeta("system.roles");
const systemRoleEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/roles/$roleId/edit",
  beforeLoad: authGuard,
  component: () => {
    const { roleId } = systemRoleEditRoute.useParams();
    const navigate = useNavigate();
    const toDetail = () => void navigate({ to: "/system/roles/$roleId", params: { roleId } });
    return buildModuleRouteContent(
      systemRoleEditMeta,
      "FOUNDATION",
      <RoleFormPage roleId={roleId} onSuccess={toDetail} onCancel={toDetail} />,
    );
  },
});

const systemRolePermissionsMeta = getMeta("system.roles");
const systemRolePermissionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/roles/$roleId/permissions",
  beforeLoad: authGuard,
  component: () => {
    const { roleId } = systemRolePermissionsRoute.useParams();
    const navigate = useNavigate();
    return buildModuleRouteContent(
      systemRolePermissionsMeta,
      "FOUNDATION",
      <RolePermissionsPage
        roleId={roleId}
        onBack={() => void navigate({ to: "/system/roles/$roleId", params: { roleId } })}
      />,
    );
  },
});

// S2-FE-FND-5 (lane FE batch C) — Sequence counters + Seed status (ops admin, read-mostly).
const systemSequencesRoute = makeModuleRoute(
  "/system/sequences",
  "system.sequences",
  "FOUNDATION",
  SequencesPage,
);
const systemSeedsRoute = makeModuleRoute("/system/seeds", "system.seeds", "FOUNDATION", SeedsPage);

// S2-FE-AUTH-5 (lane FE batch C) — /account/sessions. Authenticated-only (KHÔNG ModuleWorkspaceLayout/
// ProtectedRoute meta-gate — session self-service KHÔNG có permission pair, mirror homeRoute wiring).
const accountSessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account/sessions",
  beforeLoad: authGuard,
  component: () => buildShellRouteContent(<AccountSessionsPage />),
});

// S2-FE-AUTH-6 — /account/setup-2fa. Ép enroll khi `mustSetupTwoFactor` (AUTH-003); ProtectedShell TỰ
// điều hướng tới đây, route content chỉ cần authGuard (không permission pair — self-service, giống
// accountSessionsRoute/accountChangePasswordRoute).
const accountSetupTwoFactorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ACCOUNT_SETUP_2FA_PATH,
  beforeLoad: authGuard,
  component: () => buildShellRouteContent(<TwoFactorSetupPage />),
});

// S2-FE-AUTH-6 — /account/profile (đọc). Authenticated-only, KHÔNG permission pair (self-service, đọc
// /auth/me của CHÍNH mình) — mirror accountSessionsRoute wiring.
const accountProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ACCOUNT_PROFILE_PATH,
  beforeLoad: authGuard,
  component: () => buildShellRouteContent(<AccountProfilePage />),
});

// User CRUD — S2-FE-AUTH-3. Reuses "system.users" meta (route-level gate = AUTH.USER.VIEW); finer
// per-action gate (create/update/lock/unlock/assign-role) applied inside each page via useCan —
// mirrors hrEmployeeCreateRoute/hrEmployeeDetailRoute/hrEmployeeEditRoute pattern.
const systemUsersMeta = getMeta("system.users");

// Static "new" segment ranks above the "$userId" param route — never collides with detail.
const systemUserCreateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/users/new",
  beforeLoad: authGuard,
  component: () => {
    const navigate = useNavigate();
    return buildModuleRouteContent(
      systemUsersMeta,
      "FOUNDATION",
      <UserFormPage
        onSuccess={(id) => void navigate({ to: "/system/users/$userId", params: { userId: id } })}
        onCancel={() => void navigate({ to: "/system/users" as "/" })}
      />,
    );
  },
});

// Detail — no sidebar entry; path param resolved via useParams.
const systemUserDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/users/$userId",
  beforeLoad: authGuard,
  component: () => {
    const { userId } = systemUserDetailRoute.useParams();
    const navigate = useNavigate();
    return buildModuleRouteContent(
      systemUsersMeta,
      "FOUNDATION",
      <UserDetailPage
        userId={userId}
        onBack={() => void navigate({ to: "/system/users" as "/" })}
        onEdit={() => void navigate({ to: "/system/users/$userId/edit", params: { userId } })}
        onManageRoles={() =>
          void navigate({ to: "/system/users/$userId/roles", params: { userId } })
        }
      />,
    );
  },
});

// Edit — reuses systemUsersMeta; UserFormPage applies the update:user useCan gate.
const systemUserEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/users/$userId/edit",
  beforeLoad: authGuard,
  component: () => {
    const { userId } = systemUserEditRoute.useParams();
    const navigate = useNavigate();
    const toDetail = () => void navigate({ to: "/system/users/$userId", params: { userId } });
    return buildModuleRouteContent(
      systemUsersMeta,
      "FOUNDATION",
      <UserFormPage userId={userId} onSuccess={toDetail} onCancel={toDetail} />,
    );
  },
});

// Assign-roles — reuses systemUsersMeta; UserRolesPage applies the assign-role:user useCan gate.
const systemUserRolesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/users/$userId/roles",
  beforeLoad: authGuard,
  component: () => {
    const { userId } = systemUserRolesRoute.useParams();
    const navigate = useNavigate();
    return buildModuleRouteContent(
      systemUsersMeta,
      "FOUNDATION",
      <UserRolesPage
        userId={userId}
        onBack={() => void navigate({ to: "/system/users/$userId", params: { userId } })}
      />,
    );
  },
});

// S2-FE-FND-2 — THAY ModulePlaceholder = AuditLogsPage (route đã có sẵn trong ROUTE_REGISTRY,
// gate FOUNDATION.AUDIT_LOG.VIEW → view:audit-log, đã sửa drift trong registry.ts).
const systemAuditLogsRoute = makeModuleRoute(
  "/system/audit-logs",
  "system.audit-logs",
  "FOUNDATION",
  AuditLogsPage,
);

// Audit log detail — local RouteMeta (no sidebar entry; reuses system.audit-logs permission).
// Pattern mirrors hrEmployeeDetailRoute/attRecordDetailRoute: local meta, buildModuleRouteContent →
// ProtectedRoute guard tiêu thụ guardResult.
const systemAuditLogDetailMeta = getMeta("system.audit-logs");
const systemAuditLogDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/audit-logs/$auditLogId",
  beforeLoad: authGuard,
  component: () => {
    const { auditLogId } = systemAuditLogDetailRoute.useParams();
    return buildModuleRouteContent(
      systemAuditLogDetailMeta,
      "FOUNDATION",
      <AuditLogDetailPage auditLogId={auditLogId} />,
    );
  },
});

// System / Foundation — viewer nhật ký bảo mật (S2-AUTH-BE-5). RouteMeta CỤC BỘ (KHÔNG ở
// ROUTE_REGISTRY web-core — lane không sửa web-core); dùng CÙNG buildModuleRouteContent →
// ProtectedRoute tiêu thụ guardResult (thiếu 'view:audit-log' → 403). FOUNDATION module code.
const systemLoginLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: LOGIN_LOGS_PATH,
  beforeLoad: authGuard,
  component: () => buildModuleRouteContent(LOGIN_LOGS_ROUTE_META, "FOUNDATION", <LoginLogsPage />),
});
const systemSecurityEventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SECURITY_EVENTS_PATH,
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(SECURITY_EVENTS_ROUTE_META, "FOUNDATION", <SecurityEventsPage />),
});

// S2-FE-FND-2 — File metadata viewer. Route ADDITIVE trong ROUTE_REGISTRY (system.files, gate
// FOUNDATION.FILE.VIEW → view:foundation-file).
const systemFilesRoute = makeModuleRoute(FILES_PATH, "system.files", "FOUNDATION", FilesPage);

// File detail — local RouteMeta (no sidebar entry; reuses system.files permission).
const systemFileDetailMeta = getMeta("system.files");
const systemFileDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/files/$fileId",
  beforeLoad: authGuard,
  component: () => {
    const { fileId } = systemFileDetailRoute.useParams();
    return buildModuleRouteContent(
      systemFileDetailMeta,
      "FOUNDATION",
      <FileDetailPage fileId={fileId} />,
    );
  },
});

// S2-FE-FND-3 — Module catalog admin. Route ADDITIVE trong ROUTE_REGISTRY (system.modules, gate
// FOUNDATION.MODULE.VIEW → view:foundation-module).
const systemModulesRoute = makeModuleRoute(
  MODULES_PATH,
  "system.modules",
  "FOUNDATION",
  ModulesPage,
);

// Module detail — local RouteMeta (no sidebar entry; reuses system.modules permission).
const systemModuleDetailMeta = getMeta("system.modules");
const systemModuleDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/modules/$moduleCode",
  beforeLoad: authGuard,
  component: () => {
    const { moduleCode } = systemModuleDetailRoute.useParams();
    return buildModuleRouteContent(
      systemModuleDetailMeta,
      "FOUNDATION",
      <ModuleDetailPage moduleCode={moduleCode} />,
    );
  },
});

// Account self-service — /auth/change-password là endpoint JwtAuthGuard-only (KHÔNG PermissionGuard,
// KHÔNG cặp permission `password:*` trong catalog thật) ⇒ route KHÔNG dùng buildModuleRouteContent/
// ProtectedRoute (không có moduleCode/permission để gate) — chỉ cần ProtectedShell (đăng nhập là đủ),
// giống pattern homeRoute/indexRoute.
const accountChangePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account/change-password",
  beforeLoad: authGuard,
  component: () => buildShellRouteContent(<ChangePasswordPage />),
});

// ---------------------------------------------------------------------------
// Error / public routes
// ---------------------------------------------------------------------------
const forbiddenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/403",
  component: () => <ForbiddenPage />,
});

const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  beforeLoad: authGuard,
  component: () => (
    <ProtectedShell>
      <div className="flex min-h-96 items-center justify-center p-8 text-sm text-muted-foreground">
        404 — Không tìm thấy trang.
      </div>
    </ProtectedShell>
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  homeRoute,
  forbiddenRoute,
  dashboardRoute,
  dashboardConfigsRoute,
  hrRoute,
  hrEmployeesRoute,
  hrEmployeeCreateRoute,
  hrEmployeeDetailRoute,
  hrEmployeeEditRoute,
  hrEmployeeContractsRoute,
  hrMeRoute,
  hrOrgChartRoute,
  hrAuditLogsRoute,
  hrEmployeeCodeConfigRoute,
  hrMeChangeRequestRoute,
  hrProfileChangeRequestsRoute,
  hrProfileChangeRequestDetailRoute,
  hrDepartmentsRoute,
  hrPositionsRoute,
  hrJobLevelsRoute,
  hrContractTypesRoute,
  hrContractsRoute,
  attTodayRoute,
  attMyRecordsRoute,
  attTeamRecordsRoute,
  attRecordsRoute,
  attShiftsRoute,
  attShiftAssignmentsRoute,
  attRulesRoute,
  attRecordDetailRoute,
  attRemoteWorkRequestsRoute,
  attRemoteWorkRequestNewRoute,
  attRemoteWorkRequestDetailRoute,
  attReportsRoute,
  attAuditLogsRoute,
  attAdjustmentNewRoute,
  attAdjustmentMyRoute,
  attAdjustmentListRoute,
  attAdjustmentDetailRoute,
  attRecordAdjustRoute,
  leaveRoute,
  leaveMyBalancesRoute,
  leaveMyRequestsRoute,
  leaveCreateRoute,
  leaveDetailRoute,
  leaveApprovalsRoute,
  leaveAllRequestsRoute,
  leaveEditRoute,
  leaveCalendarRoute,
  leaveTypesRoute,
  leavePoliciesRoute,
  leaveBalancesRoute,
  leaveBalanceTransactionsRoute,
  leaveReportsRoute,
  leaveAuditLogsRoute,
  tasksRoute,
  tasksMyTasksRoute,
  tasksProjectsRoute,
  tasksProjectDetailRoute,
  tasksTaskDetailRoute,
  notificationsRoute,
  notificationDetailRoute,
  notificationEventsRoute,
  notificationDeliveryLogsRoute,
  systemRoute,
  systemCompanyRoute,
  systemCompanySettingsRoute,
  systemSettingsRoute,
  systemPublicHolidaysRoute,
  systemHealthRoute,
  systemRetentionRoute,
  systemFileAccessLogsRoute,
  systemJobsRoute,
  systemUsersRoute,
  systemUserCreateRoute,
  systemUserDetailRoute,
  systemUserEditRoute,
  systemUserRolesRoute,
  systemRolesRoute,
  systemPermissionsRoute,
  systemRoleCreateRoute,
  systemRoleDetailRoute,
  systemRoleEditRoute,
  systemRolePermissionsRoute,
  systemSequencesRoute,
  systemSeedsRoute,
  accountSessionsRoute,
  accountSetupTwoFactorRoute,
  accountProfileRoute,
  systemAuditLogsRoute,
  systemAuditLogDetailRoute,
  systemLoginLogsRoute,
  systemSecurityEventsRoute,
  systemFilesRoute,
  systemFileDetailRoute,
  systemModulesRoute,
  systemModuleDetailRoute,
  accountChangePasswordRoute,
  notFoundRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
