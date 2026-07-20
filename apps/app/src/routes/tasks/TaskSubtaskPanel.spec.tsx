import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi, hrApi } from "@mediaos/web-core";
import { TaskSubtaskPanel } from "./TaskSubtaskPanel";
import type { TaskCoreResponseDto, SubtaskListItemDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      getTask: vi.fn(),
      listSubtasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      reorderSubtasks: vi.fn(),
    },
    hrApi: {
      listEmployees: vi.fn(),
    },
  };
});

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function makeTask(overrides: Partial<TaskCoreResponseDto>): TaskCoreResponseDto {
  return {
    id: "task-001",
    companyId: "co-001",
    title: "Việc cha",
    description: null,
    taskType: "office",
    status: "Todo",
    priority: "Medium",
    projectId: "proj-001",
    projectName: "Dự án A",
    mainAssigneeEmployeeId: null,
    assigneeName: null,
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
    parentTaskId: null,
    subtaskTotal: 0,
    subtaskDone: 0,
    ...overrides,
  };
}

function makeSubtask(overrides: Partial<SubtaskListItemDto>): SubtaskListItemDto {
  return {
    id: "sub-001",
    taskCode: "TSK-002",
    title: "Việc con 1",
    status: "Todo",
    priority: "Medium",
    mainAssigneeEmployeeId: null,
    assigneeName: null,
    dueAt: null,
    isOverdue: false,
    sortOrder: 0,
    canOpen: true,
    ...overrides,
  };
}

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

