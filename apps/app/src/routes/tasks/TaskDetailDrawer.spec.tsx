import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi } from "@mediaos/web-core";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

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
