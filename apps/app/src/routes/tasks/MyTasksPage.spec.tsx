import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi, authApi } from "@mediaos/web-core";
import { MyTasksPage } from "./MyTasksPage";
import type { MyTaskItemDto } from "@mediaos/contracts";

// S20-TASK-MYTASKS-1 — bộ lọc đọc từ location.search (URL) và ghi bằng navigate(to ".").
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
    taskCoreApi: { ...actual.taskCoreApi, getMyTasks: vi.fn(), createTask: vi.fn() },
    // S20-TASK-QUICKADD-1 — ô tạo nhanh đọc employeeId của tôi từ /auth/me.
    authApi: { ...actual.authApi, me: vi.fn() },
  };
});

// 06:30 ngày 24/10/2026 giờ công ty (UTC+7) = 23:30 ngày 23/10 UTC — máy UTC vẫn đang ở «hôm qua».
const NOW = new Date("2026-10-23T23:30:00.000Z");
const P = "11111111-2222-4333-8444-555555555555";

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

const ITEMS: MyTaskItemDto[] = [
  makeItem({
    id: "t-over",
    title: "Nộp báo cáo 9h",
    dueAt: "2026-10-24T02:00:00.000Z",
    isOverdue: true,
  }),
  makeItem({ id: "t-today", title: "Gọi khách 23h30", dueAt: "2026-10-24T16:30:00.000Z" }),
  makeItem({
    id: "t-soon",
    title: "Chuẩn bị họp",
    dueAt: "2026-10-25T03:00:00.000Z",
    source: "created",
  }),
  makeItem({ id: "t-prog", title: "Viết tài liệu", status: "In Progress", source: "watched" }),
  makeItem({ id: "t-done", title: "Việc đã xong", status: "Done" }),
];

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

type NavArg = { to: string; replace?: boolean; search: (prev: Record<string, unknown>) => unknown };
const lastNav = () => navigateMock.mock.calls.at(-1)?.[0] as NavArg;

function groupIds(): string[] {
  return screen.getAllByTestId(/^my-tasks-group-(?!count)/).map((el) => el.dataset.group ?? "");
}

