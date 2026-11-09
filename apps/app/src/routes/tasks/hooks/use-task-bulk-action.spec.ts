import { beforeEach, describe, expect, it, vi } from "vitest";
import { taskCollabApi, taskCoreApi } from "@mediaos/web-core";
import type { TaskActionResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { act, renderHook } from "@testing-library/react";
import {
  TASK_BULK_CONCURRENCY,
  TASK_BULK_MAX,
  runTaskBulk,
  useTaskRowSelection,
} from "./use-task-bulk-action";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { assign: vi.fn(), changeDeadline: vi.fn(), changeStatus: vi.fn() },
    taskCollabApi: { moveTaskState: vi.fn() },
  };
});

const task = (id: string): TaskCoreResponseDto =>
  ({ id, title: `Việc ${id}` }) as TaskCoreResponseDto;
const reply = (id: string, warnings?: unknown): TaskActionResponseDto =>
  ({ task: task(id), ...(warnings ? { warnings } : {}) }) as unknown as TaskActionResponseDto;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
const BOB = "11111111-1111-4111-8111-111111111111";

describe("runTaskBulk — S20-TASK-BULKACTIONS-1", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hằng số: trần 50 việc, đồng thời có giới hạn", () => {
    expect(TASK_BULK_MAX).toBe(50);
    expect(TASK_BULK_CONCURRENCY).toBeGreaterThan(0);
  });

  it("giao 6 việc ⇒ ĐÚNG 6 lời gọi /assign, mỗi việc một lần, không route nào khác", async () => {
    vi.mocked(taskCoreApi.assign).mockImplementation(async (id) => reply(id));
    const out = await runTaskBulk(ids(6), { kind: "assign", employeeId: BOB, employeeName: "B" });
    expect(taskCoreApi.assign).toHaveBeenCalledTimes(6);
    expect(vi.mocked(taskCoreApi.assign).mock.calls.map((c) => c[0])).toEqual(ids(6));
    expect(vi.mocked(taskCoreApi.assign).mock.calls[0]?.[1]).toEqual({ assigneeEmployeeId: BOB });
    expect(taskCoreApi.changeDeadline).not.toHaveBeenCalled();
    expect(out.succeeded).toHaveLength(6);
    expect(out.failedIds).toEqual([]);
  });

  it("2/6 bị từ chối ⇒ 4 thành công, 2 id lỗi; dòng lỗi không làm hỏng dòng khác", async () => {
    vi.mocked(taskCoreApi.assign).mockImplementation(async (id) => {
      if (id === "t2" || id === "t5") throw new Error("403");
      return reply(id);
    });
    const out = await runTaskBulk(ids(6), { kind: "assign", employeeId: BOB, employeeName: "B" });
    expect(out.succeeded.map((t) => t.id)).toEqual(["t1", "t3", "t4", "t6"]);
    expect(out.failedIds).toEqual(["t2", "t5"]);
  });

  it("không chạy quá TASK_BULK_CONCURRENCY lời gọi cùng lúc", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.mocked(taskCoreApi.changeStatus).mockImplementation(async (id) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return reply(id);
    });
    await runTaskBulk(ids(23), { kind: "status", status: "Done" });
    expect(taskCoreApi.changeStatus).toHaveBeenCalledTimes(23);
    expect(peak).toBeLessThanOrEqual(TASK_BULK_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  it("gộp cảnh báo: đếm số việc có từng loại, mã rác bị bỏ", async () => {
    vi.mocked(taskCoreApi.assign).mockImplementation(async (id) =>
      id <= "t3"
        ? reply(id, [{ code: "TASK-WARN-ASSIGNEE-ON-LEAVE" }, { code: "RAC" }])
        : reply(id),
    );
    const out = await runTaskBulk(ids(6), { kind: "assign", employeeId: BOB, employeeName: "B" });
    expect(out.warningCounts).toEqual({ onLeave: 3, notMember: 0 });
  });

  it("dời hạn gọi change-deadline với dueAt; chuyển cột gọi move-state với stateId", async () => {
    vi.mocked(taskCoreApi.changeDeadline).mockImplementation(async (id) => reply(id));
    vi.mocked(taskCollabApi.moveTaskState).mockImplementation(async (id) => task(id));
    const dueAt = "2026-10-23T10:00:00.000Z";
    await runTaskBulk(["a"], { kind: "deadline", dueAt });
    await runTaskBulk(["a", "b"], { kind: "moveState", stateId: BOB });
    expect(taskCoreApi.changeDeadline).toHaveBeenCalledWith("a", { dueAt });
    expect(taskCollabApi.moveTaskState).toHaveBeenCalledTimes(2);
    expect(taskCollabApi.moveTaskState).toHaveBeenCalledWith("b", { stateId: BOB });
  });
});

describe("useTaskRowSelection.retainOnly — chọn đổi giữa lúc lệnh chạy", () => {
  const items = ["a", "b", "c"].map((id) => ({ id, title: id }) as TaskCoreResponseDto);

  it("GIAO với lựa chọn hiện tại: dòng vừa bỏ chọn không bị chọn lại, dòng mới chọn không bị ghi đè", () => {
    const { result } = renderHook(() => useTaskRowSelection(items));
    act(() => result.current.onChange({ a: true, b: true }));
    // Trong lúc lệnh chạy: bỏ b, chọn thêm c. Lệnh báo lỗi a và b.
    act(() => result.current.onChange({ a: true, c: true }));
    act(() => result.current.retainOnly(["a", "b"]));
    expect(result.current.selectedTasks.map((task) => task.id)).toEqual(["a"]);
  });
});
