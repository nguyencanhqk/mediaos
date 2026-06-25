// @vitest-environment jsdom
/**
 * [route-403-wiring] Hợp đồng: ProtectedRoute TIÊU THỤ guardResult của evaluateRouteAccess và render
 * đúng trạng thái — KHÔNG render nội dung module khi bị chặn.
 *
 * Phủ:
 *  - SHOW_403 / NO_PERMISSION  → ForbiddenPage, nội dung module ẨN.
 *  - SHOW_403 / USER_INACTIVE  (user.status='Locked') → ForbiddenPage(USER_INACTIVE), nội dung ẨN.
 *  - ALLOW                      → render children, KHÔNG 403.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type RouteMeta } from "@mediaos/web-core";
import { ProtectedRoute } from "@/layouts/protected/ProtectedRoute";

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

// Route KHÔNG có moduleCode → tránh false-404 do modules:[] (pin theo plan rủi ro #3).
const hrMeta: RouteMeta = {
  routeKey: "hr.employees",
  path: "/hr/employees",
  layout: "MODULE_WORKSPACE",
  titleKey: "routeTitle.hrEmployees",
  requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
};

const MODULE_CONTENT = "module-page-content";
function ModulePage() {
  return <div>{MODULE_CONTENT}</div>;
}

function seedAuth(opts: { status?: string; capabilities?: Record<string, boolean> }) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: {
      id: "u1",
      companyId: "c1",
      email: "u@co.com",
      fullName: "U",
      status: opts.status ?? "Active",
    },
    username: "u@co.com",
    accessToken: "a",
    refreshToken: null,
    capabilities: opts.capabilities ?? {},
  });
}

describe("ProtectedRoute consumes guardResult", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().logout();
  });

  it("SHOW_403 / NO_PERMISSION → ForbiddenPage, module content ẨN", () => {
    seedAuth({ status: "Active", capabilities: {} }); // thiếu read:employee
    render(
      <ProtectedRoute meta={hrMeta} onRedirect={() => {}}>
        <ModulePage />
      </ProtectedRoute>,
    );
    expect(screen.getByText("forbidden.title")).toBeInTheDocument();
    expect(screen.getByText("forbidden.reason.NO_PERMISSION")).toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });

  it("SHOW_403 / USER_INACTIVE (Locked) → ForbiddenPage(USER_INACTIVE), module content ẨN", () => {
    seedAuth({ status: "Locked", capabilities: { "read:employee": true } });
    render(
      <ProtectedRoute meta={hrMeta} onRedirect={() => {}}>
        <ModulePage />
      </ProtectedRoute>,
    );
    expect(screen.getByText("forbidden.reason.USER_INACTIVE")).toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });

  it("ALLOW → render children, KHÔNG 403", () => {
    seedAuth({ status: "Active", capabilities: { "read:employee": true } });
    render(
      <ProtectedRoute meta={hrMeta} onRedirect={() => {}}>
        <ModulePage />
      </ProtectedRoute>,
    );
    expect(screen.getByText(MODULE_CONTENT)).toBeInTheDocument();
    expect(screen.queryByText("forbidden.title")).not.toBeInTheDocument();
  });
});
