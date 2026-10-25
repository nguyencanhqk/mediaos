import { describe, expect, it } from "vitest";
import {
  GOAL_DECOMPOSED_ACTION,
  GOAL_DECOMPOSED_NEUTRAL_MESSAGE,
  decomposedGoalIds,
  redactGoalRef,
} from "./task-activity-goal-redact";

/**
 * S20-SEC-GOALNAMEDTO-1 (plan §4 U5) — nhật ký hoạt động theo CÙNG quyết định đọc mục tiêu với bản ghi
 * việc: che lúc đọc, trả object MỚI (sổ append-only không đổi), fail-closed khi id hỏng.
 */
const G = "90000000-0000-4000-8000-000000000001";
const decomposed = {
  id: "log-1",
  action: GOAL_DECOMPOSED_ACTION,
  newValues: { goalId: G, goalCode: "GOAL-0001", templateItemId: "tpl-1" },
  message: "Tạo từ phân rã mục tiêu Mục tiêu X",
};

describe("task-activity-goal-redact — nhật ký: cùng dữ liệu, cùng quyết định quyền", () => {
  it("U5a mục tiêu không đọc được ⇒ object MỚI, câu trung tính, bỏ id/mã, giữ khoá khác", () => {
    const out = redactGoalRef(decomposed, new Set());
    expect(out).not.toBe(decomposed);
    expect(out.message).toBe(GOAL_DECOMPOSED_NEUTRAL_MESSAGE);
    expect(out.message).not.toContain("Mục tiêu X");
    expect(out.newValues).toEqual({ templateItemId: "tpl-1" });
    expect(decomposed.newValues).toHaveProperty("goalId", G);
  });

  it("U5b mục tiêu đọc được ⇒ trả NGUYÊN dòng", () => {
    expect(redactGoalRef(decomposed, new Set([G]))).toBe(decomposed);
  });

  it("U5c dòng của action khác ⇒ không đổi", () => {
    const other = { ...decomposed, action: "TASK_STATUS_CHANGED" };
    expect(redactGoalRef(other, new Set())).toBe(other);
  });

  it("U5d goalId hỏng / vắng ⇒ che (fail-closed), không đưa vào ứng viên", () => {
    const broken = { ...decomposed, newValues: { goalId: "not-a-uuid", goalCode: "GOAL-0001" } };
    const absent = { ...decomposed, newValues: null };
    expect(decomposedGoalIds([broken, absent])).toEqual([]);
    expect(redactGoalRef(broken, new Set(["not-a-uuid"])).newValues).toEqual({});
    expect(redactGoalRef(absent, new Set()).message).toBe(GOAL_DECOMPOSED_NEUTRAL_MESSAGE);
  });

  it("U5e ứng viên chỉ từ dòng phân rã, khử trùng", () => {
    const other = { ...decomposed, action: "TASK_CREATED" };
    expect(decomposedGoalIds([decomposed, decomposed, other])).toEqual([G]);
  });
});
