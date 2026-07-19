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

    it("nút Quản lý cột CHỈ hiện khi có quyền *:project_state", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_STATE_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() => expect(screen.getByText("Ý Tưởng")).toBeInTheDocument());
      expect(screen.queryByTestId("kanban-manage-columns")).not.toBeInTheDocument();

      clearCapabilities();
      setCapabilities({ "view-kanban:task": true, "update:project_state": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_STATE_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" />);
      await waitFor(() =>
        expect(screen.getAllByTestId("kanban-manage-columns").length).toBeGreaterThan(0),
      );
    });

    // ── S5-TASK-PROJROLE-1 (đợt C, D-24) — myProjectRole Owner/Manager nới hiện nút "Quản lý cột"
    // dù thiếu mọi pair *:project_state (grant hiện đều @Company — DORMANT, D-28) ─────────────────
    it("nút Quản lý cột HIỆN khi myProjectRole='Manager' dù thiếu pair *:project_state", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_STATE_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" myProjectRole="Manager" />);
      await waitFor(() => expect(screen.getByText("Ý Tưởng")).toBeInTheDocument());
      expect(screen.getByTestId("kanban-manage-columns")).toBeInTheDocument();
    });

    it("nút Quản lý cột ẨN khi myProjectRole='Member' và thiếu pair *:project_state", async () => {
      setCapabilities({ "view-kanban:task": true });
      vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(MOCK_STATE_BOARD);
      renderWithQuery(<TaskKanbanPage projectId="proj-001" myProjectRole="Member" />);
      await waitFor(() => expect(screen.getByText("Ý Tưởng")).toBeInTheDocument());
      expect(screen.queryByTestId("kanban-manage-columns")).not.toBeInTheDocument();
    });
  });
});
