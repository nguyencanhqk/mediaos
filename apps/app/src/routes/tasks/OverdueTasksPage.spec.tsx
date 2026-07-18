import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi } from "@mediaos/web-core";
import { OverdueTasksPage } from "./OverdueTasksPage";
import type { TaskCoreResponseDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks — useNavigate (dùng trong useTaskReadColumns) + taskCoreApi.listTasks.
// ---------------------------------------------------------------------------
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { listTasks: vi.fn() },
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

function makeTask(id: string, title: string, dueAt: string): TaskCoreResponseDto {
  return {
    id,
    companyId: "co-001",
    title,
    description: null,
    taskType: "office",
    status: "In Progress",
    priority: "High",
    projectId: null,
    projectName: null,
    mainAssigneeEmployeeId: null,
    assigneeName: null,
    creatorUserId: "u1",
    creatorName: "Test User",
    reporterEmployeeId: null,
    departmentId: null,
    dueAt,
    startAt: null,
    completedAt: null,
    isOverdue: true,
    createdBy: "u1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("OverdueTasksPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  it("renders forbidden state and does NOT fetch when user lacks read:task", () => {
    setCapabilities({});
    renderWithQuery(<OverdueTasksPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(taskCoreApi.listTasks).not.toHaveBeenCalled();
  });

  it("fetches with overdue=true pinned filter", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue([]);
    renderWithQuery(<OverdueTasksPage />);
    await waitFor(() => expect(taskCoreApi.listTasks).toHaveBeenCalled());
    expect(taskCoreApi.listTasks).toHaveBeenCalledWith(expect.objectContaining({ overdue: true }));
  });

  it("sorts rows by due_at ASC (most urgent first) + shows total count", async () => {
    setCapabilities({ "read:task": true });
    // Trả về SAI thứ tự (muộn trước) — component phải sort tăng dần.
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue([
      makeTask("t-late", "Task muộn hơn", "2026-09-01T00:00:00.000Z"),
      makeTask("t-early", "Task gấp hơn", "2026-08-01T00:00:00.000Z"),
    ]);
    renderWithQuery(<OverdueTasksPage />);
    await waitFor(() => expect(screen.getByText("Task gấp hơn")).toBeInTheDocument());

    const body = document.body.textContent ?? "";
    expect(body.indexOf("Task gấp hơn")).toBeLessThan(body.indexOf("Task muộn hơn"));
    expect(screen.getByText(/2 công việc quá hạn/i)).toBeInTheDocument();
  });

  it("shows empty state when there are no overdue tasks", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockResolvedValue([]);
    renderWithQuery(<OverdueTasksPage />);
    await waitFor(() =>
      expect(screen.getByText(/không có công việc quá hạn/i)).toBeInTheDocument(),
    );
  });

  it("shows error state when the fetch fails", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.listTasks).mockRejectedValue(new Error("Network error"));
    renderWithQuery(<OverdueTasksPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải danh sách task quá hạn/i)).toBeInTheDocument(),
    );
  });
});
