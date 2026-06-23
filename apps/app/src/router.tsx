import React from "react";
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import {
  getAuthRedirectUrl,
  useAuthStore,
  evaluateRouteAccess,
  createPermissionChecker,
  type DataScope,
  type RouteMeta,
  type SessionContext,
} from "@mediaos/web-core";
import { ForbiddenPage } from "@/routes/forbidden";
import { ProtectedShell } from "@/layouts/protected/ProtectedShell";
import { HomePortalLayout } from "@/layouts/home/HomePortalLayout";
import { ModuleWorkspaceLayout } from "@/layouts/workspace/ModuleWorkspaceLayout";

// ---------------------------------------------------------------------------
// Auth guard — điều hướng về app đăng nhập trung tâm nếu chưa có phiên.
// ---------------------------------------------------------------------------
const authGuard = () => {
  if (!useAuthStore.getState().isAuthenticated) {
    throw redirect({ href: getAuthRedirectUrl() });
  }
};

// ---------------------------------------------------------------------------
// buildSession — SessionContext từ auth store.
// company/modules populated khi BE wire /me expansion (TODO S1-FE-LAYOUT-1 complete).
// ---------------------------------------------------------------------------
function buildSession(): SessionContext {
  const state = useAuthStore.getState();
  return {
    status: state.isAuthenticated ? "authenticated" : "unauthenticated",
    user: state.user
      ? {
          id: state.user.id,
          email: state.user.email,
          status: (state.user.status as NonNullable<SessionContext["user"]>["status"]) ?? "Active",
          companyId: state.user.companyId,
        }
      : null,
    company: null, // TODO(BE): populate after /me expansion
    modules: [], // TODO(BE): populate after /me expansion
  };
}

function buildPermissionChecker() {
  const caps = useAuthStore.getState().capabilities;
  const userPermissions = Object.entries(caps)
    .filter(([, v]) => v)
    .map(([key]) => ({ permission: key, scopes: [] as DataScope[] }));
  return createPermissionChecker(userPermissions);
}

function permissionGuard(meta: RouteMeta) {
  return () => {
    const state = useAuthStore.getState();
    if (!state.isAuthenticated) {
      throw redirect({ href: getAuthRedirectUrl() });
    }
    const session = buildSession();
    const permission = buildPermissionChecker();
    const result = evaluateRouteAccess(session, meta, permission);
    if (result.action === "REDIRECT_LOGIN") {
      throw redirect({ href: getAuthRedirectUrl() });
    }
    return { guardResult: result };
  };
}

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

function getMeta(routeKey: string): RouteMeta {
  const meta = ROUTE_REGISTRY.find((r) => r.routeKey === routeKey);
  if (!meta) throw new Error(`[router] RouteMeta not found for key: ${routeKey}`);
  return meta;
}

function makeModuleRoute(
  path: string,
  metaKey: string,
  moduleCode: Parameters<typeof ModuleWorkspaceLayout>[0]["moduleCode"],
  PageComponent: () => React.ReactElement,
) {
  const meta = getMeta(metaKey);
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: permissionGuard(meta),
    component: () => (
      <ProtectedShell>
        <ModuleWorkspaceLayout moduleCode={moduleCode}>
          <PageComponent />
        </ModuleWorkspaceLayout>
      </ProtectedShell>
    ),
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
const hrRoute = makeModuleRoute("/hr", "hr.overview", "HR", ModulePlaceholder);
const hrEmployeesRoute = makeModuleRoute("/hr/employees", "hr.employees", "HR", ModulePlaceholder);
const hrMeRoute = makeModuleRoute("/hr/me", "hr.me", "HR", ModulePlaceholder);

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
const systemUsersRoute = makeModuleRoute(
  "/system/users",
  "system.users",
  "FOUNDATION",
  ModulePlaceholder,
);
const systemRolesRoute = makeModuleRoute(
  "/system/roles",
  "system.roles",
  "FOUNDATION",
  ModulePlaceholder,
);
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
