import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi } from "@mediaos/web-core";
import { TaskListPage } from "./TaskListPage";
import type { TaskCoreResponseDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
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
