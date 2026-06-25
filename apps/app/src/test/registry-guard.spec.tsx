// @vitest-environment jsdom
/**
 * [registry-guard] Kiểm tra registry + route guard logic (đơn-vị thuần) của apps/app.
 *
 * Phủ:
 * 1. ForbiddenPage renders đúng title + reason text.
 * 2. evaluateRouteAccess (import từ web-core) hoạt động đúng trong context app
 *    với session được build từ auth store (mô phỏng buildSession()).
 * 3. getVisibleApps lọc đúng theo capabilities của auth store.
 * 4. filterSidebarItems ẩn item khi thiếu quyền.
 *
 * PHẠM VI: spec này CHỈ kiểm tra hàm guard THUẦN (evaluateRouteAccess) + helper registry — KHÔNG khẳng
 * định wiring router→ProtectedRoute. Vì guard thuần xanh KHÔNG bảo chứng router thực sự TIÊU THỤ guardResult
 * (regression cũ: guardResult bị bỏ rơi vẫn để các unit-test này xanh). Hợp đồng wiring SỐNG (router →
 * ProtectedRoute chặn nội dung module khi thiếu quyền) được khóa ở consumer THẬT:
 *   apps/app/src/layouts/protected/ProtectedRoute.spec.tsx (ProtectedRoute + buildModuleRouteContent).
 * Đừng coi green ở file này là bằng chứng route-level authz còn sống.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPermissionChecker,
  evaluateRouteAccess,
  filterSidebarItems,
  getVisibleApps,
  APP_REGISTRY,
  type SessionContext,
  type SidebarItemMeta,
  type UserPermission,
} from "@mediaos/web-core";

// ---------------------------------------------------------------------------
// Minimal i18n mock (nav namespace)
// ---------------------------------------------------------------------------
vi.mock("react-i18next", () => ({
  useTranslation: (_ns: string) => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// ---------------------------------------------------------------------------
// TanStack Router Link mock (ForbiddenPage dùng Link)
// ---------------------------------------------------------------------------
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    status: "authenticated",
    user: { id: "u1", email: "test@co.com", status: "Active", companyId: "c1" },
    company: { id: "c1", name: "Acme", status: "Active" },
    modules: [],
    ...overrides,
  };
}

function makePerms(permissions: string[]): UserPermission[] {
  return permissions.map((p) => ({ permission: p, scopes: [] as never }));
}

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// ForbiddenPage
// ---------------------------------------------------------------------------

describe("ForbiddenPage", () => {
  // Lazy import after mock setup
  async function renderForbidden(reason?: string) {
    const { ForbiddenPage } = await import("@/routes/forbidden");
    // Link is mocked via vi.mock("@tanstack/react-router") above — no router wrapper needed.
    render(<ForbiddenPage reason={reason} />);
  }

  it("renders tiêu đề forbidden", async () => {
    await renderForbidden();
    expect(screen.getByText("forbidden.title")).toBeInTheDocument();
  });

  it("renders reason NO_PERMISSION khi truyền reason", async () => {
    await renderForbidden("NO_PERMISSION");
    expect(screen.getByText("forbidden.reason.NO_PERMISSION")).toBeInTheDocument();
  });

  it("renders reason USER_INACTIVE", async () => {
    await renderForbidden("USER_INACTIVE");
    expect(screen.getByText("forbidden.reason.USER_INACTIVE")).toBeInTheDocument();
  });

  it("renders description mặc định khi reason không hợp lệ", async () => {
    await renderForbidden("SOME_UNKNOWN_REASON");
    expect(screen.getByText("forbidden.description")).toBeInTheDocument();
  });

  it("renders description mặc định khi không có reason", async () => {
    await renderForbidden(undefined);
    expect(screen.getByText("forbidden.description")).toBeInTheDocument();
  });

  it("renders link về trang chủ", async () => {
    await renderForbidden();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/");
  });
});

// ---------------------------------------------------------------------------
// evaluateRouteAccess — route guard logic (unit, không mount router)
// ---------------------------------------------------------------------------

describe("evaluateRouteAccess — guard logic trong context app", () => {
  const hrRoute = {
    routeKey: "hr.employees",
    path: "/hr/employees",
    layout: "MODULE_WORKSPACE" as const,
    moduleCode: "HR" as const,
    titleKey: "routeTitle.hrEmployees",
    requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
  };

  it("ALLOW khi có quyền + module active", () => {
    const session = makeSession({ modules: [{ moduleCode: "HR", status: "active" }] });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    expect(evaluateRouteAccess(session, hrRoute, c).action).toBe("ALLOW");
  });

  it("SHOW_403 khi thiếu quyền dù module active", () => {
    const session = makeSession({ modules: [{ moduleCode: "HR", status: "active" }] });
    const c = createPermissionChecker(makePerms([]));
    const r = evaluateRouteAccess(session, hrRoute, c);
    expect(r.action).toBe("SHOW_403");
    expect(r.reason).toBe("NO_PERMISSION");
  });

  it("SHOW_404 khi module không tồn tại trong session", () => {
    const session = makeSession({ modules: [] }); // HR không có
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    expect(evaluateRouteAccess(session, hrRoute, c).action).toBe("SHOW_404");
  });

  it("REDIRECT_LOGIN khi unauthenticated", () => {
    const session = makeSession({ status: "unauthenticated", user: null });
    const c = createPermissionChecker(makePerms([]));
    const r = evaluateRouteAccess(session, hrRoute, c);
    expect(r.action).toBe("REDIRECT_LOGIN");
    // redirectTo dạng /login?returnUrl=<encoded> — kiểm tra path sau decode
    expect(decodeURIComponent(r.redirectTo ?? "")).toContain("/hr/employees");
  });

  it("SHOW_403 khi user Locked", () => {
    const session = makeSession({
      user: { id: "u1", email: "a@b.com", status: "Locked", companyId: "c1" },
      modules: [{ moduleCode: "HR", status: "active" }],
    });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const r = evaluateRouteAccess(session, hrRoute, c);
    expect(r.action).toBe("SHOW_403");
    expect(r.reason).toBe("USER_INACTIVE");
  });
});

// ---------------------------------------------------------------------------
// getVisibleApps — App Switcher filter
// ---------------------------------------------------------------------------

describe("getVisibleApps — App Switcher", () => {
  it("ẩn app inactive theo module status từ session", () => {
    const session = makeSession({ modules: [{ moduleCode: "HR", status: "hidden" }] });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const visible = getVisibleApps(APP_REGISTRY, session, c);
    expect(visible.find((a) => a.appKey === "hr")).toBeUndefined();
  });

  it("hiện app khi module active và user có quyền", () => {
    const session = makeSession({ modules: [{ moduleCode: "LEAVE", status: "active" }] });
    const c = createPermissionChecker(makePerms(["LEAVE.REQUEST.VIEW_OWN"]));
    const visible = getVisibleApps(APP_REGISTRY, session, c);
    expect(visible.find((a) => a.appKey === "leave")).toBeDefined();
  });

  it("ẩn app active khi user không có bất kỳ quyền yêu cầu nào", () => {
    const session = makeSession({ modules: [{ moduleCode: "TASK", status: "active" }] });
    const c = createPermissionChecker(makePerms([]));
    const visible = getVisibleApps(APP_REGISTRY, session, c);
    expect(visible.find((a) => a.appKey === "tasks")).toBeUndefined();
  });

  it("hiện app coming_soon dù user không có quyền (showcase inactive modules)", () => {
    const comingSoonApps = APP_REGISTRY.map((a) =>
      a.appKey === "tasks" ? { ...a, status: "coming_soon" as const } : a,
    );
    const session = makeSession({ modules: [] });
    const c = createPermissionChecker(makePerms([]));
    const visible = getVisibleApps(comingSoonApps, session, c);
    expect(visible.find((a) => a.appKey === "tasks")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// filterSidebarItems — Sidebar menu filter
// ---------------------------------------------------------------------------

describe("filterSidebarItems — Sidebar", () => {
  const activeLeaveSession = makeSession({
    modules: [{ moduleCode: "LEAVE", status: "active" }],
  });

  const leaveSidebar: SidebarItemMeta[] = [
    {
      sidebarKey: "leave.my-requests",
      moduleCode: "LEAVE",
      label: "Đơn nghỉ của tôi",
      path: "/leave/me/requests",
      order: 20,
      requiredAnyPermissions: ["LEAVE.REQUEST.VIEW_OWN"],
    },
    {
      sidebarKey: "leave.approvals",
      moduleCode: "LEAVE",
      label: "Đơn cần duyệt",
      path: "/leave/approvals",
      order: 30,
      requiredAnyPermissions: ["LEAVE.REQUEST.APPROVE"],
    },
  ];

  it("employee không có quyền duyệt → ẩn approvals item", () => {
    const c = createPermissionChecker(makePerms(["LEAVE.REQUEST.VIEW_OWN"]));
    const filtered = filterSidebarItems(leaveSidebar, c, activeLeaveSession);
    expect(filtered.find((i) => i.sidebarKey === "leave.approvals")).toBeUndefined();
    expect(filtered.find((i) => i.sidebarKey === "leave.my-requests")).toBeDefined();
  });

  it("manager có quyền duyệt → hiện cả 2 item", () => {
    const c = createPermissionChecker(
      makePerms(["LEAVE.REQUEST.VIEW_OWN", "LEAVE.REQUEST.APPROVE"]),
    );
    const filtered = filterSidebarItems(leaveSidebar, c, activeLeaveSession);
    expect(filtered).toHaveLength(2);
  });

  it("user không có quyền gì → sidebar rỗng", () => {
    const c = createPermissionChecker(makePerms([]));
    const filtered = filterSidebarItems(leaveSidebar, c, activeLeaveSession);
    expect(filtered).toHaveLength(0);
  });

  it("module locked → sidebar rỗng dù có quyền", () => {
    const lockedSession = makeSession({
      modules: [{ moduleCode: "LEAVE", status: "locked" }],
    });
    const c = createPermissionChecker(
      makePerms(["LEAVE.REQUEST.VIEW_OWN", "LEAVE.REQUEST.APPROVE"]),
    );
    const filtered = filterSidebarItems(leaveSidebar, c, lockedSession);
    expect(filtered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// NavItem backward compat — status/permission/module fields optional
// ---------------------------------------------------------------------------

describe("NavItem registry metadata — backward compat", () => {
  it("NavItem không có status/permission/module vẫn valid (tương thích ngược)", async () => {
    // Import type để kiểm tra compile-time compat; runtime chỉ kiểm tra object hợp lệ
    const { LayoutDashboard } = await import("lucide-react");
    // NavItem type từ web-core — import runtime value bằng dynamic import
    const { navItemsByCategory } = await import("@mediaos/web-core");

    const legacyItem = {
      id: "tasks",
      labelKey: "tasks",
      to: "/tasks",
      icon: LayoutDashboard,
      tile: "bg-slate-500/12 text-slate-600",
      category: "work" as const,
      // Không có status / permission / module / scope
    };

    // navItemsByCategory không throw với item không có registry fields mới
    expect(() => navItemsByCategory([legacyItem])).not.toThrow();
  });

  it("NavItem có registry metadata mới không ảnh hưởng navItemsByCategory", async () => {
    const { LayoutDashboard } = await import("lucide-react");
    const { navItemsByCategory } = await import("@mediaos/web-core");

    const newItem = {
      id: "hr",
      labelKey: "employees",
      to: "/hr/employees",
      icon: LayoutDashboard,
      tile: "bg-blue-500/12 text-blue-600",
      category: "hr" as const,
      permission: "HR.EMPLOYEE.VIEW",
      module: "HR",
      status: "active" as const,
      scope: "Company",
    };

    const groups = navItemsByCategory([newItem]);
    const hrGroup = groups.find((g) => g.meta.id === "hr");
    expect(hrGroup?.items).toHaveLength(1);
    expect(hrGroup?.items[0].id).toBe("hr");
  });
});
