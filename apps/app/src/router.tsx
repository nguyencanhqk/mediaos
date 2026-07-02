import React from "react";
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { getAuthRedirectUrl, useAuthStore, type RouteMeta } from "@mediaos/web-core";
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
export function buildModuleRouteContent(
  meta: RouteMeta,
  moduleCode: ModuleCodeArg,
  page: React.ReactNode,
): React.ReactElement {
  return (
    <ProtectedShell>
      <ProtectedRoute meta={meta}>
        <ModuleWorkspaceLayout moduleCode={moduleCode}>{page}</ModuleWorkspaceLayout>
      </ProtectedRoute>
    </ProtectedShell>
  );
}

function makeModuleRoute(
  path: string,
  metaKey: string,
  moduleCode: ModuleCodeArg,
  PageComponent: () => React.ReactElement,
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

/** Placeholder component used for module routes not yet implemented. */
function ModulePlaceholder() {
  return (
    <div className="flex min-h-96 items-center justify-center p-8 text-sm text-muted-foreground">
      Màn hình đang xây dựng…
    </div>
  );
}

// Dashboard
const dashboardRoute = makeModuleRoute("/dashboard", "dashboard", "DASH", ModulePlaceholder);

// HR
import { useNavigate } from "@tanstack/react-router";
import { EmployeeListPage } from "@/routes/hr/employees/EmployeeListPage";
import { EmployeeDetailPage } from "@/routes/hr/employees/EmployeeDetailPage";
import { EmployeeFormPage } from "@/routes/hr/employees/EmployeeFormPage";
import { MyProfilePage } from "@/routes/hr/me/MyProfilePage";
// HR — Profile change request workflow (S2-FE-HR-4)
import { MyChangeRequestPage } from "@/routes/hr/profile-change-requests/MyChangeRequestPage";
import { ProfileChangeRequestListPage } from "@/routes/hr/profile-change-requests/ProfileChangeRequestListPage";
import { ProfileChangeRequestDetailPage } from "@/routes/hr/profile-change-requests/ProfileChangeRequestDetailPage";
import {
  PCR_ME_PATH,
  PCR_LIST_PATH,
  PCR_ME_ROUTE_META,
  PCR_LIST_ROUTE_META,
  PCR_DETAIL_ROUTE_META,
} from "@/routes/hr/profile-change-requests/constants";

// Attendance
import { AttendanceTodayPage } from "@/routes/attendance/AttendanceTodayPage";
import { MyAttendanceRecordsPage } from "@/routes/attendance/MyAttendanceRecordsPage";
import { TeamAttendanceRecordsPage } from "@/routes/attendance/TeamAttendanceRecordsPage";
import { AttendanceCompanyRecordsPage } from "@/routes/attendance/AttendanceCompanyRecordsPage";
import { AttendanceRecordDetailPage } from "@/routes/attendance/AttendanceRecordDetailPage";
import { AttendanceShiftsPage } from "@/routes/attendance/AttendanceShiftsPage";
import { AttendanceShiftAssignmentsPage } from "@/routes/attendance/AttendanceShiftAssignmentsPage";
import { AttendanceRulesPage } from "@/routes/attendance/AttendanceRulesPage";

// Leave
import { MyLeaveBalancePage } from "@/routes/leave/MyLeaveBalancePage";
import { MyLeaveRequestsPage } from "@/routes/leave/MyLeaveRequestsPage";
import { CreateLeaveRequestPage } from "@/routes/leave/CreateLeaveRequestPage";
import { LeaveRequestDetailPage } from "@/routes/leave/LeaveRequestDetailPage";
import { LeaveApprovalPage } from "@/routes/leave/LeaveApprovalPage";
import { AllLeaveRequestsPage } from "@/routes/leave/AllLeaveRequestsPage";
import { EditLeaveDraftPage } from "@/routes/leave/EditLeaveDraftPage";

// System
import { UsersPage } from "@/routes/system/UsersPage";
import { RolesPage } from "@/routes/system/RolesPage";
// System / Users CRUD — S2-FE-AUTH-3
import { UserFormPage } from "@/routes/system/users/UserFormPage";
import { UserDetailPage } from "@/routes/system/users/UserDetailPage";
import { UserRolesPage } from "@/routes/system/users/UserRolesPage";
import { LoginLogsPage } from "@/routes/system/auth-logs/LoginLogsPage";
import { SecurityEventsPage } from "@/routes/system/auth-logs/SecurityEventsPage";
import {
  LOGIN_LOGS_PATH,
  LOGIN_LOGS_ROUTE_META,
  SECURITY_EVENTS_PATH,
  SECURITY_EVENTS_ROUTE_META,
} from "@/routes/system/auth-logs/constants";
// System / Foundation — S2-FE-FND-1 (FND1-APP)
import { SystemOverviewPage } from "@/routes/system/foundation/SystemOverviewPage";
import { CompanyProfilePage } from "@/routes/system/foundation/CompanyProfilePage";
import { CompanySettingsPage } from "@/routes/system/foundation/CompanySettingsPage";
import { SystemSettingsPage } from "@/routes/system/foundation/SystemSettingsPage";
import { FOUNDATION_PATH, FOUNDATION_SCREEN } from "@/routes/system/foundation/constants";
// System / Foundation — Audit log viewer (S2-FE-FND-2)
import { AuditLogsPage } from "@/routes/system/foundation/audit-logs/AuditLogsPage";
import { AuditLogDetailPage } from "@/routes/system/foundation/audit-logs/AuditLogDetailPage";
// System / Foundation — File metadata viewer (S2-FE-FND-2)
import { FilesPage } from "@/routes/system/files/FilesPage";
import { FileDetailPage } from "@/routes/system/files/FileDetailPage";
import { FILES_PATH } from "@/routes/system/files/constants";
// System / Foundation — Module catalog admin (S2-FE-FND-3)
import { ModulesPage } from "@/routes/system/modules/ModulesPage";
import { ModuleDetailPage } from "@/routes/system/modules/ModuleDetailPage";
import { MODULES_PATH } from "@/routes/system/modules/constants";
// Account — self-service (S2-FE-AUTH-2)
import { ChangePasswordPage } from "@/routes/account/ChangePasswordPage";

const hrRoute = makeModuleRoute("/hr", "hr.overview", "HR", EmployeeListPage);
const hrEmployeesRoute = makeModuleRoute("/hr/employees", "hr.employees", "HR", EmployeeListPage);
const hrMeRoute = makeModuleRoute("/hr/me", "hr.me", "HR", MyProfilePage);

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

// Leave
const leaveRoute = makeModuleRoute("/leave", "leave.overview", "LEAVE", MyLeaveBalancePage);
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

// Tasks
const tasksRoute = makeModuleRoute("/tasks", "task.overview", "TASK", ModulePlaceholder);
const tasksMyTasksRoute = makeModuleRoute(
  "/tasks/my-tasks",
  "task.my-tasks",
  "TASK",
  ModulePlaceholder,
);

// Notifications
const notificationsRoute = makeModuleRoute(
  "/notifications",
  "noti.list",
  "NOTI",
  ModulePlaceholder,
);

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

// System settings (SYSTEM_MANAGE) — DEFER: chưa có BE endpoint. Gate tạm bằng cặp seed thật
// FOUNDATION.SETTING.VIEW (admin reach placeholder); KHÔNG nút mutation chết trong page.
const systemSettingsMeta: RouteMeta = {
  routeKey: "system.settings",
  path: FOUNDATION_PATH.SYSTEM_SETTINGS,
  layout: "MODULE_WORKSPACE",
  moduleCode: "FOUNDATION",
  screenCode: FOUNDATION_SCREEN.SYSTEM_SETTINGS,
  titleKey: "routeTitle.systemSettings",
  requiredAnyPermissions: ["FOUNDATION.SETTING.VIEW"],
};
const systemSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: FOUNDATION_PATH.SYSTEM_SETTINGS,
  beforeLoad: authGuard,
  component: () =>
    buildModuleRouteContent(systemSettingsMeta, "FOUNDATION", <SystemSettingsPage />),
});

