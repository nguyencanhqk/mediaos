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
import { HomePage } from "@/routes/home";
import { ForbiddenPage } from "@/routes/forbidden";

// ---------------------------------------------------------------------------
// Auth guard — điều hướng về app đăng nhập trung tâm nếu chưa có phiên.
// SSO: login externalize sang apps/auth. Boot (main.tsx) silent-refresh trước
// khi mount; đây là backstop khi store bị xoá giữa phiên.
// ---------------------------------------------------------------------------
const authGuard = () => {
  if (!useAuthStore.getState().isAuthenticated) {
    throw redirect({ href: getAuthRedirectUrl() });
  }
};

// ---------------------------------------------------------------------------
// Permission guard factory — xây SessionContext từ auth store rồi chạy
// evaluateRouteAccess. Nếu SHOW_403 → render ForbiddenPage (không throw).
// Nếu REDIRECT_LOGIN → throw redirect về auth app.
// ---------------------------------------------------------------------------
function buildSession(): SessionContext {
  const state = useAuthStore.getState();
  // Auth store hiện chưa giữ company / modules đầy đủ (BE chưa wire /me mở rộng).
  // Guard dùng capabilities map (đã có) để kiểm tra permission; company/modules
  // được mở rộng ở S1-FE-LAYOUT-1 khi /auth/me trả đủ payload.
  return {
    status: state.isAuthenticated ? "authenticated" : "unauthenticated",
    user: state.user
      ? {
          id: state.user.id,
          email: state.user.email,
          status:
            (state.user.status as SessionContext["user"] extends null
              ? never
              : NonNullable<SessionContext["user"]>["status"]) ?? "Active",
          companyId: state.user.companyId,
        }
      : null,
    company: null, // populated by S1-FE-LAYOUT-1 after /me expansion
    modules: [], // populated by S1-FE-LAYOUT-1 after /me expansion
  };
}

function buildPermissionChecker() {
  // capabilities map: { "ACTION:RESOURCE": boolean } — flatten sang UserPermission[]
  // format MODULE.RESOURCE.ACTION được lưu trong capabilities với key "action:resource"
  // (useCan dùng "action:resourceType"). Tạm thời chuyển ngược capabilities thành
  // UserPermission[] để feed createPermissionChecker. Full /me payload ở S1-FE-LAYOUT-1.
  const caps = useAuthStore.getState().capabilities;
  const userPermissions = Object.entries(caps)
    .filter(([, v]) => v)
    .map(([key]) => ({ permission: key, scopes: [] as DataScope[] }));
  return createPermissionChecker(userPermissions);
}

/**
 * Tạo beforeLoad guard cho một route có RouteMeta.
 * - Chưa đăng nhập → redirect auth app.
 * - Trái quyền (SHOW_403) → KHÔNG throw; component sẽ render ForbiddenPage.
 *   (TanStack Router không có built-in "render different component" từ beforeLoad
 *   nên guard chỉ throw khi cần redirect; 403 xử lý ở component wrapper.)
 */
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
    // SHOW_403 / SHOW_DISABLED / SHOW_404 → store result for component to consume
    // via route context so it can render ForbiddenPage without a separate route.
    return { guardResult: result };
  };
}

// ---------------------------------------------------------------------------
// Route tree
// ---------------------------------------------------------------------------

const rootRoute = createRootRoute();

// Home — auth-only, no module permission needed
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: authGuard,
  component: HomePage,
});

// /home — canonical Home Portal landing after login
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/home",
  beforeLoad: authGuard,
  component: HomePage,
});

// ---------------------------------------------------------------------------
// Permission-guarded placeholder routes
// Each route uses permissionGuard so direct URL access is blocked at the FE
// layer before the BE enforces it. Component renders ForbiddenPage when guard
// returns SHOW_403; otherwise renders a placeholder until S1-FE-LAYOUT-1.
// ---------------------------------------------------------------------------

function makeGuardedRoute(path: string, meta: RouteMeta, component: () => React.ReactElement) {
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    beforeLoad: permissionGuard(meta),
    component,
  });
}

/** Placeholder component used by module routes not yet implemented. */
function ModulePlaceholder() {
  // eslint is fine: this is a pure scaffold, replaced module-by-module
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
      Module đang xây dựng…
    </div>
  );
}

// Import ROUTE_REGISTRY to pull RouteMeta without duplicating data
import { ROUTE_REGISTRY } from "@mediaos/web-core";

function getMeta(routeKey: string): RouteMeta {
  const meta = ROUTE_REGISTRY.find((r) => r.routeKey === routeKey);
  if (!meta) throw new Error(`[router] RouteMeta not found for key: ${routeKey}`);
  return meta;
}

const dashboardRoute = makeGuardedRoute("/dashboard", getMeta("dashboard"), ModulePlaceholder);
const hrRoute = makeGuardedRoute("/hr", getMeta("hr.overview"), ModulePlaceholder);
const hrEmployeesRoute = makeGuardedRoute(
  "/hr/employees",
  getMeta("hr.employees"),
  ModulePlaceholder,
);
const hrMeRoute = makeGuardedRoute("/hr/me", getMeta("hr.me"), ModulePlaceholder);

const attTodayRoute = makeGuardedRoute(
  "/attendance/today",
  getMeta("att.today"),
  ModulePlaceholder,
);
const attMyRecordsRoute = makeGuardedRoute(
  "/attendance/my-records",
  getMeta("att.my-records"),
  ModulePlaceholder,
);

const leaveRoute = makeGuardedRoute("/leave", getMeta("leave.overview"), ModulePlaceholder);
const leaveMyRequestsRoute = makeGuardedRoute(
  "/leave/me/requests",
  getMeta("leave.my-requests"),
  ModulePlaceholder,
);
const leaveApprovalsRoute = makeGuardedRoute(
  "/leave/approvals",
  getMeta("leave.approvals"),
  ModulePlaceholder,
);

const tasksRoute = makeGuardedRoute("/tasks", getMeta("task.overview"), ModulePlaceholder);
const tasksMyTasksRoute = makeGuardedRoute(
  "/tasks/my-tasks",
  getMeta("task.my-tasks"),
  ModulePlaceholder,
);

const notificationsRoute = makeGuardedRoute(
  "/notifications",
  getMeta("noti.list"),
  ModulePlaceholder,
);

const systemRoute = makeGuardedRoute("/system", getMeta("system.overview"), ModulePlaceholder);
const systemUsersRoute = makeGuardedRoute(
  "/system/users",
  getMeta("system.users"),
  ModulePlaceholder,
);
const systemRolesRoute = makeGuardedRoute(
  "/system/roles",
  getMeta("system.roles"),
  ModulePlaceholder,
);
const systemAuditLogsRoute = makeGuardedRoute(
  "/system/audit-logs",
  getMeta("system.audit-logs"),
  ModulePlaceholder,
);

// 403 page — public, no guard
const forbiddenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/403",
  component: () => <ForbiddenPage />,
});

// 404 catch-all
const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  beforeLoad: authGuard,
  component: () => (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
      404 — Không tìm thấy trang.
    </div>
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
