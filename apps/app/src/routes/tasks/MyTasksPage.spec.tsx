import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi } from "@mediaos/web-core";
import { MyTasksPage } from "./MyTasksPage";
import type { MyTaskItemDto } from "@mediaos/contracts";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { getMyTasks: vi.fn() },
  };
});

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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

describe("MyTasksPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  it("renders forbidden state when user lacks read:task", () => {
    setCapabilities({});
    renderWithQuery(<MyTasksPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(taskCoreApi.getMyTasks).not.toHaveBeenCalled();
  });

  it("groups items into assigned/created/watched tabs and switches on click", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([
      makeItem({ id: "t1", title: "Việc được giao", source: "assigned" }),
      makeItem({ id: "t2", title: "Việc tôi tạo", source: "created" }),
      makeItem({ id: "t3", title: "Việc tôi theo dõi", source: "watched" }),
    ]);
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText("Việc được giao")).toBeInTheDocument());
    expect(screen.queryByText("Việc tôi tạo")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /tôi tạo/i }));
    await waitFor(() => expect(screen.getByText("Việc tôi tạo")).toBeInTheDocument());
    expect(screen.queryByText("Việc được giao")).not.toBeInTheDocument();
  });

  it("shows empty state for a tab with no items", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([]);
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText(/không có công việc/i)).toBeInTheDocument());
  });

  it("shows error state when API call fails", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockRejectedValue(new Error("Network error"));
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải công việc/i)).toBeInTheDocument());
  });
});
