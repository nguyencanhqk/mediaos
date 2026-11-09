/**
 * S20-TASK-ALLOWEDACTIONS-1 — màn chi tiết đọc `allowedActions`: nút «Đổi dự án» (cần `edit` + cặp
 * update-state THUẦN, KHÔNG qua khoá `changeState` vốn gộp điều kiện hàng) và nút Xoá (`delete`).
 * Người theo dõi (khoá ghi false) không thấy nút; việc chưa có dự án vẫn thấy «Đổi dự án» — đó chính là
 * cách đưa việc vào dự án (hồi quy review plan v2).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi } from "@mediaos/web-core";
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
    taskStatesApi: { listStates: () => Promise.resolve([]) },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({ items: [], meta: {} }),
    },
  };
});

const TASK = {
  id: "task-001",
  companyId: "co-001",
  title: "Việc không dự án",
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

function renderContent(caps: Record<string, boolean>): void {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: { "read:task": true, ...caps },
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TaskDetailContent taskId="task-001" onDeleted={vi.fn()} variant="drawer" />
    </QueryClientProvider>,
  );
}

const MANAGER_CAPS = { "update:task": true, "update-state:task": true, "delete:task": true };

describe("TaskDetailContent — allowedActions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ALLOW · việc không dự án, changeState:false (rowGuard), edit:true + cặp update-state ⇒ VẪN có «Đổi dự án»", async () => {
    vi.mocked(taskCoreApi.getTask).mockResolvedValue({
      ...TASK,
      allowedActions: { edit: true, changeState: false },
    });
    renderContent(MANAGER_CAPS);
    expect(await screen.findByTestId("task-move-project-open")).toBeInTheDocument();
  });

  it("DENY · thiếu cặp update-state ⇒ ẩn «Đổi dự án» dù edit:true", async () => {
    vi.mocked(taskCoreApi.getTask).mockResolvedValue({
      ...TASK,
      allowedActions: { edit: true, changeState: false },
    });
    renderContent({ "update:task": true });
    await screen.findByTestId("task-header-strip");
    expect(screen.queryByTestId("task-move-project-open")).not.toBeInTheDocument();
  });

  it("DENY · người chỉ theo dõi (edit:false) ⇒ ẩn «Đổi dự án» dù useCan đủ cặp", async () => {
    vi.mocked(taskCoreApi.getTask).mockResolvedValue({
      ...TASK,
      allowedActions: { edit: false, changeState: false, delete: false, lockReason: "watcher" },
    });
    renderContent(MANAGER_CAPS);
    await screen.findByTestId("task-header-strip");
    expect(screen.queryByTestId("task-move-project-open")).not.toBeInTheDocument();
  });

  it("F3 · server cũ không có trường ⇒ theo useCan: có «Đổi dự án»", async () => {
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(TASK);
    renderContent(MANAGER_CAPS);
    expect(await screen.findByTestId("task-move-project-open")).toBeInTheDocument();
  });
});
