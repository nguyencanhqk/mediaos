import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { HomePage } from "@/routes/home";
import { RootLayout } from "@/routes/root-layout";
import { CompanySettingsPage } from "@/routes/settings/company";
import { PlatformAccountsPage } from "@/routes/settings/platform-accounts";
import { BreakGlassPage } from "@/routes/settings/break-glass";
import { getAuthRedirectUrl, useAuthStore } from "@mediaos/web-core";

const rootRoute = createRootRoute({ component: RootLayout });

// FS-1b: login đã externalize sang app đăng nhập trung tâm (apps/auth). Guard không còn route `/login` nội bộ
// → chưa đăng nhập thì `throw redirect({ href })` RA NGOÀI (TanStack tự suy `reloadDocument` cho absolute href:
// điều hướng cả trang về auth.<domain>?redirect=<đích> + DỪNG pipeline router, KHÔNG nháy render route khi chưa
// auth). Boot (main.tsx) silent-refresh trước khi mount nên đây chủ yếu là backstop khi store bị xoá giữa phiên.
//
// FS-2 + FS-3 đã DỜI routes org/hr/payroll (→apps/people) và tasks/media/chat/workflows/dashboard/kpi
// (→apps/studio) ra khỏi apps/web. Chỉ còn nhóm `system` (→apps/console ở FS-4) + launcher. Wave 3 xoá apps/web.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    if (!useAuthStore.getState().isAuthenticated) throw redirect({ href: getAuthRedirectUrl() });
  },
  component: HomePage,
});

const authGuard = () => {
  if (!useAuthStore.getState().isAuthenticated) throw redirect({ href: getAuthRedirectUrl() });
};

const companySettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/company",
  beforeLoad: authGuard,
  component: CompanySettingsPage,
});

const platformAccountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/platform-accounts",
  beforeLoad: authGuard,
  component: PlatformAccountsPage,
});

// G6-2 PR-B ROUND 2: "My break-glass grants" — list + JIT reveal (active grants only, ephemeral plaintext).
const breakGlassRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/break-glass",
  beforeLoad: authGuard,
  component: BreakGlassPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  companySettingsRoute,
  platformAccountsRoute,
  breakGlassRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
