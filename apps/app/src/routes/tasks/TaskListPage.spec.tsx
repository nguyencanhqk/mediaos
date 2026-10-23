import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi, hrApi, meApi } from "@mediaos/web-core";
import { TaskListPage } from "./TaskListPage";
import type { TaskCoreResponseDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// S20-TASK-DRAWER-1 — bộ lọc đọc từ location.search (URL) và ghi bằng navigate(to ".").
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
      select({ location: { pathname: "/tasks", search: searchRef.current } }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      listTasks: vi.fn(),
      deleteTask: vi.fn(),
      createTask: vi.fn(),
    },
    taskProjectApi: {
      listProjects: vi.fn().mockResolvedValue([]),
    },
    meApi: { getOverview: vi.fn() },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_TASKS: TaskCoreResponseDto[] = [
  {
    id: "task-001",
    companyId: "co-001",
    title: "Chuẩn bị báo cáo tuần",
    description: null,
    taskType: "office",
    status: "In Progress",
    priority: "High",
    projectId: null,
    projectName: null,
    mainAssigneeEmployeeId: "emp-001",
    assigneeName: "Nguyễn Văn A",
    creatorUserId: "u1",
    creatorName: "Test User",
    reporterEmployeeId: null,
    departmentId: null,
    dueAt: "2026-08-01T00:00:00.000Z",
    startAt: null,
    completedAt: null,
    isOverdue: false,
    createdBy: "u1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
];

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
}

function clearCapabilities() {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("TaskListPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
    searchRef.current = {};
  });

  // ── DENY-PATH: no read:task ────────────────────────────────────────────────
  it("renders forbidden state when user lacks read:task", () => {
    setCapabilities({});
    renderWithQuery(<TaskListPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(taskCoreApi.listTasks).not.toHaveBeenCalled();
  });

  // ── DENY-PATH: create button hidden without create:task ──────────────────
  it("hides 'Tạo công việc' button when user lacks create:task", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue(MOCK_TASKS);
    renderWithQuery(<TaskListPage />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
    expect(screen.queryByText(/tạo công việc/i)).not.toBeInTheDocument();
  });

  // ── DENY-PATH: delete action hidden without EXACT delete:task (sensitive) ─
  it("hides delete action when user lacks delete:task", async () => {
    setCapabilities({ "read:task": true, "*:*": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue(MOCK_TASKS);
    renderWithQuery(<TaskListPage />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
    // useCanExact KHÔNG wildcard fallback — "*:*" KHÔNG mở delete:task (sensitive).
    expect(screen.queryByLabelText(/xóa công việc/i)).not.toBeInTheDocument();
  });

  // ── ALLOW-PATH: list renders + create button + delete action ─────────────
  it("renders task list + shows create/delete actions with matching grants", async () => {
    setCapabilities({ "read:task": true, "create:task": true, "delete:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue(MOCK_TASKS);
    renderWithQuery(<TaskListPage />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
    expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument();
    expect(screen.getByText(/tạo công việc/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/xóa công việc/i)).toBeInTheDocument();
  });

  // ── LOADING state ──────────────────────────────────────────────────────────
  it("shows table skeleton while loading", () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<TaskListPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  // ── ERROR state ────────────────────────────────────────────────────────────
  it("shows error state when API call fails", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockRejectedValue(new Error("Network error"));
    renderWithQuery(<TaskListPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh sách công việc/i)).toBeInTheDocument(),
    );
  });

  // ── EMPTY state ────────────────────────────────────────────────────────────
  it("shows empty state when list has no results", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue([]);
    renderWithQuery(<TaskListPage />);
    await waitFor(() => expect(screen.getByText(/chưa có công việc nào/i)).toBeInTheDocument());
  });
});

// ── S20-TASK-DRAWER-1 (US-TASK-QL-05) — bộ lọc trên URL, ô tìm, chip «Của tôi» ──────────────────
describe("TaskListPage — bộ lọc trên URL", () => {
  const P = "0b9f6a4e-2c1d-4e8f-9a7b-3c5d6e7f8a9b";
  const ME = "1c8e5b3d-3d2e-4f9a-8b6c-4d6e7f8a9b0c";
  type Nav = {
    to: string;
    replace?: boolean;
    search: (prev: Record<string, unknown>) => Record<string, unknown>;
  };
  const lastNav = () => navigateMock.mock.calls.at(-1)?.[0] as Nav;

  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
    searchRef.current = {};
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue(MOCK_TASKS);
  });

  it("URL ?status=In Review&project=P&search=… ⇒ GET /tasks nhận đúng bộ lọc (tải lại / Back giữ nguyên)", async () => {
    setCapabilities({ "read:task": true });
    searchRef.current = { status: "In Review", project: P, search: "báo cáo", page: 2 };
    renderWithQuery(<TaskListPage />);

    await waitFor(() =>
      expect(taskCoreApi.listTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "In Review",
          projectId: P,
          search: "báo cáo",
          offset: 20,
        }),
      ),
    );
  });

  it("giá trị rác trên URL ⇒ dùng mặc định, trang vẫn hiện", async () => {
    setCapabilities({ "read:task": true });
    searchRef.current = { status: "abc", assignee: "not-a-uuid", page: -1 };
    renderWithQuery(<TaskListPage />);

    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
    const query = vi.mocked(taskCoreApi.listTasks).mock.calls[0]?.[0];
    expect(query).toMatchObject({ status: undefined, assigneeEmployeeId: undefined, offset: 0 });
  });

  it("đổi trạng thái ⇒ ghi lên URL (bỏ page), không giữ trong state cục bộ", async () => {
    setCapabilities({ "read:task": true });
    searchRef.current = { page: 3, task: P };
    renderWithQuery(<TaskListPage />);

    fireEvent.change(screen.getByTestId("task-list-filter-status"), {
      target: { value: "Done" },
    });
    expect(lastNav().to).toBe(".");
    expect(lastNav().search({ page: 3, task: P })).toEqual({ status: "Done", task: P });
  });

  it("ô tìm debounce 300ms ⇒ URL có `search=`; phím «/» đưa con trỏ vào ô tìm", async () => {
    vi.useFakeTimers();
    try {
      setCapabilities({ "read:task": true });
      renderWithQuery(<TaskListPage />);
      const input = screen.getByTestId("task-list-search");

      fireEvent.keyDown(document.body, { key: "/" });
      expect(document.activeElement).toBe(input);

      fireEvent.change(input, { target: { value: "báo cáo" } });
      act(() => vi.advanceTimersByTime(299));
      expect(navigateMock).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(lastNav()).toMatchObject({ to: ".", replace: true });
      expect(lastNav().search({ page: 2 })).toEqual({ search: "báo cáo" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("chip «Của tôi» ⇒ assignee = employeeId của tôi lấy từ /me", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(meApi.getOverview).mockResolvedValue({
      identity: { employee: { employeeId: ME } },
    } as never);
    renderWithQuery(<TaskListPage />);

    fireEvent.click(screen.getByTestId("task-list-chip-mine"));
    await waitFor(() => expect(lastNav()?.search({})).toEqual({ assignee: ME }));
  });

  it("không có kết quả khi đang lọc ⇒ «Xoá bộ lọc» bỏ mọi bộ lọc, giữ tham số khác", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue([]);
    searchRef.current = { status: "Done", search: "xyz", page: 2 };
    renderWithQuery(<TaskListPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Xoá bộ lọc" }));
    expect(lastNav().search({ status: "Done", search: "xyz", page: 2, task: P })).toEqual({
      task: P,
    });
  });

  it("thiếu read:department ⇒ không có lọc phòng ban, KHÔNG gọi API phòng ban", async () => {
    setCapabilities({ "read:task": true });
    renderWithQuery(<TaskListPage />);

    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
    expect(screen.queryByTestId("task-list-filter-department")).not.toBeInTheDocument();
    expect(hrApi.listDepartments).not.toHaveBeenCalled();
  });

  it("có read:department ⇒ hiện lọc phòng ban", async () => {
    setCapabilities({ "read:task": true, "read:department": true });
    renderWithQuery(<TaskListPage />);

    expect(await screen.findByTestId("task-list-filter-department")).toBeInTheDocument();
    await waitFor(() => expect(hrApi.listDepartments).toHaveBeenCalled());
  });

  it("localStorage bị chặn ⇒ bộ lọc lấy từ URL vẫn đúng", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      setCapabilities({ "read:task": true });
      searchRef.current = { priority: "Urgent" };
      renderWithQuery(<TaskListPage />);
      await waitFor(() =>
        expect(taskCoreApi.listTasks).toHaveBeenCalledWith(
          expect.objectContaining({ priority: "Urgent" }),
        ),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
