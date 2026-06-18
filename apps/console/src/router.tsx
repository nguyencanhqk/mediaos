import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { HomePage } from "@/routes/home";
import { RootLayout } from "@/routes/root-layout";
import { CompanySettingsPage } from "@/routes/settings/company";
import { PlatformAccountsPage } from "@/routes/settings/platform-accounts";
import { BreakGlassPage } from "@/routes/settings/break-glass";
import { SecuritySettingsPage } from "@/routes/settings/security";
import { getAuthRedirectUrl, useAuthStore } from "@mediaos/web-core";
import { ActivityLogPage } from "@/routes/system/activity-log";

const rootRoute = createRootRoute({ component: RootLayout });

// FS-1b: login đã externalize sang app đăng nhập trung tâm (apps/auth). Guard không còn route `/login` nội bộ
// → chưa đăng nhập thì `throw redirect({ href })` RA NGOÀI (TanStack tự suy `reloadDocument` cho absolute href:
// điều hướng cả trang về auth.<domain>?redirect=<đích> + DỪNG pipeline router). Boot (main.tsx) silent-refresh
// trước khi mount nên đây chủ yếu là backstop khi store bị xoá giữa phiên.
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

// Self-service "Bảo mật tài khoản" — user tự quản 2FA của mình. Chỉ authGuard (không permission-gate,
// giống đổi mật khẩu): TwoFactorSettings đã rời apps/web mồ côi về console (nơi có phiên aud=user).
const securityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/security",
  beforeLoad: authGuard,
  component: SecuritySettingsPage,
});

// CS-1: Nhật ký hoạt động — gate quyền view:audit-log xử lý trong component.
const activityLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/activity-log",
  beforeLoad: authGuard,
  component: ActivityLogPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  companySettingsRoute,
  platformAccountsRoute,
  breakGlassRoute,
  securityRoute,
  activityLogRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
