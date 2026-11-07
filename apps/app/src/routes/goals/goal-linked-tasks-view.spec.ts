import { describe, it, expect } from "vitest";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import {
  formatLinkedTaskDue,
  groupLinkedTasksByAssignee,
  sortLinkedTasks,
} from "./goal-linked-tasks-view";

function task(over: Partial<TaskCoreResponseDto> & { id: string }): TaskCoreResponseDto {
  return {
    title: over.id,
    status: "Todo",
    isOverdue: false,
    dueAt: null,
    mainAssigneeEmployeeId: null,
    assigneeName: null,
    ...over,
  } as TaskCoreResponseDto;
}

describe("sortLinkedTasks", () => {
  it("quá hạn lên đầu, rồi hạn sớm trước, không hạn cuối; không đổi mảng gốc", () => {
    const input = [
      task({ id: "none" }),
      task({ id: "late", dueAt: "2026-12-01T00:00:00.000Z" }),
      task({ id: "soon", dueAt: "2026-11-01T00:00:00.000Z" }),
      task({ id: "over", isOverdue: true, dueAt: "2026-10-01T00:00:00.000Z" }),
    ];
    expect(sortLinkedTasks(input).map((x) => x.id)).toEqual(["over", "soon", "late", "none"]);
    expect(input.map((x) => x.id)).toEqual(["none", "late", "soon", "over"]);
  });
});

describe("groupLinkedTasksByAssignee", () => {
  it("đếm x/y xong, nhóm có việc quá hạn đứng đầu, «Chưa giao» cuối, quá hạn đầu nhóm", () => {
    const groups = groupLinkedTasksByAssignee([
      task({ id: "a1", mainAssigneeEmployeeId: "e-a", assigneeName: "An", status: "Done" }),
      task({ id: "a2", mainAssigneeEmployeeId: "e-a", assigneeName: "An" }),
      task({ id: "b1", mainAssigneeEmployeeId: "e-b", assigneeName: "Bình" }),
      task({ id: "b2", mainAssigneeEmployeeId: "e-b", assigneeName: "Bình", isOverdue: true }),
      task({ id: "u1" }),
    ]);
    expect(groups.map((g) => g.assigneeName)).toEqual(["Bình", "An", null]);
    expect(groups[0]?.tasks.map((x) => x.id)).toEqual(["b2", "b1"]);
    expect(groups[1]).toMatchObject({ doneCount: 1, hasOverdue: false });
    expect(groups[1]?.tasks).toHaveLength(2);
  });
});

describe("formatLinkedTaskDue", () => {
  it("quy ngày theo giờ công ty, không cắt chuỗi UTC", () => {
    // 20:00 UTC ngày 5 = 03:00 ngày 6 ở giờ công ty (UTC+7)
    expect(formatLinkedTaskDue("2026-11-05T20:00:00.000Z")).toBe("06/11/2026");
    expect(formatLinkedTaskDue(null)).toBe("—");
  });
});
