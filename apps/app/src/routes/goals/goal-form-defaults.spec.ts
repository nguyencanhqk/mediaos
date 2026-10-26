/**
 * S20-GOAL-QUICKSTART-1 (US-GOAL-NV-01) — mặc định THUẦN của form tạo mục tiêu.
 *
 * Mọi mốc tính từ `now` + múi công ty truyền vào, KHÔNG từ giờ máy: spec này chạy dưới TZ=UTC và
 * TZ=America/Los_Angeles (cùng kết quả). Instant đầu tiên nằm sát biên quý — giờ máy Los Angeles còn
 * ở 30/09 trong khi giờ công ty đã sang 01/10.
 */
import { describe, expect, it } from "vitest";
import {
  defaultGoalStatusForLevel,
  goalCreateInitialValues,
  goalFormDefaults,
  goalPeriodRangeFor,
  isCreateGoalOwnOnly,
  shouldAnchorSelf,
} from "./goal-form-defaults";

const COMPANY_TZ = "Asia/Ho_Chi_Minh";
const SELF = "11111111-1111-4111-8111-111111111111";
/** 01:00 ngày 01/10/2026 giờ công ty = 18:00 ngày 30/09/2026 UTC. */
const Q4_FIRST_HOUR = new Date("2026-09-30T18:00:00.000Z");

describe("isCreateGoalOwnOnly — phạm vi create:goal", () => {
  it("chỉ Own ⇒ true", () => {
    expect(isCreateGoalOwnOnly(["Own"])).toBe(true);
  });

  it("có phạm vi rộng hơn Own ⇒ false", () => {
    expect(isCreateGoalOwnOnly(["Own", "Department"])).toBe(false);
    expect(isCreateGoalOwnOnly(["Team"])).toBe(false);
    expect(isCreateGoalOwnOnly(["Company"])).toBe(false);
  });

  it("khoá vắng / rỗng (chưa biết) ⇒ false — form giữ đủ ô để chọn", () => {
    expect(isCreateGoalOwnOnly(undefined)).toBe(false);
    expect(isCreateGoalOwnOnly([])).toBe(false);
  });
});

describe("defaultGoalStatusForLevel — Q11 = B", () => {
  it("cấp Nhân viên ⇒ Active", () => {
    expect(defaultGoalStatusForLevel("employee")).toBe("Active");
  });

  it("cấp Phòng/Dự án hoặc chưa chọn ⇒ Draft", () => {
    expect(defaultGoalStatusForLevel("department")).toBe("Draft");
    expect(defaultGoalStatusForLevel("project")).toBe("Draft");
    expect(defaultGoalStatusForLevel("")).toBe("Draft");
  });
});

describe("goalPeriodRangeFor — ngày theo loại kỳ, giờ công ty", () => {
  it("quý ⇒ đầu/cuối quý chứa `now` theo múi truyền vào", () => {
    expect(goalPeriodRangeFor("quarter", Q4_FIRST_HOUR, COMPANY_TZ)).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
    // Cùng instant, múi khác ⇒ quý khác: hàm đọc múi tham số, không đọc giờ máy.
    expect(goalPeriodRangeFor("quarter", Q4_FIRST_HOUR, "America/Los_Angeles")).toEqual({
      start: "2026-07-01",
      end: "2026-09-30",
    });
  });

  it("năm ⇒ 01/01–31/12 của năm công ty (đêm giao thừa đã sang năm mới)", () => {
    expect(goalPeriodRangeFor("year", new Date("2026-12-31T18:00:00.000Z"), COMPANY_TZ)).toEqual({
      start: "2027-01-01",
      end: "2027-12-31",
    });
  });

  it("tuỳ chỉnh ⇒ null (giữ ngày đang có để sửa tay)", () => {
    expect(goalPeriodRangeFor("custom", Q4_FIRST_HOUR, COMPANY_TZ)).toBeNull();
  });
});

