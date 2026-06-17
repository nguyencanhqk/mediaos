import { Outlet, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { LoginPage } from "@/routes/login";
import { RootLayout } from "@/routes/root-layout";
import { OperatorHomePage } from "@/routes/operator/home";
import { CompaniesListPage } from "@/routes/operator/companies/companies-list";
import { TenantHomePage } from "@/routes/tenant/tenant-home";
import { RbacPage } from "@/routes/tenant/rbac/rbac-page";
import { ModulesListPage } from "@/routes/operator/modules/modules-list";
import { ModuleCatalogPage } from "@/routes/operator/modules/catalog-list";
import { EntitlementsPage } from "@/routes/operator/companies/entitlements-page";
import { ApiKeysPage } from "@/routes/tenant/api-keys/api-keys-page";
import { BrandingPage } from "@/routes/tenant/ui-config/branding-page";
import { WebhooksPage } from "@/routes/tenant/webhooks/webhooks-page";
import { NavigationPage } from "@/routes/tenant/ui-config/navigation-page";
import { I18nPage } from "@/routes/tenant/ui-config/i18n-page";
import { OperatorAuditPage } from "@/routes/operator/audit/audit-list";
import { OperatorQueuePage } from "@/routes/operator/queue/queue-monitor";
import { OperatorDbOpsPage } from "@/routes/operator/db-ops";
import { TenantAuditPage } from "@/routes/tenant/audit/tenant-audit";
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

// AC-8 — Operator audit viewer CHÉO tenant (read-only, view:platform-audit + step-up).
const operatorAuditRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/operator/audit",
  component: OperatorAuditPage,
});

// AC-8 — Operator queue monitor CHÉO tenant (outbox + dead-letter, view:platform-audit + step-up).
const operatorQueueRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/operator/queue",
  component: OperatorQueuePage,
});

// AC-9 — Operator DB ops CHỈ-ĐỌC (migration status + data browser tenant-scoped + break-glass + export).
const operatorDbOpsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/operator/db-ops",
  component: OperatorDbOpsPage,
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

// `/tenant/:companyId/entitlements` — feature-flag/usage-limit/entitlement viewer (AC-2): operator
// xem/đặt quyền lợi gói cho tenant (cross-tenant, withTenant(target)).
const tenantEntitlementsRoute = createRoute({
  getParentRoute: () => tenantRoute,
  path: "entitlements",
  component: EntitlementsPage,
});

// `/tenant/:companyId/api-keys` — API key / PAT self-service (AC-5).
const tenantApiKeysRoute = createRoute({
  getParentRoute: () => tenantRoute,
  path: "api-keys",
  component: ApiKeysPage,
});

// `/tenant/:companyId/webhooks` — webhooks self-service (AC-6).
const tenantWebhooksRoute = createRoute({
  getParentRoute: () => tenantRoute,
  path: "webhooks",
  component: WebhooksPage,
});

// `/tenant/:companyId/branding` — UI config branding self-service (AC-4).
const tenantBrandingRoute = createRoute({
  getParentRoute: () => tenantRoute,
  path: "branding",
  component: BrandingPage,
});

// `/tenant/:companyId/navigation` — UI config menu editor self-service (AC-4).
const tenantNavigationRoute = createRoute({
  getParentRoute: () => tenantRoute,
  path: "navigation",
  component: NavigationPage,
});

// `/tenant/:companyId/i18n` — UI config i18n overrides editor self-service (AC-4).
const tenantI18nRoute = createRoute({
  getParentRoute: () => tenantRoute,
  path: "i18n",
  component: I18nPage,
});

// `/tenant/:companyId/audit` — audit viewer self-service (AC-8): tenant xem audit của mình (view:audit-log).
const tenantAuditRoute = createRoute({
  getParentRoute: () => tenantRoute,
  path: "audit",
  component: TenantAuditPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([
    indexRoute,
    operatorRoute,
    operatorCompaniesRoute,
    operatorModulesRoute,
    operatorAuditRoute,
    operatorQueueRoute,
    operatorDbOpsRoute,
    tenantRoute.addChildren([
      tenantIndexRoute,
      tenantRbacRoute,
      tenantModulesRoute,
      tenantEntitlementsRoute,
      tenantApiKeysRoute,
      tenantWebhooksRoute,
      tenantBrandingRoute,
      tenantNavigationRoute,
      tenantI18nRoute,
      tenantAuditRoute,
    ]),
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
