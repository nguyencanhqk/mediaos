/**
 * S20-GOAL-LISTURL-1 (US-GOAL-QL-03) — hàm thuần của bộ lọc `/goals` + tab `/goals/$goalId`.
 * Bất biến: validateSearch KHÔNG BAO GIỜ ném; tham số rác ⇒ bỏ khoá; kỳ theo giờ công ty.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  GOAL_LIST_REMEMBER_KEY,
  goalListBackSearch,
  goalPeriodChips,
  goalViewScopeBeyondOwn,
  parseGoalPeriod,
  patchGoalListSearch,
  replaceGoalListFilters,
  resolveGoalListDefaults,
  validateGoalDetailSearch,
  validateGoalListSearch,
  withDetailTab,
} from "./goal-list-search";

const TZ = "Asia/Ho_Chi_Minh";
const DEPT = "11111111-1111-4111-8111-111111111111";
const Q4 = "2026-10-01..2026-12-31";

afterEach(() => window.localStorage.clear());

describe("validateGoalListSearch — không ném, rác ⇒ bỏ", () => {
  it("giữ đủ khoá hợp lệ (mine/risk nhận cả số do router JSON.parse)", () => {
    expect(
      validateGoalListSearch({
        period: Q4,
        departmentId: DEPT,
        status: "Active",
        level: "employee",
        view: "list",
        mine: 1,
        risk: "1",
        task: "x",
      }),
    ).toEqual({
      period: Q4,
      departmentId: DEPT,
      status: "Active",
      level: "employee",
      view: "list",
      mine: 1,
      risk: 1,
    });
  });

  it.each([
    [{ period: "abc" }],
    [{ period: "2026-02-30..2026-03-31" }],
    [{ period: "2026-12-31..2026-10-01" }],
    [{ period: ".." }],
    [{ period: 2026 }],
    [{ departmentId: "xyz" }],
    [{ status: "xyz" }],
    [{ level: "company" }],
    [{ view: "kanban" }],
    [{ mine: 0 }],
    [{ risk: "yes" }],
    [{ period: { from: "2026-10-01" } }],
  ])("rác %j ⇒ {}", (raw) => {
    expect(validateGoalListSearch(raw as Record<string, unknown>)).toEqual({});
  });

  it("kỳ một vế và «all» hợp lệ", () => {
    expect(parseGoalPeriod("2026-10-01..")).toEqual({ from: "2026-10-01" });
    expect(parseGoalPeriod("..2026-12-31")).toEqual({ to: "2026-12-31" });
    expect(parseGoalPeriod("all")).toEqual({});
  });
});

describe("goalPeriodChips — theo giờ công ty", () => {
  it("23/10/2026 ⇒ Quý này Q4 · Kỳ trước Q3 · Năm nay 2026", () => {
    expect(goalPeriodChips(new Date("2026-10-23T03:00:00.000Z"), TZ)).toEqual({
      previous: "2026-07-01..2026-09-30",
      quarter: Q4,
      year: "2026-01-01..2026-12-31",
    });
  });

  it("đầu năm: kỳ trước lùi sang Q4 năm trước", () => {
    expect(goalPeriodChips(new Date("2027-02-10T03:00:00.000Z"), TZ).previous).toBe(
      "2026-10-01..2026-12-31",
    );
  });

  it("17:30 UTC ngày 31/12 là 01/01 năm sau theo giờ công ty", () => {
    expect(goalPeriodChips(new Date("2026-12-31T17:30:00.000Z"), TZ).quarter).toBe(
      "2027-01-01..2027-03-31",
    );
  });
});

describe("goalViewScopeBeyondOwn", () => {
  it.each([
    [{ "view:goal": ["Own"] }, false],
    [{ "view:goal": ["Project"] }, false],
    [{}, false],
    [{ "view:goal": ["Team"] }, true],
    [{ "view:goal": ["Department"] }, true],
    [{ "view:goal": ["Own", "Company"] }, true],
    [{ "view:task": ["Company"] }, false],
  ])("%j ⇒ %s", (scopes, expected) => {
    expect(goalViewScopeBeyondOwn(scopes as never)).toBe(expected);
  });
});

describe("resolveGoalListDefaults", () => {
  const base = { currentQuarter: Q4, remembered: null, myDepartmentId: null };

  it("URL trống + phòng của tôi ⇒ kỳ + phòng", () => {
    expect(resolveGoalListDefaults({}, { ...base, myDepartmentId: DEPT })).toEqual({
      departmentId: DEPT,
      period: Q4,
    });
  });

  it("URL trống + đã nhớ ⇒ lựa chọn nhớ (kỳ luôn là quý hiện tại), bỏ qua phòng", () => {
    expect(
      resolveGoalListDefaults(
        {},
        {
          ...base,
          remembered: { view: "list", period: "2026-01-01..2026-03-31" },
          myDepartmentId: DEPT,
        },
      ),
    ).toEqual({ view: "list", period: Q4 });
  });

  it("có lọc nhưng thiếu kỳ ⇒ chỉ bổ sung kỳ; đủ ⇒ null", () => {
    expect(resolveGoalListDefaults({ mine: 1 }, { ...base, myDepartmentId: DEPT })).toEqual({
      mine: 1,
      period: Q4,
    });
    expect(resolveGoalListDefaults({ period: "all" }, base)).toBeNull();
  });
});

describe("ghi URL — giữ khoá ngoài bộ lọc", () => {
  it("patch bỏ khoá undefined, giữ `task` của drawer", () => {
    expect(
      patchGoalListSearch({ task: "t", status: "Active" }, { status: undefined, mine: 1 }),
    ).toEqual({
      task: "t",
      mine: 1,
    });
  });

  it("replace xoá cả giá trị rác của khoá lọc", () => {
    expect(
      replaceGoalListFilters({ period: "abc", status: "xyz", task: "t" }, { period: Q4 }),
    ).toEqual({
      task: "t",
      period: Q4,
    });
  });
});

describe("chi tiết — tab trên URL", () => {
  it("tab hợp lệ giữ, Tổng quan/rác ⇒ {}", () => {
    expect(validateGoalDetailSearch({ tab: "checkins" })).toEqual({ tab: "checkins" });
    expect(validateGoalDetailSearch({ tab: "overview" })).toEqual({});
    expect(validateGoalDetailSearch({ tab: 42 })).toEqual({});
  });

  it("đổi tab giữ khoá khác; về Tổng quan thì bỏ khoá", () => {
    expect(withDetailTab({ task: "t" }, "children")).toEqual({ task: "t", tab: "children" });
    expect(withDetailTab({ task: "t", tab: "children" }, "overview")).toEqual({ task: "t" });
  });
});

describe("«Quay lại» từ chi tiết", () => {
  it("trả bộ lọc gần nhất ĐỦ kỳ; hỏng/chưa nhớ ⇒ {}", () => {
    expect(goalListBackSearch()).toEqual({});
    window.localStorage.setItem(
      GOAL_LIST_REMEMBER_KEY,
      JSON.stringify({ period: Q4, view: "list", status: "Active", junk: 1 }),
    );
    expect(goalListBackSearch()).toEqual({ period: Q4, view: "list", status: "Active" });
    window.localStorage.setItem(GOAL_LIST_REMEMBER_KEY, "[1,2]");
    expect(goalListBackSearch()).toEqual({});
  });
});
