import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, useAuthStore, taskCoreApi } from "@mediaos/web-core";
import { Toaster, toast } from "@mediaos/ui";
import { useChatDockStore } from "@/components/chat/chat-dock.store";
import { GlobalTaskDrawer, TaskDetailDrawer } from "./TaskDetailDrawer";

// S20-TASK-DRAWER-1 — drawer toàn cục đọc `?task=` từ location.search và mở/đóng qua navigate.
const { searchRef, navigateMock } = vi.hoisted(() => ({
  searchRef: { current: {} as Record<string, unknown> },
  navigateMock: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: "/tasks/my-tasks", search: searchRef.current } }),
}));

/**
 * S5-TASK-BOARD-UX-1 — panel chi tiết trượt phải mở từ board.
 *
 * NỘI DUNG panel không test lại ở đây: nó là `TaskDetailContent` dùng CHUNG với trang
 * /tasks/:taskId (đã có TaskDetailPage.spec) — nên phần thân được mock, test này chỉ soi phần
 * riêng của drawer: mở/đóng theo `taskId`, tiêu đề lấy từ task, và không gọi API khi thiếu quyền.
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { getTask: vi.fn() },
  };
});

vi.mock("./TaskDetailContent", () => ({
  TaskDetailContent: ({ taskId, variant }: { taskId: string; variant?: string }) => (
    <div data-testid="task-detail-content" data-task-id={taskId} data-variant={variant} />
  ),
  // Cụm menu ⋯ + dialog Sửa/Xoá — drawer đặt lên header Sheet; nội dung test ở TaskDetailPage.spec.
  TaskDetailActions: () => <div data-testid="task-detail-actions" />,
}));

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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

const TASK = {
  id: "task-001",
  title: "Dựng trang Tuyển dụng",
  projectName: "Website Công ty phiên bản 2.0",
};

describe("TaskDetailDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("taskId=null ⇒ KHÔNG render panel, KHÔNG gọi API", () => {
    setCapabilities({ "read:task": true });
    renderWithQuery(<TaskDetailDrawer taskId={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId("task-detail-drawer")).not.toBeInTheDocument();
    expect(taskCoreApi.getTask).not.toHaveBeenCalled();
  });

  it("có taskId ⇒ mở panel và nhúng thân dùng chung ở variant 'drawer'", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(TASK as never);
    renderWithQuery(<TaskDetailDrawer taskId="task-001" onClose={vi.fn()} />);

    expect(screen.getByTestId("task-detail-drawer")).toBeInTheDocument();
    const content = screen.getByTestId("task-detail-content");
    expect(content).toHaveAttribute("data-task-id", "task-001");
    // variant='drawer' để thân KHÔNG vẽ lại tiêu đề (Sheet đã có) — chống hiện tiêu đề hai lần.
    expect(content).toHaveAttribute("data-variant", "drawer");
  });

  it("tiêu đề panel là tên task + tên dự án", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(TASK as never);
    renderWithQuery(<TaskDetailDrawer taskId="task-001" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Dựng trang Tuyển dụng")).toBeInTheDocument());
    expect(screen.getByText("Website Công ty phiên bản 2.0")).toBeInTheDocument();
  });

  it("menu hành động nằm ở HEADER panel (cùng hàng nút đóng) sau khi task tải xong", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(TASK as never);
    renderWithQuery(<TaskDetailDrawer taskId="task-001" onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("task-detail-actions")).toBeInTheDocument());
    // Cùng cụm shrink-0 chứa nút đóng ⇒ cùng hàng header, không rớt xuống thân.
    const actions = screen.getByTestId("task-detail-actions");
    const close = screen.getByTestId("sheet-close");
    expect(actions.parentElement).toBe(close.parentElement);
  });

  it("có onOpenFull ⇒ hiện nút mở toàn trang, bấm gọi onOpenFull; không truyền ⇒ ẩn", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(TASK as never);
    const onOpenFull = vi.fn();
    const { unmount } = renderWithQuery(
      <TaskDetailDrawer taskId="task-001" onClose={vi.fn()} onOpenFull={onOpenFull} />,
    );

    fireEvent.click(screen.getByTestId("task-drawer-open-full"));
    expect(onOpenFull).toHaveBeenCalledTimes(1);
    unmount();

    renderWithQuery(<TaskDetailDrawer taskId="task-001" onClose={vi.fn()} />);
    expect(screen.queryByTestId("task-drawer-open-full")).not.toBeInTheDocument();
  });

  it("nút đóng gọi onClose", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(TASK as never);
    const onClose = vi.fn();
    renderWithQuery(<TaskDetailDrawer taskId="task-001" onClose={onClose} />);

    fireEvent.click(screen.getByTestId("sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc đóng panel", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(TASK as never);
    const onClose = vi.fn();
    renderWithQuery(<TaskDetailDrawer taskId="task-001" onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("bấm nền mờ ngoài panel đóng panel", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(TASK as never);
    const onClose = vi.fn();
    renderWithQuery(<TaskDetailDrawer taskId="task-001" onClose={onClose} />);

    // Nền mờ là cha của panel; click TRONG panel không được đóng (stopPropagation).
    fireEvent.click(screen.getByTestId("task-detail-drawer"));
    expect(onClose).not.toHaveBeenCalled();

    const overlay = screen.getByTestId("task-detail-drawer").parentElement as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("thiếu read:task ⇒ KHÔNG gọi API lấy task (gate mirror TaskDetailContent)", () => {
    setCapabilities({});
    renderWithQuery(<TaskDetailDrawer taskId="task-001" onClose={vi.fn()} />);
    expect(taskCoreApi.getTask).not.toHaveBeenCalled();
  });
});

// ── S20-TASK-DRAWER-1 — drawer TOÀN CỤC (mount ở ProtectedShell) ────────────────────────────────
const TASK_UUID = "0b9f6a4e-2c1d-4e8f-9a7b-3c5d6e7f8a9b";
const UNAVAILABLE = "Không mở được việc này";

type NavigateArg = {
  to: string;
  params?: Record<string, string>;
  replace?: boolean;
  search?: (prev: Record<string, unknown>) => Record<string, unknown>;
};

function lastNavigate(): NavigateArg {
  const calls = navigateMock.mock.calls;
  return calls[calls.length - 1]?.[0] as NavigateArg;
}

function renderGlobal(search: Record<string, unknown>) {
  searchRef.current = search;
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <GlobalTaskDrawer />
      <Toaster />
    </QueryClientProvider>,
  );
}

function setViewportNarrow(narrow: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: narrow,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** Đóng do từ chối: replace, bỏ `task`, GIỮ mọi tham số khác của trang phía sau. */
function expectClosedKeeping(other: Record<string, unknown>) {
  const call = lastNavigate();
  expect(call).toMatchObject({ to: ".", replace: true });
  expect(call.search?.({ ...other, task: TASK_UUID })).toEqual(other);
}

