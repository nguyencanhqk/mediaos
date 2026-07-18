import { describe, it, expect } from "vitest";
import type { OrgChartEmployeeNode } from "./employee-chart-api";
import { buildMembersByUnit, flattenEmployeeChart } from "./members-by-unit";

function node(
  partial: Partial<OrgChartEmployeeNode> & { employeeId: string },
): OrgChartEmployeeNode {
  return {
    userId: null,
    displayName: null,
    positionName: null,
    orgUnitName: null,
    jobLevelName: null,
    avatarUrl: null,
    employeeCode: null,
    children: [],
    ...partial,
  };
}

describe("buildMembersByUnit", () => {
  it("gom nhân viên theo orgUnitName qua cả cây (đệ quy)", () => {
    const roots = [
      node({
        employeeId: "head-nd",
        displayName: "An",
        orgUnitName: "Phòng Nội Dung",
        children: [
          node({ employeeId: "m1", displayName: "Bình", orgUnitName: "Phòng Nội Dung" }),
          node({ employeeId: "m2", displayName: "Phúc", orgUnitName: "Phòng Nội Dung" }),
        ],
      }),
      node({ employeeId: "head-hr", displayName: "Minh", orgUnitName: "Phòng Nhân Sự" }),
    ];

    const map = buildMembersByUnit(roots);
    expect(map.get("Phòng Nội Dung")?.map((m) => m.displayName)).toEqual(["An", "Bình", "Phúc"]);
    expect(map.get("Phòng Nhân Sự")?.map((m) => m.displayName)).toEqual(["Minh"]);
  });

  it("bỏ node không có orgUnitName + dedup theo employeeId", () => {
    const shared = node({ employeeId: "dup", displayName: "X", orgUnitName: "Phòng A" });
    const roots = [
      node({ employeeId: "no-unit", displayName: "Y", orgUnitName: null, children: [shared] }),
      shared, // xuất hiện 2 lần → chỉ đếm 1
    ];
    const map = buildMembersByUnit(roots);
    expect(map.has("(no unit)")).toBe(false);
    expect(map.get("Phòng A")).toHaveLength(1);
  });

  it("cây rỗng → map rỗng", () => {
    expect(buildMembersByUnit([]).size).toBe(0);
  });
});

describe("flattenEmployeeChart", () => {
  it("duyệt phẳng toàn cây + dedup theo employeeId + giữ orgUnitName", () => {
    const dup = node({ employeeId: "d", displayName: "Z", orgUnitName: "Phòng X" });
    const roots = [
      node({
        employeeId: "a",
        displayName: "A",
        orgUnitName: "Phòng 1",
        children: [node({ employeeId: "b", displayName: "B", orgUnitName: "Phòng 2" }), dup],
      }),
      dup, // trùng → chỉ 1
    ];
    const flat = flattenEmployeeChart(roots);
    expect(flat.map((m) => m.employeeId).sort()).toEqual(["a", "b", "d"]);
    expect(flat.find((m) => m.employeeId === "b")?.orgUnitName).toBe("Phòng 2");
  });

  it("giữ cả node không có orgUnitName (khác buildMembersByUnit)", () => {
    const flat = flattenEmployeeChart([node({ employeeId: "x", orgUnitName: null })]);
    expect(flat).toHaveLength(1);
    expect(flat[0].orgUnitName).toBeNull();
  });
});
