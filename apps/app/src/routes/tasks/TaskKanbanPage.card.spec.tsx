/**
 * S20-TASK-FEDEBT-1 — thẻ board sau khi tách khỏi TaskKanbanPage:
 * - Thẻ mở-được (role=button) KHÔNG chứa phần tử tương tác nào (nút ⋯, nút bung việc con nằm cạnh,
 *   không lồng) — nút lồng trong role=button bị trình đọc màn hình gộp mất tên và không bấm riêng được.
 * - Enter/Space trên thẻ mở việc; bấm nút cạnh thẻ KHÔNG mở việc.
 * - Server từ chối đổi cột ⇒ lý do hiện qua thông báo nổi dùng chung (S20-FE-TOAST-1), cho CẢ kéo-thả
 *   lẫn menu ⋯ — không còn dòng lỗi riêng ở đầu board (người đang ở cột xa bên phải không thấy).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCollabApi, ApiError } from "@mediaos/web-core";
import { Toaster, toast } from "@mediaos/ui";
import type { TaskKanbanBoardDto, TaskKanbanCardDto } from "@mediaos/contracts";
import { TaskKanbanPage } from "./TaskKanbanPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCollabApi: { getKanbanBoard: vi.fn(), moveTask: vi.fn(), moveTaskState: vi.fn() },
  };
});

const TASK: TaskKanbanCardDto = {
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
  subtaskTotal: 3,
  subtaskDone: 1,
};

const STATUS_BOARD: TaskKanbanBoardDto = {
  projectId: "proj-001",
  columns: [
    { columnMode: "status", status: "Todo", tasks: [TASK] },
    { columnMode: "status", status: "In Progress", tasks: [] },
    { columnMode: "status", status: "Done", tasks: [] },
  ],
};

const STATE_BOARD: TaskKanbanBoardDto = {
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
      tasks: [{ ...TASK, stateId: "st-1" }],
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

const INTERACTIVE = "button, a[href], input, select, textarea, [role='button'], [tabindex]";

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

function renderBoard(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
}

function rejectNextMove(api: "moveTask" | "moveTaskState"): (err: unknown) => void {
  let reject!: (err: unknown) => void;
  const pending = new Promise<never>((_resolve, rej) => {
    reject = rej;
  });
  if (api === "moveTask") vi.mocked(taskCollabApi.moveTask).mockReturnValue(pending);
  else vi.mocked(taskCollabApi.moveTaskState).mockReturnValue(pending);
  return (err) => reject(err);
}

function toastRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Thông báo" });
}

function dataTransfer(taskId: string) {
  const store = new Map<string, string>([["text/plain", taskId]]);
  return {
    setData: (k: string, v: string) => store.set(k, v),
    getData: (k: string) => store.get(k) ?? "",
    effectAllowed: "",
  };
}

describe("thẻ board — không lồng nút trong role=button (S20-TASK-FEDEBT-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toast.clear();
    setCapabilities({ "view-kanban:task": true, "update-status:task": true });
    vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(STATUS_BOARD);
  });
  afterEach(() => toast.clear());

  it("thẻ mở-được không chứa phần tử tương tác; nút ⋯ và nút bung việc con nằm CẠNH thẻ, cùng khối thẻ", async () => {
    renderBoard(<TaskKanbanPage projectId="proj-001" onOpenTask={vi.fn()} />);
    const card = await screen.findByTestId("kanban-card-task-001");
    expect(card).toHaveAttribute("role", "button");

    expect(card.querySelectorAll(INTERACTIVE)).toHaveLength(0);
    const trigger = screen.getByTestId("kanban-card-move-trigger-task-001");
    const toggle = screen.getByTestId("kanban-card-subtasks-toggle-task-001");
    expect(card.contains(trigger)).toBe(false);
    expect(card.contains(toggle)).toBe(false);
    // Vẫn thuộc cùng khối thẻ (kéo cả khối, focus trả về đúng thẻ) — hợp đồng data-kanban-card.
    const block = card.closest("[data-kanban-card]");
    expect(block).toHaveAttribute("data-kanban-card", "task-001");
    expect(block?.contains(trigger)).toBe(true);
    expect(block?.contains(toggle)).toBe(true);
  });

  it("Enter và Space trên thẻ mở việc; bấm nút bung việc con hay nút ⋯ KHÔNG mở việc", async () => {
    const onOpenTask = vi.fn();
    renderBoard(<TaskKanbanPage projectId="proj-001" onOpenTask={onOpenTask} />);
    const card = await screen.findByTestId("kanban-card-task-001");

    fireEvent.keyDown(card, { key: " " });
    expect(onOpenTask).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpenTask).toHaveBeenCalledTimes(2);
    expect(onOpenTask).toHaveBeenLastCalledWith("task-001");

    fireEvent.click(screen.getByTestId("kanban-card-subtasks-toggle-task-001"));
    fireEvent.click(screen.getByTestId("kanban-card-move-trigger-task-001"));
    expect(onOpenTask).toHaveBeenCalledTimes(2);
  });

  it("thẻ vẫn kéo được cả khối (draggable nằm ở khối chứa thẻ)", async () => {
    renderBoard(<TaskKanbanPage projectId="proj-001" onOpenTask={vi.fn()} />);
    const card = await screen.findByTestId("kanban-card-task-001");
    expect(card.closest("[data-kanban-card]")).toHaveAttribute("draggable", "true");
  });
});

describe("server từ chối đổi cột ⇒ thông báo nổi (S20-TASK-FEDEBT-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toast.clear();
  });
  afterEach(() => toast.clear());

  it("kéo-thả bị từ chối (409) ⇒ thẻ về chỗ cũ + lý do trong vùng thông báo, không có dòng lỗi riêng trên board", async () => {
    setCapabilities({ "view-kanban:task": true, "update-status:task": true });
    vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(STATUS_BOARD);
    const reject = rejectNextMove("moveTask");
    renderBoard(<TaskKanbanPage projectId="proj-001" />);
    await screen.findByTestId("kanban-card-task-001");

    fireEvent.drop(screen.getByTestId("kanban-column-In Progress"), {
      dataTransfer: dataTransfer("task-001"),
    });
    await waitFor(() => expect(taskCollabApi.moveTask).toHaveBeenCalled());
    reject(new ApiError({ status: 409, code: "CONFLICT", message: "invalid transition" }));

    await waitFor(() =>
      expect(toastRegion()).toHaveTextContent(/không thể chuyển sang trạng thái này/i),
    );
    const todo = screen.getByTestId("kanban-column-Todo");
    expect(within(todo).getByTestId("kanban-card-task-001")).toBeInTheDocument();
    // Một lời báo duy nhất: không còn <p role=alert> riêng của board ngoài vùng thông báo.
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(toastRegion().contains(alerts[0] ?? null)).toBe(true);
  });

  it("menu ⋯ bị từ chối (403, board pipeline) ⇒ cùng con đường: lý do quyền trong vùng thông báo", async () => {
    setCapabilities({ "view-kanban:task": true, "update-state:task": true });
    vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(STATE_BOARD);
    const reject = rejectNextMove("moveTaskState");
    renderBoard(<TaskKanbanPage projectId="proj-001" />);

    fireEvent.click(await screen.findByTestId("kanban-card-move-trigger-task-001"));
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Hậu Kỳ" }));
    await waitFor(() => expect(taskCollabApi.moveTaskState).toHaveBeenCalled());
    reject(new ApiError({ status: 403, code: "FORBIDDEN", message: "missing update-status" }));

    await waitFor(() => expect(toastRegion()).toHaveTextContent(/không có quyền/i));
    const source = screen.getByTestId("kanban-state-column-st-1");
    await waitFor(() =>
      expect(within(source).getByTestId("kanban-card-task-001")).toBeInTheDocument(),
    );
  });

  it("từ chối liên tiếp cùng lý do ⇒ gộp thành MỘT thông báo (không chất đống)", async () => {
    setCapabilities({ "view-kanban:task": true, "update-status:task": true });
    vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(STATUS_BOARD);
    vi.mocked(taskCollabApi.moveTask).mockRejectedValue(
      new ApiError({ status: 409, code: "CONFLICT", message: "invalid transition" }),
    );
    renderBoard(<TaskKanbanPage projectId="proj-001" />);
    await screen.findByTestId("kanban-card-task-001");

    for (let i = 0; i < 2; i += 1) {
      fireEvent.drop(screen.getByTestId("kanban-column-Done"), {
        dataTransfer: dataTransfer("task-001"),
      });
      await waitFor(() => expect(taskCollabApi.moveTask).toHaveBeenCalledTimes(i + 1));
      await waitFor(() =>
        expect(
          within(screen.getByTestId("kanban-column-Todo")).getByTestId("kanban-card-task-001"),
        ).toBeInTheDocument(),
      );
    }
    await waitFor(() => expect(toastRegion()).toHaveTextContent("×2"));
    expect(
      within(toastRegion()).getAllByText(/không thể chuyển sang trạng thái này/i),
    ).toHaveLength(1);
  });
});
