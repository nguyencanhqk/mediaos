import { Outlet, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { LoginPage } from "@/routes/login";
import { RootLayout } from "@/routes/root-layout";
import { OperatorHomePage } from "@/routes/operator/home";
import { TenantHomePage } from "@/routes/tenant/tenant-home";
import { useAuthStore } from "@/stores/auth";

const rootRoute = createRootRoute({ component: Outlet });

// Login đứng ngoài layout có sidebar (full-screen).
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

// Layout route pathless (id "app") — bọc mọi route đã đăng nhập + chặn truy cập khi chưa auth.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: RootLayout,
  beforeLoad: () => {
    if (!useAuthStore.getState().isAuthenticated) {
      throw redirect({ to: "/login" });
    }
  },
});

const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/operator" });
  },
});

const operatorRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/operator",
  component: OperatorHomePage,
});

// /tenant/:companyId — operator chọn 1 tenant để thao tác (ADR-0019 Tầng 1: withTenant(target)).
const tenantRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/tenant/$companyId",
  component: TenantHomePage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([indexRoute, operatorRoute, tenantRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
