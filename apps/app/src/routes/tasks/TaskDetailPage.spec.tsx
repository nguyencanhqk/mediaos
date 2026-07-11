import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, ApiError, taskCoreApi } from "@mediaos/web-core";
import { TaskDetailPage } from "./TaskDetailPage";
import type { TaskCoreResponseDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      getTask: vi.fn(),
      deleteTask: vi.fn(),
      updateTask: vi.fn(),
      changeStatus: vi.fn(),
      changePriority: vi.fn(),
      changeDeadline: vi.fn(),
      assign: vi.fn(),
      addWatcher: vi.fn(),
      listComments: vi.fn().mockResolvedValue([]),
      addComment: vi.fn(),
    },
    taskProjectApi: { listProjects: vi.fn().mockResolvedValue([]) },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
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

const MOCK_TASK: TaskCoreResponseDto = {
  id: "task-001",
  companyId: "co-001",
  title: "Chuẩn bị báo cáo tuần",
  description: "Mô tả chi tiết",
  taskType: "office",
  status: "Todo",
  priority: "Medium",
  projectId: null,
  projectName: null,
  mainAssigneeEmployeeId: "emp-001",
  assigneeName: "Nguyễn Văn A",
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
};

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

describe("TaskDetailPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: no read:task ────────────────────────────────────────────────
  it("renders forbidden state when user lacks read:task", () => {
    setCapabilities({});
    renderWithQuery(<TaskDetailPage taskId="task-001" onBack={vi.fn()} />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(taskCoreApi.getTask).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: overview renders ──────────────────────────────────────────
  it("renders task overview when user has read:task", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(MOCK_TASK);
    renderWithQuery(<TaskDetailPage taskId="task-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
    expect(screen.getByText("Mô tả chi tiết")).toBeInTheDocument();
    expect(screen.getAllByText("Nguyễn Văn A").length).toBeGreaterThan(0);
  });

  // ── DENY-PATH: edit/delete hidden without matching permission ────────────
  it("hides edit/delete actions without update/delete:task", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(MOCK_TASK);
    renderWithQuery(<TaskDetailPage taskId="task-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
    expect(screen.queryByText(/sửa công việc/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/xóa công việc/i)).not.toBeInTheDocument();
  });

  // ── ALLOW-PATH: edit/delete visible with permission ───────────────────────
  it("shows edit/delete actions with update/delete:task", async () => {
    setCapabilities({ "read:task": true, "update:task": true, "delete:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(MOCK_TASK);
    renderWithQuery(<TaskDetailPage taskId="task-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
    expect(screen.getByText(/sửa công việc/i)).toBeInTheDocument();
    expect(screen.getByText(/xóa công việc/i)).toBeInTheDocument();
  });

  // ── NOT FOUND (404) ────────────────────────────────────────────────────────
  it("shows not-found state on 404", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockRejectedValue(
      new ApiError({ status: 404, code: "NOT_FOUND", message: "not found" }),
    );
    renderWithQuery(<TaskDetailPage taskId="task-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/không tìm thấy công việc/i)).toBeInTheDocument());
  });

  // ── ERROR state (non-404) ─────────────────────────────────────────────────
  it("shows error state with retry on generic failure", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockRejectedValue(new Error("Network error"));
    renderWithQuery(<TaskDetailPage taskId="task-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/không thể tải công việc/i)).toBeInTheDocument());
  });

  // ── Optimistic status change: applies immediately, ROLLS BACK on API error ─
  it("optimistically updates status then rolls back when change-status API fails", async () => {
    setCapabilities({ "read:task": true, "update-status:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(MOCK_TASK);
    // Promise treo (chưa resolve) — cho phép quan sát frame optimistic TRƯỚC khi API trả lỗi.
    let rejectChangeStatus!: (err: unknown) => void;
    vi.mocked(taskCoreApi.changeStatus).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectChangeStatus = reject;
        }),
    );
    renderWithQuery(<TaskDetailPage taskId="task-001" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

    const statusSelect = screen.getByLabelText(/^trạng thái$/i) as HTMLSelectElement;
    expect(statusSelect.value).toBe("Todo");

    fireEvent.change(statusSelect, { target: { value: "In Progress" } });
    // Optimistic: giá trị đổi NGAY trong cache/UI, KHÔNG đợi API trả về.
    await waitFor(() => expect(statusSelect.value).toBe("In Progress"));

    // API lỗi (409 FSM sai bảng) → rollback về giá trị trước đó + hiển thị thông báo lỗi.
    rejectChangeStatus(
      new ApiError({
        status: 409,
        code: "TASK-ERR-WORKFLOW-INVALID",
        message: "invalid transition",
      }),
    );
    await waitFor(() => expect(statusSelect.value).toBe("Todo"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
