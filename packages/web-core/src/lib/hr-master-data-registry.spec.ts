/**
 * HR master-data registry drift-guard (S2-FE-HR-5, lane HR5-WC / QA-05).
 *
 * PIN chống pair-drift (bug s1-fnd-module): PERMISSION_CODE_TO_PAIR phải ánh xạ ĐÚNG cặp SEED THẬT trong
 * controller — hr-department.controller (read/create/update/delete:department) · positions.controller
 * (read/create/update/delete:position) · hr-master-data.controller (manage:master-data cho CẢ đọc lẫn ghi
 * job-levels + contract-types — SPEC-03 §13.12b/c: 1 cặp DUY NHẤT, KHÔNG có cặp "view" master-data riêng).
 *
 * + deny-path: user thiếu cặp đọc → route SHOW_403; user có read nhưng thiếu create/update/delete →
 *   nút mutation phải ẩn (checker.can(mutation) === false).
 */
import { describe, expect, it } from "vitest";
import {
  PERMISSION_CODE_TO_PAIR,
  createPermissionChecker,
  evaluateRouteAccess,
  getRouteMeta,
  type SessionContext,
  type UserPermission,
} from "./registry";

// Cặp engine THẬT từ controller (nguồn: hr-department / positions / hr-master-data controller decorators).
const REAL_PAIRS = {
  "HR.DEPARTMENT.VIEW": "read:department",
  "HR.DEPARTMENT.CREATE": "create:department",
  "HR.DEPARTMENT.UPDATE": "update:department",
  "HR.DEPARTMENT.DELETE": "delete:department",
  "HR.POSITION.VIEW": "read:position",
  "HR.POSITION.CREATE": "create:position",
  "HR.POSITION.UPDATE": "update:position",
  "HR.POSITION.DELETE": "delete:position",
  "HR.MASTER_DATA.MANAGE": "manage:master-data",
} as const;

function makeSession(): SessionContext {
  return {
    status: "authenticated",
    user: { id: "u1", email: "a@b.com", status: "Active", companyId: "c1" },
    company: { id: "c1", name: "Acme", status: "Active" },
    modules: [{ moduleCode: "HR", status: "active" }],
  };
}
function perms(pairs: string[]): UserPermission[] {
  return pairs.map((p) => ({ permission: p, scopes: [] }));
}

describe("PERMISSION_CODE_TO_PAIR — HR master-data cặp seed thật (drift-guard)", () => {
  it("ánh xạ ĐÚNG cặp cho 4 nhóm (department/position + master-data)", () => {
    for (const [code, pair] of Object.entries(REAL_PAIRS)) {
      expect(PERMISSION_CODE_TO_PAIR[code], `map cho ${code}`).toBe(pair);
    }
  });

  it("master-data reads gate manage:master-data (KHÔNG có cặp view-ma riêng)", () => {
    // 1 cặp DUY NHẤT cho cả đọc lẫn ghi job-levels + contract-types.
    const withManage = createPermissionChecker(perms(["manage:master-data"]));
    expect(withManage.can("HR.MASTER_DATA.MANAGE")).toBe(true);
    // Không tồn tại nhãn "view master-data" nào ánh xạ sang cặp khác manage:master-data.
    const maCodes = Object.keys(PERMISSION_CODE_TO_PAIR).filter((c) =>
      c.startsWith("HR.MASTER_DATA"),
    );
    expect(maCodes).toEqual(["HR.MASTER_DATA.MANAGE"]);
    // Cặp giả "view:master-data" KHÔNG khớp code nào.
    const stale = createPermissionChecker(perms(["view:master-data", "read:master-data"]));
    expect(stale.can("HR.MASTER_DATA.MANAGE")).toBe(false);
  });

  it("department: read KHÔNG kế thừa create/update/delete (pair-as-gate)", () => {
    const readOnly = createPermissionChecker(perms(["read:department"]));
    expect(readOnly.can("HR.DEPARTMENT.VIEW")).toBe(true);
    expect(readOnly.can("HR.DEPARTMENT.CREATE")).toBe(false);
    expect(readOnly.can("HR.DEPARTMENT.UPDATE")).toBe(false);
    expect(readOnly.can("HR.DEPARTMENT.DELETE")).toBe(false);
  });

  it("position: read KHÔNG kế thừa create/update/delete (pair-as-gate)", () => {
    const readOnly = createPermissionChecker(perms(["read:position"]));
    expect(readOnly.can("HR.POSITION.VIEW")).toBe(true);
    expect(readOnly.can("HR.POSITION.CREATE")).toBe(false);
    expect(readOnly.can("HR.POSITION.UPDATE")).toBe(false);
    expect(readOnly.can("HR.POSITION.DELETE")).toBe(false);
  });

  it("cặp giả department:view / position:read KHÔNG khớp FE code nào", () => {
    const stale = createPermissionChecker(perms(["department:view", "position:read"]));
    expect(stale.can("HR.DEPARTMENT.VIEW")).toBe(false);
    expect(stale.can("HR.POSITION.VIEW")).toBe(false);
  });
});

