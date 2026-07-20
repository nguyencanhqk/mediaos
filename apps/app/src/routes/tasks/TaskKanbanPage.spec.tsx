import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCollabApi, ApiError } from "@mediaos/web-core";
import { TaskKanbanPage } from "./TaskKanbanPage";
import { DEFAULT_WORKSPACE_FILTERS, type WorkspaceTaskFilters } from "./workspace-constants";
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
      // S5-TASK-PIPELINE-1 — kéo thẻ board pipeline (đổi CỘT).
      moveTaskState: vi.fn(),
    },
    taskStatesApi: {
      listStates: vi.fn().mockResolvedValue([]),
      createState: vi.fn(),
      updateState: vi.fn(),
      deleteState: vi.fn(),
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

// S5-TASK-SUBTASK-1 — board ISOLATED riêng cho test badge subtask (KHÔNG đụng MOCK_BOARD dùng chung
// bởi nhiều test đếm cột/rail ở trên — thêm task vào đó sẽ làm lệch số đếm của các test khác).
const TASK_WITH_SUBTASKS: TaskKanbanCardDto = {
  ...BASE_TASK,
  id: "task-101",
  title: "Việc có việc con",
  subtaskTotal: 4,
  subtaskDone: 1,
};

const TASK_ZERO_SIGNALS: TaskKanbanCardDto = {
  ...BASE_TASK,
  id: "task-102",
  title: "Việc không tín hiệu nào",
};

const MOCK_BOARD_WITH_SUBTASKS: TaskKanbanBoardDto = {
  projectId: "proj-001",
  columns: [
    { columnMode: "status", status: "Todo", tasks: [TASK_WITH_SUBTASKS, TASK_ZERO_SIGNALS] },
    { columnMode: "status", status: "In Progress", tasks: [] },
    { columnMode: "status", status: "In Review", tasks: [] },
    { columnMode: "status", status: "Done", tasks: [] },
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

/**
 * S5-TASK-WORKSPACE-1 — rail avatar multi-select + toolbar filter giờ là PROPS từ vỏ workspace;
 * harness giữ selection state như ProjectDetailPage thật (toggle Set + clear).
 */
function KanbanHarness({
  filters = DEFAULT_WORKSPACE_FILTERS,
}: {
  filters?: WorkspaceTaskFilters;
}) {
  const [selection, setSelection] = React.useState<ReadonlySet<string>>(new Set());
  const toggle = (value: string) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  return (
    <TaskKanbanPage
      projectId="proj-001"
      filters={filters}
      assigneeSelection={selection}
      onToggleAssignee={toggle}
      onClearAssignees={() => setSelection(new Set())}
    />
  );
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

    // S5-TASK-SUBTASK-1 — badge tiến độ việc con (D-34); early-return CŨ (chỉ xét 3 count) ẨN OAN
    // badge subtask của thẻ 0 comment/file/checklist — plan fe mục 3 bắt buộc pin ca này.
    it("renders the subtask badge even when comment/attachment/checklist are all 0 (early-return fix)", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD_WITH_SUBTASKS);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Việc có việc con")).toBeInTheDocument());

      const card = screen.getByTestId("kanban-card-task-101");
      expect(within(card).getByTestId("kanban-card-badge-subtasks")).toHaveTextContent("1/4");

      // Thẻ 0 CẢ BỐN count (kể cả subtask) — vẫn không render badge nào.
      const zeroCard = screen.getByTestId("kanban-card-task-102");
      expect(within(zeroCard).queryByTestId("kanban-card-badge-subtasks")).not.toBeInTheDocument();
      expect(within(zeroCard).queryByTestId("kanban-card-badge-comments")).not.toBeInTheDocument();
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

  // ── S5-TASK-WORKSPACE-1: rail avatar multi-select + toolbar filter (props từ vỏ) ──
  describe("assignee rail (multi-select) + workspace filters", () => {
    it("bật/tắt NHIỀU người + 'Chưa giao' cùng lúc, reset qua nút 'Tất cả'", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<KanbanHarness />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

      const todoColumn = screen.getByTestId("kanban-column-Todo");
      // Mặc định (selection rỗng) — cả 3 task trong cột Todo đều hiển thị.
      expect(within(todoColumn).getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument();
      expect(within(todoColumn).getByText("Soạn thảo hợp đồng")).toBeInTheDocument();
      expect(within(todoColumn).getByText("Việc chưa có người nhận")).toBeInTheDocument();

      // Bật emp-002 — chỉ còn task-002.
      fireEvent.click(screen.getByTestId("assignee-rail-item-emp-002"));
      await waitFor(() =>
        expect(
          within(screen.getByTestId("kanban-column-Todo")).queryByText("Chuẩn bị báo cáo tuần"),
        ).not.toBeInTheDocument(),
      );
      expect(
        within(screen.getByTestId("kanban-column-Todo")).getByText("Soạn thảo hợp đồng"),
      ).toBeInTheDocument();

      // Bật THÊM "Chưa giao" (multi-select) — task-002 VÀ task-003 cùng hiển thị.
      fireEvent.click(screen.getByTestId("assignee-rail-unassigned"));
      await waitFor(() =>
        expect(
          within(screen.getByTestId("kanban-column-Todo")).getByText("Việc chưa có người nhận"),
        ).toBeInTheDocument(),
      );
      expect(
        within(screen.getByTestId("kanban-column-Todo")).getByText("Soạn thảo hợp đồng"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("kanban-column-Todo")).queryByText("Chuẩn bị báo cáo tuần"),
      ).not.toBeInTheDocument();

      // Tắt lại emp-002 (toggle) — chỉ còn "Chưa giao".
      fireEvent.click(screen.getByTestId("assignee-rail-item-emp-002"));
      await waitFor(() =>
        expect(
          within(screen.getByTestId("kanban-column-Todo")).queryByText("Soạn thảo hợp đồng"),
        ).not.toBeInTheDocument(),
      );

      // "Tất cả" — reset về đầy đủ.
      fireEvent.click(screen.getByTestId("assignee-rail-all"));
      await waitFor(() =>
        expect(
          within(screen.getByTestId("kanban-column-Todo")).getByText("Chuẩn bị báo cáo tuần"),
        ).toBeInTheDocument(),
      );
    });

    it("rail đếm đúng theo người (trước lọc assignee) — không triệt tiêu khi bật 1 người", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<KanbanHarness />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

      // emp-001 = task-001 (Todo) + task-004 (Done) = 2; emp-002 = 1; Chưa giao = 1.
      expect(screen.getByTestId("assignee-rail-count-emp-001")).toHaveTextContent("2");
      expect(screen.getByTestId("assignee-rail-count-emp-002")).toHaveTextContent("1");
      expect(screen.getByTestId("assignee-rail-count-unassigned")).toHaveTextContent("1");

      // Bật emp-002 — số đếm của emp-001 KHÔNG đổi (summary tính trước lọc assignee).
      fireEvent.click(screen.getByTestId("assignee-rail-item-emp-002"));
      await waitFor(() =>
        expect(
          within(screen.getByTestId("kanban-column-Todo")).queryByText("Chuẩn bị báo cáo tuần"),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId("assignee-rail-count-emp-001")).toHaveTextContent("2");
    });

    it("keeps column header count at the original total when a filter is applied (SPEC-06 §13.8)", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<KanbanHarness />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

      // Cột Todo có 3 task gốc.
      expect(screen.getByTestId("kanban-column-count-Todo")).toHaveTextContent("3");

      // Lọc theo emp-002 (chỉ 1 task khớp) — số đếm header VẪN là 3 (tổng gốc, không đổi theo bộ lọc).
      fireEvent.click(screen.getByTestId("assignee-rail-item-emp-002"));
      await waitFor(() =>
        expect(
          within(screen.getByTestId("kanban-column-Todo")).queryByText("Chuẩn bị báo cáo tuần"),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId("kanban-column-count-Todo")).toHaveTextContent("3");
    });

    it("áp filters toolbar từ props (q tìm không dấu) — card ngoài bộ lọc ẩn, rail đếm theo tập đã lọc", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<KanbanHarness filters={{ ...DEFAULT_WORKSPACE_FILTERS, q: "hop dong" }} />);
      await waitFor(() => expect(screen.getByText("Soạn thảo hợp đồng")).toBeInTheDocument());

      const todoColumn = screen.getByTestId("kanban-column-Todo");
      expect(within(todoColumn).queryByText("Chuẩn bị báo cáo tuần")).not.toBeInTheDocument();
      expect(within(todoColumn).queryByText("Việc chưa có người nhận")).not.toBeInTheDocument();
      // Rail chỉ còn emp-002 (1 task khớp q); emp-001 không có task khớp → không hiện trên rail.
      expect(screen.getByTestId("assignee-rail-count-emp-002")).toHaveTextContent("1");
      expect(screen.queryByTestId("assignee-rail-item-emp-001")).not.toBeInTheDocument();
      // Ẩn rail khi mount ĐỘC LẬP (không có onToggleAssignee) đã phủ ở test forbidden/allow cũ.
    });

    it("KHÔNG render rail khi mount độc lập không truyền onToggleAssignee", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());
      expect(screen.queryByTestId("assignee-rail")).not.toBeInTheDocument();
    });
  });

  // ── S5-TASK-PIPELINE-1 (lane fe) — board state-mode (cột pipeline tuỳ biến) ────
  describe("board columnMode:'state'", () => {
    const MOCK_STATE_BOARD: TaskKanbanBoardDto = {
      projectId: "proj-001",
      columns: [
        {
          columnMode: "state",
          stateId: "st-1",
          name: "Ý Tưởng",
          color: "#64748b",
          stateGroup: "unstarted",
          sortOrder: 1,
          taskCount: 1,
          tasks: [{ ...BASE_TASK, stateId: "st-1" }],
        },
        {
          columnMode: "state",
          stateId: "st-2",
          name: "Hậu Kỳ",
          color: "#3b82f6",
          stateGroup: "started",
          sortOrder: 2,
          taskCount: 0,
          tasks: [],
        },
      ],
    };

    it("render cột theo tên/màu/đếm từ CHÍNH cột + badge task_status trên thẻ (thấy được auto-map)", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_STATE_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Ý Tưởng")).toBeInTheDocument());

      expect(screen.getByText("Hậu Kỳ")).toBeInTheDocument();
      expect(screen.getByTestId("kanban-state-column-count-st-1")).toHaveTextContent("1");
      expect(screen.getByTestId("kanban-state-column-count-st-2")).toHaveTextContent("0");
      // Badge status ("Cần làm" = Todo) hiển thị TRÊN THẺ — tên cột fixture cố ý KHÁC nhãn status.
      const card = screen.getByTestId("kanban-card-task-001");
      expect(within(card).getByText("Cần làm")).toBeInTheDocument();
      // Thiếu update-state:task ⇒ thẻ KHÔNG draggable (dù có update-status hay không).
      expect(card.closest("div[draggable]") ?? card).toHaveAttribute("draggable", "false");
    });

    it("kéo thẻ gọi move-state {stateId} (KHÔNG phải move status) — optimistic rồi ROLLBACK khi 4xx", async () => {
      setCapabilities({
        "view-kanban:task": true,
        "update-state:task": true,
        "update-status:task": true,
      });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_STATE_BOARD);
      let rejectMove!: (err: unknown) => void;
      vi.mocked(taskCollabApi.moveTaskState).mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectMove = reject;
          }),
      );
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

      const sourceCol = screen.getByTestId("kanban-state-column-st-1");
      const targetCol = screen.getByTestId("kanban-state-column-st-2");
      fireEvent.drop(targetCol, { dataTransfer: makeDataTransfer("task-001") });

      // Optimistic: thẻ dời sang cột đích NGAY + đếm cột cập nhật.
      await waitFor(() =>
        expect(targetCol.textContent?.includes("Chuẩn bị báo cáo tuần")).toBe(true),
      );
      expect(vi.mocked(taskCollabApi.moveTaskState)).toHaveBeenCalledWith("task-001", {
        stateId: "st-2",
      });
      expect(vi.mocked(taskCollabApi.moveTask)).not.toHaveBeenCalled();

      rejectMove(
        new ApiError({ status: 403, code: "FORBIDDEN", message: "missing update-status" }),
      );

      // Rollback: thẻ về cột cũ + alert lỗi.
      await waitFor(() =>
        expect(sourceCol.textContent?.includes("Chuẩn bị báo cáo tuần")).toBe(true),
      );
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // Nút "Quản lý cột" đã CHUYỂN sang tab Cài đặt của dự án — gate + render test ở
    // ProjectDetailPage.spec.tsx (settings-manage-columns). Board không còn nút này.
    it("board KHÔNG còn nút Quản lý cột (đã chuyển sang tab Cài đặt)", async () => {
      setCapabilities({ "view-kanban:task": true, "update:project_state": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_STATE_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Ý Tưởng")).toBeInTheDocument());
      expect(screen.queryByTestId("kanban-manage-columns")).not.toBeInTheDocument();
    });

    // ── S5-TASK-BOARD-UX-1 — tạo nhanh đáy cột (hành vi chi tiết ở KanbanQuickCreate.spec) ────────
    it("cột pipeline có nút tạo nhanh khi đủ quyền create + update-state", async () => {
      setCapabilities({
        "view-kanban:task": true,
        "create:task": true,
        "update-state:task": true,
      });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_STATE_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Ý Tưởng")).toBeInTheDocument());
      // Mỗi cột có nút RIÊNG mang stateId của chính nó — tạo đúng cột người dùng bấm.
      expect(screen.getByTestId("kanban-quick-create-open-st-1")).toBeInTheDocument();
      expect(screen.getByTestId("kanban-quick-create-open-st-2")).toBeInTheDocument();
    });

    it("cột chế độ STATUS cũ KHÔNG có tạo nhanh — server từ chối stateId ở chế độ đó, task sẽ rơi sai cột", async () => {
      setCapabilities({
        "view-kanban:task": true,
        "create:task": true,
        "update-state:task": true,
      });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByTestId("kanban-column-Todo")).toBeInTheDocument());
      expect(screen.queryByText(/thêm công việc/i)).not.toBeInTheDocument();
    });
  });

  // ── S5-TASK-BOARD-UX-1 — bấm thẻ mở panel chi tiết ────────────────────────────
  describe("mở chi tiết từ thẻ", () => {
    it("bấm thẻ gọi onOpenTask với ĐÚNG id của thẻ", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      const onOpenTask = vi.fn();
      renderWithQuery(<TaskKanbanPage projectId="proj-001" onOpenTask={onOpenTask} />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

      fireEvent.click(screen.getByTestId("kanban-card-task-001"));
      expect(onOpenTask).toHaveBeenCalledWith("task-001");
    });

    it("mở được bằng bàn phím (Enter) — thẻ là div nên phải tự nối phím", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      const onOpenTask = vi.fn();
      renderWithQuery(<TaskKanbanPage projectId="proj-001" onOpenTask={onOpenTask} />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

      const card = screen.getByTestId("kanban-card-task-001");
      expect(card).toHaveAttribute("role", "button");
      expect(card).toHaveAttribute("tabindex", "0");
      fireEvent.keyDown(card, { key: "Enter" });
      expect(onOpenTask).toHaveBeenCalledWith("task-001");
    });

    it("KHÔNG truyền onOpenTask ⇒ thẻ không phải nút, không bẫy focus bàn phím", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Chuẩn bị báo cáo tuần")).toBeInTheDocument());

      const card = screen.getByTestId("kanban-card-task-001");
      expect(card).not.toHaveAttribute("role", "button");
      expect(card).not.toHaveAttribute("tabindex");
    });
  });
});
