/**
 * S20-CHAT-DISCUSS-1 (US-CHAT-NV-11) — «Thảo luận» trên header workspace dự án.
 *
 * Tách khỏi `ProjectDetailPage.spec.tsx` (761 dòng) để tệp đó không vượt trần 800. Khối mock giữ
 * đúng hình dạng của tệp gốc: trang không dựng RouterProvider, mọi API TASK là mock.
 * Quyền CHAT đo bằng `useCan` thật; mạng CHAT đo bằng spy `fetch` thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, taskProjectApi } from "@mediaos/web-core";
import type { ChatRoomDto, TaskProjectResponseDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "@/components/chat/chat-dock.store";
import { ProjectDetailPage } from "./ProjectDetailPage";

const PROJECT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { push: vi.fn(), replace: vi.fn() } }),
    useRouterState: ({
      select,
    }: {
      select: (s: { location: { pathname: string; search: Record<string, unknown> } }) => unknown;
    }) => select({ location: { pathname: `/tasks/projects/${PROJECT_ID}`, search: {} } }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskProjectApi: {
      getProject: vi.fn(),
      listMembers: vi.fn().mockResolvedValue([]),
    },
    taskCoreApi: { listTasks: vi.fn().mockResolvedValue([]), getTask: vi.fn() },
    dashboardApi: {
      getWidgetData: vi.fn().mockResolvedValue({
        widget_code: "PROJECT_PROGRESS",
        widget_type: "Chart",
        status: "Empty",
        data: null,
        empty_state: { message: "Dự án chưa có công việc" },
        error_state: null,
        last_updated_at: null,
        cache: null,
        quick_actions: [],
      }),
    },
  };
});

const PROJECT: TaskProjectResponseDto = {
  id: PROJECT_ID,
  companyId: "co-001",
  code: "WEB",
  name: "Website Revamp",
  description: null,
  ownerEmployeeId: "emp-001",
  ownerName: "Nguyễn Văn A",
  departmentId: null,
  departmentName: null,
  priority: "High",
  status: "Active",
  startDate: "2026-01-01",
  endDate: "2026-06-30",
  memberCount: 3,
  myProjectRole: null,
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  closedAt: null,
  closedBy: null,
};

function projectRoom(over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id: ROOM_ID,
    companyId: "co-001",
    refId: PROJECT_ID,
    roomType: "project",
    name: "Website Revamp",
    roomCode: "CHAT-WEB",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as ChatRoomDto;
}

function setCaps(caps: Record<string, boolean>): void {
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

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectDetailPage projectId={PROJECT_ID} onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

const ALL_CAPS = { "read:project": true, "access:chat": true, "view:chat-room": true };
const discussBtn = () => screen.queryByRole("button", { name: /Thảo luận/ });
const chatCalls = (spy: MockInstance<typeof fetch>) =>
  spy.mock.calls.filter(([url]) => String(url).includes("/chat/"));

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

describe("ProjectDetailPage — «Thảo luận» (S20-CHAT-DISCUSS-1)", () => {
  it("phòng dự án có trong danh sách của tôi ⇒ nút trên header, bấm mở drawer, trang giữ nguyên", async () => {
    setCaps(ALL_CAPS);
    vi.mocked(taskProjectApi.getProject).mockResolvedValue(PROJECT);
    useChatStore.getState().syncRoomList([projectRoom()], false);
    renderPage();

    const button = await screen.findByRole("button", { name: /Thảo luận/ });
    fireEvent.click(button);

    expect(useChatDockStore.getState().openRoomIds).toEqual([ROOM_ID]);
    expect(useChatDockStore.getState().isOpen).toBe(true);
    // Trang không đổi: tiêu đề dự án vẫn ở đó.
    expect(screen.getByRole("heading", { name: "Website Revamp" })).toBeInTheDocument();
    expect(chatCalls(fetchSpy)).toHaveLength(0);
  });

  it("xem được dự án nhưng phòng không có trong danh sách của tôi ⇒ không nút, 0 lời gọi API phòng", async () => {
    setCaps(ALL_CAPS);
    vi.mocked(taskProjectApi.getProject).mockResolvedValue(PROJECT);
    useChatStore.getState().syncRoomList([], false);
    renderPage();

    await screen.findByRole("heading", { name: "Website Revamp" });
    expect(discussBtn()).not.toBeInTheDocument();
    expect(chatCalls(fetchSpy)).toHaveLength(0);
  });

  it("không có cặp xem CHAT ⇒ không nút dù phòng có trong danh sách", async () => {
    setCaps({ "read:project": true, "access:chat": true });
    vi.mocked(taskProjectApi.getProject).mockResolvedValue(PROJECT);
    useChatStore.getState().syncRoomList([projectRoom()], false);
    renderPage();

    await screen.findByRole("heading", { name: "Website Revamp" });
    expect(discussBtn()).not.toBeInTheDocument();
  });

  it("tôi là thành viên dự án mà phòng chưa đồng bộ ⇒ nút vô hiệu kèm «Phòng dự án đang được tạo»", async () => {
    setCaps(ALL_CAPS);
    vi.mocked(taskProjectApi.getProject).mockResolvedValue({
      ...PROJECT,
      myProjectRole: "Member",
    });
    useChatStore.getState().syncRoomList([], false);
    renderPage();

    const button = await screen.findByRole("button", { name: /Thảo luận/ });
    expect(button).toBeDisabled();
    expect(screen.getByText("Phòng dự án đang được tạo")).toBeInTheDocument();
    expect(chatCalls(fetchSpy)).toHaveLength(0);
  });

  it("dự án đã đóng (Completed) mà phòng không có trong danh sách ⇒ không nút, không nói «đang được tạo»", async () => {
    setCaps(ALL_CAPS);
    vi.mocked(taskProjectApi.getProject).mockResolvedValue({
      ...PROJECT,
      status: "Completed",
      myProjectRole: "Member",
    });
    useChatStore.getState().syncRoomList([], false);
    renderPage();

    await screen.findByRole("heading", { name: "Website Revamp" });
    expect(discussBtn()).not.toBeInTheDocument();
    expect(screen.queryByText("Phòng dự án đang được tạo")).not.toBeInTheDocument();
  });
});
