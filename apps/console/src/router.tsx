import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { HomePage } from "@/routes/home";
import { RootLayout } from "@/routes/root-layout";
import { CompanySettingsPage } from "@/routes/settings/company";
import { MailConfigPage } from "@/routes/settings/mail-config";
import { PlatformAccountsPage } from "@/routes/settings/platform-accounts";
import { BreakGlassPage } from "@/routes/settings/break-glass";
import { SecuritySettingsPage } from "@/routes/settings/security";
import { AccountSettingsPage } from "@/routes/settings/account";
import { SecurityPolicyPage } from "@/routes/settings/security-policy";
import { getAuthRedirectUrl, useAuthStore } from "@mediaos/web-core";
import { ActivityLogPage } from "@/routes/system/activity-log";
import { PermissionsPage } from "@/routes/system/permissions/permissions-page";
import { OrgStructurePage } from "@/routes/system/org/org-structure";
import { PositionsPage } from "@/routes/system/org/positions";
import { ObjectsPage } from "@/routes/system/objects";
import { UsagePage } from "@/routes/system/usage";
import { ApiKeysPage } from "@/routes/system/api-keys/api-keys-page";
import { WebhooksPage } from "@/routes/system/webhooks/webhooks-page";
import { RecycleBinPage } from "@/routes/recycle-bin";

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

// CS-8: Cấu hình mail server SMTP — authGuard; gate quyền configure-mail:company xử lý trong component (PermissionGate).
const mailConfigRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/mail-config",
  beforeLoad: authGuard,
  component: MailConfigPage,
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

// ACCT-1 (Module 2a): "Tài khoản của tôi" — self-service hồ sơ + đổi mật khẩu của CHÍNH user. Chỉ authGuard
// (không permission-gate, giống /settings/security): mỗi người tự quản tài khoản mình; service ép WHERE id=self.
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/account",
  beforeLoad: authGuard,
  component: AccountSettingsPage,
});

// CS-9: Bảo mật nâng cao — gate quyền configure-security-policy:company xử lý trong component.
const securityPolicyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/security-policy",
  beforeLoad: authGuard,
  component: SecurityPolicyPage,
});

// CS-1: Nhật ký hoạt động — gate quyền view:audit-log xử lý trong component.
const activityLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/activity-log",
  beforeLoad: authGuard,
  component: ActivityLogPage,
});

// CS-2: Phân quyền (RBAC) — gate quyền assign-role:user / grant-object-permission:permission trong component.
const permissionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/permissions",
  beforeLoad: authGuard,
  component: PermissionsPage,
});

// CS-3: Cơ cấu tổ chức — gate quyền create/update/delete:org_unit & :team xử lý trong component.
const orgStructureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/org-structure",
  beforeLoad: authGuard,
  component: OrgStructurePage,
});

// CS-3: Vị trí công việc — gate quyền create/update/delete:position xử lý trong component.
const positionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/positions",
  beforeLoad: authGuard,
  component: PositionsPage,
});

// CS-4: Đối tượng — danh bạ Người dùng / Nhân viên — gate quyền read:employee xử lý trong component.
const objectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/objects",
  beforeLoad: authGuard,
  component: ObjectsPage,
});

// CS-7: Tình hình sử dụng — gate quyền view:usage xử lý trong component.
const usageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/usage",
  beforeLoad: authGuard,
  component: UsagePage,
});

// DevOps — API key/PAT (hút từ apps/admin tenant-plane). Gate quyền manage:api-key trong component.
const apiKeysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/api-keys",
  beforeLoad: authGuard,
  component: ApiKeysPage,
});

// DevOps — Webhooks (hút từ apps/admin tenant-plane). Gate quyền view/manage:webhook trong component.
const webhooksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/webhooks",
  beforeLoad: authGuard,
  component: WebhooksPage,
});

// CS-6: Thùng rác — khôi phục nhân viên bị xoá mềm (restore:employee sensitive), gate trong component.
const recycleBinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recycle-bin",
  beforeLoad: authGuard,
  component: RecycleBinPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  companySettingsRoute,
  platformAccountsRoute,
  mailConfigRoute,
  breakGlassRoute,
  securityRoute,
  accountRoute,
  securityPolicyRoute,
  activityLogRoute,
  permissionsRoute,
  orgStructureRoute,
  positionsRoute,
  objectsRoute,
  usageRoute,
  apiKeysRoute,
  webhooksRoute,
  recycleBinRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
