import { isShortenedFlowTask, TASK_STATUS_LABELS, TASK_TYPE_LABELS } from "./task-constants";

describe("isShortenedFlowTask", () => {
  it("is true for an office task with no workflow step", () => {
    expect(isShortenedFlowTask({ taskType: "office", stepId: null })).toBe(true);
  });

  it("is false for an FSM-owned type (production) even without a step", () => {
    expect(isShortenedFlowTask({ taskType: "production", stepId: null })).toBe(false);
  });

  it("is false when the task is bound to a workflow step (stepId present)", () => {
    expect(isShortenedFlowTask({ taskType: "office", stepId: "11111111-1111-1111-1111-111111111111" })).toBe(
      false,
    );
  });

  it("treats finance/hr/meeting_action as shortened flow when unbound", () => {
    expect(isShortenedFlowTask({ taskType: "finance", stepId: null })).toBe(true);
    expect(isShortenedFlowTask({ taskType: "hr", stepId: null })).toBe(true);
    expect(isShortenedFlowTask({ taskType: "meeting_action", stepId: null })).toBe(true);
  });
});

describe("label maps cover every enum value", () => {
  it("has a Vietnamese label for all 6 statuses", () => {
    expect(Object.keys(TASK_STATUS_LABELS)).toHaveLength(6);
  });

  it("has a Vietnamese label for all 8 task types", () => {
    expect(Object.keys(TASK_TYPE_LABELS)).toHaveLength(8);
  });
});