describe("TaskSubtaskPanel", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
    mockNavigate.mockReset();
    vi.mocked(hrApi.listEmployees).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 100, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    });
  });

  // ── LOADING ──────────────────────────────────────────────────────────────────
  it("shows a loading skeleton before the parent task detail resolves", () => {
    setCapabilities({});
    vi.mocked(taskCoreApi.getTask).mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<TaskSubtaskPanel taskId="task-001" />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  // ── ALLOW-PATH: hiện danh sách + progress theo aggregate SERVER (D-34) ──────
  it("renders the subtask list with the server-truth progress bar", async () => {
    setCapabilities({});
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(makeTask({ subtaskTotal: 2, subtaskDone: 1 }));
    vi.mocked(taskCoreApi.listSubtasks).mockResolvedValue([
      makeSubtask({ id: "sub-001", title: "Soạn tài liệu" }),
      makeSubtask({ id: "sub-002", title: "Việc con 2", status: "Done" }),
    ]);
    renderWithQuery(<TaskSubtaskPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Soạn tài liệu")).toBeInTheDocument());
    expect(screen.getByText("Việc con 2")).toBeInTheDocument();
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
  });

  // ── EMPTY ────────────────────────────────────────────────────────────────────
  it("shows empty state when the root task has no subtasks", async () => {
    setCapabilities({});
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(makeTask({}));
    vi.mocked(taskCoreApi.listSubtasks).mockResolvedValue([]);
    renderWithQuery(<TaskSubtaskPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText(/chưa có việc con/i)).toBeInTheDocument());
  });

  // ── ERROR + retry ────────────────────────────────────────────────────────────
  it("shows error state with retry when the subtask list fails to load", async () => {
    setCapabilities({});
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(makeTask({}));
    vi.mocked(taskCoreApi.listSubtasks).mockRejectedValueOnce(new Error("network"));
    renderWithQuery(<TaskSubtaskPanel taskId="task-001" />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh sách việc con/i)).toBeInTheDocument(),
    );
    vi.mocked(taskCoreApi.listSubtasks).mockResolvedValueOnce([
      makeSubtask({ title: "Đã tải lại" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await waitFor(() => expect(screen.getByText("Đã tải lại")).toBeInTheDocument());
  });

  // ── Panel ẨN khi đang xem MỘT VIỆC CON (D-33) — hiện dòng link cha ─────────
  it("renders a link to the parent task instead of the manager UI when viewing a subtask", async () => {
    setCapabilities({});
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(
      makeTask({ id: "sub-001", parentTaskId: "task-001" }),
    );
    renderWithQuery(<TaskSubtaskPanel taskId="sub-001" />);
    await waitFor(() => expect(screen.getByTestId("subtask-parent-link")).toBeInTheDocument());
    expect(taskCoreApi.listSubtasks).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /xem công việc cha/i }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/tasks/$taskId",
      params: { taskId: "task-001" },
    });
  });

  // ── D-39: con canOpen=false render READ-ONLY (không link, không nút sửa/xoá) ─
  it("renders an out-of-scope child read-only: no link, no edit/delete buttons", async () => {
    setCapabilities({ "update:task": true, "delete:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(makeTask({ subtaskTotal: 1, subtaskDone: 0 }));
    vi.mocked(taskCoreApi.listSubtasks).mockResolvedValue([
      makeSubtask({ id: "sub-hidden", title: "Việc ngoài tầm với", canOpen: false }),
    ]);
    renderWithQuery(<TaskSubtaskPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Việc ngoài tầm với")).toBeInTheDocument());

    const row = screen.getByTestId("subtask-row-sub-hidden");
    expect(within(row).queryByRole("button", { name: /sửa nhanh/i })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /^xóa việc con$/i })).not.toBeInTheDocument();
    // Tiêu đề KHÔNG phải link (bấm vào GET /tasks/:childId sẽ 404) — chỉ là text tĩnh.
    expect(
      within(row).queryByRole("button", { name: "Việc ngoài tầm với" }),
    ).not.toBeInTheDocument();
  });

  // ── Gate ĐÚNG cặp BE: create:task (thêm) · update:task (sửa/đổi thứ tự) ─────
  it("hides add/edit controls without create:task/update:task", async () => {
    setCapabilities({});
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(makeTask({ subtaskTotal: 1, subtaskDone: 0 }));
    vi.mocked(taskCoreApi.listSubtasks).mockResolvedValue([makeSubtask({})]);
    renderWithQuery(<TaskSubtaskPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Việc con 1")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: /thêm việc con/i })).not.toBeInTheDocument();
    const row = screen.getByTestId("subtask-row-sub-001");
    expect(within(row).queryByRole("button", { name: /sửa nhanh/i })).not.toBeInTheDocument();
    // Không có update:task ⇒ mũi tên đổi thứ tự cũng disable (canReorder=false).
    expect(within(row).getByRole("button", { name: /đưa lên trên/i })).toBeDisabled();
  });

  // ── Thêm việc con (create:task, POST /tasks parentTaskId — KHÔNG projectId/stateId) ──
  it("adds a subtask via the add dialog with parentTaskId only", async () => {
    setCapabilities({ "create:task": true, "update:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(makeTask({ subtaskTotal: 0, subtaskDone: 0 }));
    vi.mocked(taskCoreApi.listSubtasks).mockResolvedValue([]);
    vi.mocked(taskCoreApi.createTask).mockResolvedValue(makeTask({ id: "sub-new" }));
    renderWithQuery(<TaskSubtaskPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText(/chưa có việc con/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /thêm việc con/i }));
    fireEvent.change(screen.getByLabelText(/tiêu đề/i), { target: { value: "Việc con mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));

    await waitFor(() =>
      expect(taskCoreApi.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Việc con mới", parentTaskId: "task-001" }),
      ),
    );
    const sentBody = vi.mocked(taskCoreApi.createTask).mock.calls[0][0];
    expect(sentBody).not.toHaveProperty("projectId");
    expect(sentBody).not.toHaveProperty("stateId");
  });

  // ── Xoá việc con (delete:task, đòi xác nhận dialog) ─────────────────────────
  it("deletes a subtask after confirm", async () => {
    setCapabilities({ "update:task": true, "delete:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(makeTask({ subtaskTotal: 1, subtaskDone: 0 }));
    vi.mocked(taskCoreApi.listSubtasks).mockResolvedValue([
      makeSubtask({ id: "sub-001", title: "Việc con 1" }),
    ]);
    vi.mocked(taskCoreApi.deleteTask).mockResolvedValue(undefined);
    renderWithQuery(<TaskSubtaskPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("Việc con 1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /xóa việc con/i }));
    expect(taskCoreApi.deleteTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /xác nhận xóa/i }));
    await waitFor(() => expect(taskCoreApi.deleteTask).toHaveBeenCalledWith("sub-001"));
  });

  // ── Đổi thứ tự (mũi tên) — chờ list settle (isFetching) trước khi click ─────
  it("reorders subtasks with the up button after the list has settled", async () => {
    setCapabilities({ "update:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(makeTask({ subtaskTotal: 2, subtaskDone: 0 }));
    vi.mocked(taskCoreApi.listSubtasks).mockResolvedValue([
      makeSubtask({ id: "sub-001", title: "A", sortOrder: 0 }),
      makeSubtask({ id: "sub-002", title: "B", sortOrder: 1 }),
    ]);
    vi.mocked(taskCoreApi.reorderSubtasks).mockResolvedValue([
      makeSubtask({ id: "sub-002", title: "B", sortOrder: 0 }),
      makeSubtask({ id: "sub-001", title: "A", sortOrder: 1 }),
    ]);
    renderWithQuery(<TaskSubtaskPanel taskId="task-001" />);
    await waitFor(() => expect(screen.getByText("B")).toBeInTheDocument());

    const rowB = screen.getByTestId("subtask-row-sub-002");
    // Danh sách đã settle (isFetching=false) — nút "đưa lên trên" của dòng thứ 2 phải bật được.
    await waitFor(() =>
      expect(within(rowB).getByRole("button", { name: /đưa lên trên/i })).not.toBeDisabled(),
    );
    fireEvent.click(within(rowB).getByRole("button", { name: /đưa lên trên/i }));

    await waitFor(() =>
      expect(taskCoreApi.reorderSubtasks).toHaveBeenCalledWith("task-001", {
        subtaskIds: ["sub-002", "sub-001"],
      }),
    );
  });
});
