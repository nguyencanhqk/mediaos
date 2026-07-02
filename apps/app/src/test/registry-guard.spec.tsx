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
  getRouteMeta,
  APP_REGISTRY,
  type SessionContext,
  type SidebarItemMeta,
  type UserPermission,
} from "@mediaos/web-core";
import { ATT_SIDEBAR, LEAVE_SIDEBAR, SYSTEM_SIDEBAR } from "@/layouts/workspace/sidebar-registry";
import {
  SYSTEM_PUBLIC_HOLIDAYS_ROUTE_META,
  SYSTEM_HEALTH_ROUTE_META,
  SYSTEM_RETENTION_ROUTE_META,
  SYSTEM_FILE_ACCESS_LOGS_ROUTE_META,
} from "@/routes/system/foundation/constants";

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

/** Cặp-engine + scope THẬT (per-permission) — mô phỏng /auth/me capabilities+scopes (KHÔNG []). */
function makeScopedPerms(entries: UserPermission[]): UserPermission[] {
  return entries.map((e) => ({ permission: e.permission, scopes: [...e.scopes] }));
}

// Persona theo cặp ENGINE THẬT + scope THẬT (pair-as-gate + defense-in-depth).
const EMPLOYEE_PERMS = makeScopedPerms([
  { permission: "view-own:attendance", scopes: ["Own"] },
  { permission: "view-own:leave", scopes: ["Own"] },
]);
const MANAGER_PERMS = makeScopedPerms([
  { permission: "view-own:attendance", scopes: ["Own"] },
  { permission: "view-team:attendance", scopes: ["Team"] },
  { permission: "view-own:leave", scopes: ["Own"] },
  // S3-FE-LEAVE-2: mig 0455 grant manager view:leave@Team + approve:leave@Team (đọc chéo/duyệt phạm vi nhóm).
  // view:leave là cổng của leave.approvals (route + sidebar) — phải có để manager thấy menu + qua route.
  { permission: "view:leave", scopes: ["Team"] },
  { permission: "approve:leave", scopes: ["Team"] },
]);
const HR_PERMS = makeScopedPerms([
  { permission: "view-own:attendance", scopes: ["Own"] },
  { permission: "view-team:attendance", scopes: ["Team"] },
  { permission: "view-company:attendance", scopes: ["Company"] },
  { permission: "view-own:leave", scopes: ["Own"] },
  { permission: "view:leave", scopes: ["Company"] },
  { permission: "approve:leave", scopes: ["Company"] },
]);

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
// CROWN — ATT scoped sidebar (real registry) pair-as-gate deny-path matrix
// filterSidebarItems chạy trên ATT_SIDEBAR/LEAVE_SIDEBAR THẬT (không fixture cục bộ) → khoá registry.
// employee ẩn Team/Company + approvals; manager thấy Team ẩn Company; hr thấy Company.
// ---------------------------------------------------------------------------

