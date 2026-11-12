import { describe, it, expect } from "vitest";
import type { GoalCoreResponseDto } from "@mediaos/contracts";
import {
  GOAL_SUGGEST_SUBTASK_PRESELECT,
  goalQueryParams,
  hasWriteAnchor,
  isLinkableGoal,
  isOwnPersonalGoal,
  rankCandidates,
  subtaskGoalLock,
  suggestionDate,
  suggestionMode,
  type GoalSuggestContext,
} from "./goal-suggest";

const DATE = "2026-11-15";

function goal(over: Partial<GoalCoreResponseDto>): GoalCoreResponseDto {
  return {
    id: "g-1",
    companyId: "co-1",
    goalCode: "G-1",
    name: "Mục tiêu",
    description: null,
    level: "employee",
    departmentId: null,
    projectId: null,
    employeeId: "emp-me",
    parentGoalId: null,
    ownerEmployeeId: "emp-me",
    periodType: "quarter",
    periodStart: "2026-10-01",
    periodEnd: "2026-12-31",
    measureType: "percent",
    targetValue: null,
    currentValue: null,
    unit: null,
    progressMode: "tasks",
    progressPercent: null,
    weight: 1,
    status: "Active",
    finalizedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

const CTX: GoalSuggestContext = {
  projectId: "p-1",
  assigneeEmployeeId: "emp-me",
  departmentId: "d-1",
  dueAt: "2026-11-15T03:00:00.000Z",
};

describe("goal-suggest — hằng số Q28", () => {
  it("mặc định khuyến nghị A: ô «Tính vào mục tiêu của việc cha» KHÔNG chọn sẵn", () => {
    expect(GOAL_SUGGEST_SUBTASK_PRESELECT).toBe(false);
  });
});

describe("isLinkableGoal", () => {
  it("nhận mục tiêu Active, chưa chốt, đo theo việc gắn, kỳ chứa ngày", () => {
    expect(isLinkableGoal(goal({}), DATE)).toBe(true);
  });
  it.each([
    ["mode manual", { progressMode: "manual" as const }],
    ["mode children", { progressMode: "children" as const }],
    ["mode project", { progressMode: "project" as const }],
    ["Draft", { status: "Draft" as const }],
    ["Completed", { status: "Completed" as const }],
    ["đã chốt kỳ", { finalizedAt: "2026-11-01T00:00:00.000Z" }],
    ["kỳ đã qua", { periodEnd: "2026-09-30" }],
    ["kỳ chưa tới", { periodStart: "2026-12-01" }],
  ])("loại %s", (_label, over) => {
    expect(isLinkableGoal(goal(over), DATE)).toBe(false);
  });
});

describe("rankCandidates", () => {
  const personal = goal({ id: "g-emp" });
  const project = goal({ id: "g-prj", level: "project", projectId: "p-1", employeeId: null });
  const dept = goal({ id: "g-dep", level: "department", departmentId: "d-1", employeeId: null });

  it("xếp cá nhân > dự án > phòng, bỏ trùng id", () => {
    const out = rankCandidates([dept, project, personal, personal], CTX, DATE);
    expect(out.map((g) => g.id)).toEqual(["g-emp", "g-prj", "g-dep"]);
  });
  it("mục tiêu cá nhân của người KHÁC không là ứng viên (server chặn GOAL-ERR-008)", () => {
    expect(rankCandidates([goal({ id: "x", employeeId: "emp-other" })], CTX, DATE)).toEqual([]);
  });
  it("mục tiêu dự án khác không là ứng viên", () => {
    expect(rankCandidates([goal({ id: "x", level: "project", projectId: "p-2" })], CTX, DATE)).toEqual([]);
  });
  it("việc chưa có phòng ban ⇒ không gợi ý mục tiêu phòng", () => {
    const out = rankCandidates([dept], { ...CTX, departmentId: null }, DATE);
    expect(out).toEqual([]);
  });
  it("không ứng viên khi việc không người phụ trách VÀ không dự án (ngoài phạm vi ghi)", () => {
    const ctx = { ...CTX, assigneeEmployeeId: null, projectId: null };
    expect(rankCandidates([personal, project, dept], ctx, DATE)).toEqual([]);
  });
  it("mục tiêu mode manual không bao giờ lọt vào", () => {
    expect(rankCandidates([goal({ progressMode: "manual" })], CTX, DATE)).toEqual([]);
  });
});

describe("suggestionMode", () => {
  const mine = goal({ id: "mine" });
  const managerMade = goal({ id: "mgr", ownerEmployeeId: "emp-mgr" });
  const project = goal({ id: "prj", level: "project", projectId: "p-1", employeeId: null });

  it("0 ứng viên ⇒ none", () => {
    expect(suggestionMode([], "emp-me")).toBe("none");
  });
  it("đúng 1 mục tiêu cá nhân của chính tôi (employee = owner = tôi) ⇒ preselect", () => {
    expect(suggestionMode([mine], "emp-me")).toBe("preselect");
  });
  it("cá nhân do quản lý tạo (owner khác tôi) ⇒ chỉ chip, KHÔNG chọn sẵn", () => {
    expect(isOwnPersonalGoal(managerMade, "emp-me")).toBe(false);
    expect(suggestionMode([managerMade], "emp-me")).toBe("chip");
  });
  it("chưa biết tôi là ai ⇒ không chọn sẵn", () => {
    expect(suggestionMode([mine], null)).toBe("chip");
  });
  it("1 ứng viên cấp dự án ⇒ chip", () => {
    expect(suggestionMode([project], "emp-me")).toBe("chip");
  });
  it("nhiều ứng viên ⇒ dropdown, không chọn sẵn", () => {
    expect(suggestionMode([mine, project], "emp-me")).toBe("dropdown");
  });
});

describe("goalQueryParams / hasWriteAnchor / suggestionDate", () => {
  it("không neo ghi ⇒ không truy vấn nào", () => {
    const ctx = { ...CTX, assigneeEmployeeId: null, projectId: null };
    expect(hasWriteAnchor(ctx)).toBe(false);
    expect(goalQueryParams(ctx, DATE)).toEqual([]);
  });
  it("tối đa 3 truy vấn hẹp, lọc ở SERVER theo neo + Active + kỳ + limit 50", () => {
    const params = goalQueryParams(CTX, DATE);
    expect(params).toHaveLength(3);
    for (const p of params) {
      expect(p).toMatchObject({ status: "Active", periodFrom: DATE, periodTo: DATE, limit: 50 });
    }
    expect(params.map((p) => p.employeeId ?? p.projectId ?? p.departmentId)).toEqual([
      "emp-me",
      "p-1",
      "d-1",
    ]);
  });
  it("chỉ có dự án ⇒ 1 truy vấn", () => {
    expect(goalQueryParams({ ...CTX, assigneeEmployeeId: null, departmentId: null }, DATE)).toHaveLength(1);
  });
  it("ngày gợi ý = ngày công ty của hạn việc (hạn 18:00 UTC = sáng hôm sau giờ VN)", () => {
    expect(suggestionDate({ ...CTX, dueAt: "2026-12-31T18:00:00.000Z" })).toBe("2027-01-01");
  });
  it("không có hạn ⇒ hôm nay theo giờ công ty", () => {
    expect(suggestionDate({ ...CTX, dueAt: null }, new Date("2026-11-15T20:00:00.000Z"))).toBe("2026-11-16");
  });
});

describe("subtaskGoalLock", () => {
  const parentGoal = goal({ level: "project", projectId: "p-1", employeeId: null });
  it("mục tiêu dự án + cha thuộc dự án ⇒ mở", () => {
    expect(subtaskGoalLock(parentGoal, { parentHasProject: true, subtaskAssigneeEmployeeId: null })).toBeNull();
  });
  it("mục tiêu cá nhân mà việc con chưa có người phụ trách ⇒ khoá (GOAL-ERR-008)", () => {
    const personal = goal({});
    expect(subtaskGoalLock(personal, { parentHasProject: true, subtaskAssigneeEmployeeId: null })).toBe("personalOwner");
  });
  it("mục tiêu cá nhân + người phụ trách khác chủ ⇒ khoá; đúng chủ ⇒ mở", () => {
    const personal = goal({});
    expect(subtaskGoalLock(personal, { parentHasProject: true, subtaskAssigneeEmployeeId: "emp-b" })).toBe("personalOwner");
    expect(subtaskGoalLock(personal, { parentHasProject: true, subtaskAssigneeEmployeeId: "emp-me" })).toBeNull();
  });
  it("không người phụ trách và cha không thuộc dự án ⇒ khoá (ngoài phạm vi ghi)", () => {
    const dept = goal({ level: "department", departmentId: "d-1", employeeId: null });
    expect(subtaskGoalLock(dept, { parentHasProject: false, subtaskAssigneeEmployeeId: null })).toBe("noWriteScope");
  });
});
