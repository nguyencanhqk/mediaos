import { describe, expect, it } from "vitest";
import type { OrgChartEmployeeNode } from "@mediaos/contracts";
import { buildOrgChartTree, type OrgChartRow } from "./hr-org-chart.service";

/**
 * S5-HR-ORGCHART-BE-1 — unit test cho hàm dựng cây THUẦN (no DB). Chứng minh: orphan → root, nesting,
 * chống cycle (không treo, mỗi node đúng 1 lần, cờ cảnh báo), self-manage → root + cờ, và projection
 * CHỈ field allowlist directory-class (BẤT BIẾN #3). Ranh giới data-scope được kiểm ở int-spec (predicate thật).
 */

function row(over: Partial<OrgChartRow> & { employeeId: string }): OrgChartRow {
  return {
    userId: over.employeeId, // mặc định user_id = employee_id (thuận tiện nối cây trong test)
    directManagerId: null,
    displayName: over.employeeId,
    positionName: null,
    orgUnitName: null,
    jobLevelName: null,
    avatarUrl: null,
    employeeCode: null,
    ...over,
  };
}

/** Làm phẳng cây (mọi node) — dùng để assert không trùng + không rò field. */
function flatten(nodes: OrgChartEmployeeNode[]): OrgChartEmployeeNode[] {
  const out: OrgChartEmployeeNode[] = [];
  const walk = (n: OrgChartEmployeeNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

const ALLOWED_KEYS = new Set([
  "employeeId",
  "userId",
  "displayName",
  "positionName",
  "orgUnitName",
  "jobLevelName",
  "avatarUrl",
  "employeeCode",
  "children",
]);

describe("buildOrgChartTree", () => {
  it("orphan: manager null / ngoài tập / chưa-link → node gốc", () => {
    const rows: OrgChartRow[] = [
      row({ employeeId: "a", directManagerId: null }), // không có quản lý
      row({ employeeId: "b", directManagerId: "ghost" }), // quản lý ngoài tập
      row({ employeeId: "c", userId: null, directManagerId: "a" }), // chưa-link user (vẫn là con của a)
    ];
    const { roots, warnings } = buildOrgChartTree(rows);
    const rootIds = roots.map((r) => r.employeeId).sort();
    expect(rootIds).toEqual(["a", "b"]);
    expect(warnings.cyclesDetected).toBe(false);
    // c là con của a (a.userId === c.directManagerId)
    const a = roots.find((r) => r.employeeId === "a")!;
    expect(a.children.map((n) => n.employeeId)).toEqual(["c"]);
  });

  it("nesting 2 cấp: report gắn dưới đúng quản lý", () => {
    const rows: OrgChartRow[] = [
      row({ employeeId: "boss", directManagerId: null }),
      row({ employeeId: "r1", directManagerId: "boss" }),
      row({ employeeId: "r2", directManagerId: "boss" }),
      row({ employeeId: "sub", directManagerId: "r1" }),
    ];
    const { roots } = buildOrgChartTree(rows);
    expect(roots.map((r) => r.employeeId)).toEqual(["boss"]);
    const boss = roots[0];
    expect(boss.children.map((n) => n.employeeId).sort()).toEqual(["r1", "r2"]);
    const r1 = boss.children.find((n) => n.employeeId === "r1")!;
    expect(r1.children.map((n) => n.employeeId)).toEqual(["sub"]);
    // mỗi node đúng 1 lần
    expect(flatten(roots)).toHaveLength(4);
  });

  it("cycle A↔B → cắt vòng, cờ cảnh báo, không treo, mỗi node đúng 1 lần", () => {
    const rows: OrgChartRow[] = [
      row({ employeeId: "A", directManagerId: "B" }),
      row({ employeeId: "B", directManagerId: "A" }),
    ];
    const { roots, warnings } = buildOrgChartTree(rows);
    expect(warnings.cyclesDetected).toBe(true);
    const all = flatten(roots);
    expect(all.map((n) => n.employeeId).sort()).toEqual(["A", "B"]);
    expect(all).toHaveLength(2); // không nhân đôi, không vòng vô hạn
    // Object graph phải acyclic (JSON.stringify không ném circular).
    expect(() => JSON.stringify(roots)).not.toThrow();
  });

  it("cycle 3-bậc A→B→C→A → cắt vòng, cờ, mỗi node đúng 1 lần, JSON serialize được", () => {
    const rows: OrgChartRow[] = [
      row({ employeeId: "A", directManagerId: "B" }),
      row({ employeeId: "B", directManagerId: "C" }),
      row({ employeeId: "C", directManagerId: "A" }),
    ];
    const { roots, warnings } = buildOrgChartTree(rows);
    expect(warnings.cyclesDetected).toBe(true);
    expect(
      flatten(roots)
        .map((n) => n.employeeId)
        .sort(),
    ).toEqual(["A", "B", "C"]);
    expect(() => JSON.stringify(roots)).not.toThrow();
  });

  it("self-manager (directManagerId === userId) → root + cờ cảnh báo", () => {
    const rows: OrgChartRow[] = [row({ employeeId: "x", userId: "x", directManagerId: "x" })];
    const { roots, warnings } = buildOrgChartTree(rows);
    expect(roots.map((r) => r.employeeId)).toEqual(["x"]);
    expect(warnings.cyclesDetected).toBe(true);
    expect(roots[0].children).toEqual([]);
  });

  it("projection: node CHỈ chứa field allowlist directory-class (không rò PII/salary)", () => {
    const rows: OrgChartRow[] = [
      row({
        employeeId: "a",
        userId: "ua",
        displayName: "Nguyễn A",
        positionName: "Trưởng nhóm",
        orgUnitName: "Kỹ thuật",
        jobLevelName: "L3",
        avatarUrl: "https://x/a.png",
        employeeCode: "E001",
      }),
    ];
    const { roots } = buildOrgChartTree(rows);
    for (const node of flatten(roots)) {
      for (const key of Object.keys(node)) {
        expect(ALLOWED_KEYS.has(key), `unexpected field leaked in node: ${key}`).toBe(true);
      }
    }
    // đúng giá trị map 1-1
    expect(roots[0]).toMatchObject({
      employeeId: "a",
      userId: "ua",
      displayName: "Nguyễn A",
      positionName: "Trưởng nhóm",
      orgUnitName: "Kỹ thuật",
      jobLevelName: "L3",
      avatarUrl: "https://x/a.png",
      employeeCode: "E001",
    });
  });

  it("empty input → rừng rỗng, không cờ", () => {
    const { roots, warnings } = buildOrgChartTree([]);
    expect(roots).toEqual([]);
    expect(warnings.cyclesDetected).toBe(false);
  });

  it("thứ tự ổn định: sắp theo displayName, nulls last", () => {
    const rows: OrgChartRow[] = [
      row({ employeeId: "z", displayName: "Zoe", directManagerId: null }),
      row({ employeeId: "n", displayName: null, directManagerId: null }),
      row({ employeeId: "a", displayName: "An", directManagerId: null }),
    ];
    const { roots } = buildOrgChartTree(rows);
    expect(roots.map((r) => r.employeeId)).toEqual(["a", "z", "n"]);
  });
});
