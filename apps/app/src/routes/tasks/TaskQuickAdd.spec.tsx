import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi, ApiError } from "@mediaos/web-core";
import { TaskQuickAdd } from "./TaskQuickAdd";

/**
 * S20-TASK-QUICKADD-1 — ô tạo việc một dòng dùng chung («Việc của tôi» + board dự án).
 *
 * Ba thứ dễ hỏng âm thầm: (1) người phụ trách cố định phải vào ĐÚNG payload — thiếu là server 403 với
 * phạm vi Own; (2) chip hạn «dính» qua các lần Enter; (3) tài khoản chưa liên kết hồ sơ ⇒ KHÔNG gửi.
 */
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, taskCoreApi: { createTask: vi.fn() } };
});

const ME = "11111111-2222-4333-8444-555555555555";

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

function renderQuickAdd(props: Partial<React.ComponentProps<typeof TaskQuickAdd>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <input data-testid="other-input" />
      <TaskQuickAdd
        id="qa"
        fixedAssigneeEmployeeId={ME}
        placeholder="Thêm việc cho tôi"
        hint="Enter để tạo"
        shortcutKey="n"
        {...props}
      />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

const input = () => screen.getByTestId("qa-input") as HTMLInputElement;

function typeAndEnter(value: string) {
  fireEvent.change(input(), { target: { value } });
  fireEvent.keyDown(input(), { key: "Enter" });
}

describe("TaskQuickAdd — người phụ trách cố định (Việc của tôi)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(taskCoreApi.createTask).mockResolvedValue({ id: "task-new" } as never);
  });

  it("Enter tạo việc giao cho CHÍNH TÔI, ô trống và vẫn giữ focus để nhập tiếp", async () => {
    setCapabilities({ "create:task": true });
    renderQuickAdd();
    input().focus();
    typeAndEnter("  Gửi báo giá  ");

    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    expect(taskCoreApi.createTask).toHaveBeenCalledWith({
      title: "Gửi báo giá",
      assigneeEmployeeId: ME,
    });
    expect(input()).toHaveValue("");
    expect(document.activeElement).toBe(input());
  });

  it("chip hạn GIỮ cho lượt sau: hai việc liên tiếp cùng một hạn", async () => {
    setCapabilities({ "create:task": true, "update-deadline:task": true });
    renderQuickAdd();
    fireEvent.click(screen.getByTestId("qa-due"));
    fireEvent.click(screen.getByTestId("qa-due-preset-tomorrow"));

    typeAndEnter("Việc 1");
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    typeAndEnter("Việc 2");
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(2));

    const [first, second] = vi.mocked(taskCoreApi.createTask).mock.calls.map((c) => c[0]);
    expect(first?.dueAt).toMatch(/T10:00:00[.]000Z$/); // 17:00 giờ công ty
    expect(second?.dueAt).toBe(first?.dueAt);
  });

  it("KPI #8 — tiêu đề → chip mốc gần nhất → Enter (3 thao tác) ⇒ việc có hạn; bấm lại chip ⇒ bỏ hạn", async () => {
    setCapabilities({ "create:task": true, "update-deadline:task": true });
    renderQuickAdd();
    fireEvent.change(input(), { target: { value: "Nộp báo cáo" } });
    const nearest = screen.getByTestId("qa-due-nearest");
    fireEvent.click(nearest);
    expect(nearest).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(taskCoreApi.createTask).mock.calls[0]?.[0]?.dueAt).toMatch(/Z$/);

    fireEvent.click(nearest);
    expect(nearest).toHaveAttribute("aria-pressed", "false");
    typeAndEnter("Không hạn");
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(2));
    expect(vi.mocked(taskCoreApi.createTask).mock.calls[1]?.[0]).not.toHaveProperty("dueAt");
  });

  it("thiếu update-deadline ⇒ không có chip Hạn (việc vẫn tạo được)", () => {
    setCapabilities({ "create:task": true });
    renderQuickAdd();
    expect(screen.queryByTestId("qa-due")).not.toBeInTheDocument();
    expect(screen.queryByTestId("qa-due-nearest")).not.toBeInTheDocument();
  });

  it("không có chip Người khi người phụ trách đã cố định, dù có assign:task", () => {
    setCapabilities({ "create:task": true, "assign:task": true });
    renderQuickAdd({ withAssigneeChip: true });
    expect(screen.queryByTestId("qa-assignee")).not.toBeInTheDocument();
  });

  it("vô hiệu (chưa liên kết hồ sơ) ⇒ ô khoá, có giải thích, Enter KHÔNG gửi request", () => {
    setCapabilities({ "create:task": true });
    renderQuickAdd({
      fixedAssigneeEmployeeId: undefined,
      disabled: true,
      disabledReason: "Tài khoản chưa liên kết hồ sơ",
    });
    expect(input()).toBeDisabled();
    expect(screen.getByText("Tài khoản chưa liên kết hồ sơ")).toBeInTheDocument();
    typeAndEnter("Không được gửi");
    expect(taskCoreApi.createTask).not.toHaveBeenCalled();
  });

  it("tiêu đề rỗng ⇒ không gửi, lỗi tại ô", () => {
    setCapabilities({ "create:task": true });
    renderQuickAdd();
    typeAndEnter("   ");
    expect(taskCoreApi.createTask).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/nhập tên công việc/i);
  });

  it("tiêu đề quá 500 ký tự ⇒ không gửi, lỗi tại ô", () => {
    setCapabilities({ "create:task": true });
    renderQuickAdd();
    typeAndEnter("x".repeat(501));
    expect(taskCoreApi.createTask).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/tối đa 500/i);
  });

  it("server từ chối người phụ trách ⇒ «Không giao được cho người này», tiêu đề trả lại vào ô", async () => {
    setCapabilities({ "create:task": true });
    vi.mocked(taskCoreApi.createTask).mockRejectedValue(
      new ApiError(
        403,
        "FORBIDDEN",
        "TASK-ERR-TASK-ASSIGNEE-OUT-OF-SCOPE: nhân viên nhận việc ngoài phạm vi giao việc của bạn.",
      ),
    );
    renderQuickAdd();
    typeAndEnter("Việc bị từ chối");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Không giao được cho người này"),
    );
    expect(input()).toHaveValue("Việc bị từ chối");
  });

  it("tạo xong làm mới «Việc của tôi» — việc mới hiện ngay trong nhóm phù hợp", async () => {
    setCapabilities({ "create:task": true });
    const { client } = renderQuickAdd();
    const spy = vi.spyOn(client, "invalidateQueries");
    typeAndEnter("Việc mới");
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["tasks", "my"] }));
  });
});

