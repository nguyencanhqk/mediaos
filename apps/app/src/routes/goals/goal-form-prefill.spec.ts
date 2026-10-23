/**
 * S20-GOAL-LISTURL-1 (US-GOAL-QL-04) — prefill `/goals/new` (hàm thuần). Prefill chỉ là GỢI Ý: BE vẫn
 * validate GOAL-ERR-001/011/012; validateSearch KHÔNG BAO GIỜ ném.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_GOAL_FORM } from "./goal-form-schema";
import {
  applyGoalFormPrefill,
  childGoalPrefill,
  nextGoalFormValues,
  validateGoalFormPrefill,
} from "./goal-form-prefill";

const PARENT = "33333333-3333-4333-8333-333333333333";
const DEPT = "11111111-1111-4111-8111-111111111111";
const PROJECT = "55555555-5555-4555-8555-555555555555";

describe("validateGoalFormPrefill — không ném, rác ⇒ bỏ", () => {
  it("giữ đủ khoá hợp lệ, bỏ khoá lạ", () => {
    expect(
      validateGoalFormPrefill({
        parentGoalId: PARENT,
        level: "project",
        departmentId: DEPT,
        projectId: PROJECT,
        periodType: "quarter",
        periodStart: "2026-10-01",
        periodEnd: "2026-12-31",
        task: "x",
      }),
    ).toEqual({
      parentGoalId: PARENT,
      level: "project",
      departmentId: DEPT,
      projectId: PROJECT,
      periodType: "quarter",
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
    });
  });

  it.each([
    [{ parentGoalId: "abc" }],
    [{ level: "company" }],
    [{ departmentId: 42 }],
    [{ periodType: "month" }],
    [{ periodStart: "2026-02-30" }],
    [{ periodStart: "2026-12-31", periodEnd: "2026-10-01" }],
  ])("rác %j ⇒ {}", (raw) => {
    expect(validateGoalFormPrefill(raw as Record<string, unknown>)).toEqual({});
  });
});

describe("childGoalPrefill + applyGoalFormPrefill", () => {
  const parent = {
    id: PARENT,
    departmentId: DEPT,
    projectId: null,
    periodType: "quarter" as const,
    periodStart: "2026-10-01",
    periodEnd: "2026-12-31",
  };

  it("mục tiêu con kế thừa cha · kỳ · phòng, cấp gợi ý Nhân viên", () => {
    expect(childGoalPrefill(parent)).toEqual({
      parentGoalId: PARENT,
      level: "employee",
      departmentId: DEPT,
      periodType: "quarter",
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
    });
  });

  it("có cha ⇒ Active; không cha ⇒ giữ trạng thái mặc định của form", () => {
    expect(applyGoalFormPrefill(EMPTY_GOAL_FORM, childGoalPrefill(parent))).toMatchObject({
      parentGoalId: PARENT,
      level: "employee",
      departmentId: DEPT,
      periodType: "quarter",
      periodStart: "2026-10-01",
      periodEnd: "2026-12-31",
      status: "Active",
    });
    expect(
      applyGoalFormPrefill(EMPTY_GOAL_FORM, { level: "project", projectId: PROJECT }),
    ).toMatchObject({
      level: "project",
      projectId: PROJECT,
      status: EMPTY_GOAL_FORM.status,
    });
  });
});

describe("nextGoalFormValues — «Lưu và thêm tiếp»", () => {
  it("xoá tên · người · chỉ tiêu, giữ cha · kỳ · phòng · cấp · cách đo", () => {
    const saved = {
      ...applyGoalFormPrefill(EMPTY_GOAL_FORM, {
        parentGoalId: PARENT,
        level: "employee",
        departmentId: DEPT,
        periodType: "quarter",
        periodStart: "2026-10-01",
        periodEnd: "2026-12-31",
      }),
      name: "Doanh số NV A",
      description: "ghi chú",
      employeeId: "44444444-4444-4444-8444-444444444444",
      ownerEmployeeId: "44444444-4444-4444-8444-444444444444",
      targetValue: "50",
      measureType: "number" as const,
      unit: "đơn",
    };
    expect(nextGoalFormValues(saved)).toEqual({
      ...saved,
      name: "",
      description: "",
      employeeId: "",
      ownerEmployeeId: "",
      targetValue: "",
    });
  });
});
