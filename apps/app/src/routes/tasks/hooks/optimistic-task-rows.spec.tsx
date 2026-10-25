import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { taskKeys } from "@mediaos/web-core";
import type { TaskActionResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { useTaskActionMutation } from "./use-task-action-mutation";

/**
 * S20-TASK-QUICKEDIT-1 — `rowPatch` của `useTaskActionMutation`: vá lạc quan DÒNG việc trong cache
 * danh sách (`tasks/list/*`, `tasks/my`) và hoàn tác NGUYÊN VẸN khi server từ chối. Không truyền
 * `rowPatch` ⇒ cache danh sách không bị đụng (hành vi cũ của màn chi tiết giữ nguyên).
 */
const LIST_PARAMS = { overdue: true, limit: 200 };
const ROWS = [
  { id: "task-1", status: "Todo", dueAt: "2026-10-20T10:00:00.000Z", isOverdue: true },
  { id: "task-2", status: "Todo", dueAt: null, isOverdue: false },
];

function setup({
  withRowPatch,
  outcome,
}: {
  withRowPatch: boolean;
  outcome: { ok: true } | { ok: false; error: Error } | { ok: "pending" };
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(taskKeys.list(LIST_PARAMS), ROWS);
  client.setQueryData(taskKeys.my(), ROWS);
  // Khoá cùng tiền tố nhưng không phải mảng dòng ⇒ không đụng tới.
  client.setQueryData(taskKeys.list({ shape: "object" }), { total: 2 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const mutationFn = (): Promise<TaskActionResponseDto> => {
    if (outcome.ok === "pending") return new Promise(() => {});
    if (outcome.ok === false) return Promise.reject(outcome.error);
    return Promise.resolve({
      task: { id: "task-1", status: "Done" } as unknown as TaskCoreResponseDto,
      warnings: [],
    } as unknown as TaskActionResponseDto);
  };
  const { result } = renderHook(
    () =>
      useTaskActionMutation<string | null>({
        taskId: "task-1",
        mutationFn,
        toPatch: (dueAt) => ({ dueAt }),
        rowPatch: withRowPatch ? (dueAt) => ({ dueAt, isOverdue: false }) : undefined,
      }),
    { wrapper },
  );
  return { client, result };
}

const rowOf = (client: QueryClient, key: readonly unknown[]) =>
  (client.getQueryData(key) as typeof ROWS).find((r) => r.id === "task-1");

describe("useTaskActionMutation — rowPatch (S20-TASK-QUICKEDIT-1)", () => {
  it("vá ĐÚNG dòng trong mọi cache danh sách + «Việc của tôi», dòng khác giữ nguyên", async () => {
    const { client, result } = setup({ withRowPatch: true, outcome: { ok: "pending" } });
    act(() => result.current.mutate(null));
    await waitFor(() => expect(rowOf(client, taskKeys.my())?.dueAt).toBeNull());
    expect(rowOf(client, taskKeys.list(LIST_PARAMS))).toMatchObject({
      dueAt: null,
      isOverdue: false,
    });
    expect((client.getQueryData(taskKeys.my()) as typeof ROWS)[1]).toEqual(ROWS[1]);
    expect(client.getQueryData(taskKeys.list({ shape: "object" }))).toEqual({ total: 2 });
  });

  it("server từ chối ⇒ hoàn tác dòng về đúng ảnh chụp trước khi sửa", async () => {
    const { client, result } = setup({
      withRowPatch: true,
      outcome: { ok: false, error: new Error("403") },
    });
    act(() => result.current.mutate(null));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(rowOf(client, taskKeys.my())).toEqual(ROWS[0]);
    expect(rowOf(client, taskKeys.list(LIST_PARAMS))).toEqual(ROWS[0]);
  });

  it("không truyền rowPatch ⇒ cache danh sách không bị vá (hành vi cũ)", async () => {
    const { client, result } = setup({ withRowPatch: false, outcome: { ok: "pending" } });
    act(() => result.current.mutate(null));
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(rowOf(client, taskKeys.my())).toEqual(ROWS[0]);
  });
});
