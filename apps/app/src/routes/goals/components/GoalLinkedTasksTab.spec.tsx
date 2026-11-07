// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/i18n";

const nav = vi.hoisted(() => ({ navigate: vi.fn(), search: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => nav.navigate,
  useRouterState: ({ select }: { select: (s: { location: { search: object } }) => unknown }) =>
    select({ location: { search: nav.search } }),
}));

const perm = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock("@mediaos/web-core", () => {
  class ApiError extends Error {
    status: number;
    constructor(input: { message: string; status?: number }) {
      super(input.message);
      this.status = input.status ?? 0;
    }
  }
  return {
    ApiError,
    useCan: (action: string, resourceType: string) => !perm.denied.has(`${action}:${resourceType}`),
    goalApi: { listLinkedTasks: vi.fn(), linkTasks: vi.fn(), unlinkTask: vi.fn() },
    goalKeys: { linkedTasks: (id: string) => ["goals", "linked-tasks", id] },
    goalInvalidation: {
      linkTasks: () => [["goals", "list"]],
      taskProgress: (id: string) => [["goals", "detail", id]],
    },
    companyTimeZone: () => "Asia/Ho_Chi_Minh",
    localDateOf: (d: Date) => d.toISOString().slice(0, 10),
  };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("@mediaos/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mediaos/ui")>()),
  toast: toastMock,
}));

// Drawer thật có bộ test riêng (TaskFormDrawer.spec) — ở đây chỉ cần hợp đồng prop: initialValues + onSuccess.
const drawer = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("@/routes/tasks/TaskFormDrawer", () => ({
  TaskFormDrawer: (props: Record<string, unknown>) => {
    drawer.props = props;
    return <div data-testid="task-form-drawer" />;
  },
}));

import { ApiError, goalApi } from "@mediaos/web-core";
import { GoalLinkedTasksTab } from "./GoalLinkedTasksTab";

const listLinked = goalApi.listLinkedTasks as ReturnType<typeof vi.fn>;
const linkTasks = goalApi.linkTasks as ReturnType<typeof vi.fn>;

const GOAL = { id: "g-1", projectId: null, finalizedAt: null };

function task(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    taskCode: `TASK-${id}`,
    title: `Việc ${id}`,
    status: "Todo",
    projectId: null,
    projectName: null,
    mainAssigneeEmployeeId: "e-a",
    assigneeName: "An",
    dueAt: null,
    isOverdue: false,
    ...over,
  };
}

function renderTab(goal: unknown = GOAL) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  // Phần tử MỚI mỗi lần (cùng tham chiếu thì React bỏ qua render lại, mock router-state không được đọc lại).
  const ui = () => (
    <QueryClientProvider client={client}>
      <GoalLinkedTasksTab goal={goal as never} active />
    </QueryClientProvider>
  );
  const view = render(ui());
  return { spy, rerender: () => view.rerender(ui()) };
}

async function createdTask(created: unknown) {
  await waitFor(() => expect(drawer.props).not.toBeNull());
  (drawer.props?.onSuccess as (x: unknown) => void)(created);
}

beforeEach(() => {
  vi.clearAllMocks();
  perm.denied.clear();
  nav.search = {};
  drawer.props = null;
  listLinked.mockResolvedValue([
    task("1"),
    task("2", { status: "Done" }),
    task("3", {
      mainAssigneeEmployeeId: "e-b",
      assigneeName: "Bình",
      isOverdue: true,
      dueAt: "2026-10-01T00:00:00.000Z",
    }),
  ]);
});

