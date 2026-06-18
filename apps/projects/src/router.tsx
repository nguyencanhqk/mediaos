import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { getAuthRedirectUrl, useAuthStore } from "@mediaos/web-core";
import { RootLayout } from "@/routes/root-layout";
import { ProjectsListPage } from "@/routes/projects-list";
import { ProjectWorkspacePage } from "@/routes/project-workspace";
import { ProjectSettingsPage } from "@/routes/project-settings";

const rootRoute = createRootRoute({ component: RootLayout });

/**
 * Guard SSO: chưa đăng nhập → `throw redirect({ href })` RA NGOÀI app đăng nhập trung tâm (apps/auth).
 * Boot (main.tsx) silent-refresh trước khi mount nên đây chủ yếu là backstop khi store bị xoá giữa phiên.
 */
const authGuard = () => {
  if (!useAuthStore.getState().isAuthenticated) throw redirect({ href: getAuthRedirectUrl() });
};

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: authGuard,
  component: ProjectsListPage,
});

const projectWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  beforeLoad: authGuard,
  component: ProjectWorkspacePage,
});

const projectSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/settings",
  beforeLoad: authGuard,
  component: ProjectSettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  projectWorkspaceRoute,
  projectSettingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
