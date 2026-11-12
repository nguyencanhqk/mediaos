import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { refresh, uniqueKeys } from "./use-goal-suggestions-link";

describe("refresh sau gắn/gỡ mục tiêu", () => {
  it("mỗi khoá invalidate đúng một lần", async () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    await refresh(queryClient, { goalId: "g1", goalCode: "G", taskId: "t1", projectId: "p1" });
    const ids = spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = spy.mock.calls.map(([f]) => (f?.queryKey ?? []) as readonly unknown[]);
    const prefixOf = (a: readonly unknown[], b: readonly unknown[]) =>
      a.length <= b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
    keys.forEach((a, i) =>
      keys.forEach((b, j) => {
        if (i !== j)
          expect(prefixOf(a, b), `${JSON.stringify(a)} phủ ${JSON.stringify(b)}`).toBe(false);
      }),
    );
  });

  it("uniqueKeys bỏ khoá con đã được khoá tiền tố phủ, giữ khoá khác nhánh", () => {
    expect(
      uniqueKeys([
        ["tasks", "kanban", "p1"],
        ["tasks", "kanban"],
        ["tasks", "list"],
        ["tasks", "kanban"],
      ]),
    ).toEqual([
      ["tasks", "kanban"],
      ["tasks", "list"],
    ]);
    expect(
      uniqueKeys([
        ["goals", { id: "g1" }],
        ["goals", { id: "g2" }],
      ]),
    ).toHaveLength(2);
  });
});