describe("GlobalTaskDrawer — ?task= toàn ứng dụng", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => toast.clear());
    useChatDockStore.getState().resetChatDock();
    setViewportNarrow(false);
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("không có ?task= ⇒ không render, không gọi API", () => {
    setCapabilities({ "read:task": true });
    renderGlobal({ status: "Todo" });
    expect(screen.queryByTestId("task-detail-drawer")).not.toBeInTheDocument();
    expect(taskCoreApi.getTask).not.toHaveBeenCalled();
  });

  it.each([["abc"], [123], ["../../etc"], [`${TASK_UUID}x`]])(
    "?task=%s không phải UUID ⇒ 0 lời gọi API, báo «Không mở được việc này», đóng bằng replace",
    async (raw) => {
      setCapabilities({ "read:task": true });
      renderGlobal({ status: "Todo", task: raw });

      await waitFor(() => expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument());
      expect(taskCoreApi.getTask).not.toHaveBeenCalled();
      expect(screen.queryByTestId("task-detail-drawer")).not.toBeInTheDocument();
      expectClosedKeeping({ status: "Todo" });
    },
  );

  it.each([
    ["không tồn tại / xoá mềm (404)", 404, "TASK-ERR-001"],
    ["ngoài phạm vi đọc (403)", 403, "AUTH-ERR-FORBIDDEN"],
    ["id bị server từ chối (400)", 400, "VALIDATION-ERR"],
  ])("%s ⇒ CÙNG thông điệp, không lộ tiêu đề/mã, trang sau vẫn dùng được", async (_l, st, code) => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockRejectedValue(new ApiError(st, code, "x"));
    renderGlobal({ tab: "board", task: TASK_UUID });

    await waitFor(() => expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument());
    expect(taskCoreApi.getTask).toHaveBeenCalledWith(TASK_UUID);
    expect(screen.queryByTestId("task-detail-drawer")).not.toBeInTheDocument();
    expect(screen.queryByText(code)).not.toBeInTheDocument();
    expect(screen.queryByText(TASK_UUID)).not.toBeInTheDocument();
    expectClosedKeeping({ tab: "board" });
  });

  it("thiếu read:task ⇒ 0 lời gọi API, cùng thông điệp", async () => {
    setCapabilities({});
    renderGlobal({ task: TASK_UUID });

    await waitFor(() => expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument());
    expect(taskCoreApi.getTask).not.toHaveBeenCalled();
    expectClosedKeeping({});
  });

  it.each([
    ["lỗi máy chủ (500)", new ApiError(500, "INTERNAL", "boom")],
    ["lỗi mạng", new Error("network")],
  ])(
    "%s ⇒ drawer vẫn mở (thân có «Thử lại»), tiêu đề là thông điệp lỗi chung — không còn «Đang tải…», không lộ mã",
    async (_l, err) => {
      setCapabilities({ "read:task": true });
      vi.mocked(taskCoreApi.getTask).mockRejectedValue(err);
      renderGlobal({ task: TASK_UUID });

      await waitFor(() => expect(screen.getByText("Lỗi khi tải công việc")).toBeInTheDocument());
      expect(screen.queryByText("Đang tải công việc…")).not.toBeInTheDocument();
      expect(screen.queryByText(TASK_UUID)).not.toBeInTheDocument();
      // Không thuộc nhóm từ chối ⇒ KHÔNG báo «Không mở được», KHÔNG tự đóng.
      expect(screen.getByTestId("task-detail-drawer")).toBeInTheDocument();
      expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
      expect(navigateMock).not.toHaveBeenCalled();
    },
  );

  it("UUID hợp lệ ⇒ mở drawer với tiêu đề việc; Esc đóng bằng replace, bộ lọc giữ nguyên", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue({ ...TASK, id: TASK_UUID } as never);
    renderGlobal({ status: "InProgress", page: 2, task: TASK_UUID });

    await waitFor(() => expect(screen.getByText("Dựng trang Tuyển dụng")).toBeInTheDocument());
    expect(screen.getAllByTestId("task-detail-drawer")).toHaveLength(1);
    expect(screen.getByTestId("task-detail-content")).toHaveAttribute("data-task-id", TASK_UUID);

    fireEvent.keyDown(document, { key: "Escape" });
    expectClosedKeeping({ status: "InProgress", page: 2 });
  });

  it("«Mở toàn trang» ⇒ push sang /tasks/:id", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue({ ...TASK, id: TASK_UUID } as never);
    renderGlobal({ task: TASK_UUID });

    fireEvent.click(screen.getByTestId("task-drawer-open-full"));
    expect(lastNavigate()).toMatchObject({ to: "/tasks/$taskId", params: { taskId: TASK_UUID } });
    expect(lastNavigate().replace).not.toBe(true);
  });

  it("màn hẹp hơn md + drawer chat đang mở ⇒ drawer chat thu lại, drawer việc ở trên", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue({ ...TASK, id: TASK_UUID } as never);
    setViewportNarrow(true);
    act(() => useChatDockStore.getState().openRoom("room-1"));
    renderGlobal({ task: TASK_UUID });

    await waitFor(() => expect(useChatDockStore.getState().isOpen).toBe(false));
    // Thu lại, KHÔNG rời phòng: mở lại drawer chat là về đúng hội thoại.
    expect(useChatDockStore.getState().openRoomIds).toEqual(["room-1"]);
    expect(screen.getByTestId("task-detail-drawer")).toBeInTheDocument();
  });

  it("màn rộng ⇒ drawer chat KHÔNG bị đóng", async () => {
    setCapabilities({ "read:task": true });
    vi.mocked(taskCoreApi.getTask).mockResolvedValue({ ...TASK, id: TASK_UUID } as never);
    act(() => useChatDockStore.getState().openDrawer());
    renderGlobal({ task: TASK_UUID });

    await waitFor(() => expect(screen.getByTestId("task-detail-drawer")).toBeInTheDocument());
    expect(useChatDockStore.getState().isOpen).toBe(true);
  });
});
