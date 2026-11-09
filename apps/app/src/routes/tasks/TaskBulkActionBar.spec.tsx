import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hrApi, taskCollabApi, taskCoreApi, useAuthStore } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import type { TaskActionResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { TaskBulkActionBar } from "./TaskBulkActionBar";
import { TASK_BULK_MAX } from "./hooks/use-task-bulk-action";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { assign: vi.fn(), changeDeadline: vi.fn(), changeStatus: vi.fn() },
    taskCollabApi: { moveTaskState: vi.fn() },
    hrApi: { listEmployees: vi.fn() },
  };
});

const BOB = "11111111-1111-4111-8111-111111111111";
const STATE = "22222222-2222-4222-8222-222222222222";
const mk = (n: number): TaskCoreResponseDto[] =>
  Array.from(
    { length: n },
    (_, i) => ({ id: `t${i + 1}`, title: `Việc ${i + 1}` }) as TaskCoreResponseDto,
  );
const reply = (id: string, warnings?: unknown): TaskActionResponseDto =>
  ({
    task: { id, title: `Việc ${id}` },
    ...(warnings ? { warnings } : {}),
  }) as unknown as TaskActionResponseDto;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "a@b.c", fullName: "U", status: "Active", companyId: "co" },
  });
}

function renderBar(
  props: Partial<React.ComponentProps<typeof TaskBulkActionBar>> & { count?: number } = {},
) {
  const { count, ...rest } = props;
  const onRetainFailed = vi.fn();
  const onClear = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TaskBulkActionBar
        selectedTasks={mk(count ?? 6)}
        onRetainFailed={onRetainFailed}
        onClear={onClear}
        {...rest}
      />
    </QueryClientProvider>,
  );
  return { onRetainFailed, onClear };
}

async function pickBob() {
  fireEvent.click(screen.getByTestId("bulk-assign"));
  fireEvent.click(await screen.findByRole("button", { name: /Bình/ }));
}

