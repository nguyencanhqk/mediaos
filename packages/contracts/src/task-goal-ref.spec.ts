import { describe, expect, it } from "vitest";
import { taskCoreResponseSchema } from "./task";

/**
 * S20-SEC-GOALNAMEDTO-1 (plan §4 U3) — contract tham chiếu mục tiêu của bản ghi việc tương thích HAI chiều:
 * dạng cũ (không cờ) vẫn parse như trước; dạng mới (cờ `hasGoal` + ba trường null khi người xem không đọc
 * được mục tiêu) parse được và GIỮ cờ (additive `.optional()`, không `.default()`).
 */
const BASE = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  title: "Việc mẫu",
  description: null,
  taskType: "office",
  status: "Todo",
  priority: null,
  projectId: null,
  projectName: null,
  mainAssigneeEmployeeId: null,
  assigneeName: null,
  creatorUserId: null,
  creatorName: null,
  reporterEmployeeId: null,
  departmentId: null,
  dueAt: null,
  startAt: null,
  completedAt: null,
  isOverdue: false,
  createdBy: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const GOAL_ID = "33333333-3333-4333-8333-333333333333";

describe("contract task — tham chiếu mục tiêu (cũ ⇄ mới)", () => {
  it("U3a dạng cũ (ba trường, không cờ) parse như trước, không tự thêm cờ", () => {
    const out = taskCoreResponseSchema.parse({
      ...BASE,
      goalId: GOAL_ID,
      goalCode: "GOAL-0001",
      goalName: "Mục tiêu X",
    });
    expect(out.goalId).toBe(GOAL_ID);
    expect(out.goalName).toBe("Mục tiêu X");
    expect(out).not.toHaveProperty("hasGoal");
  });

  it("U3b dạng mới (ba trường null + cờ) parse được và giữ cờ", () => {
    const out = taskCoreResponseSchema.parse({
      ...BASE,
      goalId: null,
      goalCode: null,
      goalName: null,
      hasGoal: true,
    });
    expect(out.goalId).toBeNull();
    expect(out).toHaveProperty("hasGoal", true);
  });

  it("U3c cờ sai kiểu bị từ chối", () => {
    const res = taskCoreResponseSchema.safeParse({ ...BASE, hasGoal: "yes" });
    expect(res.success).toBe(false);
  });
});
