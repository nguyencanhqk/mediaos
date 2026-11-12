import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { refresh } from "./use-goal-suggestions-link";

describe("refresh sau gắn/gỡ mục tiêu", () => {
  it("mỗi khoá invalidate đúng một lần", async () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    await refresh(queryClient, { goalId: "g1", goalCode: "G", taskId: "t1", projectId: "p1" });
    const ids = spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