describe("GoalLinkedTasksTab — nhóm theo người + quá hạn", () => {
  it("danh sách phẳng: việc quá hạn tô đỏ và đứng đầu", async () => {
    renderTab();
    await screen.findByText("Việc 1");
    const rows = screen.getAllByTestId(/^goal-linked-row-/);
    expect(rows[0]).toHaveAttribute("data-overdue", "true");
    expect(rows[0]).toHaveTextContent("Việc 3");
  });

  it("nút gạt «Nhóm theo người»: tên + x/y xong, nhóm có việc quá hạn đứng đầu", async () => {
    renderTab();
    await screen.findByText("Việc 1");
    fireEvent.click(screen.getByTestId("goal-linked-group-toggle"));
    const groups = screen.getByTestId("goal-linked-groups").querySelectorAll("section");
    expect(groups[0]).toHaveTextContent("Bình");
    expect(groups[0]).toHaveTextContent("0/1 xong");
    expect(groups[1]).toHaveTextContent("An");
    expect(groups[1]).toHaveTextContent("1/2 xong");
  });
});

describe("GoalLinkedTasksTab — «Thêm việc»: gate đủ ba cặp", () => {
  it("đủ quyền ⇒ có nút", async () => {
    renderTab();
    expect(await screen.findByTestId("goal-add-task-open")).toBeInTheDocument();
  });

  it.each(["update:goal", "update:task", "create:task"])(
    "thiếu %s ⇒ KHÔNG có nút",
    async (pair) => {
      perm.denied.add(pair);
      renderTab();
      await screen.findByText("Việc 1");
      expect(screen.queryByTestId("goal-add-task-open")).not.toBeInTheDocument();
    },
  );
});

describe("GoalLinkedTasksTab — «Thêm việc»: hai bước", () => {
  async function openAdd(goal: unknown = GOAL) {
    renderTab(goal);
    fireEvent.click(await screen.findByTestId("goal-add-task-open"));
  }

  it("mục tiêu cấp dự án ⇒ initialValues.projectId điền sẵn; mở drawer chưa gọi API ghi nào", async () => {
    await openAdd({ id: "g-1", projectId: "p-9", finalizedAt: null });
    expect(await screen.findByTestId("task-form-drawer")).toBeInTheDocument();
    expect(drawer.props?.initialValues).toEqual({ projectId: "p-9" });
    expect(linkTasks).not.toHaveBeenCalled();
  });

  it("bước 1 xong ⇒ gắn đúng {taskIds:[id mới]}, đóng drawer, báo thành công", async () => {
    linkTasks.mockResolvedValue({ warnings: [] });
    await openAdd();
    await createdTask(task("new"));
    await waitFor(() => expect(linkTasks).toHaveBeenCalledWith("g-1", { taskIds: ["new"] }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("task-form-drawer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-add-task-failure")).not.toBeInTheDocument();
  });

  it("bước gắn lỗi ⇒ «Đã tạo việc … nhưng chưa gắn», KHÔNG toast thành công; «Thử gắn lại» gắn được", async () => {
    linkTasks
      .mockRejectedValueOnce(new ApiError({ message: "Kỳ đã chốt", status: 403 }))
      .mockResolvedValueOnce({ warnings: [] });
    await openAdd();
    await createdTask(task("new"));
    const banner = await screen.findByTestId("goal-add-task-failure");
    expect(banner).toHaveTextContent("Đã tạo việc «Việc new» nhưng chưa gắn vào mục tiêu");
    expect(toastMock.success).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("goal-add-task-open-created"));
    expect(nav.navigate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("goal-add-task-retry"));
    await waitFor(() => expect(linkTasks).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByTestId("goal-add-task-failure")).not.toBeInTheDocument(),
    );
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });
});

describe("GoalLinkedTasksTab — đóng drawer việc làm mới tiến độ", () => {
  it("?task= có → mất ⇒ invalidate taskProgress; chưa đổi ⇒ không gọi", async () => {
    nav.search = { task: "t-1" };
    const { spy, rerender } = renderTab();
    await screen.findByText("Việc 1");
    expect(spy).not.toHaveBeenCalled();

    nav.search = {};
    rerender();
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["goals", "detail", "g-1"] }));
  });
});
