// @vitest-environment jsdom
/**
 * S7-CHAT-FE-3 — panel chat nổi, phần KHUNG (CHAT-SCREEN-002).
 *
 * Bài này CỐ Ý mock `ChatDockWindow`: nội dung hội thoại đã có spec riêng ở FE-2
 * (`ConversationPanel.spec.tsx` · `MessageList.spec.tsx` · `use-chat-conversation.spec.tsx`) và dựng lại
 * nó ở đây chỉ làm bài test chậm hơn mà không khoá thêm hành vi nào. Bốn khẳng định còn lại thì KHÔNG
 * chỗ nào khác giữ:
 *  (a) KHÔNG render trên `/chat` — nếu vỡ, hai instance cùng phòng sẽ giết lưới bù tin của nhau
 *      (docblock ChatDock §0.2 của plan);
 *  (b) container `pointer-events-none` — nếu vỡ, dải cố định này nuốt click của trang nền ở cạnh dưới;
 *  (c) phòng biến khỏi store (bị bớt/tự rời) ⇒ tự đóng cửa sổ, không để nó nện 404;
 *  (d) chốt `hasLoadedRooms`: không đóng sạch dock ở khung hình đầu khi store còn rỗng.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ChatRoomDto } from "@mediaos/contracts";

let pathname = "/hr/employees";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname } }),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, useCan: vi.fn(() => true) };
});

vi.mock("./ChatDockWindow", () => ({
  ChatDockWindow: ({ roomId }: { roomId: string }) => (
    <div data-testid="chat-dock-window" data-room-id={roomId} />
  ),
}));

import { useCan } from "@mediaos/web-core";
import { useChatStore } from "@/stores/chat.store";
import { useChatDockStore } from "./chat-dock.store";
import { ChatDock } from "./ChatDock";

const mockUseCan = useCan as unknown as ReturnType<typeof vi.fn>;

function room(id: string): ChatRoomDto {
  return {
    id,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: `Phòng ${id}`,
    roomCode: `CHAT-${id}`,
    description: null,
    lastMessageAt: "2026-08-04T10:00:00.000Z",
    lastMessageSeq: 5,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...{},
  };
}

describe("ChatDock", () => {
  beforeEach(() => {
    pathname = "/hr/employees";
    mockUseCan.mockReturnValue(true);
    useChatDockStore.getState().resetChatDock();
    useChatStore.getState().resetChatStore();
  });

  it("vẽ một cửa sổ cho mỗi hội thoại đang mở", async () => {
    // `syncRoomList` (không `hydrateRooms`) để bật `hasLoadedRooms` — mirror đường thật ở app shell.
    useChatStore.getState().syncRoomList([room("a"), room("b")], false);
    useChatDockStore.getState().openRoom("a");
    useChatDockStore.getState().openRoom("b");

    render(<ChatDock />);
    // `findAll…` chứ không `getAll…`: `ChatDockWindow` vào qua `React.lazy` (tách khỏi bundle khởi
    // động), nên khung hình đầu là `Suspense fallback`. Dùng bản đồng bộ thì bài test chỉ xanh khi một
    // bài TRƯỚC nó đã nạp sẵn module — xanh theo thứ tự chạy, đúng loại phụ thuộc ẩn.
    expect(await screen.findAllByTestId("chat-dock-window")).toHaveLength(2);
  });

  it("KHÔNG render trên /chat (trang đã là khung nhìn đầy đủ) nhưng GIỮ trạng thái dock", () => {
    useChatStore.getState().syncRoomList([room("a")], false);
    useChatDockStore.getState().openRoom("a");
    pathname = "/chat";

    render(<ChatDock />);
    expect(screen.queryByTestId("chat-dock")).toBeNull();
    // Rời /chat là cửa sổ phải hiện lại nguyên vẹn ⇒ store KHÔNG được dọn.
    expect(useChatDockStore.getState().openRoomIds).toEqual(["a"]);
  });

  it("thiếu access:chat ⇒ không render gì", () => {
    mockUseCan.mockReturnValue(false);
    useChatStore.getState().syncRoomList([room("a")], false);
    useChatDockStore.getState().openRoom("a");

    const { container } = render(<ChatDock />);
    expect(container).toBeEmptyDOMElement();
  });

  it("container không nuốt chuột của trang nền (pointer-events-none)", () => {
    useChatStore.getState().syncRoomList([room("a")], false);
    useChatDockStore.getState().openRoom("a");

    render(<ChatDock />);
    expect(screen.getByTestId("chat-dock").className).toContain("pointer-events-none");
  });

  it("phòng biến khỏi store (bị bớt/tự rời) ⇒ tự đóng cửa sổ", async () => {
    useChatStore.getState().syncRoomList([room("a"), room("b")], false);
    useChatDockStore.getState().openRoom("a");
    useChatDockStore.getState().openRoom("b");

    const { rerender } = render(<ChatDock />);
    expect(await screen.findAllByTestId("chat-dock-window")).toHaveLength(2);

    useChatStore.getState().removeRoomForSelf("a");
    rerender(<ChatDock />);

    expect(useChatDockStore.getState().openRoomIds).toEqual(["b"]);
  });

  it("chưa nạp xong danh sách phòng ⇒ KHÔNG đóng dock (chống 'dock tự quên' sau mỗi lần F5)", () => {
    // `hasLoadedRooms === false`: `GET /chat/rooms` chưa trả về nên `roomsById` rỗng với MỌI phòng.
    useChatDockStore.getState().openRoom("a");
    expect(useChatStore.getState().hasLoadedRooms).toBe(false);

    render(<ChatDock />);
    expect(useChatDockStore.getState().openRoomIds).toEqual(["a"]);
  });
});
