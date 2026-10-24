import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { taskKeys, taskCoreInvalidation, goalKeys, goalInvalidation } from "@mediaos/web-core";
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
  status: "In Progress",
  subtaskTotal: 5,
  subtaskDone: 2,
} as unknown as TaskCoreResponseDto;

/** Response của route action: KHÔNG mang subtaskTotal/subtaskDone — mô phỏng đúng `respond()`. */
const ACTION_RESPONSE = {
  task: {
    id: "task-1",
    projectId: "proj-1",
    status: "Done",
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
        toPatch: (vars) => ({ status: vars.status }) as Partial<TaskCoreResponseDto>,
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
    expect(cached?.status).toBe("Done");
    // …field server KHÔNG trả thì giữ nguyên, KHÔNG bị xoá.
    expect(cached?.subtaskTotal).toBe(5);
    expect(cached?.subtaskDone).toBe(2);
  });

  it("field server trả về null tường minh VẪN thắng cache (không phải merge mù)", async () => {
    const { client, result } = setup({
      task: {
        id: "task-1",
        projectId: "proj-1",
        status: "Done",
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
      task: { id: "task-1", projectId: null, status: "Done" } as unknown as TaskCoreResponseDto,
      warnings: [],
    } as unknown as TaskActionResponseDto);

    result.current.mutate({ status: "Done" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidatedKeys).not.toContain(JSON.stringify(taskKeys.kanban("")));
  });

  // ── S5-GOAL-FE-2 — chiều TASK→GOAL. Lỗi cùng họ với hai ca trên: không exception, không đỏ test,
  // chỉ là % mục tiêu SAI mà nhìn vẫn hợp lý. Server tính lại progress của mục tiêu neo ngay khi
  // task sang Done (SPEC-10 §13, progress_mode='tasks'), FE không invalidate ⇒ mở màn Mục tiêu
  // hoặc /me vẫn thấy số trước khi đổi cho tới khi F5.
  describe("đồng bộ % mục tiêu khi task gắn mục tiêu đổi trạng thái", () => {
    const WITH_GOAL = {
      task: {
        id: "task-1",
        projectId: "proj-1",
        status: "Done",
        goalId: "goal-9",
      } as unknown as TaskCoreResponseDto,
      warnings: [],
    } as unknown as TaskActionResponseDto;

    it("task CÓ goalId ⇒ invalidate detail + linked-tasks + list/tree + me/goals của mục tiêu", async () => {
      const { result, invalidateSpy } = setup(WITH_GOAL);

      result.current.mutate({ status: "Done" });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      for (const key of goalInvalidation.taskProgress("goal-9")) {
        expect(invalidatedKeys).toContain(JSON.stringify(key));
      }
    });

    it("task KHÔNG gắn mục tiêu ⇒ KHÔNG đụng cache goal (không invalidate thừa)", async () => {
      const { result, invalidateSpy } = setup();

      result.current.mutate({ status: "Done" });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(invalidatedKeys.some((k) => k?.includes("goals"))).toBe(false);
      expect(invalidatedKeys).not.toContain(JSON.stringify(goalKeys.detail("")));
    });

    it("mutate LỖI ⇒ vẫn làm mới mục tiêu CŨ từ snapshot (rollback không được để % lệch)", async () => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      client.setQueryData(taskKeys.detail("task-1"), {
        ...DETAIL_WITH_SUBTASKS,
        goalId: "goal-cu",
      });
      const invalidateSpy = vi.spyOn(client, "invalidateQueries");
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(
        () =>
          useTaskActionMutation<{ status: string }>({
            taskId: "task-1",
            mutationFn: () => Promise.reject(new Error("boom")),
            toPatch: (vars) => ({ status: vars.status }) as Partial<TaskCoreResponseDto>,
          }),
        { wrapper },
      );

      result.current.mutate({ status: "Done" });
      await waitFor(() => expect(result.current.isError).toBe(true));

      const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(invalidatedKeys).toContain(JSON.stringify(goalKeys.detail("goal-cu")));
    });
  });

  // ── S20-TASK-ASSIGNWARN-1 (US-TASK-QL-91) — `warnings[]` server đã trả (assign / change-deadline)
  // được CHUẨN HOÁ ngay trong kết quả mutate: phía gọi (ô người phụ trách, sau này thao tác hàng loạt
  // và quick-add) đọc `data.warnings` / `onWarnings` thay vì tự parse lại. Parse PHÒNG THỦ: shape lạ
  // hay vắng trường ⇒ không cảnh báo, KHÔNG ném — việc giao server đã chấp nhận không được biến thành lỗi.
  describe("warnings[] chuẩn hoá trong kết quả mutate", () => {
    function setupWithWarnings(response: unknown) {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      client.setQueryData(taskKeys.detail("task-1"), DETAIL_WITH_SUBTASKS);
      const onWarnings = vi.fn();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(
        () =>
          useTaskActionMutation<string>({
            taskId: "task-1",
            mutationFn: () => Promise.resolve(response as TaskActionResponseDto),
            toPatch: (id) => ({ mainAssigneeEmployeeId: id }) as Partial<TaskCoreResponseDto>,
            onWarnings,
          }),
        { wrapper },
      );
      return { result, onWarnings };
    }

    const ASSIGNED = { id: "task-1", projectId: "proj-1", assigneeName: "Trần Thị B" };

    it("nghỉ phép + không thành viên ⇒ hai cảnh báo chuẩn hoá, onWarnings nhận đúng danh sách", async () => {
      const { result, onWarnings } = setupWithWarnings({
        task: ASSIGNED,
        warnings: [
          { code: "TASK-WARN-ASSIGNEE-ON-LEAVE", message: "x" },
          { code: "TASK-WARN-ASSIGNEE-NOT-MEMBER", message: "y" },
        ],
      });

      result.current.mutate("emp-002");
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const expected = [
        { kind: "onLeave", until: null },
        { kind: "notMember", until: null },
      ];
      expect(result.current.data?.warnings).toEqual(expected);
      expect(onWarnings).toHaveBeenCalledTimes(1);
      expect(onWarnings.mock.calls[0]?.[0]).toEqual(expected);
      expect(onWarnings.mock.calls[0]?.[1]).toMatchObject({ assigneeName: "Trần Thị B" });
    });

    it("server trả hạn nghỉ dạng ngày (YYYY-MM-DD) ⇒ giữ `until`; dạng khác ⇒ bỏ hạn, vẫn cảnh báo", async () => {
      const { result } = setupWithWarnings({
        task: ASSIGNED,
        warnings: [
          { code: "TASK-WARN-ASSIGNEE-ON-LEAVE", message: "x", until: "2026-10-30" },
          { code: "TASK-WARN-ASSIGNEE-NOT-MEMBER", message: "y", until: "30/10" },
        ],
      });

      result.current.mutate("emp-002");
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.warnings).toEqual([
        { kind: "onLeave", until: "2026-10-30" },
        { kind: "notMember", until: null },
      ]);
    });

    it("warnings[] rỗng ⇒ không cảnh báo (onWarnings nhận mảng rỗng)", async () => {
      const { result, onWarnings } = setupWithWarnings({ task: ASSIGNED, warnings: [] });

      result.current.mutate("emp-002");
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.warnings).toEqual([]);
      expect(onWarnings.mock.calls[0]?.[0]).toEqual([]);
    });

    it("VẮNG trường warnings ⇒ không cảnh báo, mutate vẫn thành công (không ném)", async () => {
      const { result, onWarnings } = setupWithWarnings({ task: ASSIGNED });

      result.current.mutate("emp-002");
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.warnings).toEqual([]);
      expect(onWarnings.mock.calls[0]?.[0]).toEqual([]);
    });

    it("shape lạ (không phải mảng · phần tử rác · mã lạ · trùng mã) ⇒ chỉ giữ cảnh báo hợp lệ, không ném", async () => {
      const notArray = setupWithWarnings({ task: ASSIGNED, warnings: { code: "x" } });
      notArray.result.current.mutate("emp-002");
      await waitFor(() => expect(notArray.result.current.isSuccess).toBe(true));
      expect(notArray.result.current.data?.warnings).toEqual([]);

      const junk = setupWithWarnings({
        task: ASSIGNED,
        warnings: [
          null,
          "TASK-WARN-ASSIGNEE-ON-LEAVE",
          { message: "thiếu mã" },
          { code: "TASK-WARN-SOMETHING-NEW", message: "mã chưa biết" },
          { code: "toString" },
          { code: "TASK-WARN-ASSIGNEE-NOT-MEMBER" },
          { code: "TASK-WARN-ASSIGNEE-NOT-MEMBER", message: "trùng" },
        ],
      });
      junk.result.current.mutate("emp-002");
      await waitFor(() => expect(junk.result.current.isSuccess).toBe(true));
      expect(junk.result.current.data?.warnings).toEqual([{ kind: "notMember", until: null }]);
    });

    it("mutate LỖI ⇒ KHÔNG gọi onWarnings (không cảnh báo cho việc giao chưa thành)", async () => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const onWarnings = vi.fn();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(
        () =>
          useTaskActionMutation<string>({
            taskId: "task-1",
            mutationFn: () => Promise.reject(new Error("boom")),
            toPatch: (id) => ({ mainAssigneeEmployeeId: id }) as Partial<TaskCoreResponseDto>,
            onWarnings,
          }),
        { wrapper },
      );

      result.current.mutate("emp-002");
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(onWarnings).not.toHaveBeenCalled();
    });
  });
});
