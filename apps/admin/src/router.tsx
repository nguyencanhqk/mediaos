import { Outlet, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { LoginPage } from "@/routes/login";
import { RootLayout } from "@/routes/root-layout";
import { OperatorHomePage } from "@/routes/operator/home";
import { CompaniesListPage } from "@/routes/operator/companies/companies-list";
import { TenantHomePage } from "@/routes/tenant/tenant-home";
import { RbacPage } from "@/routes/tenant/rbac/rbac-page";
import { ModulesListPage } from "@/routes/operator/modules/modules-list";
import { ModuleCatalogPage } from "@/routes/operator/modules/catalog-list";
import { ApiKeysPage } from "@/routes/tenant/api-keys/api-keys-page";
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

// AC-1 — Operator companies & billing (cross-tenant via withTenant(target)).
const operatorCompaniesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/operator/companies",
  component: CompaniesListPage,
});

// AC-7 — Operator catalog module GLOBAL (read-only viewer của system_modules dùng chung).
const operatorModulesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/operator/modules",
  component: ModuleCatalogPage,
});

// /tenant/:companyId — operator chọn 1 tenant để thao tác (ADR-0019 Tầng 1: withTenant(target)).
// Layout-only: render <Outlet/> để các module tenant (RBAC AC-3, branding AC-4…) gắn child route.
const tenantRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/tenant/$companyId",
  component: Outlet,
});

// Index `/tenant/:companyId` (chính xác) → trang chủ tenant.
const tenantIndexRoute = createRoute({
  getParentRoute: () => tenantRoute,
  path: "/",
  component: TenantHomePage,
});

// `/tenant/:companyId/rbac` — RBAC self-service (AC-3 nhánh (a)).
const tenantRbacRoute = createRoute({
  getParentRoute: () => tenantRoute,
  path: "rbac",
  component: RbacPage,
});

// `/tenant/:companyId/modules` — module-registry (AC-7): bật/tắt module cho tenant.
const tenantModulesRoute = createRoute({
  getParentRoute: () => tenantRoute,
  path: "modules",
  component: ModulesListPage,
});

// `/tenant/:companyId/api-keys` — API key / PAT self-service (AC-5).
const tenantApiKeysRoute = createRoute({
  getParentRoute: () => tenantRoute,
  path: "api-keys",
  component: ApiKeysPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([
    indexRoute,
    operatorRoute,
    operatorCompaniesRoute,
    operatorModulesRoute,
    tenantRoute.addChildren([
      tenantIndexRoute,
      tenantRbacRoute,
      tenantModulesRoute,
      tenantApiKeysRoute,
    ]),
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
