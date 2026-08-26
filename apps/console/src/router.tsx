import React from "react";
import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { HomePage } from "@/routes/home";
import { RootLayout } from "@/routes/root-layout";
import { getAuthRedirectUrl, useAuthStore } from "@mediaos/web-core";
import { hasChatOversightCapability } from "@/lib/chat-oversight-gate";


/**
 * S10-PERF-LOADPATH-1 — 17 trang console nạp qua dynamic import.
 *
 * TRƯỚC: router import TĨNH cả 17 trang ⇒ Vite gộp toàn bộ console vào MỘT chunk. Đo bản build:
 * `dist/assets` chỉ có đúng một file JS, 993.308 byte thô / 227.379 byte brotli — người mới đăng nhập
 * phải tải trọn bộ màn quản trị trước khi thấy bất cứ thứ gì. (Đối chiếu `apps/app`: 2,36 MB nhưng
 * trải trên ~100 chunk, entry chỉ 1,17 MB.)
 *
 * `HomePage` CỐ Ý giữ EAGER: đó là màn đích ngay sau đăng nhập của gần như mọi phiên, hoãn nó chỉ đẻ
 * thêm một round-trip đúng trên đường tới hạn. `RootLayout` cũng eager — nó LÀ cái vỏ.
 *
 * Ranh giới Suspense nằm ở `RootLayout` (bọc `<Outlet/>`) — một chỗ phủ hết, kể cả route thêm sau này.
 */
const CompanySettingsPage = React.lazy(() =>
  import("@/routes/settings/company").then((m) => ({ default: m.CompanySettingsPage })),
);
const MailConfigPage = React.lazy(() =>
  import("@/routes/settings/mail-config").then((m) => ({ default: m.MailConfigPage })),
);
const SecuritySettingsPage = React.lazy(() =>
  import("@/routes/settings/security").then((m) => ({ default: m.SecuritySettingsPage })),
);
const AccountSettingsPage = React.lazy(() =>
  import("@/routes/settings/account").then((m) => ({ default: m.AccountSettingsPage })),
);
const SecurityPolicyPage = React.lazy(() =>
  import("@/routes/settings/security-policy").then((m) => ({ default: m.SecurityPolicyPage })),
);
const ActivityLogPage = React.lazy(() =>
  import("@/routes/system/activity-log").then((m) => ({ default: m.ActivityLogPage })),
);
const PermissionsPage = React.lazy(() =>
  import("@/routes/system/permissions/permissions-page").then((m) => ({
    default: m.PermissionsPage,
  })),
);
const OrgStructurePage = React.lazy(() =>
  import("@/routes/system/org/org-structure").then((m) => ({ default: m.OrgStructurePage })),
);
const PositionsPage = React.lazy(() =>
  import("@/routes/system/org/positions").then((m) => ({ default: m.PositionsPage })),
);
const ObjectsPage = React.lazy(() =>
  import("@/routes/system/objects").then((m) => ({ default: m.ObjectsPage })),
);
const UsagePage = React.lazy(() =>
  import("@/routes/system/usage").then((m) => ({ default: m.UsagePage })),
);
const ApiKeysPage = React.lazy(() =>
  import("@/routes/system/api-keys/api-keys-page").then((m) => ({ default: m.ApiKeysPage })),
);
const WebhooksPage = React.lazy(() =>
  import("@/routes/system/webhooks/webhooks-page").then((m) => ({ default: m.WebhooksPage })),
);
const RecycleBinPage = React.lazy(() =>
  import("@/routes/recycle-bin").then((m) => ({ default: m.RecycleBinPage })),
);
// S7-CHAT-FE-5 🔒 — CHAT-SCREEN-007/008 (đọc-vượt membership).
const ChatOversightPage = React.lazy(() =>
  import("@/routes/system/chat-oversight/chat-oversight-page").then((m) => ({
    default: m.ChatOversightPage,
  })),
);
const ChatOversightAuditPage = React.lazy(() =>
  import("@/routes/system/chat-oversight/chat-oversight-audit-page").then((m) => ({
    default: m.ChatOversightAuditPage,
  })),
);
// ACCT-2-FE: Quản lý người dùng (admin user CRUD — manage:user + suspend:user + delete-user:user).
const UsersPage = React.lazy(() =>
  import("@/routes/system/users/users-page").then((m) => ({ default: m.UsersPage })),
);

const rootRoute = createRootRoute({ component: RootLayout });

// FS-1b: login ÄÃ£ externalize sang app ÄÄng nháº­p trung tÃ¢m (apps/auth). Guard khÃ´ng cÃ²n route `/login` ná»i bá»
// â chÆ°a ÄÄng nháº­p thÃ¬ `throw redirect({ href })` RA NGOÃI (TanStack tá»± suy `reloadDocument` cho absolute href:
// Äiá»u hÆ°á»ng cáº£ trang vá» auth.<domain>?redirect=<ÄÃ­ch> + Dá»ªNG pipeline router). Boot (main.tsx) silent-refresh
// trÆ°á»c khi mount nÃªn ÄÃ¢y chá»§ yáº¿u lÃ  backstop khi store bá» xoÃ¡ giá»¯a phiÃªn.
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

// CS-8: Cáº¥u hÃ¬nh mail server SMTP â authGuard; gate quyá»n configure-mail:company xá»­ lÃ½ trong component (PermissionGate).
const mailConfigRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/mail-config",
  beforeLoad: authGuard,
  component: MailConfigPage,
});