describe("MyTasksPage — S20-TASK-MYTASKS-1", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    searchRef.current = {};
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("cổng read:task — đo bằng fetch thật", () => {
    async function wireRealFetch() {
      const actual = await vi.importActual<typeof import("@mediaos/web-core")>("@mediaos/web-core");
      vi.mocked(taskCoreApi.getMyTasks).mockImplementation(actual.taskCoreApi.getMyTasks);
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    it("thiếu read:task ⇒ màn không có quyền, 0 lời gọi API", async () => {
      const fetchMock = await wireRealFetch();
      setCapabilities({});
      renderWithQuery(<MyTasksPage />);
      expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("có read:task ⇒ đúng một lời gọi GET /tasks/my (spy fetch thấy được lời gọi)", async () => {
      const fetchMock = await wireRealFetch();
      setCapabilities({ "read:task": true });
      renderWithQuery(<MyTasksPage />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/tasks/my");
    });
  });

  it("chia nhóm theo giờ công ty, có số đếm, nhóm rỗng thu gọn, việc đã xong ẩn", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(ITEMS);
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText("Nộp báo cáo 9h")).toBeInTheDocument());

    expect(groupIds()).toEqual(["overdue", "today", "upcoming", "inProgress", "inReview", "other"]);
    const over = screen.getByTestId("my-tasks-group-overdue");
    expect(within(over).getByText("Nộp báo cáo 9h")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("my-tasks-group-today")).getByText("Gọi khách 23h30"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("my-tasks-group-upcoming")).getByText("Chuẩn bị họp"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("my-tasks-group-inProgress")).getByText("Viết tài liệu"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("my-tasks-group-count-overdue")).toHaveTextContent("1");

    const review = screen.getByTestId("my-tasks-group-inReview");
    expect(screen.getByTestId("my-tasks-group-count-inReview")).toHaveTextContent("0");
    expect(within(review).getByRole("button")).toHaveAttribute("aria-expanded", "false");
    expect(within(over).getByRole("button", { name: /quá hạn/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    expect(screen.queryByText("Việc đã xong")).not.toBeInTheDocument();
    expect(screen.queryByTestId("my-tasks-group-done")).not.toBeInTheDocument();
  });

  it("`showDone=1` trên URL ⇒ nhóm «Đã xong»; bật/tắt công tắc ghi URL và giữ `?task=`", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(ITEMS);
    searchRef.current = { showDone: 1 };
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText("Việc đã xong")).toBeInTheDocument());
    expect(
      within(screen.getByTestId("my-tasks-group-done")).getByText("Việc đã xong"),
    ).toBeInTheDocument();

    const toggle = screen.getByRole("checkbox", { name: /hiện việc đã xong/i });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(lastNav().to).toBe(".");
    expect(lastNav().search({ showDone: 1, task: P })).toEqual({ task: P });
  });

  it("bật «Hiện việc đã xong» ⇒ URL có showDone=1", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(ITEMS);
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText("Nộp báo cáo 9h")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: /hiện việc đã xong/i }));
    expect(lastNav().search({ task: P })).toEqual({ task: P, showDone: 1 });
  });

  it("chip «Theo dõi» trên URL (tải lại / mở lại link) ⇒ vẫn chỉ hiện việc theo dõi", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(ITEMS);
    searchRef.current = { source: "watched" };
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText("Viết tài liệu")).toBeInTheDocument());
    expect(screen.queryByText("Nộp báo cáo 9h")).not.toBeInTheDocument();
    expect(screen.queryByText("Chuẩn bị họp")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Theo dõi" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("bấm chip nguồn ⇒ ghi `source=` (push), giữ tham số khác; «Tất cả nguồn» bỏ khoá", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(ITEMS);
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText("Nộp báo cáo 9h")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Tôi tạo" }));
    expect(lastNav()).toMatchObject({ to: ".", replace: false });
    expect(lastNav().search({ task: P, showDone: 1 })).toEqual({
      task: P,
      showDone: 1,
      source: "created",
    });

    fireEvent.click(screen.getByRole("button", { name: "Tất cả nguồn" }));
    expect(lastNav().search({ source: "created" })).toEqual({});
  });

  it("`group=` trên URL ⇒ chỉ hiện nhóm đó; bấm chip nhóm ghi URL", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(ITEMS);
    searchRef.current = { group: "overdue" };
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText("Nộp báo cáo 9h")).toBeInTheDocument());
    expect(groupIds()).toEqual(["overdue"]);
    expect(screen.queryByText("Gọi khách 23h30")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Hôm nay/ }));
    expect(lastNav().search({ group: "overdue" })).toEqual({ group: "today" });
  });

  it("phím «/» focus ô lọc nhanh; không cướp khi đang gõ trong input/textarea/contenteditable", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(ITEMS);
    renderWithQuery(
      <>
        <MyTasksPage />
        <input data-testid="other-input" />
        <textarea data-testid="other-textarea" />
        <div data-testid="other-editable" contentEditable suppressContentEditableWarning>
          <span data-testid="editable-child">x</span>
        </div>
        <div role="dialog">
          <button type="button" data-testid="dialog-button">
            x
          </button>
        </div>
      </>,
    );
    await waitFor(() => expect(screen.getByText("Nộp báo cáo 9h")).toBeInTheDocument());
    const quick = screen.getByRole("searchbox", { name: /lọc nhanh theo tiêu đề/i });

    for (const id of ["other-input", "other-textarea", "editable-child", "dialog-button"]) {
      const target = screen.getByTestId(id);
      target.focus();
      const notPrevented = fireEvent.keyDown(target, { key: "/" });
      expect(notPrevented).toBe(true);
      expect(document.activeElement).not.toBe(quick);
    }

    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(quick);

    fireEvent.change(quick, { target: { value: "bao cao" } });
    expect(screen.getByText("Nộp báo cáo 9h")).toBeInTheDocument();
    expect(screen.queryByText("Viết tài liệu")).not.toBeInTheDocument();
  });

  it("mở việc ⇒ thêm `?task=` vào URL hiện tại (drawer dùng chung), giữ bộ lọc", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue(ITEMS);
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText("Nộp báo cáo 9h")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Nộp báo cáo 9h" }));
    expect(lastNav().search({ source: "assigned" })).toEqual({
      source: "assigned",
      task: "t-over",
    });
  });

  it("không có việc (hoặc chưa liên kết hồ sơ nhân viên) ⇒ trạng thái rỗng có hướng dẫn", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([]);
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText(/chưa có công việc nào/i)).toBeInTheDocument());
    expect(screen.getByText(/hồ sơ nhân viên/i)).toBeInTheDocument();
  });

  it("bộ lọc loại hết việc ⇒ rỗng-theo-bộ-lọc có nút «Xoá bộ lọc» giữ `?task=`", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([
      makeItem({ id: "a", title: "Việc được giao" }),
      makeItem({ id: "d", title: "Việc theo dõi đã xong", status: "Done", source: "watched" }),
    ]);
    searchRef.current = { source: "watched", group: "today" };
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText(/không có việc khớp bộ lọc/i)).toBeInTheDocument());
    expect(screen.queryByText("Việc được giao")).not.toBeInTheDocument();
    expect(screen.queryByText("Việc theo dõi đã xong")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /xoá bộ lọc/i }));
    expect(lastNav().search({ task: P, source: "watched", group: "today" })).toEqual({ task: P });
  });

  it("chỉ có việc đã xong (không bộ lọc nào) ⇒ không hiện nút «Xoá bộ lọc» vô nghĩa", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([makeItem({ id: "d", status: "Done" })]);
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText(/không có việc khớp bộ lọc/i)).toBeInTheDocument());
    expect(screen.getByText(/hiện việc đã xong/i, { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /xoá bộ lọc/i })).not.toBeInTheDocument();
  });

  it("lỗi tải ⇒ trạng thái lỗi", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getMyTasks).mockRejectedValue(new Error("Network error"));
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(screen.getByText(/không thể tải công việc/i)).toBeInTheDocument());
  });
});

