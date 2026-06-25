// @vitest-environment jsdom
/**
 * [protected-public-route] Hợp đồng named-guard: ProtectedRoute & PublicRoute (FRONTEND-03 §14).
 *
 *  ProtectedRoute:
 *   - chưa đăng nhập → REDIRECT_LOGIN (gọi getAuthRedirectUrl qua onRedirect), KHÔNG render children.
 *   - đã đăng nhập + đủ quyền → render children.
 *  PublicRoute (ngược lại):
 *   - chưa đăng nhập → render children.
 *   - đã đăng nhập → điều hướng rời (onRedirect), KHÔNG render children.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type RouteMeta } from "@mediaos/web-core";
import { ProtectedRoute } from "@/layouts/protected/ProtectedRoute";
import { PublicRoute } from "@/layouts/public/PublicRoute";

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

const meta: RouteMeta = {
  routeKey: "hr.employees",
  path: "/hr/employees",
  layout: "MODULE_WORKSPACE",
  titleKey: "routeTitle.hrEmployees",
  requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
};

const CHILD = "guarded-child";

function login(capabilities: Record<string, boolean> = {}) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "u1", companyId: "c1", email: "u@co.com", fullName: "U", status: "Active" },
    username: "u@co.com",
    accessToken: "a",
    refreshToken: null,
    capabilities,
  });
}

describe("ProtectedRoute / PublicRoute named guards", () => {
  beforeEach(() => useAuthStore.getState().logout());
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().logout();
  });

  it("ProtectedRoute: chưa đăng nhập → redirect intent, KHÔNG render children", () => {
    const onRedirect = vi.fn();
    render(
      <ProtectedRoute meta={meta} onRedirect={onRedirect}>
        <div>{CHILD}</div>
      </ProtectedRoute>,
    );
    expect(onRedirect).toHaveBeenCalledTimes(1);
    expect(onRedirect.mock.calls[0][0]).toBeTruthy();
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });

  it("ProtectedRoute: đã đăng nhập + đủ quyền → render children", () => {
    login({ "read:employee": true });
    render(
      <ProtectedRoute meta={meta} onRedirect={() => {}}>
        <div>{CHILD}</div>
      </ProtectedRoute>,
    );
    expect(screen.getByText(CHILD)).toBeInTheDocument();
  });

  it("PublicRoute: chưa đăng nhập → render children", () => {
    render(
      <PublicRoute onRedirect={() => {}}>
        <div>{CHILD}</div>
      </PublicRoute>,
    );
    expect(screen.getByText(CHILD)).toBeInTheDocument();
  });

  it("PublicRoute: đã đăng nhập → redirect intent, KHÔNG render children", () => {
    login();
    const onRedirect = vi.fn();
    render(
      <PublicRoute onRedirect={onRedirect} redirectTo="/home">
        <div>{CHILD}</div>
      </PublicRoute>,
    );
    expect(onRedirect).toHaveBeenCalledWith("/home");
    expect(screen.queryByText(CHILD)).not.toBeInTheDocument();
  });
});