describe("goalFormDefaults — /goals/new mở sẵn", () => {
  it("NV chỉ Own ⇒ cấp Nhân viên · chính mình · quý hiện tại · Active", () => {
    const values = goalFormDefaults({
      now: Q4_FIRST_HOUR,
      timeZone: COMPANY_TZ,
      selfEmployeeId: SELF,
      anchorSelf: true,
    });
    expect(values).toMatchObject({
      level: "employee",
      employeeId: SELF,
      periodType: "quarter",
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
      status: "Active",
      measureType: "percent",
      progressMode: "manual",
      weight: "1",
      name: "",
    });
  });

  it("không tự neo vào mình (vd phân rã từ mục tiêu cha) ⇒ chủ thể trống", () => {
    const values = goalFormDefaults({
      now: Q4_FIRST_HOUR,
      timeZone: COMPANY_TZ,
      selfEmployeeId: SELF,
      anchorSelf: false,
    });
    expect(values.level).toBe("employee");
    expect(values.employeeId).toBe("");
  });

  it("không lấy được hồ sơ ⇒ chủ thể trống, phần còn lại vẫn mặc định", () => {
    const values = goalFormDefaults({
      now: Q4_FIRST_HOUR,
      timeZone: COMPANY_TZ,
      selfEmployeeId: null,
      anchorSelf: true,
    });
    expect(values.employeeId).toBe("");
    expect(values.periodStart).toBe("2026-10-01");
    expect(values.status).toBe("Active");
  });

  it("không đọc giờ máy: hai lần gọi với cùng `now` cho cùng kết quả, không phụ thuộc `Date.now`", () => {
    const input = {
      now: Q4_FIRST_HOUR,
      timeZone: COMPANY_TZ,
      selfEmployeeId: SELF,
      anchorSelf: true,
    };
    expect(goalFormDefaults(input)).toEqual(goalFormDefaults(input));
  });
});

describe("goalCreateInitialValues — mặc định + gợi ý từ search", () => {
  const PARENT = "22222222-2222-4222-8222-222222222222";
  const base = { now: Q4_FIRST_HOUR, timeZone: COMPANY_TZ, selfEmployeeId: SELF };

  it("không gợi ý ⇒ mặc định nhanh (Nhân viên · mình · Q4 · Active)", () => {
    expect(goalCreateInitialValues({ ...base, ownOnly: false }, {})).toMatchObject({
      level: "employee",
      employeeId: SELF,
      periodStart: "2026-10-01",
      status: "Active",
    });
  });

  it("gợi ý cấp Dự án (không cha) ⇒ Draft theo Q11 = B", () => {
    const values = goalCreateInitialValues({ ...base, ownOnly: false }, { level: "project" });
    expect(values.level).toBe("project");
    expect(values.status).toBe("Draft");
  });

  it("từ cha + phạm vi rộng ⇒ Active, chủ thể TRỐNG (giao cho người khác)", () => {
    const values = goalCreateInitialValues(
      { ...base, ownOnly: false },
      { parentGoalId: PARENT, level: "department" },
    );
    expect(values.status).toBe("Active");
    expect(values.employeeId).toBe("");
  });

  it("chỉ Own ⇒ luôn cấp Nhân viên + chính mình, kể cả khi search gợi ý cấp khác", () => {
    const values = goalCreateInitialValues(
      { ...base, ownOnly: true },
      { parentGoalId: PARENT, level: "department" },
    );
    expect(values.level).toBe("employee");
    expect(values.employeeId).toBe(SELF);
    expect(goalCreateInitialValues({ ...base, ownOnly: true }, { level: "project" })).toMatchObject(
      {
        level: "employee",
        status: "Active",
      },
    );
  });

  it("shouldAnchorSelf: Own luôn tự neo; phạm vi rộng chỉ khi không mở từ cha", () => {
    expect(shouldAnchorSelf(true, { parentGoalId: PARENT })).toBe(true);
    expect(shouldAnchorSelf(false, {})).toBe(true);
    expect(shouldAnchorSelf(false, { parentGoalId: PARENT })).toBe(false);
  });
});
