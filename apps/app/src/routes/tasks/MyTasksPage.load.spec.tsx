import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MY_TASKS_CLOSED_LIMIT, type MyTaskItemDto } from "@mediaos/contracts";
import { authApi, taskCoreApi, useAuthStore } from "@mediaos/web-core";
import { MyTasksPage } from "./MyTasksPage";

// S20-TASK-MYTASKSLOAD-1 — tải nhẹ (includeClosed theo công tắc) + chip mục tiêu trên dòng.
const { searchRef, navigateMock } = vi.hoisted(() => ({
  searchRef: { current: {} as Record<string, unknown> },
  navigateMock: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
      select({ location: { pathname: "/tasks/my-tasks", search: searchRef.current } }),
    Link: ({
      to,
      search,
      children,
      ...rest
    }: {
      to: string;
      search?: Record<string, unknown>;
      children: React.ReactNode;
    }) => (
      <a
        href={`${to}?${new URLSearchParams(Object.entries(search ?? {}).map(([k, v]) => [k, String(v)]))}`}
        {...rest}
      >
        {children}
      </a>
    ),
  };
});
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { ...actual.taskCoreApi, getMyTasks: vi.fn(), createTask: vi.fn() },
    authApi: { ...actual.authApi, me: vi.fn() },
  };
});

const GOAL_ID = "0190a1b2-c3d4-7e5f-8a6b-1c2d3e4f5a6b";

function makeItem(overrides: Partial<MyTaskItemDto>): MyTaskItemDto {
  return {
    id: "task-001",
    companyId: "co-001",
    title: "Việc mặc định",
    description: null,
    taskType: "office",
    status: "Todo",
    priority: "Medium",
    projectId: null,
    projectName: null,
    mainAssigneeEmployeeId: "emp-001",
    assigneeName: "Test User",
    creatorUserId: "u1",
    creatorName: "Test User",
    reporterEmployeeId: null,
    departmentId: null,
    dueAt: null,
    startAt: null,
    completedAt: null,
    isOverdue: false,
    createdBy: "u1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    source: "assigned",
    ...overrides,
  };
}

const doneRows = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    makeItem({ id: `done-${i}`, title: `Đã xong ${i}`, status: "Done" }),
  );

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Phần tử MỚI mỗi lần dựng: React bỏ qua rerender khi nhận lại đúng phần tử cũ (đọc lại search từ ref).
  const ui = () => (
    <QueryClientProvider client={client}>
      <MyTasksPage />
    </QueryClientProvider>
  );
  const view = render(ui());
  return { ...view, rerenderPage: () => view.rerender(ui()) };
}

describe("MyTasksPage — tải nhẹ + chip mục tiêu (S20-TASK-MYTASKSLOAD-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(taskCoreApi.getMyTasks).mockReset();
    searchRef.current = {};
    useAuthStore.setState({
      isAuthenticated: true,
      capabilities: { "read:task": true },
      user: {
        id: "u1",
        email: "t@demo.local",
        fullName: "T",
        status: "Active",
        companyId: "co-001",
      },
    });
    vi.mocked(authApi.me).mockResolvedValue({ employeeId: null } as never);
  });

  it("mặc định: getMyTasks KHÔNG gửi includeClosed", async () => {
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([makeItem({ id: "a", title: "Việc mở" })]);
    renderPage();
    await screen.findByText("Việc mở");
    expect(vi.mocked(taskCoreApi.getMyTasks).mock.calls[0]).toEqual([undefined]);
  });

  it("showDone=1 ⇒ gọi {includeClosed:true}; đúng bằng trần ⇒ thông báo trần", async () => {
    searchRef.current = { showDone: 1 };
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(doneRows(MY_TASKS_CLOSED_LIMIT));
    renderPage();
    await screen.findByTestId("my-tasks-closed-capped");
    expect(vi.mocked(taskCoreApi.getMyTasks).mock.calls[0]).toEqual([{ includeClosed: true }]);
    expect(screen.getByTestId("my-tasks-closed-capped").textContent).toContain("100");
  });

  it("showDone=1 nhưng đóng ít hơn trần, hoặc LỚN hơn trần (API cũ) ⇒ không báo trần", async () => {
    searchRef.current = { showDone: 1 };
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(doneRows(3));
    const first = renderPage();
    await screen.findByText("Đã xong 0");
    expect(screen.queryByTestId("my-tasks-closed-capped")).toBeNull();
    first.unmount();
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(doneRows(MY_TASKS_CLOSED_LIMIT + 5));
    renderPage();
    await screen.findByText("Đã xong 0");
    expect(screen.queryByTestId("my-tasks-closed-capped")).toBeNull();
  });

  it("bật công tắc: danh sách đang hiện KHÔNG bị trắng khi tải lần hai; lần hai lỗi ⇒ chỉ báo tại chỗ", async () => {
    vi.mocked(taskCoreApi.getMyTasks)
      .mockResolvedValueOnce([makeItem({ id: "a", title: "Việc mở" })])
      .mockRejectedValueOnce(new Error("Network error"));
    const { rerenderPage } = renderPage();
    await screen.findByText("Việc mở");
    searchRef.current = { showDone: 1 };
    rerenderPage();
    await screen.findByTestId("my-tasks-closed-error");
    expect(screen.getByText("Việc mở")).toBeInTheDocument();
    expect(screen.queryByText(/không thể tải công việc/i)).toBeNull();
  });

  it("chip: mục tiêu đọc được ⇒ link /tasks?goalId=…; bị che (null) ⇒ không chip", async () => {
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([
      makeItem({
        id: "g1",
        title: "Có mục tiêu",
        goalId: GOAL_ID,
        goalCode: "G-1",
        goalName: "Tăng doanh thu",
        hasGoal: true,
      }),
      makeItem({ id: "g2", title: "Mục tiêu bị che", hasGoal: true, goalId: null }),
    ]);
    renderPage();
    await screen.findByText("Có mục tiêu");
    await waitFor(() => expect(screen.getAllByTestId("task-goal-chip")).toHaveLength(1));
    const chip = screen.getByTestId("task-goal-chip");
    expect(chip.getAttribute("href")).toBe(`/tasks?goalId=${GOAL_ID}`);
  });
});
