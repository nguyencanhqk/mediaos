// @vitest-environment jsdom
/**
 * S3-FE-LEAVE-7 — route-gate cho /leave/me/balances (số dư phép DỜI khỏi /leave).
 *
 * CHỨNG MINH thiết kế: route /leave/me/balances REUSE meta `leave.overview` (requiredAny =
 * LEAVE.REQUEST.VIEW_OWN — ĐÃ map trong PERMISSION_CODE_TO_PAIR → view-own:leave). KHÔNG dùng
 * LEAVE.BALANCE.VIEW_OWN (CHƯA có trong PERMISSION_CODE_TO_PAIR → fallthrough → SHOW_403 mọi user).
 *
 *  (d) user CHỈ view-own:leave mở /leave/me/balances → ProtectedRoute ALLOW (render page, KHÔNG SHOW_403).
 *  + meta-pin: leave.overview requiredAny CHỨA LEAVE.REQUEST.VIEW_OWN (mapped), KHÔNG LEAVE.BALANCE.VIEW_OWN.
 *  + deny-control: user KHÔNG có view-own:leave → SHOW_403 (route thật sự ép cặp mapped).
 *
 * Mirror route-authz-wiring.spec.tsx: dùng buildModuleRouteContent + getMeta THẬT từ @/router (chính
 * factory router dùng cho MỌI route module) + store THẬT — KHÔNG mock web-core (guard thuần dễ xanh-giả).
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, getRouteMeta } from "@mediaos/web-core";

// Vỏ nặng (topbar/sidebar) → mock passthrough để cô lập đúng tầng AUTHZ (ProtectedRoute).
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
    useNavigate: () => vi.fn(),
  };
});

const MODULE_CONTENT = "balances-page-content";
function BalancesPageStub() {
  return <div>{MODULE_CONTENT}</div>;
}

function seedAuth(capabilities: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "u1", companyId: "c1", email: "u@co.com", fullName: "U", status: "Active" },
    username: "u@co.com",
    accessToken: "a",
    refreshToken: null,
    capabilities,
  });
}

describe("S3-FE-LEAVE-7 — /leave/me/balances route gate reuses leave.overview (VIEW_OWN mapped)", () => {
  // Nạp @/router MỘT LẦN: import kéo cả graph route (cold-import ~2-5s dưới full-suite) → nếu để
  // trong từng it() dễ vượt testTimeout 5s. Hoist vào beforeAll (timeout rộng); test dùng ref đã cache.
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

  it("meta-pin: leave.overview requiredAny CHỨA LEAVE.REQUEST.VIEW_OWN (mapped), KHÔNG LEAVE.BALANCE.VIEW_OWN", () => {
    const meta = getRouteMeta("leave.overview")!;
    expect(meta.requiredAnyPermissions).toContain("LEAVE.REQUEST.VIEW_OWN");
    expect(meta.requiredAnyPermissions).not.toContain("LEAVE.BALANCE.VIEW_OWN");
  });

  it("(d) user view-own:leave → route ALLOW (render page, KHÔNG SHOW_403)", () => {
    const { buildModuleRouteContent, getMeta } = routerMod;
    seedAuth({ "view-own:leave": true });
    render(buildModuleRouteContent(getMeta("leave.overview"), "LEAVE", <BalancesPageStub />));
    expect(screen.getByText(MODULE_CONTENT)).toBeInTheDocument();
    expect(screen.queryByText("forbidden.reason.NO_PERMISSION")).not.toBeInTheDocument();
  });

  it("deny-control: user KHÔNG có view-own:leave → SHOW_403 (route ép cặp mapped, không mở toang)", () => {
    const { buildModuleRouteContent, getMeta } = routerMod;
    seedAuth({}); // không có view-own:leave lẫn view:leave
    render(buildModuleRouteContent(getMeta("leave.overview"), "LEAVE", <BalancesPageStub />));
    expect(screen.getByText("forbidden.reason.NO_PERMISSION")).toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });
});
