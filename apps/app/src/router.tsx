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

// System
import { UsersPage } from "@/routes/system/UsersPage";
import { RolesPage } from "@/routes/system/RolesPage";

const hrRoute = makeModuleRoute("/hr", "hr.overview", "HR", EmployeeListPage);
const hrEmployeesRoute = makeModuleRoute("/hr/employees", "hr.employees", "HR", EmployeeListPage);
const hrMeRoute = makeModuleRoute("/hr/me", "hr.me", "HR", MyProfilePage);

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
const attTodayRoute = makeModuleRoute("/attendance/today", "att.today", "ATT", ModulePlaceholder);
const attMyRecordsRoute = makeModuleRoute(
  "/attendance/my-records",
  "att.my-records",
  "ATT",
  ModulePlaceholder,
);

// Leave
const leaveRoute = makeModuleRoute("/leave", "leave.overview", "LEAVE", ModulePlaceholder);
const leaveMyRequestsRoute = makeModuleRoute(
  "/leave/me/requests",
  "leave.my-requests",
  "LEAVE",
  ModulePlaceholder,
);
const leaveApprovalsRoute = makeModuleRoute(
  "/leave/approvals",
  "leave.approvals",
  "LEAVE",
  ModulePlaceholder,
);

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

// System / Foundation
const systemRoute = makeModuleRoute("/system", "system.overview", "FOUNDATION", ModulePlaceholder);
const systemUsersRoute = makeModuleRoute("/system/users", "system.users", "FOUNDATION", UsersPage);
const systemRolesRoute = makeModuleRoute("/system/roles", "system.roles", "FOUNDATION", RolesPage);
const systemAuditLogsRoute = makeModuleRoute(
  "/system/audit-logs",
  "system.audit-logs",
  "FOUNDATION",
  ModulePlaceholder,
);

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
  attTodayRoute,
  attMyRecordsRoute,
  leaveRoute,
  leaveMyRequestsRoute,
  leaveApprovalsRoute,
  tasksRoute,
  tasksMyTasksRoute,
  notificationsRoute,
  systemRoute,
  systemUsersRoute,
  systemRolesRoute,
  systemAuditLogsRoute,
  notFoundRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
