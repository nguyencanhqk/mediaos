/**
 * S20-TASK-QUICKADD-1 (US-TASK-QL-06 tiêu chí 4) — «Tạo công việc» trên board mở form Tạo với dự án
 * điền sẵn, để board chế độ status (không có ô «+» đáy cột) cũng tạo được việc; lưu xong thẻ hiện
 * ngay (khoá kanban của đúng dự án được làm mới, không cần F5).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCollabApi, taskCoreApi, authApi } from "@mediaos/web-core";
import type { TaskKanbanBoardDto, TaskKanbanCardDto } from "@mediaos/contracts";
import { TaskKanbanPage } from "./TaskKanbanPage";

vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCollabApi: { getKanbanBoard: vi.fn(), moveTask: vi.fn(), moveTaskState: vi.fn() },
    taskCoreApi: { createTask: vi.fn() },
    taskProjectApi: { listProjects: vi.fn().mockResolvedValue([]) },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
    },
    authApi: { ...actual.authApi, me: vi.fn() },
  };
});

const TASK = {
  id: "task-001",
  title: "Việc có sẵn",
  status: "Todo",
  projectId: "proj-001",
  mainAssigneeEmployeeId: null,
  assigneeName: null,
  dueAt: null,
  isOverdue: false,
} as unknown as TaskKanbanCardDto;

const STATUS_BOARD: TaskKanbanBoardDto = {
  projectId: "proj-001",
  columns: [
    { columnMode: "status", status: "Todo", tasks: [TASK] },
    { columnMode: "status", status: "Done", tasks: [] },
  ],
};

const EMPTY_STATUS_BOARD: TaskKanbanBoardDto = {
  projectId: "proj-001",
  columns: [{ columnMode: "status", status: "Todo", tasks: [] }],
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

function renderBoard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Vỏ workspace đã tải chi tiết dự án ⇒ tên dự án lấy từ cache, không thêm request.
  client.setQueryData(["tasks", "projects", "detail", "proj-001"], {
    id: "proj-001",
    name: "Dự án A",
  });
  const view = render(
    <QueryClientProvider client={client}>
      <TaskKanbanPage projectId="proj-001" />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

describe("TaskKanbanPage — «Tạo công việc» với dự án điền sẵn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.mocked(authApi.me).mockResolvedValue({ employee: null } as never);
  });

  it("thiếu create:task ⇒ không có nút", async () => {
    setCapabilities({ "view-kanban:task": true });
    vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(STATUS_BOARD);
    renderBoard();
    await screen.findByText("Việc có sẵn");
    expect(screen.queryByTestId("kanban-create-task")).not.toBeInTheDocument();
  });

  it("board chế độ status: mở form với dự án đã chọn; lưu xong làm mới board của dự án", async () => {
    setCapabilities({ "view-kanban:task": true, "create:task": true });
    vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(STATUS_BOARD);
    vi.mocked(taskCoreApi.createTask).mockResolvedValue({
      id: "t-new",
      projectId: "proj-001",
    } as never);
    const { client } = renderBoard();
    const spy = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(await screen.findByTestId("kanban-create-task"));
    const project = document.getElementById("task-project") as HTMLSelectElement;
    expect(project).toHaveValue("proj-001");
    expect(screen.getByRole("option", { name: "Dự án A" })).toBeInTheDocument();

    fireEvent.change(document.getElementById("task-title") as HTMLInputElement, {
      target: { value: "Việc mới trên board" },
    });
    fireEvent.submit(document.getElementById("task-core-form") as HTMLFormElement);

    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(taskCoreApi.createTask).mock.calls[0]?.[0]).toMatchObject({
      title: "Việc mới trên board",
      projectId: "proj-001",
    });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ["tasks", "kanban", "proj-001"] }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("board chế độ status CHƯA có việc nào ⇒ trạng thái rỗng vẫn có «Tạo công việc»", async () => {
    setCapabilities({ "view-kanban:task": true, "create:task": true });
    vi.mocked(taskCollabApi.getKanbanBoard).mockResolvedValue(EMPTY_STATUS_BOARD);
    renderBoard();
    fireEvent.click(await screen.findByTestId("kanban-create-task"));
    expect(document.getElementById("task-project")).toHaveValue("proj-001");
  });
});
