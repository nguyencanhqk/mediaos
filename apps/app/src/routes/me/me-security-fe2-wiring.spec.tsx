// @vitest-environment jsdom
/**
 * [me-security-fe2-wiring] S5-ME-FE-2 — chốt hợp đồng wiring cho 6 route "Hồ sơ của tôi/Tài khoản &
 * bảo mật" (ME-SCREEN-002..008) trong 1 file, tránh trôi giữa các spec riêng lẻ:
 *
 *  A. router.tsx (source-level): mỗi component TÁI DÙNG (MyProfilePage/MyChangeRequestPage/
 *     AccountProfilePage/ChangePasswordPage/AccountSessionsPage) chỉ có ĐÚNG 1 lazy-wrapper
 *     `React.lazy(() => import(...))` trong cả file — route cũ VÀ route ME mới CÙNG dùng 1 hằng số,
 *     KHÔNG import/lazy lần 2 (chống copy-paste). Route cũ + 6 path ME mới đều còn hiện diện trong
 *     source (KHÔNG gãy bookmark/deep-link — done_when).
 *  B. registry: ROUTE_REGISTRY có 6 route "me.profile"/"me.profile.change-requests"/"me.account"/
 *     "me.security.password"/"me.security.sessions"/"me.security.activity" gate literal ['access:me']
 *     + showInSidebar; ME_SIDEBAR có 2 nhóm mới, mỗi item.path khớp path route ĐÃ đăng ký (KHÔNG
 *     dead-link); i18n "me" namespace có đủ securityActivity.* + "nav".routeTitle.me* 6 khoá.
 *  C. route-authz-wiring: 6 route mới render qua <ProtectedRoute meta> (gate access:me) — thiếu quyền
 *     → 403, có quyền → nội dung render (mirror me-routes-authz-wiring.spec.tsx).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ROUTE_REGISTRY, useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { ME_SIDEBAR } from "@/layouts/workspace/sidebar-registry";

vi.mock("@/layouts/protected/ProtectedShell", () => ({
  ProtectedShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/layouts/workspace/ModuleWorkspaceLayout", () => ({
  ModuleWorkspaceLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage: vi.fn() } }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

// Đọc source router.tsx để chốt hợp đồng "import-only" (part A). Anchor bằng process.cwd() = apps/app
// (vitest root mặc định + turbo chạy test theo package-dir) thay vì import.meta.url — dưới vitest URL này
// KHÔNG luôn là scheme "file:" (fileURLToPath ném "The URL must be of scheme file").
const ROUTER_SRC = fs.readFileSync(path.resolve(process.cwd(), "src/router.tsx"), "utf-8");

const SHARED_COMPONENT_IMPORT_PATHS = [
  "@/routes/hr/me/MyProfilePage",
  "@/routes/hr/profile-change-requests/MyChangeRequestPage",
  "@/routes/account/AccountProfilePage",
  "@/routes/account/ChangePasswordPage",
  "@/routes/account/AccountSessionsPage",
] as const;

const NEW_ME_ROUTE_KEYS = [
  "me.profile",
  "me.profile.change-requests",
  "me.account",
  "me.security.password",
  "me.security.sessions",
  "me.security.activity",
] as const;

const NEW_ME_ROUTE_PATHS: Record<(typeof NEW_ME_ROUTE_KEYS)[number], string> = {
  "me.profile": "/me/profile",
  "me.profile.change-requests": "/me/profile/change-requests",
  "me.account": "/me/account",
  "me.security.password": "/me/security/password",
  "me.security.sessions": "/me/security/sessions",
  "me.security.activity": "/me/security/activity",
};

describe("A. router.tsx — tái dùng import-only, KHÔNG lazy-wrapper trùng lặp + route cũ còn sống", () => {
  it.each(SHARED_COMPONENT_IMPORT_PATHS)(
    "'%s' chỉ có ĐÚNG 1 lazy-wrapper (route cũ + route ME mới CÙNG dùng 1 hằng số)",
    (importPath) => {
      const occurrences = ROUTER_SRC.split(`import("${importPath}")`).length - 1;
      expect(occurrences).toBe(1);
    },
  );

  it("route cũ /hr/me + /hr/me/change-request (qua PCR_ME_PATH) + /account/* vẫn còn trong router.tsx", () => {
    expect(ROUTER_SRC).toContain('"/hr/me"');
    expect(ROUTER_SRC).toContain("PCR_ME_PATH");
    expect(ROUTER_SRC).toContain('"/account/sessions"');
    expect(ROUTER_SRC).toContain("ACCOUNT_PROFILE_PATH");
    expect(ROUTER_SRC).toContain('"/account/change-password"');
  });

  it.each(Object.values(NEW_ME_ROUTE_PATHS))(
    "route ME mới '%s' có trong router.tsx",
    (routePath) => {
      expect(ROUTER_SRC).toContain(`"${routePath}"`);
    },
  );
});

describe("B. registry — ROUTE_REGISTRY + ME_SIDEBAR + i18n", () => {
  it.each(NEW_ME_ROUTE_KEYS)(
    "ROUTE_REGISTRY['%s'] gate literal access:me + showInSidebar",
    (key) => {
      const meta = ROUTE_REGISTRY.find((r) => r.routeKey === key);
      expect(meta).toBeDefined();
      expect(meta?.requiredAnyPermissions).toEqual(["access:me"]);
      expect(meta?.showInSidebar).toBe(true);
      expect(meta?.moduleCode).toBe("ME");
    },
  );

  it("ME_SIDEBAR có 2 nhóm mới 'Hồ sơ của tôi'/'Tài khoản & bảo mật' — path KHÔNG dead-link", () => {
    const registeredPaths = new Set(ROUTE_REGISTRY.map((r) => r.path));
    const newGroupItems = ME_SIDEBAR.filter((item) =>
      ["Hồ sơ của tôi", "Tài khoản & bảo mật"].includes(item.group ?? ""),
    );
    expect(newGroupItems.length).toBe(6);
    for (const item of newGroupItems) {
      expect(item.path).toBeDefined();
      expect(registeredPaths.has(item.path as string)).toBe(true);
      expect(item.requiredAnyPermissions).toEqual(["access:me"]);
    }
    const profileGroupCount = newGroupItems.filter((i) => i.group === "Hồ sơ của tôi").length;
    const accountGroupCount = newGroupItems.filter((i) => i.group === "Tài khoản & bảo mật").length;
    expect(profileGroupCount).toBe(2);
    expect(accountGroupCount).toBe(4);
  });

  it("i18n 'me' namespace có đủ securityActivity.* (title/columns/empty/error)", async () => {
    const meVi = (await import("@/i18n/locales/vi/me")).default;
    expect(meVi.securityActivity.title).toBeTruthy();
    expect(meVi.securityActivity.columns.time).toBeTruthy();
    expect(meVi.securityActivity.columns.eventType).toBeTruthy();
    expect(meVi.securityActivity.columns.device).toBeTruthy();
    expect(meVi.securityActivity.columns.ip).toBeTruthy();
    expect(meVi.securityActivity.empty.title).toBeTruthy();
    expect(meVi.securityActivity.error.title).toBeTruthy();
  });

  it("i18n 'nav'.routeTitle có đủ 6 khoá me* cho route mới", () => {
    const keys = [
      "meProfile",
      "meProfileChangeRequests",
      "meAccount",
      "meSecurityPassword",
      "meSecuritySessions",
      "meSecurityActivity",
    ];
    for (const key of keys) {
      expect(i18n.t(`routeTitle.${key}`, { ns: "nav" })).not.toBe(`routeTitle.${key}`);
    }
  });
});

describe("C. route-authz-wiring — 6 route mới render qua ProtectedRoute (gate access:me)", () => {
  const MODULE_CONTENT = "me-security-fe2-page-content";
  function StubPage() {
    return <div>{MODULE_CONTENT}</div>;
  }

  let routerMod: typeof import("@/router");
  beforeAll(async () => {
    routerMod = await import("@/router");
  }, 30000);

  beforeEach(() => {
    useAuthStore.getState().logout();
  });
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().logout();
  });

  function seedAuth(opts: { capabilities?: Record<string, boolean> }) {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: "u1", companyId: "c1", email: "u@co.com", fullName: "U", status: "Active" },
      username: "u@co.com",
      accessToken: "a",
      refreshToken: null,
      capabilities: opts.capabilities ?? {},
    });
  }

  it.each(NEW_ME_ROUTE_KEYS)("route '%s' thiếu access:me → SHOW_403, nội dung ẨN", (routeKey) => {
    const { buildModuleRouteContent, getMeta } = routerMod;
    seedAuth({ capabilities: {} });
    render(buildModuleRouteContent(getMeta(routeKey), "ME", <StubPage />));
    expect(screen.getByText("forbidden.title")).toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });

  it.each(NEW_ME_ROUTE_KEYS)("route '%s' có access:me → nội dung render", (routeKey) => {
    const { buildModuleRouteContent, getMeta } = routerMod;
    seedAuth({ capabilities: { "access:me": true } });
    render(buildModuleRouteContent(getMeta(routeKey), "ME", <StubPage />));
    expect(screen.getByText(MODULE_CONTENT)).toBeInTheDocument();
    expect(screen.queryByText("forbidden.title")).not.toBeInTheDocument();
  });
});
