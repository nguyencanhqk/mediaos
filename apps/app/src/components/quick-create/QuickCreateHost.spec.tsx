// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, authApi, taskCoreApi, taskProjectApi, useAuthStore } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { QuickCreateHost } from "./QuickCreateHost";
import { useQuickCreateStore } from "./quick-create.store";
import { QUICK_CREATE_RECENT_PROJECT_KEY } from "./recent-project";

/**
 * S20-X-QUICKCREATE-1 — form tạo việc gọn toàn cục. Trọng tâm: (1) thiếu create:task ⇒ phím tắt vô tác
 * dụng; (2) payload CHỈ có tiêu đề + người phụ trách = tôi, KHÔNG có projectId trừ khi bấm chip; (3) chip
 * không hiện với dự án lưu trữ / tôi không còn là thành viên; (4) lỗi server giữ tiêu đề.
 */
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return { ...actual, toast: { ...actual.toast, success: vi.fn(), error: vi.fn() } };
});
vi.mock("@/routes/tasks/TaskFormDrawer", () => ({
  TaskFormDrawer: (props: {
    initialValues?: { title?: string };
    defaultProject?: { id: string };
    defaultAssigneeMe?: boolean;
  }) => (
    <div
      data-testid="full-form"
      data-title={props.initialValues?.title}
      data-project={props.defaultProject?.id ?? ""}
      data-me={String(props.defaultAssigneeMe)}
    />
  ),
}));
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    authApi: { ...actual.authApi, me: vi.fn() },
    taskCoreApi: { createTask: vi.fn() },
    taskProjectApi: { getProject: vi.fn() },
  };
});

const ME = "11111111-2222-4333-8444-555555555555";
const PROJECT_ID = "99999999-2222-4333-8444-555555555555";
const NEW_TASK = { id: "aaaaaaaa-2222-4333-8444-555555555555", projectId: null };

function project(over: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    name: "Dự án Alpha",
    status: "Active",
    closedAt: null,
    myProjectRole: "Member",
    ...over,
  };
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "a@demo.local", fullName: "A", status: "Active", companyId: "co1" },
  });
}

function renderHost() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QuickCreateHost />
    </QueryClientProvider>,
  );
}

function chord() {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        altKey: true,
        shiftKey: true,
        code: "KeyN",
        key: "N",
      }),
    );
  });
}

const input = () => screen.getByTestId("quick-create-input") as HTMLInputElement;

async function openDialog() {
  chord();
  await screen.findByTestId("quick-create-dialog");
  await waitFor(() => expect(input()).not.toBeDisabled());
}