describe("TaskQuickAdd — phím «n»", () => {
  beforeEach(() => vi.clearAllMocks());

  it("«n» ngoài ô nhập ⇒ focus ô tạo nhanh", () => {
    setCapabilities({ "create:task": true });
    renderQuickAdd();
    fireEvent.keyDown(document.body, { key: "n" });
    expect(document.activeElement).toBe(input());
  });

  it("đang gõ trong ô khác ⇒ «n» KHÔNG bị cướp", () => {
    setCapabilities({ "create:task": true });
    renderQuickAdd();
    const other = screen.getByTestId("other-input");
    other.focus();
    fireEvent.keyDown(other, { key: "n" });
    expect(document.activeElement).toBe(other);
  });

  it("trong vùng contenteditable ⇒ «n» KHÔNG bị cướp", () => {
    setCapabilities({ "create:task": true });
    renderQuickAdd();
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.appendChild(editor);
    fireEvent.keyDown(editor, { key: "n" });
    expect(document.activeElement).not.toBe(input());
    editor.remove();
  });
});

/**
 * Lượt đo trình duyệt thật: (1) chọn «Hôm nay 17:00» thì chip lịch bên cạnh in lại đúng hạn đó — một hạn
 * hiện hai lần trên một hàng; (2) cột board ~270 px đẩy chip «Đặt hạn» xuống dòng hai. Bất biến: hạn
 * đang chọn hiện ĐÚNG MỘT lần; chưa có hạn (hoặc hạn = mốc một chạm) thì chip lịch chỉ là biểu tượng
 * có tên trợ năng; hạn khác mốc một chạm thì chip lịch in ngày giờ và chip một chạm ẩn.
 * Đồng hồ cố định Thứ Năm 22/10/2026 10:00 giờ công ty (chỉ giả `Date`, hẹn giờ vẫn thật).
 */
describe("TaskQuickAdd — hàng chip Hạn hiện hạn đúng một lần", () => {
  const DUE_LABEL = "Hạn của việc sắp tạo";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(taskCoreApi.createTask).mockResolvedValue({ id: "task-new" } as never);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T03:00:00.000Z"));
    setCapabilities({ "create:task": true, "update-deadline:task": true });
  });

  afterEach(() => vi.useRealTimers());

  it("chưa có hạn ⇒ chip lịch chỉ là biểu tượng, vẫn có tên trợ năng", () => {
    renderQuickAdd();
    const due = screen.getByTestId("qa-due");
    expect(due.textContent).toBe("");
    expect(screen.getByRole("button", { name: DUE_LABEL })).toBe(due);
    expect(screen.getByTestId("qa-due-nearest")).toHaveTextContent("Hôm nay 17:00");
  });

  it("chọn «Hôm nay 17:00» ⇒ chip lịch KHÔNG in lại ngày giờ của hạn đó", () => {
    renderQuickAdd();
    fireEvent.click(screen.getByTestId("qa-due-nearest"));
    expect(screen.getByTestId("qa-due-nearest")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("qa-due").textContent).toBe("");
    expect(screen.getByTestId("qa").textContent).not.toMatch(/22\/10/);
  });

  it("hạn khác mốc một chạm (Thứ Sáu) ⇒ chip lịch in ngày giờ, chip một chạm ẩn; xoá hạn ⇒ chip một chạm quay lại", async () => {
    renderQuickAdd();
    fireEvent.click(screen.getByTestId("qa-due"));
    fireEvent.click(screen.getByTestId("qa-due-preset-friday"));

    expect(screen.getByTestId("qa-due")).toHaveTextContent(/17:00.*23\/10/);
    expect(screen.queryByTestId("qa-due-nearest")).not.toBeInTheDocument();
    expect(screen.getByTestId("qa").textContent?.match(/23\/10/g)).toHaveLength(1);

    typeAndEnter("Chốt hợp đồng");
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(taskCoreApi.createTask).mock.calls[0]?.[0]?.dueAt).toBe(
      "2026-10-23T10:00:00.000Z",
    );

    fireEvent.click(screen.getByTestId("qa-due"));
    fireEvent.click(screen.getByTestId("qa-due-clear"));
    expect(screen.getByTestId("qa-due-nearest")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("qa-due").textContent).toBe("");
  });
});
