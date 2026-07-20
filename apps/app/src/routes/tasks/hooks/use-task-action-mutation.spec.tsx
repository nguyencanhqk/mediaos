import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { taskKeys, taskCoreInvalidation } from "@mediaos/web-core";
import type { TaskActionResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { useTaskActionMutation } from "./use-task-action-mutation";

/**
 * Khoá hai tính chất của cache sau action mutate (assign / change-status / change-priority /
 * change-deadline). Cả hai đều là lỗi ÂM THẦM — không exception, không đỏ test, chỉ dữ liệu sai.
 *
 * 1. `respond()` (task-actions.service.ts) trả `toTaskCoreDto(row)` — KHÔNG có `subtaskTotal`/
 *    `subtaskDone` (chỉ `getTask` gắn thêm). Hai field đó `.optional()` trong contract nên tsc mù.
 *    Ghi đè thẳng `result.task` vào cache chi tiết là XOÁ chúng, mà `onSettled` không invalidate
 *    `detail` ⇒ không có refetch sửa lại. Hệ quả: thanh tiến độ việc con biến mất, và
 *    TaskMoveProjectDialog đọc `subtaskTotal ?? 0` → 0 → mở khoá nút đổi dự án cho task CÓ việc con
 *    ⇒ bấm là 400 SUBTASK_PARENT_PROJECT_LOCKED.
 *
 * 2. `taskKeys.kanban` KHÔNG nằm dưới prefix `tasks/list`, nên `taskCoreInvalidation.list()` không
 *    chạm board. Thiếu vế này: mở panel trượt TỪ board → đổi trạng thái → thẻ vẫn nằm cột cũ.
 */

const DETAIL_WITH_SUBTASKS = {
  id: "task-1",
  projectId: "proj-1",
  taskStatus: "InProgress",
  subtaskTotal: 5,
  subtaskDone: 2,
} as unknown as TaskCoreResponseDto;

/** Response của route action: KHÔNG mang subtaskTotal/subtaskDone — mô phỏng đúng `respond()`. */
const ACTION_RESPONSE = {
  task: {
    id: "task-1",
    projectId: "proj-1",
    taskStatus: "Done",
  } as unknown as TaskCoreResponseDto,
  warnings: [],
} as unknown as TaskActionResponseDto;

function setup(response: TaskActionResponseDto = ACTION_RESPONSE) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(taskKeys.detail("task-1"), DETAIL_WITH_SUBTASKS);
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  const { result } = renderHook(
    () =>
      useTaskActionMutation<{ status: string }>({
        taskId: "task-1",
        mutationFn: () => Promise.resolve(response),
        toPatch: (vars) => ({ taskStatus: vars.status }) as Partial<TaskCoreResponseDto>,
      }),
    { wrapper },
  );

  return { client, result, invalidateSpy };
}

describe("useTaskActionMutation — cache chi tiết sau action mutate", () => {
  it("GIỮ subtaskTotal/subtaskDone dù response không mang chúng", async () => {
    const { client, result } = setup();

    result.current.mutate({ status: "Done" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = client.getQueryData<TaskCoreResponseDto>(taskKeys.detail("task-1"));
    // Field server TRẢ thì server thắng…
    expect(cached?.taskStatus).toBe("Done");
    // …field server KHÔNG trả thì giữ nguyên, KHÔNG bị xoá.
    expect(cached?.subtaskTotal).toBe(5);
    expect(cached?.subtaskDone).toBe(2);
  });

  it("field server trả về null tường minh VẪN thắng cache (không phải merge mù)", async () => {
    const { client, result } = setup({
      task: {
        id: "task-1",
        projectId: "proj-1",
        taskStatus: "Done",
        mainAssigneeEmployeeId: null,
      } as unknown as TaskCoreResponseDto,
      warnings: [],
    } as unknown as TaskActionResponseDto);

    client.setQueryData(taskKeys.detail("task-1"), {
      ...DETAIL_WITH_SUBTASKS,
      mainAssigneeEmployeeId: "emp-cu",
    });

    result.current.mutate({ status: "Done" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = client.getQueryData<TaskCoreResponseDto>(taskKeys.detail("task-1"));
    // Bỏ gán người phụ trách = null TRẢ VỀ, phải ghi đè giá trị cũ — nếu merge làm mất vế này thì
    // người phụ trách cũ "sống lại" trên UI sau khi vừa gỡ.
    expect(cached?.mainAssigneeEmployeeId).toBeNull();
    expect(cached?.subtaskTotal).toBe(5);
  });

  it("invalidate BOARD của dự án chứa task (kanban không nằm dưới prefix tasks/list)", async () => {
    const { result, invalidateSpy } = setup();

    result.current.mutate({ status: "Done" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidatedKeys).toContain(JSON.stringify(taskKeys.kanban("proj-1")));
    // Và vẫn giữ nguyên các invalidation cũ.
    for (const key of taskCoreInvalidation.list()) {
      expect(invalidatedKeys).toContain(JSON.stringify(key));
    }
  });

  it("task KHÔNG thuộc dự án nào ⇒ không gọi invalidate kanban với id rỗng", async () => {
    const { result, invalidateSpy } = setup({
      task: { id: "task-1", projectId: null, taskStatus: "Done" } as unknown as TaskCoreResponseDto,
      warnings: [],
    } as unknown as TaskActionResponseDto);

    result.current.mutate({ status: "Done" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidatedKeys).not.toContain(JSON.stringify(taskKeys.kanban("")));
  });
});
