// @vitest-environment jsdom
/**
 * [route-authz-wiring] Hợp đồng AUTHZ TẦNG ROUTE — chống regression "guardResult chết".
 *
 * Bối cảnh: 1 vòng trước, router thay <ProtectedRoute meta> bằng beforeLoad sinh `guardResult`
 * KHÔNG ai tiêu thụ → user đăng nhập thiếu quyền vẫn render được nội dung module (DASH/ATT/LEAVE…).
 * Test này khóa hành vi ĐÚNG: nội dung route module do `buildModuleRouteContent` (chính factory
 * router.tsx dùng cho MỌI route module) PHẢI đi qua ProtectedRoute và CHẶN khi thiếu quyền.
 *
 * Phủ deny-path (FULL gate — đây là thay đổi authz):
 *  - Module bất kỳ (DASH) thiếu quyền  → SHOW_403, nội dung module ẨN.
 *  - User Locked                        → SHOW_403(USER_INACTIVE), nội dung module ẨN.
 *  - Đủ quyền                           → nội dung module render.
 *  - HR detail route dùng CÙNG ProtectedRoute → thiếu quyền vẫn bị chặn (không authGuard trần).
 *
 * Ghi chú false-404: store có modules:[] (chưa expand /me) → ProtectedRoute bỏ qua gating module-status,
 * chỉ enforce nhánh permission/user-status. Bởi vậy deny-path test xoáy vào NO_PERMISSION/USER_INACTIVE.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@mediaos/web-core";

// ProtectedShell + ModuleWorkspaceLayout là vỏ nặng (topbar/sidebar/store) — mock passthrough để
// test cô lập đúng tầng AUTHZ (ProtectedRoute). Nếu wiring chặn, children KHÔNG mount → mock vô hại.
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

describe("router wires ProtectedRoute for module routes (authz at route level)", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
  });
  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().logout();
  });

  it("module DASH thiếu quyền → SHOW_403, nội dung module ẨN", async () => {
    const { buildModuleRouteContent, getMeta } = await import("@/router");
    seedAuth({ status: "Active", capabilities: {} }); // không có read:dashboard
    render(buildModuleRouteContent(getMeta("dashboard"), "DASH", <ModulePage />));
    expect(screen.getByText("forbidden.title")).toBeInTheDocument();
    expect(screen.getByText("forbidden.reason.NO_PERMISSION")).toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });

  it("user Locked → SHOW_403(USER_INACTIVE), nội dung module ẨN", async () => {
    const { buildModuleRouteContent, getMeta } = await import("@/router");
    seedAuth({ status: "Locked", capabilities: { "read:dashboard": true } });
    render(buildModuleRouteContent(getMeta("dashboard"), "DASH", <ModulePage />));
    expect(screen.getByText("forbidden.reason.USER_INACTIVE")).toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });

  it("đủ quyền → nội dung module render", async () => {
    const { buildModuleRouteContent, getMeta } = await import("@/router");
    seedAuth({ status: "Active", capabilities: { "read:dashboard": true } });
    render(buildModuleRouteContent(getMeta("dashboard"), "DASH", <ModulePage />));
    expect(screen.getByText(MODULE_CONTENT)).toBeInTheDocument();
    expect(screen.queryByText("forbidden.title")).not.toBeInTheDocument();
  });

  it("HR detail dùng CÙNG ProtectedRoute → thiếu HR.EMPLOYEE.VIEW vẫn bị chặn", async () => {
    const { buildModuleRouteContent, getMeta } = await import("@/router");
    seedAuth({ status: "Active", capabilities: {} }); // không có read:employee
    render(buildModuleRouteContent(getMeta("hr.employees"), "HR", <ModulePage />));
    expect(screen.getByText("forbidden.reason.NO_PERMISSION")).toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });
});
