import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCollabApi, ApiError } from "@mediaos/web-core";
import { TaskKanbanPage } from "./TaskKanbanPage";
import type { TaskKanbanBoardDto, TaskKanbanCardDto } from "@mediaos/contracts";

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

const BASE_TASK: TaskKanbanCardDto = {
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

// Card giàu tín hiệu (S5-FE-TASK-5) — commentCount/attachmentCount/checklistDone/checklistTotal > 0.
const TASK_WITH_SIGNALS: TaskKanbanCardDto = {
  ...BASE_TASK,
  id: "task-002",
  title: "Soạn thảo hợp đồng",
  mainAssigneeEmployeeId: "emp-002",
  assigneeName: "Trần Thị B",
  commentCount: 3,
  attachmentCount: 2,
  checklistDone: 1,
  checklistTotal: 4,
};

// Task chưa giao (mainAssigneeEmployeeId null) — dùng cho lọc "Chưa giao".
const TASK_UNASSIGNED: TaskKanbanCardDto = {
  ...BASE_TASK,
  id: "task-003",
  title: "Việc chưa có người nhận",
  mainAssigneeEmployeeId: null,
  assigneeName: null,
};

// Task Done — style muted + gạch tiêu đề.
const TASK_DONE: TaskKanbanCardDto = {
  ...BASE_TASK,
  id: "task-004",
  title: "Đã hoàn thành xong việc",
  status: "Done",
  mainAssigneeEmployeeId: "emp-001",
  assigneeName: "Nguyễn Văn A",
};

const MOCK_BOARD: TaskKanbanBoardDto = {
  projectId: "proj-001",
  columns: [
    {
      columnMode: "status",
      status: "Todo",
      tasks: [BASE_TASK, TASK_WITH_SIGNALS, TASK_UNASSIGNED],
    },
    { columnMode: "status", status: "In Progress", tasks: [] },
    { columnMode: "status", status: "In Review", tasks: [] },
    { columnMode: "status", status: "Done", tasks: [TASK_DONE] },
    { columnMode: "status", status: "Cancelled", tasks: [] },
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

  // ── S5-FE-TASK-5: badge tín hiệu (comment/attachment/checklist) ─────────────
  describe("card signal badges", () => {
    it("renders comment/attachment/checklist badges only when counts > 0", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Soạn thảo hợp đồng")).toBeInTheDocument());

      const signalCard = screen.getByTestId("kanban-card-task-002");
      expect(within(signalCard).getByTestId("kanban-card-badge-comments")).toHaveTextContent("3");
      expect(within(signalCard).getByTestId("kanban-card-badge-attachments")).toHaveTextContent(
        "2",
      );
      expect(within(signalCard).getByTestId("kanban-card-badge-checklist")).toHaveTextContent(
        "1/4",
      );

      // Card với counts = 0/undefined KHÔNG render badge nào.
      const zeroCard = screen.getByTestId("kanban-card-task-001");
      expect(within(zeroCard).queryByTestId("kanban-card-badge-comments")).not.toBeInTheDocument();
      expect(
        within(zeroCard).queryByTestId("kanban-card-badge-attachments"),
      ).not.toBeInTheDocument();
      expect(within(zeroCard).queryByTestId("kanban-card-badge-checklist")).not.toBeInTheDocument();
    });

    it("shows avatar initials for assignee instead of raw name text", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

      const card = screen.getByTestId("kanban-card-task-001");
      // initialsFrom("Nguyễn Văn A") = "NA" — thay cho hiển thị chữ tên đầy đủ trên card.
      expect(within(card).getByText("NA")).toBeInTheDocument();
      expect(within(card).queryByText("Nguyễn Văn A")).not.toBeInTheDocument();
    });

    it("applies muted + strikethrough style for Done/Cancelled cards", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Đã hoàn thành xong việc")).toBeInTheDocument());

      const doneTitle = screen.getByText("Đã hoàn thành xong việc");
      expect(doneTitle).toHaveClass("line-through");

      const todoTitle = screen.getByText("Chuẩn bị báo cáo tuần");
      expect(todoTitle).not.toHaveClass("line-through");
    });
  });

  // ── S5-FE-TASK-5: lọc theo assignee/"Chưa giao" ──────────────────────────────
  describe("assignee filter rail", () => {
    it("filters cards by selected assignee and by unassigned, resettable via 'Tất cả'", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

      const todoColumn = screen.getByTestId("kanban-column-Todo");
      // Mặc định ("Tất cả") — cả 3 task trong cột Todo đều hiển thị.
      expect(within(todoColumn).getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument();
      expect(within(todoColumn).getByText("Soạn thảo hợp đồng")).toBeInTheDocument();
      expect(within(todoColumn).getByText("Việc chưa có người nhận")).toBeInTheDocument();

      // Lọc theo emp-002 (Trần Thị B) — chỉ còn task-002 trong cột.
      fireEvent.click(screen.getByTestId("kanban-filter-assignee-emp-002"));
      await waitFor(() =>
        expect(
          within(screen.getByTestId("kanban-column-Todo")).queryByText("Chuẩn bị báo cáo tuần"),
        ).not.toBeInTheDocument(),
      );
      expect(
        within(screen.getByTestId("kanban-column-Todo")).getByText("Soạn thảo hợp đồng"),
      ).toBeInTheDocument();

      // Lọc "Chưa giao" — chỉ còn task-003.
      fireEvent.click(screen.getByTestId("kanban-filter-unassigned"));
      await waitFor(() =>
        expect(
          within(screen.getByTestId("kanban-column-Todo")).getByText("Việc chưa có người nhận"),
        ).toBeInTheDocument(),
      );
      expect(
        within(screen.getByTestId("kanban-column-Todo")).queryByText("Soạn thảo hợp đồng"),
      ).not.toBeInTheDocument();

      // "Tất cả" — reset về đầy đủ.
      fireEvent.click(screen.getByTestId("kanban-filter-all"));
      await waitFor(() =>
        expect(
          within(screen.getByTestId("kanban-column-Todo")).getByText("Chuẩn bị báo cáo tuần"),
        ).toBeInTheDocument(),
      );
    });

    it("keeps column header count at the original total when a filter is applied (SPEC-06 §13.8)", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

      // Cột Todo có 3 task gốc.
      expect(screen.getByTestId("kanban-column-count-Todo")).toHaveTextContent("3");

      // Lọc theo emp-002 (chỉ 1 task khớp) — số đếm header VẪN là 3 (tổng gốc, không đổi theo bộ lọc).
      fireEvent.click(screen.getByTestId("kanban-filter-assignee-emp-002"));
      await waitFor(() =>
        expect(
          within(screen.getByTestId("kanban-column-Todo")).queryByText("Chuẩn bị báo cáo tuần"),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId("kanban-column-count-Todo")).toHaveTextContent("3");
    });
  });
});
