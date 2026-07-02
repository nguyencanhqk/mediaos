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
import { DepartmentsPage } from "@/routes/hr/departments/DepartmentsPage";
import { PositionsPage } from "@/routes/hr/positions/PositionsPage";
import { JobLevelsPage } from "@/routes/hr/job-levels/JobLevelsPage";
import { ContractTypesPage } from "@/routes/hr/contract-types/ContractTypesPage";
// S2-FE-HR-7 — Hợp đồng lao động (company-wide + theo nhân viên)
import { ContractsPage } from "@/routes/hr/contracts/ContractsPage";
import { EmployeeContractsPage } from "@/routes/hr/employees/EmployeeContractsPage";

// Attendance
import { AttendanceTodayPage } from "@/routes/attendance/AttendanceTodayPage";
import { MyAttendanceRecordsPage } from "@/routes/attendance/MyAttendanceRecordsPage";
import { TeamAttendanceRecordsPage } from "@/routes/attendance/TeamAttendanceRecordsPage";
import { AttendanceCompanyRecordsPage } from "@/routes/attendance/AttendanceCompanyRecordsPage";
import { AttendanceRecordDetailPage } from "@/routes/attendance/AttendanceRecordDetailPage";
import { AttendanceShiftsPage } from "@/routes/attendance/AttendanceShiftsPage";
import { AttendanceShiftAssignmentsPage } from "@/routes/attendance/AttendanceShiftAssignmentsPage";
import { AttendanceRulesPage } from "@/routes/attendance/AttendanceRulesPage";
// S3-FE-ATT-4 — Remote/onsite-work requests
import { RemoteWorkRequestsPage } from "@/routes/attendance/remote-work/RemoteWorkRequestsPage";
import { CreateRemoteWorkRequestPage } from "@/routes/attendance/remote-work/CreateRemoteWorkRequestPage";
import { RemoteWorkRequestDetailPage } from "@/routes/attendance/remote-work/RemoteWorkRequestDetailPage";

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

const hrRoute = makeModuleRoute("/hr", "hr.overview", "HR", EmployeeListPage);
const hrEmployeesRoute = makeModuleRoute("/hr/employees", "hr.employees", "HR", EmployeeListPage);
const hrMeRoute = makeModuleRoute("/hr/me", "hr.me", "HR", MyProfilePage);

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
const systemAuditLogsRoute = makeModuleRoute(
  "/system/audit-logs",
  "system.audit-logs",
  "FOUNDATION",
  ModulePlaceholder,
);

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
  hrEmployeeContractsRoute,
  hrMeRoute,
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
  systemRolesRoute,
  systemAuditLogsRoute,
  systemLoginLogsRoute,
  systemSecurityEventsRoute,
  notFoundRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
