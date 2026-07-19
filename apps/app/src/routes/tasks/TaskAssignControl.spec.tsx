import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi } from "@mediaos/web-core";
import { TaskAssignControl } from "./TaskAssignControl";
import type { TaskCoreResponseDto, TaskWatcherResponseDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks — S5-TASK-DETAIL-1 (GAP 4): watchers list + theo dõi/bỏ theo dõi self-only.
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      assign: vi.fn(),
      addWatcher: vi.fn(),
      listWatchers: vi.fn(),
      removeWatcher: vi.fn(),
    },
    hrApi: {
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
    },
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const TASK = {
  id: "task-001",
  mainAssigneeEmployeeId: null,
  assigneeName: null,
} as unknown as TaskCoreResponseDto;

const MY_WATCHER: TaskWatcherResponseDto = {
  id: "w-001",
  taskId: "task-001",
  employeeId: "emp-001",
  employeeName: "Test User",
  userId: "u1",
  watcherType: "Manual",
  status: "Active",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const OTHER_WATCHER: TaskWatcherResponseDto = {
  ...MY_WATCHER,
  id: "w-002",
  employeeId: "emp-002",
  employeeName: "Đồng Nghiệp",
  userId: "u2",
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

describe("TaskAssignControl — watchers (S5-TASK-DETAIL-1 GAP 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the watcher list (names) and marks the current user", async () => {
    setCapabilities({ "watch:task": true });
    vi.mocked(taskCoreApi.listWatchers).mockResolvedValue([MY_WATCHER, OTHER_WATCHER]);
    renderWithQuery(<TaskAssignControl task={TASK} />);

    await waitFor(() => expect(screen.getByText("Đồng Nghiệp")).toBeInTheDocument());
    expect(screen.getByText(/người theo dõi \(2\)/i)).toBeInTheDocument();
    expect(screen.getByText("(bạn)")).toBeInTheDocument();
  });

  it("shows 'Bỏ theo dõi' when the current user is a watcher and calls removeWatcher with own id", async () => {
    setCapabilities({ "watch:task": true });
    vi.mocked(taskCoreApi.listWatchers).mockResolvedValue([MY_WATCHER]);
    vi.mocked(taskCoreApi.removeWatcher).mockResolvedValue(undefined);
    renderWithQuery(<TaskAssignControl task={TASK} />);

    const btn = await screen.findByRole("button", { name: /bỏ theo dõi/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(taskCoreApi.removeWatcher).toHaveBeenCalledWith("task-001", "w-001"),
    );
  });

  it("shows 'Theo dõi' when not watching and calls addWatcher", async () => {
    setCapabilities({ "watch:task": true });
    vi.mocked(taskCoreApi.listWatchers).mockResolvedValue([OTHER_WATCHER]);
    vi.mocked(taskCoreApi.addWatcher).mockResolvedValue({
      task: TASK,
      warnings: [],
    });
    renderWithQuery(<TaskAssignControl task={TASK} />);

    // Chờ list settle: nút Theo dõi disable trong lúc watchersQuery.isFetching (chống double-click).
    await screen.findByText("Đồng Nghiệp");
    const btn = await screen.findByRole("button", { name: /^theo dõi$/i });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    await waitFor(() => expect(taskCoreApi.addWatcher).toHaveBeenCalledWith("task-001"));
  });

  it("hides the watcher section and never fetches without watch:task", () => {
    setCapabilities({});
    renderWithQuery(<TaskAssignControl task={TASK} />);
    expect(screen.queryByText(/người theo dõi/i)).not.toBeInTheDocument();
    expect(taskCoreApi.listWatchers).not.toHaveBeenCalled();
  });
});
