/**
 * S20-CHAT-DISCUSS-1 (US-CHAT-NV-11) — «Thảo luận» ở chi tiết việc: chỉ khi việc thuộc dự án, và mở
 * phòng của DỰ ÁN (không có phòng theo việc — CHAT-DEC-009). Mock giữ hình dạng `TaskDetailPage.spec`.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskCoreApi } from "@mediaos/web-core";
import type { ChatRoomDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "@/components/chat/chat-dock.store";
import { TaskDetailContent } from "./TaskDetailContent";

const PROJECT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: {
      getTask: vi.fn(),
      listWatchers: vi.fn().mockResolvedValue([]),
    },
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

const TASK: TaskCoreResponseDto = {
  id: "task-001",
  companyId: "co-001",
  title: "Chuẩn bị báo cáo tuần",
  description: null,
  taskType: "office",
  status: "Todo",
  priority: "Medium",
  projectId: PROJECT_ID,
  projectName: "Website Revamp",
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
};

const PROJECT_ROOM = {
  id: ROOM_ID,
  companyId: "co-001",
  refId: PROJECT_ID,
  roomType: "project",
  name: "Website Revamp",
  roomCode: "CHAT-WEB",
  createdAt: "2026-01-01T00:00:00.000Z",
} as ChatRoomDto;

function renderContent(): void {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: { "read:task": true, "access:chat": true, "view:chat-room": true },
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

const discussBtn = () => screen.queryByRole("button", { name: /Thảo luận/ });
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.getState().resetChatStore();
  useChatDockStore.getState().resetChatDock();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("TaskDetailContent — «Thảo luận» (S20-CHAT-DISCUSS-1)", () => {
  it("việc thuộc dự án + phòng dự án có trong danh sách ⇒ bấm mở phòng của DỰ ÁN trong drawer", async () => {
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(TASK);
    useChatStore.getState().syncRoomList([PROJECT_ROOM], false);
    renderContent();

    fireEvent.click(await screen.findByRole("button", { name: /Thảo luận/ }));

    expect(useChatDockStore.getState().openRoomIds).toEqual([ROOM_ID]);
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("/chat/"))).toHaveLength(0);
  });

  it("việc không thuộc dự án ⇒ không có nút", async () => {
    vi.mocked(taskCoreApi.getTask).mockResolvedValue({
      ...TASK,
      projectId: null,
      projectName: null,
    });
    useChatStore.getState().syncRoomList([PROJECT_ROOM], false);
    renderContent();

    await screen.findByTestId("task-header-strip");
    expect(discussBtn()).not.toBeInTheDocument();
  });

  it("việc thuộc dự án nhưng phòng không có trong danh sách của tôi ⇒ không nút (không suy «đang tạo»)", async () => {
    vi.mocked(taskCoreApi.getTask).mockResolvedValue(TASK);
    useChatStore.getState().syncRoomList([], false);
    renderContent();

    await screen.findByTestId("task-header-strip");
    expect(discussBtn()).not.toBeInTheDocument();
    expect(screen.queryByText("Phòng dự án đang được tạo")).not.toBeInTheDocument();
  });
});
