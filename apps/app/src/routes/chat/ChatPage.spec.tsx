/**
 * S7-CHAT-FE-2 — ChatPage (CHAT-SCREEN-001).
 *
 * §14 "không có quyền" là ca đắt nhất ở đây, và nó có ĐỐI CHỨNG: bài test khẳng định `useCan` được gọi
 * với ĐÚNG cặp `view:chat-room`. Chỉ khẳng định "nội dung bị ẩn" là xanh-giả — một cổng hỏi nhầm cặp
 * (vd `view:chat` không tồn tại trong seed) cũng làm nội dung bị ẩn y hệt.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";

const getRoom = vi.fn();
const getMessages = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: {
      ...actual.chatApi,
      getRoom: (...a: unknown[]) => getRoom(...a),
      getMessages: (...a: unknown[]) => getMessages(...a),
      listRooms: vi.fn().mockResolvedValue([]),
      getPinned: vi.fn().mockResolvedValue([]),
      markRead: vi.fn().mockResolvedValue({ roomId: "", lastReadSeq: 0, unreadCount: 0 }),
    },
  };
});

import { useCan } from "@mediaos/web-core";
import { useChatStore } from "@/stores/chat.store";
import { ChatPage } from "./ChatPage";

const mockUseCan = useCan as unknown as ReturnType<typeof vi.fn>;
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PEER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function room(over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id: ROOM_ID,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: "Phòng thử",
    roomCode: "CHAT-0001",
    description: null,
    lastMessageAt: "2026-08-04T10:00:00.000Z",
    lastMessageSeq: 3,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ChatPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUseCan.mockReset();
  mockUseCan.mockReturnValue(true);
  getRoom.mockReset();
  getRoom.mockResolvedValue({ ...room(), members: [], myRole: "member" });
  getMessages.mockReset();
  getMessages.mockResolvedValue([]);
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
});

describe("ChatPage · §14 không có quyền", () => {
  it("thiếu `view:chat-room` ⇒ ẩn toàn bộ nội dung chat", () => {
    mockUseCan.mockImplementation(
      (action: string, resource: string) => !(action === "view" && resource === "chat-room"),
    );
    renderPage();
    expect(screen.queryByTestId("chat-page")).toBeNull();
    expect(screen.getByText(/không có quyền xem tin nhắn nội bộ/i)).toBeTruthy();
  });

  it("ĐỐI CHỨNG: cổng hỏi ĐÚNG cặp `view:chat-room` (không phải `access:chat` hay cặp bịa)", () => {
    renderPage();
    expect(mockUseCan).toHaveBeenCalledWith("view", "chat-room");
  });

  it("có quyền ⇒ render 3 cột", async () => {
    renderPage();
    expect(await screen.findByTestId("chat-page")).toBeTruthy();
  });
});

describe("ChatPage · chọn phòng", () => {
  it("chưa chọn phòng ⇒ hướng dẫn chọn, KHÔNG gọi getRoom", async () => {
    useChatStore.getState().syncRoomList([room()], false);
    renderPage();
    expect(await screen.findByText("Chọn một cuộc trò chuyện")).toBeTruthy();
    expect(getRoom).not.toHaveBeenCalled();
  });

  it("chọn phòng ⇒ nạp chi tiết ĐÚNG phòng đó và mở hội thoại", async () => {
    useChatStore.getState().syncRoomList([room()], false);
    renderPage();

    fireEvent.click((await screen.findAllByTestId("chat-room-item"))[0]);

    await waitFor(() => expect(getRoom).toHaveBeenCalledWith(ROOM_ID));
    expect(await screen.findByTestId("chat-composer")).toBeTruthy();
  });

  it("phòng direct: tên dựng từ NGƯỜI CÒN LẠI sau khi có members, và được nhớ ở danh sách", async () => {
    useChatStore.getState().syncRoomList([room({ roomType: "direct", name: null })], false);
    getRoom.mockResolvedValue({
      ...room({ roomType: "direct", name: null }),
      members: [
        { id: "m1", roomId: ROOM_ID, userId: ME, role: "member", joinedAt: "", userName: "Tôi" },
        {
          id: "m2",
          roomId: ROOM_ID,
          userId: PEER,
          role: "member",
          joinedAt: "",
          userName: "Trần B",
        },
      ],
      myRole: "member",
    });
    renderPage();

    fireEvent.click((await screen.findAllByTestId("chat-room-item"))[0]);
    // Tên hiện ở CẢ tiêu đề hội thoại lẫn hàng danh sách (cache `resolvedNames`).
    await waitFor(() => expect(screen.getAllByText("Trần B").length).toBeGreaterThan(0));
  });

  it("phòng đang mở BIẾN MẤT khỏi store (bị bớt/tự rời) ⇒ bỏ chọn, không treo 'đang tải'", async () => {
    useChatStore.getState().syncRoomList([room()], false);
    renderPage();
    fireEvent.click((await screen.findAllByTestId("chat-room-item"))[0]);
    await screen.findByTestId("chat-composer");

    useChatStore.getState().removeRoomForSelf(ROOM_ID);

    expect(await screen.findByText("Chọn một cuộc trò chuyện")).toBeTruthy();
  });
});

describe("ChatPage · §14 loading của cột danh sách phòng", () => {
  it("CHƯA có phản hồi `GET /chat/rooms` ⇒ skeleton, KHÔNG nói 'chưa có cuộc trò chuyện nào'", () => {
    // `hydrateRooms` cố ý KHÔNG bật `hasLoadedRooms` (nó chỉ upsert vài phòng, không hứa danh sách đầy
    // đủ) — nên trạng thái này mô phỏng đúng khung hình đầu tiên sau khi vào trang.
    renderPage();
    expect(screen.getByTestId("chat-rooms-loading")).toBeTruthy();
    expect(screen.queryByText(/Chưa có cuộc trò chuyện nào/)).toBeNull();
  });

  it("đã có phản hồi và rỗng THẬT ⇒ mới được nói 'chưa có cuộc trò chuyện nào'", () => {
    useChatStore.getState().syncRoomList([], false);
    renderPage();
    expect(screen.queryByTestId("chat-rooms-loading")).toBeNull();
    expect(screen.getByText(/Chưa có cuộc trò chuyện nào/)).toBeTruthy();
  });
});

describe("ChatPage · cô lập state theo phòng", () => {
  it("đổi phòng ⇒ bảng thông tin KHÔNG mang form đã điền của phòng cũ (đổi tên nhầm phòng)", async () => {
    const ROOM_B = "22222222-2222-4222-8222-222222222222";
    useChatStore
      .getState()
      .syncRoomList([room(), room({ id: ROOM_B, name: "Phòng B", roomCode: "CHAT-0002" })], false);
    getRoom.mockImplementation((id: string) =>
      Promise.resolve({
        ...room(id === ROOM_B ? { id: ROOM_B, name: "Phòng B", roomCode: "CHAT-0002" } : {}),
        members: [],
        myRole: "admin",
      }),
    );
    renderPage();

    const rows = await screen.findAllByTestId("chat-room-item");
    fireEvent.click(rows[0]);
    await waitFor(() => expect(getRoom).toHaveBeenCalled());
    fireEvent.click(await screen.findByText("Đổi tên / mô tả"));
    expect((screen.getByLabelText("Tên phòng") as HTMLInputElement).value).toBe("Phòng thử");

    // Sang phòng khác: form PHẢI biến mất cùng state của nó (panel keyed theo roomId).
    fireEvent.click(screen.getAllByTestId("chat-room-item")[1]);
    await waitFor(() => expect(screen.queryByLabelText("Tên phòng")).toBeNull());

    fireEvent.click(await screen.findByText("Đổi tên / mô tả"));
    expect((screen.getByLabelText("Tên phòng") as HTMLInputElement).value).toBe("Phòng B");
  });
});
