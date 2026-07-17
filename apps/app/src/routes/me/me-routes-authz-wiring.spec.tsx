// @vitest-environment jsdom
/**
 * [me-routes-authz-wiring] S5-ME-FE-3 — xác nhận 6 route mới (ME-SCREEN-009..014) gate `access:me` VÀ
 * render qua `ProtectedRoute` (mirror `src/test/route-authz-wiring.spec.tsx`, KHÔNG authGuard trần).
 * Dùng `buildModuleRouteContent`/`getMeta` xuất từ `@/router` — CHÍNH factory mọi route module dùng
 * (makeModuleRoute), nên test này khoá đúng hành vi router.tsx thật, KHÔNG phải bản sao logic.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@mediaos/web-core";

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

const MODULE_CONTENT = "me-route-page-content";
function MePage() {
  return <div>{MODULE_CONTENT}</div>;
}

function seedAuth(opts: { capabilities?: Record<string, boolean> }) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: {
      id: "u1",
      companyId: "c1",
      email: "u@co.com",
      fullName: "U",
      status: "Active",
    },
    username: "u@co.com",
    accessToken: "a",
    refreshToken: null,
    capabilities: opts.capabilities ?? {},
  });
}

const ME_ROUTE_KEYS = [
  "me.attendance",
  "me.leave",
  "me.tasks",
  "me.notifications",
  "me.preferences.notifications",
  "me.preferences.appearance",
] as const;

describe("router wires ProtectedRoute cho 6 route ME mới (gate access:me)", () => {
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

  it.each(ME_ROUTE_KEYS)("route '%s' thiếu access:me → SHOW_403, nội dung ẨN", (routeKey) => {
    const { buildModuleRouteContent, getMeta } = routerMod;
    seedAuth({ capabilities: {} });
    render(buildModuleRouteContent(getMeta(routeKey), "ME", <MePage />));
    expect(screen.getByText("forbidden.title")).toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });

  it.each(ME_ROUTE_KEYS)("route '%s' có access:me → nội dung render", (routeKey) => {
    const { buildModuleRouteContent, getMeta } = routerMod;
    seedAuth({ capabilities: { "access:me": true } });
    render(buildModuleRouteContent(getMeta(routeKey), "ME", <MePage />));
    expect(screen.getByText(MODULE_CONTENT)).toBeInTheDocument();
    expect(screen.queryByText("forbidden.title")).not.toBeInTheDocument();
  });
});
