import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { useAuthStore, meApi, taskProjectApi, taskCoreApi } from "@mediaos/web-core";
import type { TaskCoreResponseDto, TaskProjectResponseDto } from "@mediaos/contracts";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { validateProjectWorkspaceRouteSearch } from "./project-workspace-filters";

// S20-TASK-PROJTOOLBARURL-1 — toolbar + rail của workspace dự án trên URL, đo bằng ROUTER THẬT
// (memory history): `validateSearch` của route = đúng hàm router.tsx dùng, nên `?task=` của drawer
// (navigate giữ `prev`) và Back thật sự đi qua các mục lịch sử.
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskProjectApi: { getProject: vi.fn(), listMembers: vi.fn().mockResolvedValue([]) },
    taskCollabApi: {
      getKanbanBoard: vi.fn().mockResolvedValue({ projectId: "proj-001", columns: [] }),
      listProjectActivity: vi.fn().mockResolvedValue([]),
    },
    taskCoreApi: { listTasks: vi.fn(), getTask: vi.fn() },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
    },
    meApi: { getOverview: vi.fn() },
  };
});

const U1 = "11111111-1111-4111-8111-111111111111";
const ME = "44444444-4444-4444-8444-444444444444";
const TASK_ID = "33333333-3333-4333-8333-333333333333";

const PROJECT = {
  id: "proj-001",
  name: "Website Revamp",
  code: "WEB",
  status: "Active",
  myProjectRole: null,
  memberCount: 2,
} as unknown as TaskProjectResponseDto;

function makeTask(id: string, assignee: string, name: string): TaskCoreResponseDto {
  return {
    id,
    title: `Việc của ${name}`,
    status: "Todo",
    priority: "Medium",
    projectId: "proj-001",
    mainAssigneeEmployeeId: assignee,
    assigneeName: name,
    assigneeAvatarUrl: null,
    dueAt: null,
    isOverdue: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  } as unknown as TaskCoreResponseDto;
}

function renderAt(url: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/tasks/projects/$projectId",
    validateSearch: validateProjectWorkspaceRouteSearch,
    component: () => <ProjectDetailPage projectId="proj-001" onBack={() => undefined} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([projectRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const urlSearch = (router: { state: { location: { search: unknown } } }) =>
  router.state.location.search as Record<string, unknown>;

describe("ProjectDetailPage — toolbar + rail trên URL (router thật)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Router thật khôi phục vị trí cuộn khi điều hướng — jsdom không có window.scrollTo.
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    window.localStorage.clear();
    useAuthStore.setState({
      isAuthenticated: true,
      capabilities: { "read:project": true, "read:task": true, "view-kanban:task": true },
      user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co" },
    });
    vi.mocked(taskProjectApi.getProject).mockResolvedValue(PROJECT);
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue([
      makeTask("t-1", U1, "An"),
      makeTask("t-2", ME, "Tôi"),
    ]);
    vi.mocked(meApi.getOverview).mockResolvedValue({
      identity: { employee: { employeeId: ME } },
    } as never);
  });

  it("tab + bộ lọc + task cùng URL; đổi tab bỏ task giữ bộ lọc; Back lùi từng bước", async () => {
    const router = renderAt("/tasks/projects/proj-001?tab=list");
    const status = await screen.findByTestId("workspace-filter-status");

    fireEvent.change(status, { target: { value: "Todo" } });
    await waitFor(() => expect(urlSearch(router).status).toBe("Todo"));
    fireEvent.click(await screen.findByTestId(`assignee-rail-item-${U1}`));
    await waitFor(() => expect(urlSearch(router).who).toBe(U1));

    // Mở drawer việc — y như useTaskDrawer: navigate giữ `prev` (đã qua validateSearch của route).
    await act(() =>
      router.navigate({
        to: ".",
        search: ((prev: object) => ({ ...prev, task: TASK_ID })) as never,
      }),
    );
    expect(urlSearch(router)).toMatchObject({
      tab: "list",
      status: "Todo",
      who: U1,
      task: TASK_ID,
    });

    fireEvent.click(screen.getByTestId("workspace-tab-board"));
    await waitFor(() => expect(urlSearch(router).tab).toBe("board"));
    expect(urlSearch(router)).toEqual({ tab: "board", status: "Todo", who: U1 });

    act(() => router.history.back());
    await waitFor(() => expect(urlSearch(router).task).toBe(TASK_ID));
    act(() => router.history.back());
    await waitFor(() => expect(urlSearch(router).task).toBeUndefined());
    expect(screen.getByTestId(`assignee-rail-item-${U1}`)).toHaveAttribute("aria-pressed", "true");
    act(() => router.history.back());
    await waitFor(() => expect(urlSearch(router).who).toBeUndefined());
    expect(screen.getByTestId(`assignee-rail-item-${U1}`)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("workspace-filter-status")).toHaveValue("Todo");
    act(() => router.history.back());
    await waitFor(() => expect(screen.getByTestId("workspace-filter-status")).toHaveValue(""));
    expect(urlSearch(router)).toEqual({ tab: "list" });
  });

  it("chip «Của tôi» lấy employeeId từ /me (cùng nguồn Danh sách /tasks) và bật/tắt trong `who`", async () => {
    const router = renderAt("/tasks/projects/proj-001?tab=list");
    const chip = await screen.findByTestId("workspace-chip-mine");
    expect(chip).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(chip);
    await waitFor(() => expect(urlSearch(router).who).toBe(ME));
    expect(meApi.getOverview).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("workspace-chip-mine")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId(`assignee-rail-item-${ME}`)).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("workspace-chip-mine"));
    await waitFor(() => expect(urlSearch(router).who).toBeUndefined());
  });

  it("gõ ô tìm ⇒ `q` lên URL bằng REPLACE (không thêm mục lịch sử mỗi chữ)", async () => {
    const router = renderAt("/tasks/projects/proj-001?tab=board");
    const input = await screen.findByTestId("workspace-search");
    const lengthBefore = router.history.length;

    fireEvent.change(input, { target: { value: "báo cáo" } });
    await waitFor(() => expect(urlSearch(router).q).toBe("báo cáo"));
    expect(router.history.length).toBe(lengthBefore);
    expect(urlSearch(router).tab).toBe("board");
  });

  it("URL rác ⇒ trang vẫn mở, toolbar + rail về mặc định", async () => {
    renderAt(`/tasks/projects/proj-001?tab=list&status=abc&priority=zz&who=xyz&sort=1&overdue=no`);
    const status = await screen.findByTestId("workspace-filter-status");
    expect(status).toHaveValue("");
    expect(screen.getByTestId("workspace-filter-priority")).toHaveValue("");
    expect(screen.getByTestId("workspace-sort")).toHaveValue("default");
    expect(await screen.findByTestId("assignee-rail-all")).toHaveAttribute("aria-pressed", "true");
  });
});