describe("filterSidebarItems — ATT scoped (real registry) deny-path", () => {
  const attActive = makeSession({ modules: [{ moduleCode: "ATT", status: "active" }] });
  const leaveActive = makeSession({ modules: [{ moduleCode: "LEAVE", status: "active" }] });

  it("employee → ẩn att.team-records + att.records + leave.approvals", () => {
    const att = filterSidebarItems(ATT_SIDEBAR, createPermissionChecker(EMPLOYEE_PERMS), attActive);
    expect(att.find((i) => i.sidebarKey === "att.today")).toBeDefined();
    expect(att.find((i) => i.sidebarKey === "att.my-records")).toBeDefined();
    expect(att.find((i) => i.sidebarKey === "att.team-records")).toBeUndefined();
    expect(att.find((i) => i.sidebarKey === "att.records")).toBeUndefined();

    const leave = filterSidebarItems(
      LEAVE_SIDEBAR,
      createPermissionChecker(EMPLOYEE_PERMS),
      leaveActive,
    );
    expect(leave.find((i) => i.sidebarKey === "leave.approvals")).toBeUndefined();
  });

  it("manager (view:leave@Team) → thấy att.team-records, ẩn att.records; thấy leave.approvals", () => {
    const att = filterSidebarItems(ATT_SIDEBAR, createPermissionChecker(MANAGER_PERMS), attActive);
    expect(att.find((i) => i.sidebarKey === "att.team-records")).toBeDefined();
    expect(att.find((i) => i.sidebarKey === "att.records")).toBeUndefined();

    // S3-FE-LEAVE-2: leave.approvals gate = LEAVE.REQUEST.VIEW (view:leave). Manager có view:leave@Team → hiện.
    const leave = filterSidebarItems(
      LEAVE_SIDEBAR,
      createPermissionChecker(MANAGER_PERMS),
      leaveActive,
    );
    expect(leave.find((i) => i.sidebarKey === "leave.approvals")).toBeDefined();
  });

  it("hr (view:leave@Company) → thấy att.records (+ att.team-records) + leave.approvals", () => {
    const att = filterSidebarItems(ATT_SIDEBAR, createPermissionChecker(HR_PERMS), attActive);
    expect(att.find((i) => i.sidebarKey === "att.records")).toBeDefined();
    expect(att.find((i) => i.sidebarKey === "att.team-records")).toBeDefined();

    const leave = filterSidebarItems(LEAVE_SIDEBAR, createPermissionChecker(HR_PERMS), leaveActive);
    expect(leave.find((i) => i.sidebarKey === "leave.approvals")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// S3-FE-LEAVE-2 — leave.approvals PIN CỔNG (view:leave) trên REGISTRY THẬT
// Route guard + sidebar gate ĐỀU đòi LEAVE.REQUEST.VIEW (KHÔNG approve:leave). employee (view-own:leave,
// KHÔNG view:leave) → ẩn menu + SHOW_403 ở route; manager(view:leave@Team) / hr(view:leave@Company) → ALLOW.
// scopes THẬT (per-permission) + modules không rỗng → chống xanh-giả (fixture rỗng có thể pass sai).
// ---------------------------------------------------------------------------

describe("leave.approvals gate = view:leave (registry thật)", () => {
  const leaveActive = makeSession({ modules: [{ moduleCode: "LEAVE", status: "active" }] });
  const approvalsMeta = getRouteMeta("leave.approvals")!;

  it("pin cổng: meta yêu cầu ĐÚNG LEAVE.REQUEST.VIEW (không approve)", () => {
    expect(approvalsMeta.requiredAnyPermissions).toEqual(["LEAVE.REQUEST.VIEW"]);
    const approvalsSidebar = LEAVE_SIDEBAR.find((i) => i.sidebarKey === "leave.approvals");
    expect(approvalsSidebar?.requiredAnyPermissions).toEqual(["LEAVE.REQUEST.VIEW"]);
  });

  it("employee (không view:leave) → LEAVE_SIDEBAR ẩn leave.approvals + route SHOW_403", () => {
    const c = createPermissionChecker(EMPLOYEE_PERMS);
    const leave = filterSidebarItems(LEAVE_SIDEBAR, c, leaveActive);
    expect(leave.find((i) => i.sidebarKey === "leave.approvals")).toBeUndefined();
    expect(evaluateRouteAccess(leaveActive, approvalsMeta, c).action).toBe("SHOW_403");
  });

  it("manager (view:leave@Team) → hiện leave.approvals + route ALLOW", () => {
    const c = createPermissionChecker(MANAGER_PERMS);
    const leave = filterSidebarItems(LEAVE_SIDEBAR, c, leaveActive);
    expect(leave.find((i) => i.sidebarKey === "leave.approvals")).toBeDefined();
    expect(evaluateRouteAccess(leaveActive, approvalsMeta, c).action).toBe("ALLOW");
  });

  it("hr (view:leave@Company) → hiện leave.approvals + route ALLOW", () => {
    const c = createPermissionChecker(HR_PERMS);
    const leave = filterSidebarItems(LEAVE_SIDEBAR, c, leaveActive);
    expect(leave.find((i) => i.sidebarKey === "leave.approvals")).toBeDefined();
    expect(evaluateRouteAccess(leaveActive, approvalsMeta, c).action).toBe("ALLOW");
  });

  it("anti-false-green: MANAGER_PERMS có scope THẬT (≠[]) + có view:leave; session.modules ≠ []", () => {
    expect(MANAGER_PERMS.every((p) => p.scopes.length > 0)).toBe(true);
    expect(MANAGER_PERMS.some((p) => p.permission === "view:leave")).toBe(true);
    expect(leaveActive.modules.length).toBeGreaterThan(0);
  });
});

describe("getVisibleApps — company-admin thấy attendance + leave", () => {
  it("caps company-admin THẬT → attendance & leave hiển thị", () => {
    const session = makeSession({
      modules: [
        { moduleCode: "ATT", status: "active" },
        { moduleCode: "LEAVE", status: "active" },
      ],
    });
    const c = createPermissionChecker(HR_PERMS);
    const visible = getVisibleApps(APP_REGISTRY, session, c);
    expect(visible.find((a) => a.appKey === "attendance")).toBeDefined();
    expect(visible.find((a) => a.appKey === "leave")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// NavItem backward compat — status/permission/module fields optional
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// S2-FE-FND-7 (H8/§7) — 4 màn System (public-holidays/health/retention/file-access-logs) visibility
// trong SYSTEM_SIDEBAR THẬT. Kiểm: (1) sidebar pair === route-meta pair (chống drift); (2) deny-path
// PER-ENTRY — persona thiếu ĐÚNG cặp của entry đó (nhưng có các cặp entry khác) → entry ẨN; có cặp → hiện.
// admin-full-quyền KHÔNG đủ để chứng minh (phải per-entry mới bắt được pair-drift).
// ---------------------------------------------------------------------------

describe("S2-FE-FND-7 — 4 System sidebar entries (registry thật)", () => {
  const foundationActive = makeSession({
    modules: [{ moduleCode: "FOUNDATION", status: "active" }],
  });

  // sidebarKey → { meta, allPairs của entry }.
  const NEW_ENTRIES = [
    { key: "system.public-holidays", meta: SYSTEM_PUBLIC_HOLIDAYS_ROUTE_META },
    { key: "system.health", meta: SYSTEM_HEALTH_ROUTE_META },
    { key: "system.retention", meta: SYSTEM_RETENTION_ROUTE_META },
    { key: "system.file-access-logs", meta: SYSTEM_FILE_ACCESS_LOGS_ROUTE_META },
  ] as const;

  // Tập cặp của mọi entry mới (để dựng persona "thiếu ĐÚNG entry X").
  const ALL_NEW_PAIRS = Array.from(
    new Set(NEW_ENTRIES.flatMap((e) => e.meta.requiredAnyPermissions ?? [])),
  );

  it("cả 4 entry tồn tại trong SYSTEM_SIDEBAR + sidebar pair === route-meta pair", () => {
    for (const { key, meta } of NEW_ENTRIES) {
      const entry = SYSTEM_SIDEBAR.find((i) => i.sidebarKey === key);
      expect(entry, `sidebar entry ${key} phải tồn tại`).toBeDefined();
      // Nguồn CHUNG → cùng mảng requiredAnyPermissions (chống pair-drift route↔sidebar).
      expect(entry?.requiredAnyPermissions).toEqual(meta.requiredAnyPermissions);
    }
  });

  it("entry health gate ĐỦ CẢ 2 cặp [view:foundation-setting, view:user]", () => {
    expect(SYSTEM_HEALTH_ROUTE_META.requiredAnyPermissions).toEqual([
      "view:foundation-setting",
      "view:user",
    ]);
  });

  it("entry retention gate view:foundation-retention (KHÔNG manage — tránh ẩn nhầm company-admin)", () => {
    expect(SYSTEM_RETENTION_ROUTE_META.requiredAnyPermissions).toEqual([
      "view:foundation-retention",
    ]);
    expect(SYSTEM_RETENTION_ROUTE_META.requiredAnyPermissions).not.toContain(
      "manage:foundation-retention",
    );
  });

  it("KHÔNG có entry /system/settings (chờ S2-FND-BE-8)", () => {
    expect(SYSTEM_SIDEBAR.find((i) => i.path === "/system/settings")).toBeUndefined();
  });

  for (const { key, meta } of NEW_ENTRIES) {
    const requiredPairs = meta.requiredAnyPermissions ?? [];

    it(`${key}: persona CÓ cặp → hiện entry`, () => {
      const c = createPermissionChecker(makePerms([requiredPairs[0]]));
      const filtered = filterSidebarItems(SYSTEM_SIDEBAR, c, foundationActive);
      expect(filtered.find((i) => i.sidebarKey === key)).toBeDefined();
    });

    it(`${key}: persona THIẾU cặp của entry (có cặp entry khác) → ẨN entry (per-entry deny)`, () => {
      // Grant mọi cặp entry-mới TRỪ cặp của entry đang xét → chứng minh gate theo ĐÚNG cặp, không "admin-full".
      const withoutThisEntry = ALL_NEW_PAIRS.filter((p) => !requiredPairs.includes(p));
      const c = createPermissionChecker(makePerms(withoutThisEntry));
      const filtered = filterSidebarItems(SYSTEM_SIDEBAR, c, foundationActive);
      expect(filtered.find((i) => i.sidebarKey === key)).toBeUndefined();
    });

    it(`${key}: persona rỗng quyền → ẨN entry`, () => {
      const c = createPermissionChecker(makePerms([]));
      const filtered = filterSidebarItems(SYSTEM_SIDEBAR, c, foundationActive);
      expect(filtered.find((i) => i.sidebarKey === key)).toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------------------
// S2-FE-FND-7 (H8) — app 'system' landing KHÔNG 403. defaultRoute = /system (Overview). MỌI persona
// thấy app System (có ≥1 cặp app-visibility) → evaluateRouteAccess(system.overview) === ALLOW.
// Trước fix: system.overview chỉ đòi {setting|user} trong khi app visible qua {user|role|setting|audit}
// → persona chỉ-role / chỉ-audit landing SHOW_403. Test này khoá parity route↔app.
// ---------------------------------------------------------------------------

describe("S2-FE-FND-7 — system app landing không 403", () => {
  const systemApp = APP_REGISTRY.find((a) => a.appKey === "system")!;
  const overviewMeta = getRouteMeta("system.overview")!;
  const foundationActive = makeSession({
    modules: [{ moduleCode: "FOUNDATION", status: "active" }],
  });

  // Cặp engine THẬT mỗi mã app-visibility ánh xạ tới (qua PERMISSION_CODE_TO_PAIR).
  const APP_VISIBILITY_ENGINE_PAIRS: Record<string, string> = {
    "AUTH.USER.VIEW": "view:user",
    "AUTH.ROLE.VIEW": "view:role",
    "FOUNDATION.SETTING.VIEW": "view:foundation-setting",
    "FOUNDATION.AUDIT_LOG.VIEW": "view:audit-log",
  };

  it("defaultRoute = /system = path của system.overview", () => {
    expect(systemApp.defaultRoute).toBe("/system");
    expect(systemApp.defaultRoute).toBe(overviewMeta.path);
  });

  it("route system.overview requiredAny === app-visibility (parity, chống landing-403)", () => {
    expect(overviewMeta.requiredAnyPermissions).toEqual(systemApp.requiredAnyPermissions);
  });

  for (const [code, pair] of Object.entries(APP_VISIBILITY_ENGINE_PAIRS)) {
    it(`persona chỉ có ${pair} (${code}) → app System hiện + landing /system ALLOW (không 403)`, () => {
      const c = createPermissionChecker(makePerms([pair]));
      const visible = getVisibleApps(APP_REGISTRY, foundationActive, c);
      expect(visible.find((a) => a.appKey === "system")).toBeDefined();

      const guard = evaluateRouteAccess(foundationActive, overviewMeta, c);
      expect(guard.action).toBe("ALLOW");
    });
  }
});

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