describe("QuickCreateHost — S20-X-QUICKCREATE-1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useQuickCreateStore.setState({ isOpen: false });
    vi.mocked(authApi.me).mockResolvedValue({ employee: { id: ME, fullName: "A" } } as never);
    vi.mocked(taskCoreApi.createTask).mockResolvedValue(NEW_TASK as never);
    vi.mocked(taskProjectApi.getProject).mockResolvedValue(project() as never);
  });
  afterEach(() => {
    useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  });

  it("thiếu create:task ⇒ phím tắt và store.open không vẽ gì", () => {
    setCaps({ "read:task": true });
    renderHost();
    chord();
    act(() => useQuickCreateStore.getState().open());
    expect(screen.queryByTestId("quick-create-dialog")).toBeNull();
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it("có create:task ⇒ Alt+Shift+N mở hộp, ô tiêu đề được focus", async () => {
    setCaps({ "create:task": true });
    renderHost();
    await openDialog();
    expect(document.activeElement).toBe(input());
  });

  it("Enter lưu: payload chỉ có tiêu đề + tôi (không dự án) ⇒ toast «Đã tạo · Mở», hộp đóng", async () => {
    setCaps({ "create:task": true });
    renderHost();
    await openDialog();
    fireEvent.change(input(), { target: { value: "  Gọi khách  " } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    expect(taskCoreApi.createTask).toHaveBeenCalledWith({
      title: "Gọi khách",
      assigneeEmployeeId: ME,
    });
    await waitFor(() => expect(screen.queryByTestId("quick-create-dialog")).toBeNull());
    const [message, opts] = vi.mocked(toast.success).mock.calls[0] as unknown as [
      string,
      { action: { label: string; onClick: () => void } },
    ];
    expect(message).toBe("Đã tạo việc");
    expect(opts.action.label).toBe("Mở");
    opts.action.onClick();
    const nav = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (p: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(nav.search({ q: "x" })).toEqual({ q: "x", task: NEW_TASK.id });
  });

  it.each(["", "   "])("tiêu đề %j ⇒ không gửi, lỗi «Nhập tiêu đề»", async (value) => {
    setCaps({ "create:task": true });
    renderHost();
    await openDialog();
    fireEvent.change(input(), { target: { value } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toBe("Nhập tiêu đề");
    expect(taskCoreApi.createTask).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("server từ chối ⇒ hộp còn mở, tiêu đề được trả lại, hiện lý do", async () => {
    setCaps({ "create:task": true });
    vi.mocked(taskCoreApi.createTask).mockRejectedValue(new ApiError(403, "FORBIDDEN", "no"));
    renderHost();
    await openDialog();
    fireEvent.change(input(), { target: { value: "Việc A" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(input().value).toBe("Việc A");
    expect(screen.getByTestId("quick-create-dialog")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("chưa liên kết hồ sơ nhân viên ⇒ ô khoá, không gửi", async () => {
    setCaps({ "create:task": true });
    vi.mocked(authApi.me).mockResolvedValue({ employee: null } as never);
    renderHost();
    chord();
    await screen.findByTestId("quick-create-dialog");
    await waitFor(() =>
      expect(screen.getByTestId("quick-create-message").textContent).toMatch(/chưa liên kết/),
    );
    expect(input()).toBeDisabled();
  });

  describe("chip «dự án gần nhất»", () => {
    beforeEach(() => window.localStorage.setItem(QUICK_CREATE_RECENT_PROJECT_KEY, PROJECT_ID));

    it("hiện nhưng KHÔNG tự chọn: không bấm ⇒ không có projectId", async () => {
      setCaps({ "create:task": true });
      renderHost();
      await openDialog();
      const chip = await screen.findByTestId("quick-create-recent-project");
      expect(chip).toHaveAttribute("aria-pressed", "false");
      fireEvent.change(input(), { target: { value: "Việc B" } });
      fireEvent.keyDown(input(), { key: "Enter" });
      await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalled());
      expect(vi.mocked(taskCoreApi.createTask).mock.calls[0]?.[0]).not.toHaveProperty("projectId");
    });

    it("bấm chip ⇒ payload có projectId", async () => {
      setCaps({ "create:task": true });
      renderHost();
      await openDialog();
      fireEvent.click(await screen.findByTestId("quick-create-recent-project"));
      fireEvent.change(input(), { target: { value: "Việc C" } });
      fireEvent.keyDown(input(), { key: "Enter" });
      await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalled());
      expect(taskCoreApi.createTask).toHaveBeenCalledWith({
        title: "Việc C",
        projectId: PROJECT_ID,
        assigneeEmployeeId: ME,
      });
    });

    it.each([
      ["lưu trữ", { status: "Archived" }],
      ["đã đóng", { closedAt: "2026-01-01T00:00:00.000Z" }],
      ["tôi không còn là thành viên", { myProjectRole: null }],
      ["tôi chỉ là người xem", { myProjectRole: "Viewer" }],
    ])("dự án %s ⇒ chip không hiện", async (_n, over) => {
      setCaps({ "create:task": true });
      vi.mocked(taskProjectApi.getProject).mockResolvedValue(project(over) as never);
      renderHost();
      await openDialog();
      await waitFor(() => expect(taskProjectApi.getProject).toHaveBeenCalled());
      expect(screen.queryByTestId("quick-create-recent-project")).toBeNull();
    });

    it("server không cho đọc dự án (403/404) ⇒ chip không hiện", async () => {
      setCaps({ "create:task": true });
      vi.mocked(taskProjectApi.getProject).mockRejectedValue(new ApiError(404, "NOT_FOUND", "x"));
      renderHost();
      await openDialog();
      await waitFor(() => expect(taskProjectApi.getProject).toHaveBeenCalled());
      expect(screen.queryByTestId("quick-create-recent-project")).toBeNull();
    });

    it("tạo xong có dự án ⇒ nhớ id dự án cho lần sau", async () => {
      window.localStorage.clear();
      vi.mocked(taskCoreApi.createTask).mockResolvedValue({
        ...NEW_TASK,
        projectId: PROJECT_ID,
      } as never);
      setCaps({ "create:task": true });
      renderHost();
      await openDialog();
      fireEvent.change(input(), { target: { value: "Việc D" } });
      fireEvent.keyDown(input(), { key: "Enter" });
      await waitFor(() =>
        expect(window.localStorage.getItem(QUICK_CREATE_RECENT_PROJECT_KEY)).toBe(PROJECT_ID),
      );
    });
  });

  it("localStorage ném lỗi ⇒ vẫn tạo được, không có chip", async () => {
    setCaps({ "create:task": true });
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderHost();
    await openDialog();
    expect(screen.queryByTestId("quick-create-recent-project")).toBeNull();
    spy.mockRestore();
  });

  it("«Thêm chi tiết» ⇒ mở form đầy đủ với tiêu đề đang gõ, giao cho tôi, chưa gọi API tạo", async () => {
    setCaps({ "create:task": true });
    renderHost();
    await openDialog();
    fireEvent.change(input(), { target: { value: "Việc E" } });
    fireEvent.click(screen.getByTestId("quick-create-expand"));
    const full = await screen.findByTestId("full-form");
    expect(full.dataset.title).toBe("Việc E");
    expect(full.dataset.me).toBe("true");
    expect(full.dataset.project).toBe("");
    expect(screen.queryByTestId("quick-create-dialog")).toBeNull();
    expect(taskCoreApi.createTask).not.toHaveBeenCalled();
  });

  it("chip dự án: rời ô nhập (đang trống) sang chip ⇒ hộp KHÔNG đóng, chip bấm được", async () => {
    window.localStorage.setItem(QUICK_CREATE_RECENT_PROJECT_KEY, PROJECT_ID);
    setCaps({ "create:task": true });
    renderHost();
    await openDialog();
    const chip = await screen.findByTestId("quick-create-recent-project");
    fireEvent.blur(input(), { relatedTarget: chip });
    fireEvent.blur(input(), { relatedTarget: null });
    expect(screen.getByTestId("quick-create-dialog")).toBeInTheDocument();
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("đóng hộp khi request đang bay rồi server lỗi ⇒ toast lỗi kèm tiêu đề", async () => {
    setCaps({ "create:task": true });
    let reject: (e: unknown) => void = () => undefined;
    vi.mocked(taskCoreApi.createTask).mockReturnValue(
      new Promise((_, r) => {
        reject = r;
      }) as never,
    );
    renderHost();
    await openDialog();
    fireEvent.change(input(), { target: { value: "Việc F" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalled());
    act(() => useQuickCreateStore.getState().close());
    expect(screen.queryByTestId("quick-create-dialog")).toBeNull();
    await act(async () => {
      reject(new ApiError(500, "INTERNAL", "x"));
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toContain("Việc F");
  });

  it("request đang bay ⇒ «Thêm chi tiết» bị khoá (không mở form rỗng/tạo trùng)", async () => {
    setCaps({ "create:task": true });
    vi.mocked(taskCoreApi.createTask).mockReturnValue(new Promise(() => undefined) as never);
    renderHost();
    await openDialog();
    fireEvent.change(input(), { target: { value: "Việc G" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("quick-create-expand")).toBeDisabled());
    fireEvent.click(screen.getByTestId("quick-create-expand"));
    expect(screen.queryByTestId("full-form")).toBeNull();
  });
});
