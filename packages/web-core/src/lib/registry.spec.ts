import { describe, expect, it } from "vitest";
import {
  createPermissionChecker,
  evaluateRouteAccess,
  filterSidebarItems,
  getVisibleApps,
  normalizeUserStatus,
  APP_REGISTRY,
  ROUTE_REGISTRY,
  getRouteMeta,
  type SessionContext,
  type SidebarItemMeta,
  type UserPermission,
} from "./registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    status: "authenticated",
    user: { id: "u1", email: "a@b.com", status: "Active", companyId: "c1" },
    company: { id: "c1", name: "Acme", status: "Active" },
    modules: [],
    ...overrides,
  };
}

function makePerms(permissions: string[], scopes: string[] = []): UserPermission[] {
  return permissions.map((p) => ({ permission: p, scopes: scopes as never }));
}

/** Fixture cặp-engine + scope THẬT (per-permission), mô phỏng /auth/me capabilities+scopes. */
function makeScopedPerms(entries: UserPermission[]): UserPermission[] {
  return entries.map((e) => ({ permission: e.permission, scopes: [...e.scopes] }));
}

// Ma trận persona theo cặp ENGINE THẬT + scope THẬT (KHÔNG [] — pair-as-gate + defense-in-depth).
// employee: chỉ đọc của mình. manager: thêm view-team (Team) + duyệt nghỉ. hr: thêm view-company (Company).
const EMPLOYEE_PERMS = makeScopedPerms([
  { permission: "view-own:attendance", scopes: ["Own"] },
  { permission: "view-own:leave", scopes: ["Own"] },
]);
const MANAGER_PERMS = makeScopedPerms([
  { permission: "view-own:attendance", scopes: ["Own"] },
  { permission: "view-team:attendance", scopes: ["Team"] },
  { permission: "view-own:leave", scopes: ["Own"] },
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

// Session có ATT + LEAVE active (populate THẬT — deny-path phải qua nhánh module-active).
const ATT_LEAVE_SESSION = () => ({
  modules: [
    { moduleCode: "ATT" as const, status: "active" as const },
    { moduleCode: "LEAVE" as const, status: "active" as const },
  ],
});

// ---------------------------------------------------------------------------
// normalizeUserStatus — vá lệch hoa/thường BE('active') vs guard('Active')
// ---------------------------------------------------------------------------

describe("normalizeUserStatus", () => {
  it("'active' (BE chữ thường) → 'Active' — KHÔNG bị guard chặn USER_INACTIVE", () => {
    expect(normalizeUserStatus("active")).toBe("Active");
  });

  it("'suspended' (BE) → 'Locked' (fail-closed, trước đây fallback 'Active' = fail-open)", () => {
    expect(normalizeUserStatus("suspended")).toBe("Locked");
  });

  it("đã canonical Title-case → pass-through", () => {
    expect(normalizeUserStatus("Active")).toBe("Active");
    expect(normalizeUserStatus("Pending Activation")).toBe("Pending Activation");
  });

  it("giá trị lạ / thiếu → 'Inactive' (fail-closed)", () => {
    expect(normalizeUserStatus("wat")).toBe("Inactive");
    expect(normalizeUserStatus("")).toBe("Inactive");
    expect(normalizeUserStatus(undefined)).toBe("Inactive");
    expect(normalizeUserStatus(null)).toBe("Inactive");
  });
});

// ---------------------------------------------------------------------------
// createPermissionChecker
// ---------------------------------------------------------------------------

describe("createPermissionChecker", () => {
  it("can() trả true khi permission tồn tại", () => {
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    expect(c.can("HR.EMPLOYEE.VIEW")).toBe(true);
  });

  it("can() trả false khi permission không tồn tại", () => {
    const c = createPermissionChecker(makePerms([]));
    expect(c.can("HR.EMPLOYEE.VIEW")).toBe(false);
  });

  it("can(FE code) khớp khi user có CẶP engine tương ứng (BE getCapabilities trả action:resourceType)", () => {
    const c = createPermissionChecker(makePerms(["read:employee", "read:dashboard"]));
    expect(c.can("HR.EMPLOYEE.VIEW")).toBe(true); // read:employee → HR.EMPLOYEE.VIEW
    expect(c.can("DASH.DASHBOARD.VIEW")).toBe(true);
    expect(c.can("AUTH.ROLE.VIEW")).toBe(false); // không có read:role
  });

  it("getVisibleApps hiện đủ 7 app cho company-admin (capabilities = cặp engine THẬT)", () => {
    // Cặp company-admin THẬT từ seed (ATT view-own/team/company:attendance đã lộ qua allowlist sensitive;
    // LEAVE view-own/view/approve:leave; AUTH view:user/view:role) — KHÔNG dùng cặp giả read:attendance/read:leave.
    const caps = makePerms([
      "read:dashboard",
      "read:employee",
      "view-own:attendance",
      "view-team:attendance",
      "view-company:attendance",
      "view-own:leave",
      "view:leave",
      "approve:leave",
      "read:task",
      "read:project",
      "read:notification",
      "view:user",
      "view:role",
      "view:foundation-setting",
      "view:foundation-audit-log",
    ]);
    const apps = getVisibleApps(APP_REGISTRY, makeSession(), createPermissionChecker(caps));
    expect(apps.map((a) => a.appKey).sort()).toEqual([
      "attendance",
      "dashboard",
      "hr",
      "leave",
      "notifications",
      "system",
      "tasks",
    ]);
  });

  it("canAll() true khi có đủ mọi permission", () => {
    const c = createPermissionChecker(makePerms(["A.B.C", "D.E.F"]));
    expect(c.canAll(["A.B.C", "D.E.F"])).toBe(true);
  });

  it("canAll() false khi thiếu 1 permission", () => {
    const c = createPermissionChecker(makePerms(["A.B.C"]));
    expect(c.canAll(["A.B.C", "D.E.F"])).toBe(false);
  });

  it("canAny() true khi có ít nhất 1 permission trong danh sách", () => {
    const c = createPermissionChecker(makePerms(["LEAVE.REQUEST.APPROVE"]));
    expect(c.canAny(["LEAVE.REQUEST.VIEW", "LEAVE.REQUEST.APPROVE"])).toBe(true);
  });

  it("canAny() false khi không có permission nào", () => {
    const c = createPermissionChecker(makePerms([]));
    expect(c.canAny(["LEAVE.REQUEST.VIEW", "LEAVE.REQUEST.APPROVE"])).toBe(false);
  });

  it("canAny() với mảng rỗng luôn trả true", () => {
    const c = createPermissionChecker(makePerms([]));
    expect(c.canAny([])).toBe(true);
  });

  it("checkRequirement() ALLOW khi không có requirement nào", () => {
    const c = createPermissionChecker(makePerms([]));
    expect(c.checkRequirement({}).allowed).toBe(true);
  });

  it("checkRequirement() NO_PERMISSION khi thiếu requiredPermissions", () => {
    const c = createPermissionChecker(makePerms([]));
    const r = c.checkRequirement({ requiredPermissions: ["HR.EMPLOYEE.CREATE"] });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("NO_PERMISSION");
    expect(r.missingPermissions).toContain("HR.EMPLOYEE.CREATE");
  });

  it("checkRequirement() NO_PERMISSION khi không khớp requiredAnyPermissions", () => {
    const c = createPermissionChecker(makePerms([]));
    const r = c.checkRequirement({ requiredAnyPermissions: ["A", "B"] });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("NO_PERMISSION");
  });

  it("checkRequirement() ALLOW khi khớp requiredAnyPermissions", () => {
    const c = createPermissionChecker(makePerms(["B"]));
    const r = c.checkRequirement({ requiredAnyPermissions: ["A", "B"] });
    expect(r.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scope hierarchy
// ---------------------------------------------------------------------------

describe("createPermissionChecker — scope hierarchy", () => {
  it("scope Company thỏa yêu cầu Team (rộng hơn)", () => {
    const c = createPermissionChecker([
      { permission: "LEAVE.REQUEST.APPROVE", scopes: ["Company"] },
    ]);
    expect(c.hasScope("LEAVE.REQUEST.APPROVE", "Team")).toBe(true);
  });

  it("scope Team KHÔNG thỏa yêu cầu Company (hẹp hơn)", () => {
    const c = createPermissionChecker([{ permission: "LEAVE.REQUEST.APPROVE", scopes: ["Team"] }]);
    expect(c.hasScope("LEAVE.REQUEST.APPROVE", "Company")).toBe(false);
  });

  it("scope Project chỉ thỏa khi khớp tường minh, không qua hierarchy", () => {
    const c = createPermissionChecker([{ permission: "TASK.TASK.VIEW", scopes: ["Company"] }]);
    // Company rank > Project không có rank → Project phải khớp tường minh
    expect(c.hasScope("TASK.TASK.VIEW", "Project")).toBe(false);
  });

  it("scope Project thỏa khi user có đúng Project scope", () => {
    const c = createPermissionChecker([{ permission: "TASK.TASK.VIEW", scopes: ["Project"] }]);
    expect(c.hasScope("TASK.TASK.VIEW", "Project")).toBe(true);
  });

  it("NO_SCOPE khi user có permission nhưng scope không thỏa", () => {
    const c = createPermissionChecker([{ permission: "LEAVE.REQUEST.APPROVE", scopes: ["Own"] }]);
    const r = c.checkRequirement({
      requiredAnyPermissions: ["LEAVE.REQUEST.APPROVE"],
      requiredScopes: ["Team"],
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("NO_SCOPE");
  });

  it("ALLOW khi scope thỏa requirement qua hierarchy", () => {
    const c = createPermissionChecker([
      { permission: "LEAVE.REQUEST.APPROVE", scopes: ["Department"] },
    ]);
    const r = c.checkRequirement({
      requiredAnyPermissions: ["LEAVE.REQUEST.APPROVE"],
      requiredScopes: ["Team"],
    });
    expect(r.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateRouteAccess
// ---------------------------------------------------------------------------

describe("evaluateRouteAccess", () => {
  const publicRoute = {
    routeKey: "auth.login",
    path: "/login",
    layout: "AUTH" as const,
    titleKey: "routeTitle.login",
    isPublic: true,
  };

  const protectedRoute = {
    routeKey: "hr.employees",
    path: "/hr/employees",
    layout: "MODULE_WORKSPACE" as const,
    moduleCode: "HR" as const,
    titleKey: "routeTitle.hrEmployees",
    requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
  };

  it("public route luôn ALLOW", () => {
    const session = makeSession({ status: "unauthenticated", user: null });
    const c = createPermissionChecker([]);
    const r = evaluateRouteAccess(session, publicRoute, c);
    expect(r.action).toBe("ALLOW");
    expect(r.allowed).toBe(true);
  });

  it("status loading → SHOW_LOADING", () => {
    const session = makeSession({ status: "loading" });
    const c = createPermissionChecker([]);
    const r = evaluateRouteAccess(session, protectedRoute, c);
    expect(r.action).toBe("SHOW_LOADING");
  });

  it("unauthenticated → REDIRECT_LOGIN với returnUrl", () => {
    const session = makeSession({ status: "unauthenticated", user: null });
    const c = createPermissionChecker([]);
    const r = evaluateRouteAccess(session, protectedRoute, c);
    expect(r.action).toBe("REDIRECT_LOGIN");
    expect(r.redirectTo).toContain("returnUrl");
    expect(r.redirectTo).toContain(encodeURIComponent("/hr/employees"));
  });

  it("user inactive → SHOW_403 reason USER_INACTIVE", () => {
    const session = makeSession({
      user: { id: "u1", email: "a@b.com", status: "Inactive", companyId: "c1" },
    });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const r = evaluateRouteAccess(session, protectedRoute, c);
    expect(r.action).toBe("SHOW_403");
    expect(r.reason).toBe("USER_INACTIVE");
  });

  it("company inactive → SHOW_403 reason COMPANY_INACTIVE", () => {
    const session = makeSession({
      company: { id: "c1", name: "Acme", status: "Inactive" },
    });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const r = evaluateRouteAccess(session, protectedRoute, c);
    expect(r.action).toBe("SHOW_403");
    expect(r.reason).toBe("COMPANY_INACTIVE");
  });

  it("module hidden → SHOW_404", () => {
    const session = makeSession({
      modules: [{ moduleCode: "HR", status: "hidden" }],
    });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const r = evaluateRouteAccess(session, protectedRoute, c);
    expect(r.action).toBe("SHOW_404");
  });

  it("module không tìm thấy trong session.modules → SHOW_404 (default hidden)", () => {
    const session = makeSession({ modules: [] }); // HR không có trong modules
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const r = evaluateRouteAccess(session, protectedRoute, c);
    expect(r.action).toBe("SHOW_404");
  });

  it("module locked → SHOW_DISABLED", () => {
    const session = makeSession({
      modules: [{ moduleCode: "HR", status: "locked" }],
    });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const r = evaluateRouteAccess(session, protectedRoute, c);
    expect(r.action).toBe("SHOW_DISABLED");
    expect(r.reason).toBe("MODULE_DISABLED");
  });

  it("thiếu permission → SHOW_403", () => {
    const session = makeSession({
      modules: [{ moduleCode: "HR", status: "active" }],
    });
    const c = createPermissionChecker(makePerms([])); // không có quyền
    const r = evaluateRouteAccess(session, protectedRoute, c);
    expect(r.action).toBe("SHOW_403");
    expect(r.reason).toBe("NO_PERMISSION");
  });

  it("có đủ quyền + module active → ALLOW", () => {
    const session = makeSession({
      modules: [{ moduleCode: "HR", status: "active" }],
    });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const r = evaluateRouteAccess(session, protectedRoute, c);
    expect(r.action).toBe("ALLOW");
    expect(r.allowed).toBe(true);
  });

  it("featureFlag tắt → SHOW_DISABLED", () => {
    const routeWithFlag = {
      ...protectedRoute,
      featureFlag: "advancedHR",
    };
    const session = makeSession({
      modules: [{ moduleCode: "HR", status: "active", featureFlags: { advancedHR: false } }],
    });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const r = evaluateRouteAccess(session, routeWithFlag, c);
    expect(r.action).toBe("SHOW_DISABLED");
    expect(r.reason).toBe("FEATURE_DISABLED");
  });
});

// ---------------------------------------------------------------------------
// CROWN — pair-drift deny-path (ATT scoped + LEAVE approvals)
// Cặp scope-level ATT (view-own/team/company:attendance) = cặp RIÊNG is_sensitive → pair-as-gate.
// employee KHÔNG được vào Team/Company; manager Team-only; hr Company. Route gate = requiredAny cặp ĐÚNG,
// KHÔNG dùng requiredScopes làm cổng-cứng (scope /auth/me lọc sensitive nên có thể rỗng).
// ---------------------------------------------------------------------------

describe("evaluateRouteAccess — ATT scoped pair-as-gate (deny-path matrix)", () => {
  const attTeamRoute = {
    routeKey: "att.team-records",
    path: "/attendance/team-records",
    layout: "MODULE_WORKSPACE" as const,
    moduleCode: "ATT" as const,
    titleKey: "routeTitle.attTeamRecords",
    requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_TEAM"],
  };
  const attCompanyRoute = {
    routeKey: "att.records",
    path: "/attendance/records",
    layout: "MODULE_WORKSPACE" as const,
    moduleCode: "ATT" as const,
    titleKey: "routeTitle.attRecords",
    requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_COMPANY"],
  };
  const leaveApprovalsRoute = {
    routeKey: "leave.approvals",
    path: "/leave/approvals",
    layout: "MODULE_WORKSPACE" as const,
    moduleCode: "LEAVE" as const,
    titleKey: "routeTitle.leaveApprovals",
    requiredAnyPermissions: ["LEAVE.REQUEST.APPROVE", "LEAVE.REQUEST.VIEW"],
  };

  it("employee (view-own only) → KHÔNG ALLOW team-records / records / approvals", () => {
    const session = makeSession(ATT_LEAVE_SESSION());
    const c = createPermissionChecker(EMPLOYEE_PERMS);
    expect(evaluateRouteAccess(session, attTeamRoute, c).action).toBe("SHOW_403");
    expect(evaluateRouteAccess(session, attCompanyRoute, c).action).toBe("SHOW_403");
    expect(evaluateRouteAccess(session, leaveApprovalsRoute, c).action).toBe("SHOW_403");
  });

  it("manager (view-team:attendance) → ALLOW team-records + approvals, KHÔNG company records", () => {
    const session = makeSession(ATT_LEAVE_SESSION());
    const c = createPermissionChecker(MANAGER_PERMS);
    expect(evaluateRouteAccess(session, attTeamRoute, c).action).toBe("ALLOW");
    expect(evaluateRouteAccess(session, leaveApprovalsRoute, c).action).toBe("ALLOW");
    expect(evaluateRouteAccess(session, attCompanyRoute, c).action).toBe("SHOW_403");
  });

  it("hr (view-company:attendance) → ALLOW company records + team-records", () => {
    const session = makeSession(ATT_LEAVE_SESSION());
    const c = createPermissionChecker(HR_PERMS);
    expect(evaluateRouteAccess(session, attCompanyRoute, c).action).toBe("ALLOW");
    expect(evaluateRouteAccess(session, attTeamRoute, c).action).toBe("ALLOW");
  });
});

// ---------------------------------------------------------------------------
// ROUTE_REGISTRY — ATT scoped routes gate theo cặp ĐÚNG (integrity)
// ---------------------------------------------------------------------------

describe("ROUTE_REGISTRY — ATT scoped routes", () => {
  it("att.team-records gate ATT.ATTENDANCE.VIEW_TEAM, KHÔNG requiredScopes cổng-cứng", () => {
    const meta = getRouteMeta("att.team-records");
    expect(meta?.path).toBe("/attendance/team-records");
    expect(meta?.moduleCode).toBe("ATT");
    expect(meta?.requiredAnyPermissions).toEqual(["ATT.ATTENDANCE.VIEW_TEAM"]);
    expect(meta?.requiredScopes).toBeUndefined();
  });

  it("att.records gate ATT.ATTENDANCE.VIEW_COMPANY, KHÔNG requiredScopes cổng-cứng", () => {
    const meta = getRouteMeta("att.records");
    expect(meta?.path).toBe("/attendance/records");
    expect(meta?.moduleCode).toBe("ATT");
    expect(meta?.requiredAnyPermissions).toEqual(["ATT.ATTENDANCE.VIEW_COMPANY"]);
    expect(meta?.requiredScopes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PERMISSION_CODE_TO_PAIR — ATT/LEAVE scope-level = cặp RIÊNG (pin chống drift)
// ---------------------------------------------------------------------------

describe("PERMISSION_CODE_TO_PAIR — ATT/LEAVE scope pairs", () => {
  it("mỗi scope-level ATT = cặp engine RIÊNG (KHÔNG gộp read:attendance)", () => {
    // view-team KHÁC view-own → manager (chỉ view-team) KHÔNG kế thừa view-own gate và ngược lại.
    const own = createPermissionChecker(EMPLOYEE_PERMS);
    expect(own.can("ATT.ATTENDANCE.VIEW_OWN")).toBe(true);
    expect(own.can("ATT.ATTENDANCE.VIEW_TEAM")).toBe(false);
    expect(own.can("ATT.ATTENDANCE.VIEW_COMPANY")).toBe(false);

    const team = createPermissionChecker(MANAGER_PERMS);
    expect(team.can("ATT.ATTENDANCE.VIEW_TEAM")).toBe(true);
    expect(team.can("ATT.ATTENDANCE.VIEW_COMPANY")).toBe(false);

    const company = createPermissionChecker(HR_PERMS);
    expect(company.can("ATT.ATTENDANCE.VIEW_COMPANY")).toBe(true);
  });

  it("LEAVE view-own / view / approve = 3 cặp engine RIÊNG", () => {
    const employee = createPermissionChecker(EMPLOYEE_PERMS);
    expect(employee.can("LEAVE.REQUEST.VIEW_OWN")).toBe(true);
    expect(employee.can("LEAVE.REQUEST.VIEW")).toBe(false);
    expect(employee.can("LEAVE.REQUEST.APPROVE")).toBe(false);

    const hr = createPermissionChecker(HR_PERMS);
    expect(hr.can("LEAVE.REQUEST.VIEW")).toBe(true); // view:leave
    expect(hr.can("LEAVE.REQUEST.APPROVE")).toBe(true); // approve:leave
  });

  it("cặp giả read:attendance / read:leave KHÔNG còn khớp bất kỳ FE code nào", () => {
    const stale = createPermissionChecker(makePerms(["read:attendance", "read:leave"]));
    expect(stale.can("ATT.ATTENDANCE.VIEW_OWN")).toBe(false);
    expect(stale.can("ATT.ATTENDANCE.VIEW_TEAM")).toBe(false);
    expect(stale.can("ATT.ATTENDANCE.VIEW_COMPANY")).toBe(false);
    expect(stale.can("LEAVE.REQUEST.VIEW_OWN")).toBe(false);
    expect(stale.can("LEAVE.REQUEST.VIEW")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getVisibleApps
// ---------------------------------------------------------------------------

describe("getVisibleApps", () => {
  it("ẩn app có status hidden dù user có quyền", () => {
    const apps = APP_REGISTRY.map((a) =>
      a.appKey === "hr" ? { ...a, status: "hidden" as const } : a,
    );
    const session = makeSession({
      modules: [{ moduleCode: "HR", status: "active" }],
    });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const visible = getVisibleApps(apps, session, c);
    expect(visible.find((a) => a.appKey === "hr")).toBeUndefined();
  });

  it("ẩn app active khi user không có quyền yêu cầu", () => {
    const session = makeSession({
      modules: [{ moduleCode: "HR", status: "active" }],
    });
    const c = createPermissionChecker(makePerms([])); // không có HR.EMPLOYEE.VIEW
    const visible = getVisibleApps(APP_REGISTRY, session, c);
    expect(visible.find((a) => a.appKey === "hr")).toBeUndefined();
  });

  it("hiện app active khi user có quyền yêu cầu và module active", () => {
    const session = makeSession({
      modules: [{ moduleCode: "HR", status: "active" }],
    });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const visible = getVisibleApps(APP_REGISTRY, session, c);
    expect(visible.find((a) => a.appKey === "hr")).toBeDefined();
  });

  it("hiện app coming_soon dù user không có quyền (để showcase)", () => {
    const apps = APP_REGISTRY.map((a) =>
      a.appKey === "hr" ? { ...a, status: "coming_soon" as const } : a,
    );
    const session = makeSession({ modules: [] });
    const c = createPermissionChecker(makePerms([]));
    const visible = getVisibleApps(apps, session, c);
    expect(visible.find((a) => a.appKey === "hr")).toBeDefined();
  });

  it("module status từ session ghi đè app.status — hidden module ẩn app active", () => {
    const session = makeSession({
      modules: [{ moduleCode: "HR", status: "hidden" }],
    });
    const c = createPermissionChecker(makePerms(["HR.EMPLOYEE.VIEW"]));
    const visible = getVisibleApps(APP_REGISTRY, session, c);
    expect(visible.find((a) => a.appKey === "hr")).toBeUndefined();
  });

  it("kết quả sắp xếp theo order tăng dần", () => {
    const session = makeSession({
      modules: [
        { moduleCode: "DASH", status: "active" },
        { moduleCode: "HR", status: "active" },
        { moduleCode: "ATT", status: "active" },
      ],
    });
    const c = createPermissionChecker(
      makePerms(["DASH.DASHBOARD.VIEW", "HR.EMPLOYEE.VIEW", "ATT.ATTENDANCE.VIEW_OWN"]),
    );
    const visible = getVisibleApps(APP_REGISTRY, session, c);
    const orders = visible.map((a) => a.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// filterSidebarItems
// ---------------------------------------------------------------------------

describe("filterSidebarItems", () => {
  const session = makeSession({
    modules: [{ moduleCode: "LEAVE", status: "active" }],
  });

  const items: SidebarItemMeta[] = [
    {
      sidebarKey: "leave.overview",
      moduleCode: "LEAVE",
      label: "Tổng quan",
      path: "/leave",
      order: 10,
      requiredAnyPermissions: ["LEAVE.REQUEST.VIEW_OWN", "LEAVE.REQUEST.VIEW"],
    },
    {
      sidebarKey: "leave.approvals",
      moduleCode: "LEAVE",
      label: "Đơn cần duyệt",
      path: "/leave/approvals",
      order: 30,
      requiredAnyPermissions: ["LEAVE.REQUEST.APPROVE"],
    },
    {
      sidebarKey: "leave.settings",
      moduleCode: "LEAVE",
      label: "Cấu hình",
      order: 90,
      requiredAnyPermissions: ["LEAVE.TYPE.VIEW", "LEAVE.POLICY.VIEW"],
      children: [
        {
          sidebarKey: "leave.types",
          moduleCode: "LEAVE",
          label: "Loại nghỉ",
          path: "/leave/types",
          order: 91,
          requiredAnyPermissions: ["LEAVE.TYPE.VIEW"],
        },
        {
          sidebarKey: "leave.policies",
          moduleCode: "LEAVE",
          label: "Chính sách nghỉ",
          path: "/leave/policies",
          order: 92,
          requiredAnyPermissions: ["LEAVE.POLICY.VIEW"],
        },
      ],
    },
  ];

  it("ẩn item mà user không có quyền", () => {
    const c = createPermissionChecker(makePerms(["LEAVE.REQUEST.VIEW_OWN"]));
    const filtered = filterSidebarItems(items, c, session);
    expect(filtered.find((i) => i.sidebarKey === "leave.approvals")).toBeUndefined();
  });

  it("hiện item mà user có quyền", () => {
    const c = createPermissionChecker(makePerms(["LEAVE.REQUEST.VIEW_OWN"]));
    const filtered = filterSidebarItems(items, c, session);
    expect(filtered.find((i) => i.sidebarKey === "leave.overview")).toBeDefined();
  });

  it("hiện parent khi có ít nhất 1 child được phép", () => {
    // user chỉ có LEAVE.TYPE.VIEW → chỉ leave.types pass
    const c = createPermissionChecker(makePerms(["LEAVE.TYPE.VIEW"]));
    const filtered = filterSidebarItems(items, c, session);
    const settings = filtered.find((i) => i.sidebarKey === "leave.settings");
    expect(settings).toBeDefined();
    expect(settings?.children).toHaveLength(1);
    expect(settings?.children?.[0].sidebarKey).toBe("leave.types");
  });

  it("ẩn parent khi tất cả children đều bị ẩn và parent không tự pass", () => {
    const c = createPermissionChecker(makePerms([]));
    const filtered = filterSidebarItems(items, c, session);
    expect(filtered.find((i) => i.sidebarKey === "leave.settings")).toBeUndefined();
  });

  it("ẩn tất cả item khi user không có quyền gì", () => {
    const c = createPermissionChecker(makePerms([]));
    const filtered = filterSidebarItems(items, c, session);
    expect(filtered).toHaveLength(0);
  });

  it("ẩn item khi module không active", () => {
    const sessionModuleLocked = makeSession({
      modules: [{ moduleCode: "LEAVE", status: "locked" }],
    });
    const c = createPermissionChecker(makePerms(["LEAVE.REQUEST.VIEW_OWN"]));
    const filtered = filterSidebarItems(items, c, sessionModuleLocked);
    expect(filtered).toHaveLength(0);
  });

  it("sắp xếp items theo order tăng dần", () => {
    const c = createPermissionChecker(
      makePerms(["LEAVE.REQUEST.VIEW_OWN", "LEAVE.REQUEST.APPROVE", "LEAVE.TYPE.VIEW"]),
    );
    const filtered = filterSidebarItems(items, c, session);
    const orders = filtered.map((i) => i.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// ROUTE_REGISTRY & getRouteMeta
// ---------------------------------------------------------------------------

describe("ROUTE_REGISTRY", () => {
  it("tất cả routeKey là duy nhất", () => {
    const keys = ROUTE_REGISTRY.map((r) => r.routeKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("tất cả path là duy nhất", () => {
    const paths = ROUTE_REGISTRY.map((r) => r.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  it("getRouteMeta trả đúng meta theo routeKey", () => {
    const meta = getRouteMeta("leave.approvals");
    expect(meta).toBeDefined();
    expect(meta?.path).toBe("/leave/approvals");
    expect(meta?.moduleCode).toBe("LEAVE");
  });

  it("getRouteMeta trả undefined với key không tồn tại", () => {
    expect(getRouteMeta("not.exist")).toBeUndefined();
  });

  it("route public không có requiredPermissions", () => {
    const loginMeta = getRouteMeta("auth.login");
    expect(loginMeta?.isPublic).toBe(true);
    expect(loginMeta?.requiredPermissions).toBeUndefined();
    expect(loginMeta?.requiredAnyPermissions).toBeUndefined();
  });

  it("route nghiệp vụ có moduleCode và requiredAnyPermissions", () => {
    const meta = getRouteMeta("hr.employees");
    expect(meta?.moduleCode).toBe("HR");
    expect(meta?.requiredAnyPermissions?.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// APP_REGISTRY integrity
// ---------------------------------------------------------------------------

describe("APP_REGISTRY", () => {
  it("tất cả appKey là duy nhất", () => {
    const keys = APP_REGISTRY.map((a) => a.appKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("mỗi app có requiredAnyPermissions hoặc requiredPermissions", () => {
    for (const app of APP_REGISTRY) {
      const hasPerms =
        (app.requiredAnyPermissions?.length ?? 0) > 0 || (app.requiredPermissions?.length ?? 0) > 0;
      expect(hasPerms, `app ${app.appKey} thiếu permission requirement`).toBe(true);
    }
  });

  it("thứ tự order tăng dần trong registry", () => {
    const orders = APP_REGISTRY.map((a) => a.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});
