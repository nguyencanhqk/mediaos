import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, useAuthStore, taskCoreApi } from "@mediaos/web-core";
import type { MyTaskItemDto, TaskActionResponseDto } from "@mediaos/contracts";
import { MyTasksPage } from "./MyTasksPage";

/**
 * S20-TASK-QUICKEDIT-1 (US-TASK-NV-03 + NV-08) — đổi trạng thái và hạn NGAY TRÊN DÒNG «Việc của tôi».
 *
 * Ca từ chối viết TRƯỚC (RED): thiếu cặp ⇒ badge/chip tĩnh; checklist bắt buộc ⇒ rollback + link tab
 * Checklist; 403 ⇒ rollback + câu chữ riêng; mất mạng ⇒ rollback + «Thử lại». Lưu đi ĐÚNG route
 * change-status / change-deadline (không PATCH).
 */
const { searchRef, navigateMock } = vi.hoisted(() => ({
  searchRef: { current: {} as Record<string, unknown> },
  navigateMock: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
      select({ location: { pathname: "/tasks/my-tasks", search: searchRef.current } }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      ...actual.taskCoreApi,
      getMyTasks: vi.fn(),
      changeStatus: vi.fn(),
      changeDeadline: vi.fn(),
      updateTask: vi.fn(),
    },
  };
});

// 06:30 Thứ Bảy 24/10/2026 giờ công ty (UTC+7).
const NOW = new Date("2026-10-23T23:30:00.000Z");

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

const OVER = makeItem({
  id: "t-over",
  title: "Nộp báo cáo",
  dueAt: "2026-10-24T02:00:00.000Z",
  isOverdue: true,
});
const PROG = makeItem({ id: "t-prog", title: "Viết tài liệu", status: "In Progress" });

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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MyTasksPage />
    </QueryClientProvider>,
  );
}

function actionResponse(task: MyTaskItemDto): TaskActionResponseDto {
  return { task, warnings: [] } as unknown as TaskActionResponseDto;
}

const group = (key: string) => screen.getByTestId(`my-tasks-group-${key}`);
const statusTrigger = (id: string) => screen.getByTestId(`task-row-status-${id}`);

function chooseStatus(id: string, label: string) {
  fireEvent.click(statusTrigger(id));
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: label }));
}

async function renderWith(items: MyTaskItemDto[], caps: Record<string, boolean>) {
  setCapabilities({ "read:task": true, ...caps });
  vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(items);
  renderPage();
  await waitFor(() => expect(screen.getByText(items[0]?.title ?? "")).toBeInTheDocument());
}

describe("MyTasksPage — S20-TASK-QUICKEDIT-1 đổi trạng thái trên dòng", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    searchRef.current = {};
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("thiếu update-status:task ⇒ badge tĩnh, không có nút đổi trạng thái", async () => {
    await renderWith([OVER], {});
    expect(screen.queryByTestId("task-row-status-t-over")).not.toBeInTheDocument();
    expect(within(group("overdue")).getByText("Cần làm")).toBeInTheDocument();
  });

  it("chọn «Đang làm» ⇒ gọi change-status, badge đổi ngay và việc sang nhóm Đang làm (lạc quan)", async () => {
    // Việc Todo KHÔNG quá hạn (nhóm «Khác»): quá hạn đứng trên trạng thái khi nhóm, nên ca đổi nhóm
    // phải dùng việc chưa quá hạn.
    const todo = makeItem({ id: "t-todo", title: "Gọi khách", status: "Todo" });
    await renderWith([todo, PROG], { "update-status:task": true });
    vi.mocked(taskCoreApi.changeStatus).mockReturnValue(new Promise(() => {}));
    chooseStatus("t-todo", "Đang làm");
    // onMutate (huỷ query + vá dòng) là async ⇒ mutationFn chạy SAU nó.
    await waitFor(() =>
      expect(taskCoreApi.changeStatus).toHaveBeenCalledWith("t-todo", { status: "In Progress" }),
    );
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(within(group("inProgress")).getByText("Gọi khách")).toBeInTheDocument(),
    );
    expect(within(statusTrigger("t-todo")).getByText("Đang làm")).toBeInTheDocument();
  });

  it("việc quá hạn đổi sang Đang làm vẫn ở nhóm Quá hạn (cờ quá hạn của server đứng trước)", async () => {
    await renderWith([OVER], { "update-status:task": true });
    vi.mocked(taskCoreApi.changeStatus).mockReturnValue(new Promise(() => {}));
    chooseStatus("t-over", "Đang làm");
    await waitFor(() =>
      expect(within(statusTrigger("t-over")).getByText("Đang làm")).toBeInTheDocument(),
    );
    expect(within(group("overdue")).getByText("Nộp báo cáo")).toBeInTheDocument();
  });

  it("menu chỉ có chuyển hợp lệ: từ Đã hủy KHÔNG có Chờ review / Hoàn thành", async () => {
    searchRef.current = { showDone: 1 };
    await renderWith([makeItem({ id: "t-cxl", title: "Việc đã huỷ", status: "Cancelled" })], {
      "update-status:task": true,
    });
    fireEvent.click(statusTrigger("t-cxl"));
    const names = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual(["Cần làm", "Đang làm", "Đã hủy"]);
  });

  it("checklist bắt buộc chưa xong + chọn Hoàn thành ⇒ rollback, «Cần hoàn tất checklist» + link tab Checklist", async () => {
    await renderWith([PROG], { "update-status:task": true });
    vi.mocked(taskCoreApi.changeStatus).mockRejectedValue(
      new ApiError({
        status: 400,
        code: "VALIDATION-ERR-001",
        message:
          "TASK-ERR-CHECKLIST-REQUIRED: còn hạng mục checklist bắt buộc chưa hoàn thành — không thể chuyển Done.",
      }),
    );
    chooseStatus("t-prog", "Hoàn thành");
    expect(await screen.findByText("Cần hoàn tất checklist")).toBeInTheDocument();
    expect(within(group("inProgress")).getByText("Viết tài liệu")).toBeInTheDocument();
    expect(within(statusTrigger("t-prog")).getByText("Đang làm")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /mở checklist/i }));
    const nav = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => unknown;
    };
    expect(nav.search({})).toEqual({ task: "t-prog", taskTab: "checklist" });
  });

  it("403 (chỉ theo dõi) ⇒ rollback + «Bạn không có quyền đổi trạng thái việc này», danh sách vẫn hiện", async () => {
    await renderWith([OVER], { "update-status:task": true });
    vi.mocked(taskCoreApi.changeStatus).mockRejectedValue(
      new ApiError({ status: 403, code: "AUTH-ERR-FORBIDDEN", message: "Forbidden" }),
    );
    chooseStatus("t-over", "Đang làm");
    expect(
      await screen.findByText("Bạn không có quyền đổi trạng thái việc này"),
    ).toBeInTheDocument();
    expect(within(group("overdue")).getByText("Nộp báo cáo")).toBeInTheDocument();
    expect(within(statusTrigger("t-over")).getByText("Cần làm")).toBeInTheDocument();
  });

  it("mất mạng ⇒ rollback + «Thử lại» gửi lại đúng lựa chọn", async () => {
    await renderWith([OVER], { "update-status:task": true });
    vi.mocked(taskCoreApi.changeStatus)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(actionResponse({ ...OVER, status: "In Progress" }));
    chooseStatus("t-over", "Đang làm");
    const retry = await screen.findByRole("button", { name: /thử lại/i });
    expect(within(statusTrigger("t-over")).getByText("Cần làm")).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(taskCoreApi.changeStatus).toHaveBeenCalledTimes(2));
    expect(vi.mocked(taskCoreApi.changeStatus).mock.calls[1]).toEqual([
      "t-over",
      { status: "In Progress" },
    ]);
  });
});

