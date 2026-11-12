import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { GoalCoreResponseDto } from "@mediaos/contracts";

/**
 * S20-GOAL-SUGGEST-1 — truy vấn neo hỏng một phần ⇒ KHÔNG xếp hạng dữ liệu thiếu (trước đây còn đúng 1
 * ứng viên từ truy vấn kia ⇒ chip/chọn sẵn sai).
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    authApi: { ...actual.authApi, me: vi.fn().mockResolvedValue({ employee: null }) },
    goalApi: { ...actual.goalApi, listGoals: vi.fn() },
  };
});

import { useAuthStore, goalApi } from "@mediaos/web-core";
import { useGoalSuggestions } from "./use-goal-suggestions";

const mockList = goalApi.listGoals as ReturnType<typeof vi.fn>;

const GOAL = {
  id: "g-prj",
  goalCode: "G-0007",
  name: "Ra mắt",
  level: "project",
  departmentId: null,
  projectId: "p-1",
  employeeId: null,
  ownerEmployeeId: "emp-x",
  periodStart: "2020-01-01",
  periodEnd: "2099-12-31",
  progressMode: "tasks",
  status: "Active",
  finalizedAt: null,
} as unknown as GoalCoreResponseDto;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const CTX = {
  projectId: "p-1",
  assigneeEmployeeId: "emp-me",
  departmentId: null,
  dueAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: { "update:task": true, "update:goal": true },
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co-1" },
  });
});

describe("useGoalSuggestions — lỗi một phần", () => {
  it("đủ hai truy vấn ⇒ có ứng viên", async () => {
    mockList.mockImplementation(async (q: { projectId?: string }) => (q.projectId ? [GOAL] : []));
    const { result } = renderHook(() => useGoalSuggestions(CTX), { wrapper });
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
  });

  it("một truy vấn hỏng ⇒ isError và KHÔNG ứng viên (mode none)", async () => {
    mockList.mockImplementation(async (q: { projectId?: string }) => {
      if (q.projectId) return [GOAL];
      throw new Error("boom");
    });
    const { result } = renderHook(() => useGoalSuggestions(CTX), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.candidates).toHaveLength(0);
    expect(result.current.mode).toBe("none");
  });
});