describe("ROUTE_REGISTRY — HR master-data screens gate đúng cặp", () => {
  const cases = [
    { key: "hr.departments", path: "/hr/departments", perm: "HR.DEPARTMENT.VIEW" },
    { key: "hr.positions", path: "/hr/positions", perm: "HR.POSITION.VIEW" },
    { key: "hr.job-levels", path: "/hr/job-levels", perm: "HR.MASTER_DATA.MANAGE" },
    { key: "hr.contract-types", path: "/hr/contract-types", perm: "HR.MASTER_DATA.MANAGE" },
  ] as const;

  it.each(cases)("$key gate $perm (module HR)", ({ key, path, perm }) => {
    const meta = getRouteMeta(key);
    expect(meta?.path).toBe(path);
    expect(meta?.moduleCode).toBe("HR");
    expect(meta?.requiredAnyPermissions).toEqual([perm]);
    expect(meta?.requiredScopes).toBeUndefined();
  });
});

describe("evaluateRouteAccess — HR master-data deny-path (QA-05)", () => {
  it("thiếu cặp read:department → /hr/departments SHOW_403", () => {
    const meta = getRouteMeta("hr.departments")!;
    const noPerm = createPermissionChecker(perms([]));
    expect(evaluateRouteAccess(makeSession(), meta, noPerm).action).toBe("SHOW_403");
  });

  it("có read:department → /hr/departments ALLOW", () => {
    const meta = getRouteMeta("hr.departments")!;
    const c = createPermissionChecker(perms(["read:department"]));
    expect(evaluateRouteAccess(makeSession(), meta, c).action).toBe("ALLOW");
  });

  it("thiếu manage:master-data → job-levels + contract-types SHOW_403 (KHÔNG cặp view-ma bypass)", () => {
    const s = makeSession();
    // user có read:department nhưng KHÔNG có manage:master-data → master-data routes vẫn 403.
    const c = createPermissionChecker(perms(["read:department"]));
    expect(evaluateRouteAccess(s, getRouteMeta("hr.job-levels")!, c).action).toBe("SHOW_403");
    expect(evaluateRouteAccess(s, getRouteMeta("hr.contract-types")!, c).action).toBe("SHOW_403");
  });

  it("có manage:master-data → cả job-levels + contract-types ALLOW", () => {
    const s = makeSession();
    const c = createPermissionChecker(perms(["manage:master-data"]));
    expect(evaluateRouteAccess(s, getRouteMeta("hr.job-levels")!, c).action).toBe("ALLOW");
    expect(evaluateRouteAccess(s, getRouteMeta("hr.contract-types")!, c).action).toBe("ALLOW");
  });

  it("read-only user: nút mutation ẩn (checker.can(create/update/delete) === false)", () => {
    const c = createPermissionChecker(perms(["read:department", "read:position"]));
    // Route (đọc) ALLOW nhưng nút thao tác gate riêng → ẩn.
    expect(evaluateRouteAccess(makeSession(), getRouteMeta("hr.departments")!, c).action).toBe(
      "ALLOW",
    );
    for (const action of ["CREATE", "UPDATE", "DELETE"] as const) {
      expect(c.can(`HR.DEPARTMENT.${action}`)).toBe(false);
      expect(c.can(`HR.POSITION.${action}`)).toBe(false);
    }
  });
});
