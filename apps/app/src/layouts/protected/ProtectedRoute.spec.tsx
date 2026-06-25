// @vitest-environment jsdom
/**
 * [ProtectedRoute] Deny-path AUTHZ TẦNG ROUTE (RED-first, colocate cạnh consumer) — FULL gate.
 *
 * Vì sao spec này tồn tại (chống regression đã từng lọt 1 vòng trước):
 *  - Router CÓ LÚC thay <ProtectedRoute meta> bằng beforeLoad sinh `guardResult` mà KHÔNG ai tiêu thụ
 *    → user đăng nhập thiếu quyền vẫn render được nội dung module. Đây là regression authz đỏ.
 *  - Spec này khóa hành vi ĐÚNG bằng cách chạm CONSUMER THẬT theo hai tầng:
 *      (A) Component thật `ProtectedRoute` (đọc store → evaluateRouteFromStore → render trạng thái).
 *      (B) Factory router THẬT `buildModuleRouteContent` + `getMeta` (đúng hàm router.tsx dùng cho MỌI
 *          route module) → đảm bảo wiring router→ProtectedRoute còn sống, không chỉ unit hoá guard.
 *
 * Phủ deny-path + allow-path:
 *  - Thiếu quyền (capabilities rỗng)        → SHOW_403 / NO_PERMISSION, nội dung module ẨN.
 *  - User Locked                            → SHOW_403 / USER_INACTIVE,  nội dung module ẨN.
 *  - Đủ quyền                               → ALLOW: render children.
 *  - modules:[] (chưa expand /me)           → KHÔNG rơi false-404 (RouteNotFoundState không xuất hiện);
 *                                             vẫn enforce nhánh permission (đủ quyền → ALLOW).
 *
 * Ghi chú false-404: evaluateRouteAccess trả SHOW_404 khi modules rỗng + route có moduleCode. ProtectedRoute
 * (evaluateRouteFromStore) BỎ moduleCode khi modules rỗng → chỉ enforce session/user-status/permission.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore, type RouteMeta } from "@mediaos/web-core";
import { ProtectedRoute } from "@/layouts/protected/ProtectedRoute";

// ProtectedShell + ModuleWorkspaceLayout là vỏ nặng (topbar/sidebar/store). Mock passthrough để cô lập
// đúng tầng AUTHZ — nếu wiring chặn, children KHÔNG mount nên passthrough vô hại; nếu wiring hỏng (không
// chặn), children SẼ mount và lộ ra → test bắt được regression.
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

// Route có moduleCode (giống registry thật) — nếu false-404 sống thì modules:[] sẽ ra 404.
const hrMeta: RouteMeta = {
  routeKey: "hr.employees",
  path: "/hr/employees",
  layout: "MODULE_WORKSPACE",
  moduleCode: "HR",
  titleKey: "routeTitle.hrEmployees",
  requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
};

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

beforeEach(() => {
  useAuthStore.getState().logout();
});
afterEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().logout();
});

// ---------------------------------------------------------------------------
// (A) Consumer thật: ProtectedRoute đọc store → render trạng thái theo guardResult
// ---------------------------------------------------------------------------
describe("ProtectedRoute tiêu thụ guardResult (consumer thật)", () => {
  it("thiếu quyền (capabilities rỗng) → SHOW_403 / NO_PERMISSION, nội dung module ẨN", () => {
    seedAuth({ status: "Active", capabilities: {} }); // không có read:employee
    render(
      <ProtectedRoute meta={hrMeta} onRedirect={() => {}}>
        <ModulePage />
      </ProtectedRoute>,
    );
    expect(screen.getByText("forbidden.title")).toBeInTheDocument();
    expect(screen.getByText("forbidden.reason.NO_PERMISSION")).toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });

  it("user Locked → SHOW_403 / USER_INACTIVE, nội dung module ẨN", () => {
    // Có quyền nhưng user bị khóa → vẫn chặn bằng USER_INACTIVE (không phải NO_PERMISSION).
    seedAuth({ status: "Locked", capabilities: { "read:employee": true } });
    render(
      <ProtectedRoute meta={hrMeta} onRedirect={() => {}}>
        <ModulePage />
      </ProtectedRoute>,
    );
    expect(screen.getByText("forbidden.reason.USER_INACTIVE")).toBeInTheDocument();
    expect(screen.queryByText("forbidden.reason.NO_PERMISSION")).not.toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });

  it("đủ quyền → ALLOW: render children", () => {
    seedAuth({ status: "Active", capabilities: { "read:employee": true } });
    render(
      <ProtectedRoute meta={hrMeta} onRedirect={() => {}}>
        <ModulePage />
      </ProtectedRoute>,
    );
    expect(screen.getByText(MODULE_CONTENT)).toBeInTheDocument();
    expect(screen.queryByText("forbidden.title")).not.toBeInTheDocument();
  });

  it("modules:[] + có moduleCode + đủ quyền → KHÔNG false-404 (children render)", () => {
    // store luôn để modules:[] (chưa expand /me). Route có moduleCode HR.
    // Nếu false-404 sống → ra 404; ProtectedRoute phải bỏ moduleCode → ALLOW vì có quyền.
    seedAuth({ status: "Active", capabilities: { "read:employee": true } });
    render(
      <ProtectedRoute meta={hrMeta} onRedirect={() => {}}>
        <ModulePage />
      </ProtectedRoute>,
    );
    expect(screen.getByText(MODULE_CONTENT)).toBeInTheDocument();
    expect(screen.queryByText("404")).not.toBeInTheDocument();
    expect(screen.queryByText("routeTitle.notFound")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (B) Wiring router THẬT: buildModuleRouteContent + getMeta (factory router.tsx dùng cho MỌI route module)
//     → đảm bảo router→ProtectedRoute còn sống. Nếu router bỏ ProtectedRoute (regression cũ), các case này đỏ.
// ---------------------------------------------------------------------------
describe("router wires ProtectedRoute (buildModuleRouteContent THẬT)", () => {
  it("module DASH thiếu quyền qua factory router → SHOW_403, nội dung module ẨN", async () => {
    const { buildModuleRouteContent, getMeta } = await import("@/router");
    seedAuth({ status: "Active", capabilities: {} }); // không có read:dashboard
    render(buildModuleRouteContent(getMeta("dashboard"), "DASH", <ModulePage />));
    expect(screen.getByText("forbidden.reason.NO_PERMISSION")).toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });

  it("module DASH đủ quyền qua factory router → render nội dung module", async () => {
    const { buildModuleRouteContent, getMeta } = await import("@/router");
    seedAuth({ status: "Active", capabilities: { "read:dashboard": true } });
    render(buildModuleRouteContent(getMeta("dashboard"), "DASH", <ModulePage />));
    expect(screen.getByText(MODULE_CONTENT)).toBeInTheDocument();
    expect(screen.queryByText("forbidden.title")).not.toBeInTheDocument();
  });

  it("HR detail dùng CÙNG factory → thiếu HR.EMPLOYEE.VIEW vẫn bị chặn (không authGuard trần)", async () => {
    const { buildModuleRouteContent, getMeta } = await import("@/router");
    seedAuth({ status: "Active", capabilities: {} }); // không có read:employee
    render(buildModuleRouteContent(getMeta("hr.employees"), "HR", <ModulePage />));
    expect(screen.getByText("forbidden.reason.NO_PERMISSION")).toBeInTheDocument();
    expect(screen.queryByText(MODULE_CONTENT)).not.toBeInTheDocument();
  });
});