const systemUsersRoute = makeModuleRoute("/system/users", "system.users", "FOUNDATION", UsersPage);
const systemRolesRoute = makeModuleRoute("/system/roles", "system.roles", "FOUNDATION", RolesPage);

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
  component: () => (
    <ProtectedShell>
      <ChangePasswordPage />
    </ProtectedShell>
  ),
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
  hrRoute,
  hrEmployeesRoute,
  hrEmployeeCreateRoute,
  hrEmployeeDetailRoute,
  hrEmployeeEditRoute,
  hrMeRoute,
  hrMeChangeRequestRoute,
  hrProfileChangeRequestsRoute,
  hrProfileChangeRequestDetailRoute,
  attTodayRoute,
  attMyRecordsRoute,
  attTeamRecordsRoute,
  attRecordsRoute,
  attShiftsRoute,
  attShiftAssignmentsRoute,
  attRulesRoute,
  attRecordDetailRoute,
  leaveRoute,
  leaveMyRequestsRoute,
  leaveCreateRoute,
  leaveDetailRoute,
  leaveApprovalsRoute,
  leaveAllRequestsRoute,
  leaveEditRoute,
  tasksRoute,
  tasksMyTasksRoute,
  notificationsRoute,
  systemRoute,
  systemCompanyRoute,
  systemCompanySettingsRoute,
  systemSettingsRoute,
  systemUsersRoute,
  systemUserCreateRoute,
  systemUserDetailRoute,
  systemUserEditRoute,
  systemUserRolesRoute,
  systemRolesRoute,
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