describe("TaskBulkActionBar — S20-TASK-BULKACTIONS-1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hrApi.listEmployees).mockResolvedValue({
      items: [{ id: BOB, fullName: "Bình", avatarUrl: null }],
      meta: {},
    } as never);
  });

  it("chưa chọn việc nào ⇒ thanh không hiện", () => {
    setCaps({ "assign:task": true });
    renderBar({ count: 0 });
    expect(screen.queryByTestId("task-bulk-bar")).not.toBeInTheDocument();
  });

  it("deny-path: không có cặp quyền hành động nào ⇒ không có thanh", () => {
    setCaps({ "read:task": true });
    renderBar();
    expect(screen.queryByTestId("task-bulk-bar")).not.toBeInTheDocument();
  });

  it("chỉ có update-status:task ⇒ chỉ «Đổi trạng thái» (không Giao/Dời hạn/Chuyển cột)", () => {
    setCaps({ "update-status:task": true });
    renderBar({ moveTargets: [{ id: STATE, label: "Đang làm" }] });
    expect(screen.getByTestId("bulk-status")).toBeInTheDocument();
    expect(screen.queryByTestId("bulk-assign")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bulk-deadline")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bulk-move-state")).not.toBeInTheDocument();
  });

  it("«Chuyển cột» cần cả update-state:task lẫn cột pipeline", () => {
    setCaps({ "update-state:task": true });
    renderBar();
    expect(screen.queryByTestId("task-bulk-bar")).not.toBeInTheDocument();
  });

  it("chọn 6 → «Giao cho Bình» → Xác nhận ⇒ 6 lời gọi /assign và toast thành công", async () => {
    setCaps({ "assign:task": true, "read:employee": true });
    vi.mocked(taskCoreApi.assign).mockImplementation(async (id) => reply(id));
    const success = vi.spyOn(toast, "success");
    const { onRetainFailed } = renderBar();
    await pickBob();
    expect(screen.getByTestId("task-bulk-pending")).toHaveTextContent("Giao 6 việc cho Bình");
    fireEvent.click(screen.getByTestId("task-bulk-confirm"));
    await waitFor(() => expect(taskCoreApi.assign).toHaveBeenCalledTimes(6));
    await waitFor(() => expect(onRetainFailed).toHaveBeenCalledWith([]));
    expect(success).toHaveBeenCalledWith("6/6 thành công", expect.anything());
  });

  it("2/6 lỗi ⇒ «4/6 thành công», 2 dòng lỗi giữ chọn, ghi «Không thực hiện được»; cảnh báo gộp một câu", async () => {
    setCaps({ "assign:task": true, "read:employee": true });
    vi.mocked(taskCoreApi.assign).mockImplementation(async (id) => {
      if (id === "t2" || id === "t5") throw new Error("403");
      return id <= "t4" ? reply(id, [{ code: "TASK-WARN-ASSIGNEE-ON-LEAVE" }]) : reply(id);
    });
    const warning = vi.spyOn(toast, "warning");
    const { onRetainFailed } = renderBar();
    await pickBob();
    fireEvent.click(screen.getByTestId("task-bulk-confirm"));
    await waitFor(() => expect(onRetainFailed).toHaveBeenCalledWith(["t2", "t5"]));
    expect(warning).toHaveBeenCalledWith("4/6 thành công", expect.anything());
    expect(warning).toHaveBeenCalledWith("3 việc: Bình đang nghỉ phép", expect.anything());
    const failed = screen.getByTestId("task-bulk-failed");
    expect(failed).toHaveTextContent("Việc 2");
    expect(failed).toHaveTextContent("Việc 5");
    expect(failed.textContent?.match(/Không thực hiện được/g)).toHaveLength(2);
  });

  it(`chọn quá ${TASK_BULK_MAX} việc ⇒ nút xác nhận khoá kèm giải thích, không gọi API`, async () => {
    setCaps({ "assign:task": true, "read:employee": true });
    renderBar({ count: TASK_BULK_MAX + 1 });
    await pickBob();
    expect(screen.getByTestId("task-bulk-confirm")).toBeDisabled();
    expect(screen.getByTestId("task-bulk-limit")).toHaveTextContent("tối đa 50 việc");
    fireEvent.click(screen.getByTestId("task-bulk-confirm"));
    expect(taskCoreApi.assign).not.toHaveBeenCalled();
  });

  it("đúng 50 việc vẫn xác nhận được", async () => {
    setCaps({ "assign:task": true, "read:employee": true });
    renderBar({ count: TASK_BULK_MAX });
    await pickBob();
    expect(screen.getByTestId("task-bulk-confirm")).toBeEnabled();
    expect(screen.queryByTestId("task-bulk-limit")).not.toBeInTheDocument();
  });

  it("Đổi trạng thái ⇒ change-status từng việc", async () => {
    setCaps({ "update-status:task": true });
    vi.mocked(taskCoreApi.changeStatus).mockImplementation(async (id) => reply(id));
    renderBar({ count: 3 });
    fireEvent.click(screen.getByTestId("bulk-status"));
    fireEvent.click(await screen.findByTestId("bulk-status-Done"));
    fireEvent.click(screen.getByTestId("task-bulk-confirm"));
    await waitFor(() => expect(taskCoreApi.changeStatus).toHaveBeenCalledTimes(3));
    expect(taskCoreApi.changeStatus).toHaveBeenCalledWith("t1", { status: "Done" });
  });

  it("Dời hạn bằng mốc nhanh ⇒ change-deadline từng việc", async () => {
    setCaps({ "update-deadline:task": true });
    vi.mocked(taskCoreApi.changeDeadline).mockImplementation(async (id) => reply(id));
    renderBar({ count: 2 });
    fireEvent.click(screen.getByTestId("bulk-deadline"));
    const preset = (await screen.findAllByTestId(/^bulk-deadline-preset-/))[0];
    expect(preset).toBeDefined();
    fireEvent.click(preset as HTMLElement);
    fireEvent.click(screen.getByTestId("task-bulk-confirm"));
    await waitFor(() => expect(taskCoreApi.changeDeadline).toHaveBeenCalledTimes(2));
  });

  it("Chuyển cột ⇒ move-state từng việc", async () => {
    setCaps({ "update-state:task": true });
    vi.mocked(taskCollabApi.moveTaskState).mockImplementation(
      async (id) => ({ id, title: id }) as TaskCoreResponseDto,
    );
    renderBar({ count: 2, moveTargets: [{ id: STATE, label: "Đang làm" }] });
    fireEvent.click(screen.getByTestId("bulk-move-state"));
    fireEvent.click(await screen.findByTestId(`bulk-move-state-${STATE}`));
    expect(screen.getByTestId("task-bulk-pending")).toHaveTextContent("cột «Đang làm»");
    fireEvent.click(screen.getByTestId("task-bulk-confirm"));
    await waitFor(() => expect(taskCollabApi.moveTaskState).toHaveBeenCalledTimes(2));
  });

  it("bỏ chọn hết rồi chọn lại ⇒ KHÔNG mở thẳng dòng xác nhận cũ (pending/failedIds bị xoá)", async () => {
    setCaps({ "assign:task": true, "read:employee": true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (n: number) => (
      <QueryClientProvider client={client}>
        <TaskBulkActionBar selectedTasks={mk(n)} onRetainFailed={vi.fn()} onClear={vi.fn()} />
      </QueryClientProvider>
    );
    const { rerender } = render(ui(3));
    await pickBob();
    expect(screen.getByTestId("task-bulk-pending")).toBeInTheDocument();
    rerender(ui(0));
    expect(screen.queryByTestId("task-bulk-bar")).not.toBeInTheDocument();
    rerender(ui(2));
    expect(screen.queryByTestId("task-bulk-pending")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-bulk-confirm")).not.toBeInTheDocument();
    expect(screen.getByTestId("bulk-assign")).toBeInTheDocument();
  });

  it("nút «Giao cho…» có nhãn rõ, tên trợ năng = «Giao cho…», không avatar rỗng", () => {
    setCaps({ "assign:task": true, "read:employee": true });
    renderBar();
    const btn = screen.getByTestId("bulk-assign");
    expect(btn).toHaveTextContent("Giao cho…");
    expect(btn).toHaveAccessibleName("Giao cho…");
    expect(btn.textContent).not.toContain("?");
  });

  it("race: chọn về 0 giữa lúc chạy ⇒ failedIds cũ KHÔNG sống lại khi chọn lại", async () => {
    setCaps({ "assign:task": true, "read:employee": true });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(taskCoreApi.assign).mockImplementation(async () => {
      await gate;
      throw new Error("403");
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (n: number) => (
      <QueryClientProvider client={client}>
        <TaskBulkActionBar selectedTasks={mk(n)} onRetainFailed={vi.fn()} onClear={vi.fn()} />
      </QueryClientProvider>
    );
    const { rerender } = render(ui(2));
    await pickBob();
    fireEvent.click(screen.getByTestId("task-bulk-confirm"));
    rerender(ui(0));
    await act(async () => {
      release();
      await gate;
    });
    rerender(ui(2));
    await waitFor(() => expect(taskCoreApi.assign).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("task-bulk-failed")).not.toBeInTheDocument();
  });

  it("chọn hành động ⇒ tiêu điểm chuyển sang «Xác nhận»; Huỷ ⇒ về vùng thanh (không rơi về body)", async () => {
    setCaps({ "assign:task": true, "read:employee": true });
    renderBar();
    await pickBob();
    await waitFor(() => expect(screen.getByTestId("task-bulk-confirm")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(screen.getByTestId("task-bulk-bar")).toHaveFocus();
  });

  it("menu chọn giá trị KHÔNG tự xưng role=menu/menuitem (không có hợp đồng phím mũi tên) — là nhóm nút", async () => {
    setCaps({ "update-status:task": true });
    renderBar({ count: 2 });
    fireEvent.click(screen.getByTestId("bulk-status"));
    await screen.findByTestId("bulk-status-Done");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(screen.getByTestId("bulk-status")).not.toHaveAttribute("aria-haspopup");
  });

  it("vùng role=status bền đọc số việc + câu xác nhận; danh sách lỗi là role=alert", async () => {
    setCaps({ "assign:task": true, "read:employee": true });
    vi.mocked(taskCoreApi.assign).mockImplementation(async (id) => {
      if (id === "t2") throw new Error("403");
      return reply(id);
    });
    renderBar({ count: 3 });
    const live = screen.getByTestId("task-bulk-live");
    expect(live).toHaveAttribute("role", "status");
    expect(live).toHaveTextContent("Đã chọn 3 việc");
    await pickBob();
    expect(live).toHaveTextContent("Giao 3 việc cho Bình");
    fireEvent.click(screen.getByTestId("task-bulk-confirm"));
    const failed = await screen.findByTestId("task-bulk-failed");
    expect(failed).toHaveAttribute("role", "alert");
  });

  it("rời màn giữa lúc lệnh chạy ⇒ không gọi onRetainFailed trên màn đã gỡ", async () => {
    setCaps({ "assign:task": true, "read:employee": true });
    let release: () => void = () => undefined;
    vi.mocked(taskCoreApi.assign).mockImplementation(
      (id) =>
        new Promise((resolve) => {
          release = () => resolve(reply(id));
        }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onRetainFailed = vi.fn();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <TaskBulkActionBar
          selectedTasks={mk(1)}
          onRetainFailed={onRetainFailed}
          onClear={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await pickBob();
    fireEvent.click(screen.getByTestId("task-bulk-confirm"));
    await waitFor(() => expect(taskCoreApi.assign).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(onRetainFailed).not.toHaveBeenCalled();
  });
});
