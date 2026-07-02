import { describe, it, expect } from "vitest";
import { createPermissionChecker, type UserPermission } from "@mediaos/web-core";

/**
 * QA-05 drift-guard — S2-FE-HR-5.
 * Khẳng định FE code (MODULE.RESOURCE.ACTION) ánh xạ ĐÚNG cặp SEED THẬT của controller HR master-data
 * qua createPermissionChecker (tiêu thụ PERMISSION_CODE_TO_PAIR). Chống lặp bug pair-drift (s1-fnd-module).
 *
 * Cặp seed thật (đã đọc controller):
 * - hr-department.controller  → read/create/update/delete:department
 * - positions.controller      → read/create/update/delete:position
 * - hr-master-data.controller → manage:master-data (CẢ đọc lẫn ghi job-levels + contract-types)
 */
function checkerWith(pairs: string[]) {
  const perms: UserPermission[] = pairs.map((permission) => ({ permission, scopes: [] }));
  return createPermissionChecker(perms);
}

describe("HR master-data FE-code → engine-pair drift-guard", () => {
  it("department FE codes resolve to read/create/update/delete:department", () => {
    expect(checkerWith(["read:department"]).can("HR.DEPARTMENT.VIEW")).toBe(true);
    expect(checkerWith(["create:department"]).can("HR.DEPARTMENT.CREATE")).toBe(true);
    expect(checkerWith(["update:department"]).can("HR.DEPARTMENT.UPDATE")).toBe(true);
    expect(checkerWith(["delete:department"]).can("HR.DEPARTMENT.DELETE")).toBe(true);
    // read KHÔNG kế thừa create (mỗi cặp độc lập)
    expect(checkerWith(["read:department"]).can("HR.DEPARTMENT.CREATE")).toBe(false);
  });

  it("position FE codes resolve to read/create/update/delete:position", () => {
    expect(checkerWith(["read:position"]).can("HR.POSITION.VIEW")).toBe(true);
    expect(checkerWith(["create:position"]).can("HR.POSITION.CREATE")).toBe(true);
    expect(checkerWith(["update:position"]).can("HR.POSITION.UPDATE")).toBe(true);
    expect(checkerWith(["delete:position"]).can("HR.POSITION.DELETE")).toBe(true);
  });

  it("master-data gates on the SINGLE manage:master-data pair (no view-ma pair)", () => {
    expect(checkerWith(["manage:master-data"]).can("HR.MASTER_DATA.MANAGE")).toBe(true);
    // Cặp "view/read:master-data" KHÔNG tồn tại → KHÔNG mở được màn (SPEC-03 §13.12b/c: 1 cặp DUY NHẤT).
    expect(checkerWith(["view:master-data"]).can("HR.MASTER_DATA.MANAGE")).toBe(false);
    expect(checkerWith(["read:master-data"]).can("HR.MASTER_DATA.MANAGE")).toBe(false);
    // Có cặp department KHÔNG mở được master-data (không nhầm cặp).
    expect(checkerWith(["read:department"]).can("HR.MASTER_DATA.MANAGE")).toBe(false);
  });
});