// Self-service "Báº£o máº­t tÃ i khoáº£n" â user tá»± quáº£n 2FA cá»§a mÃ¬nh. Chá» authGuard (khÃ´ng permission-gate,
// giá»ng Äá»i máº­t kháº©u): TwoFactorSettings ÄÃ£ rá»i apps/web má» cÃ´i vá» console (nÆ¡i cÃ³ phiÃªn aud=user).
const securityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/security",
  beforeLoad: authGuard,
  component: SecuritySettingsPage,
});

// ACCT-1 (Module 2a): "TÃ i khoáº£n cá»§a tÃ´i" â self-service há» sÆ¡ + Äá»i máº­t kháº©u cá»§a CHÃNH user. Chá» authGuard
// (khÃ´ng permission-gate, giá»ng /settings/security): má»i ngÆ°á»i tá»± quáº£n tÃ i khoáº£n mÃ¬nh; service Ã©p WHERE id=self.
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/account",
  beforeLoad: authGuard,
  component: AccountSettingsPage,
});

// CS-9: Báº£o máº­t nÃ¢ng cao â gate quyá»n configure-security-policy:company xá»­ lÃ½ trong component.
const securityPolicyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/security-policy",
  beforeLoad: authGuard,
  component: SecurityPolicyPage,
});

// CS-1: Nháº­t kÃ½ hoáº¡t Äá»ng â gate quyá»n view:audit-log xá»­ lÃ½ trong component.
const activityLogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/activity-log",
  beforeLoad: authGuard,
  component: ActivityLogPage,
});

// CS-2: PhÃ¢n quyá»n (RBAC) â gate quyá»n assign-role:user / grant-object-permission:permission trong component.
const permissionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/permissions",
  beforeLoad: authGuard,
  component: PermissionsPage,
});

// CS-3: CÆ¡ cáº¥u tá» chá»©c â gate quyá»n create/update/delete:org_unit & :team xá»­ lÃ½ trong component.
const orgStructureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/org-structure",
  beforeLoad: authGuard,
  component: OrgStructurePage,
});

// CS-3: Vá» trÃ­ cÃ´ng viá»c â gate quyá»n create/update/delete:position xá»­ lÃ½ trong component.
const positionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/positions",
  beforeLoad: authGuard,
  component: PositionsPage,
});

// CS-4: Äá»i tÆ°á»£ng â danh báº¡ NgÆ°á»i dÃ¹ng / NhÃ¢n viÃªn â gate quyá»n read:employee xá»­ lÃ½ trong component.
const objectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/objects",
  beforeLoad: authGuard,
  component: ObjectsPage,
});

// CS-7: TÃ¬nh hÃ¬nh sá»­ dá»¥ng â gate quyá»n view:usage xá»­ lÃ½ trong component.
const usageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/usage",
  beforeLoad: authGuard,
  component: UsagePage,
});

// DevOps â API key/PAT (hÃºt tá»« apps/admin tenant-plane). Gate quyá»n manage:api-key trong component.
const apiKeysRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/api-keys",
  beforeLoad: authGuard,
  component: ApiKeysPage,
});

// DevOps â Webhooks (hÃºt tá»« apps/admin tenant-plane). Gate quyá»n view/manage:webhook trong component.
const webhooksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/webhooks",
  beforeLoad: authGuard,
  component: WebhooksPage,
});

// ACCT-2-FE: Quáº£n lÃ½ ngÆ°á»i dÃ¹ng â gate manage:user xá»­ lÃ½ trong component (PermissionGate + useCan).
const adminUsersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/users",
  beforeLoad: authGuard,
  component: UsersPage,
});

/**
 * S7-CHAT-FE-5 ð â cá»ng route cho hai mÃ n Äá»c-vÆ°á»£t (CHAT-SCREEN-007/008).
 *
 * KhÃ¡c cÃ¡c route khÃ¡c cá»§a console (gate quyá»n Xá»¬ LÃ TRONG COMPONENT): á» ÄÃ¢y thÃªm má»t lá»p NGOÃI React
 * ná»¯a, vÃ¬ gÃµ tháº³ng URL vÃ o mÃ n nguy hiá»m nháº¥t module khÃ´ng nÃªn phá»¥ thuá»c vÃ o viá»c component sau nÃ y cÃ²n
 * nhá» gá»i `useCanChatOversight`. KhÃ´ng cÃ³ Äua tráº¡ng thÃ¡i: `main.tsx` `await bootstrapSession()` (náº¡p
 * `/me` + `capabilities`) TRÆ¯á»C khi mount router, nÃªn `beforeLoad` luÃ´n Äá»c ÄÆ°á»£c map ÄÃ£ Äáº§y Äá»§.
 *
 * Thiáº¿u quyá»n â vá» trang chá»§, KHÃNG hiá»n mÃ n rá»ng â lá»p trang váº«n giá»¯ `EmptyState` "khÃ´ng cÃ³ quyá»n" cho
 * trÆ°á»ng há»£p component ÄÆ°á»£c render trá»±c tiáº¿p (test, hoáº·c route má»i trá» vÃ o sau nÃ y).
 */
const chatOversightGuard = () => {
  authGuard();
  if (!hasChatOversightCapability()) throw redirect({ to: "/" });
};

const chatOversightRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/chat-oversight",
  beforeLoad: chatOversightGuard,
  component: ChatOversightPage,
});

const chatOversightAuditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/system/chat-oversight/audit",
  beforeLoad: chatOversightGuard,
  component: ChatOversightAuditPage,
});

// CS-6: ThÃ¹ng rÃ¡c â khÃ´i phá»¥c nhÃ¢n viÃªn bá» xoÃ¡ má»m (restore:employee sensitive), gate trong component.
const recycleBinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recycle-bin",
  beforeLoad: authGuard,
  component: RecycleBinPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  adminUsersRoute,
  companySettingsRoute,
  mailConfigRoute,
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
  chatOversightRoute,
  chatOversightAuditRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