// ── S20-TASK-QUICKADD-1 (US-TASK-NV-05) — tạo việc một dòng ngay đầu trang ─────────────────────────
describe("MyTasksPage — tạo nhanh việc cho chính mình", () => {
  const ME_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  function meResponse(employeeId: string | null) {
    return {
      id: "u1",
      companyId: "co-001",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      capabilities: {},
      mustSetupTwoFactor: false,
      employee: employeeId
        ? {
            id: employeeId,
            employeeCode: null,
            fullName: "Test User",
            departmentId: null,
            directManagerId: null,
            employmentStatus: "active",
          }
        : null,
    } as never;
  }

  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
    vi.clearAllMocks();
    searchRef.current = {};
    vi.mocked(taskCoreApi.getMyTasks).mockResolvedValue([]);
    vi.mocked(taskCoreApi.createTask).mockResolvedValue({ id: "t-new" } as never);
    vi.mocked(authApi.me).mockResolvedValue(meResponse(ME_ID));
  });

  it("phạm vi tạo Own, KHÔNG có read:employee: gõ + Enter ⇒ việc giao cho tôi, danh sách tải lại", async () => {
    setCapabilities({ "read:task": true, "create:task": true });
    renderWithQuery(<MyTasksPage />);
    // Trang rỗng vẫn có ô tạo nhanh — đó là lúc cần nó nhất.
    await waitFor(() => expect(screen.getByTestId("my-tasks-quick-add-input")).toBeEnabled());
    const input = screen.getByTestId("my-tasks-quick-add-input");
    fireEvent.change(input, { target: { value: "Gọi lại khách" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    expect(taskCoreApi.createTask).toHaveBeenCalledWith({
      title: "Gọi lại khách",
      assigneeEmployeeId: ME_ID,
    });
    await waitFor(() => expect(taskCoreApi.getMyTasks).toHaveBeenCalledTimes(2));
    expect(input).toHaveValue("");
  });

  it("tài khoản chưa liên kết hồ sơ ⇒ ô tạo nhanh vô hiệu kèm giải thích, Enter không gửi", async () => {
    setCapabilities({ "read:task": true, "create:task": true });
    vi.mocked(authApi.me).mockResolvedValue(meResponse(null));
    renderWithQuery(<MyTasksPage />);
    expect(await screen.findByText(/chưa liên kết hồ sơ nhân viên/i)).toBeInTheDocument();
    const input = screen.getByTestId("my-tasks-quick-add-input");
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { value: "Không gửi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(taskCoreApi.createTask).not.toHaveBeenCalled();
  });

  // S20-DASH-QUICKACTION-1 — đích quick action «Tạo task» của dashboard là `/tasks/my-tasks?create=1`.
  it("?create=1 ⇒ ô tạo nhanh có focus ngay khi mở khoá; không có tham số ⇒ không tự lấy focus", async () => {
    setCapabilities({ "read:task": true, "create:task": true });
    searchRef.current = { create: 1 };
    const { unmount } = renderWithQuery(<MyTasksPage />);
    const input = await screen.findByTestId("my-tasks-quick-add-input");
    await waitFor(() => expect(input).toBeEnabled());
    await waitFor(() => expect(input).toHaveFocus());
    unmount();

    searchRef.current = {};
    renderWithQuery(<MyTasksPage />);
    const plain = await screen.findByTestId("my-tasks-quick-add-input");
    await waitFor(() => expect(plain).toBeEnabled());
    expect(plain).not.toHaveFocus();
  });

  it("thiếu create:task ⇒ không có ô tạo nhanh, không có nút «Tạo việc», không gọi /auth/me", async () => {
    setCapabilities({ "read:task": true });
    renderWithQuery(<MyTasksPage />);
    await waitFor(() => expect(taskCoreApi.getMyTasks).toHaveBeenCalled());
    expect(screen.queryByTestId("my-tasks-quick-add-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("my-tasks-create")).not.toBeInTheDocument();
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it("nút «Tạo việc» mở form Tạo ngay trên trang (0 chuyển trang)", async () => {
    setCapabilities({ "read:task": true, "create:task": true });
    renderWithQuery(<MyTasksPage />);
    fireEvent.click(screen.getByTestId("my-tasks-create"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