describe("MyTasksPage — S20-TASK-QUICKEDIT-1 mốc hạn trên dòng", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    searchRef.current = {};
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("thiếu update-deadline:task ⇒ không có nút chọn hạn", async () => {
    await renderWith([OVER], { "update-status:task": true });
    expect(screen.queryByTestId("task-row-deadline-t-over")).not.toBeInTheDocument();
  });

  it("«Ngày mai» ⇒ change-deadline 25/10 17:00 giờ công ty (10:00 UTC), không PATCH", async () => {
    await renderWith([OVER], { "update-deadline:task": true });
    vi.mocked(taskCoreApi.changeDeadline).mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByTestId("task-row-deadline-t-over"));
    fireEvent.click(screen.getByTestId("task-row-deadline-t-over-preset-tomorrow"));
    await waitFor(() =>
      expect(taskCoreApi.changeDeadline).toHaveBeenCalledWith("t-over", {
        dueAt: "2026-10-25T10:00:00.000Z",
      }),
    );
    expect(taskCoreApi.updateTask).not.toHaveBeenCalled();
    // Lạc quan: hạn tương lai ⇒ rời nhóm Quá hạn ngay.
    await waitFor(() =>
      expect(screen.getByTestId("my-tasks-group-count-overdue")).toHaveTextContent("0"),
    );
  });

  it("«Xoá hạn» ⇒ change-deadline null, việc rời nhóm Quá hạn", async () => {
    await renderWith([OVER], { "update-deadline:task": true });
    vi.mocked(taskCoreApi.changeDeadline).mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByTestId("task-row-deadline-t-over"));
    fireEvent.click(screen.getByTestId("task-row-deadline-t-over-clear"));
    await waitFor(() =>
      expect(taskCoreApi.changeDeadline).toHaveBeenCalledWith("t-over", { dueAt: null }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("my-tasks-group-count-overdue")).toHaveTextContent("0"),
    );
  });

  it("start_at sau mốc ⇒ lỗi CHECK của server: rollback + thông điệp dễ hiểu", async () => {
    await renderWith([OVER], { "update-deadline:task": true });
    vi.mocked(taskCoreApi.changeDeadline).mockRejectedValue(
      new ApiError({
        status: 400,
        code: "VALIDATION-ERR-001",
        message: "TASK-ERR-INVALID-DATE-RANGE: hạn chót không được sớm hơn ngày bắt đầu.",
      }),
    );
    fireEvent.click(screen.getByTestId("task-row-deadline-t-over"));
    fireEvent.click(screen.getByTestId("task-row-deadline-t-over-preset-tomorrow"));
    expect(await screen.findByText(/sớm hơn ngày bắt đầu/i)).toBeInTheDocument();
    expect(within(group("overdue")).getByText("Nộp báo cáo")).toBeInTheDocument();
  });

  it("403 ⇒ rollback + báo không có quyền đổi hạn", async () => {
    await renderWith([OVER], { "update-deadline:task": true });
    vi.mocked(taskCoreApi.changeDeadline).mockRejectedValue(
      new ApiError({ status: 403, code: "AUTH-ERR-FORBIDDEN", message: "Forbidden" }),
    );
    fireEvent.click(screen.getByTestId("task-row-deadline-t-over"));
    fireEvent.click(screen.getByTestId("task-row-deadline-t-over-clear"));
    expect(await screen.findByText("Bạn không có quyền đổi hạn việc này")).toBeInTheDocument();
    expect(within(group("overdue")).getByText("Nộp báo cáo")).toBeInTheDocument();
  });
});
