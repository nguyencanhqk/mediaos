import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCollabApi, ApiError } from "@mediaos/web-core";
import { TaskKanbanPage } from "./TaskKanbanPage";
import type { TaskCoreResponseDto, TaskKanbanBoardDto } from "@mediaos/contracts";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCollabApi: {
      getKanbanBoard: vi.fn(),
      moveTask: vi.fn(),
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
  description: null,
  taskType: "office",
  status: "Todo",
  priority: "Medium",
  projectId: "proj-001",
  projectName: "Dự án A",
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

const MOCK_BOARD: TaskKanbanBoardDto = {
  projectId: "proj-001",
  columns: [
    { status: "Todo", tasks: [MOCK_TASK] },
    { status: "In Progress", tasks: [] },
    { status: "In Review", tasks: [] },
    { status: "Done", tasks: [] },
    { status: "Cancelled", tasks: [] },
  ],
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

function makeDataTransfer(taskId: string) {
  const store = new Map<string, string>();
  store.set("text/plain", taskId);
  return {
    setData: (k: string, v: string) => store.set(k, v),
    getData: (k: string) => store.get(k) ?? "",
    effectAllowed: "",
  };
}

describe("TaskKanbanPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: không có view-kanban:task ────────────────────────────────────
  it("renders forbidden state without view-kanban:task", () => {
    setCapabilities({});
    renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(taskCollabApi.getKanbanBoard).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH: hiển thị cột + card ──────────────────────────────────────────
  it("renders columns with task cards", async () => {
    setCapabilities({ "view-kanban:task": true });
    vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
    renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
    expect(screen.getByTestId("kanban-column-Todo")).toBeInTheDocument();
  });

  // ── Kéo-thả bị TẮT khi thiếu update-status:task ─────────────────────────────
  it("disables drag on cards without update-status:task", async () => {
    setCapabilities({ "view-kanban:task": true });
    vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
    renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
    const card = screen.getByText("Chuẩn bị báo cáo tuần").closest("div[draggable]");
    expect(card).toHaveAttribute("draggable", "false");
    expect(screen.getByText(/chỉ có thể xem/i)).toBeInTheDocument();
  });

  // ── Kéo-thả optimistic move + rollback khi API lỗi ──────────────────────────
  it("optimistically moves a card then rolls back when move API fails", async () => {
    setCapabilities({ "view-kanban:task": true, "update-status:task": true });
    vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
    let rejectMove!: (err: unknown) => void;
    vi.mocked(taskCollabApi.moveTask).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectMove = reject;
        }),
    );
    renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
    await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

    const todoColumn = screen.getByTestId("kanban-column-Todo");
    const inProgressColumn = screen.getByTestId("kanban-column-In Progress");
    const dataTransfer = makeDataTransfer("task-001");

    fireEvent.drop(inProgressColumn, { dataTransfer });

    // Optimistic: card dời sang cột "In Progress" NGAY, không đợi API.
    await waitFor(() =>
      expect(inProgressColumn.textContent?.includes("Chuẩn bị báo cáo tuần")).toBe(true),
    );

    rejectMove(new ApiError({ status: 409, code: "CONFLICT", message: "invalid transition" }));

    // Rollback: card trở lại cột "Todo".
    await waitFor(() =>
      expect(todoColumn.textContent?.includes("Chuẩn bị báo cáo tuần")).toBe(true),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  // ── Error state với retry ───────────────────────────────────────────────────
  it("shows error state with retry on load failure", async () => {
    setCapabilities({ "view-kanban:task": true });
    vi.mocked(taskCollabApi.getKanbanBoard).mockRejectedValue(new Error("network"));
    renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải kanban board/i)).toBeInTheDocument(),
    );
  });
});
