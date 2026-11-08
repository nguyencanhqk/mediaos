/**
 * S20-TASK-LEAVEHANDOFF-1 (vá review) — ô soạn bình luận chỉ autofocus MỘT lần cho mỗi lần điều hướng
 * `?taskTab=comment`: đổi sang tab Tệp rồi quay lại «Bình luận» không được cướp focus.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TaskDetailContent } from "./TaskDetailContent";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { getTask: vi.fn(), listWatchers: vi.fn().mockResolvedValue([]) },
    taskCollabApi: {
      listComments: vi.fn().mockResolvedValue([]),
      listChecklists: vi.fn().mockResolvedValue([]),
      listActivity: vi.fn().mockResolvedValue([]),
    },
    taskFileApi: { getTaskFiles: vi.fn().mockResolvedValue([]) },
    taskProjectApi: { listProjects: vi.fn().mockResolvedValue([]) },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
    },
  };
});

const TASK = {
  id: "task-001",
  companyId: "co-001",
  title: "Chuẩn bị báo cáo tuần",
  description: null,
  taskType: "office",
  status: "Todo",
  priority: "Medium",
  projectId: null,
  projectName: null,
  mainAssigneeEmployeeId: null,
  assigneeName: null,
  creatorUserId: "u1",
  creatorName: "Test User",
  reporterEmployeeId: null,
  reporterName: null,
  departmentId: null,
  dueAt: null,
  startAt: null,
  completedAt: null,
  isOverdue: false,
  createdBy: "u1",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
} as TaskCoreResponseDto;

function renderContent() {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: { "read:task": true, "comment:task": true },
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskDetailContent
        taskId="task-001"
        onDeleted={vi.fn()}
        variant="drawer"
        initialBreakdownTab="comment"
      />
    </QueryClientProvider>,
  );
}

describe("TaskDetailContent — autofocus ô soạn một lần", () => {
  beforeEach(async () => {
    const { taskCoreApi } = await import("@mediaos/web-core");
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(TASK);
  });

  it("focus ô soạn khi mở bằng taskTab=comment, nhưng quay lại tab Bình luận không cướp focus", async () => {
    renderContent();
    const composer = await screen.findByPlaceholderText(/viết bình luận/i);
    expect(composer).toHaveFocus();

    const filesTab = screen.getByRole("tab", { name: /tệp/i });
    fireEvent.mouseDown(filesTab);
    fireEvent.click(filesTab);
    const commentsTab = screen.getByRole("tab", { name: /bình luận/i });
    fireEvent.mouseDown(commentsTab);
    fireEvent.click(commentsTab);

    expect(await screen.findByPlaceholderText(/viết bình luận/i)).not.toHaveFocus();
  });
});
