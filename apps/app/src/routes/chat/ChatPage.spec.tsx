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
const search = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: {
      ...actual.chatApi,
      getRoom: (...a: unknown[]) => getRoom(...a),
      getMessages: (...a: unknown[]) => getMessages(...a),
      search: (...a: unknown[]) => search(...a),
      listRoomFiles: vi.fn().mockResolvedValue([]),
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
  // jsdom KHÔNG implement `scrollIntoView` — stub cho đường "cuộn tới tin được làm nổi" của FE-4
  // (cùng khuôn `TaskCommentThread.spec.tsx`). Thiếu nó thì effect NÉM và cả cây component chết,
  // biến một bài test về con trỏ thành một bài test về jsdom.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  mockUseCan.mockReset();
  mockUseCan.mockReturnValue(true);
  getRoom.mockReset();
  getRoom.mockResolvedValue({ ...room(), members: [], myRole: "member" });
  getMessages.mockReset();
  getMessages.mockResolvedValue([]);
  search.mockReset();
  search.mockResolvedValue({ data: [], nextCursor: null });
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

/**
 * S7-CHAT-FE-4 — tìm kiếm + nhảy tới tin trong ngữ cảnh (CHAT-SCREEN-005).
 *
 * Ca đắt nhất là con trỏ: `/messages` KHÔNG có `aroundSeq`, nên cửa sổ dựng bằng hai lời gọi và
 * `beforeSeq` là vị từ LOẠI TRỪ. Viết `beforeSeq: seq` (thay vì `seq + 1`) làm rơi đúng tin người dùng
 * vừa bấm vào — màn hình mở ra "gần đúng chỗ" và không ai gọi đó là bug.
 */
describe("ChatPage · tìm kiếm + nhảy tới ngữ cảnh", () => {
  const searchResult = {
    id: "00000042-1111-4111-8111-111111111111",
    roomId: ROOM_ID,
    roomName: "Phòng thử",
    roomType: "group" as const,
    roomSeq: 42,
    senderId: PEER,
    senderName: "Trần B",
    body: "báo cáo tuần",
    createdAt: "2026-08-04T09:00:00.000Z",
    attachmentCount: 0,
  };

  function contextMessage(seq: number) {
    return {
      id: `${String(seq).padStart(8, "0")}-1111-4111-8111-111111111111`,
      companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      roomId: ROOM_ID,
      senderId: PEER,
      senderName: "Trần B",
      body: `tin ${seq}`,
      messageType: "text" as const,
      mentions: [],
      pinnedAt: null,
      pinnedBy: null,
      replyToMessageId: null,
      recalledAt: null,
      attachmentCount: 0,
      attachments: [],
      roomSeq: seq,
      createdAt: "2026-08-04T09:00:00.000Z",
    };
  }

  it("mở panel tìm kiếm từ danh sách phòng, đóng lại thì về danh sách", async () => {
    useChatStore.getState().syncRoomList([room()], false);
    renderPage();

    fireEvent.click(await screen.findByTestId("chat-open-search"));
    expect(await screen.findByTestId("chat-search-panel")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Quay lại danh sách phòng"));
    await waitFor(() => expect(screen.queryByTestId("chat-search-panel")).toBeNull());
    expect(screen.getAllByTestId("chat-room-item").length).toBeGreaterThan(0);
  });

  /**
   * Ca này bắt một lỗi THẬT đã xảy ra khi viết WO: nút phạm vi ban đầu gửi lại `scope.roomId` hiện tại,
   * mà ở phạm vi "tất cả" giá trị đó là `null` ⇒ bấm "Trong phòng này" gửi `null` và không đổi gì.
   * Bài test của riêng panel KHÔNG bắt được (nó stub `onScopeChange`) — phải đo ở chỗ nối dây.
   */
  it("đổi phạm vi sang 'Trong phòng này' ⇒ truy vấn KÈM roomId của phòng đang mở", async () => {
    useChatStore.getState().syncRoomList([room()], false);
    renderPage();

    fireEvent.click(await screen.findByTestId("chat-room-item"));
    fireEvent.click(screen.getByTestId("chat-open-search"));
    fireEvent.change(screen.getByTestId("chat-search-input"), { target: { value: "báo cáo" } });
    await waitFor(() => expect(search).toHaveBeenLastCalledWith({ q: "báo cáo", limit: 20 }));

    fireEvent.click(screen.getByText(/^Trong: /));
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith({ q: "báo cáo", limit: 20, roomId: ROOM_ID }),
    );
  });

  it("bấm kết quả ⇒ nạp cửa sổ bằng ĐÚNG hai con trỏ (beforeSeq = seq + 1, afterSeq = seq)", async () => {
    useChatStore.getState().syncRoomList([room({ lastMessageSeq: 500 })], false);
    search.mockResolvedValue({ data: [searchResult], nextCursor: null });
    getMessages.mockImplementation((_roomId: string, q?: { beforeSeq?: number }) =>
      Promise.resolve(
        q?.beforeSeq === 43 ? [contextMessage(41), contextMessage(42)] : [contextMessage(43)],
      ),
    );
    renderPage();

    fireEvent.click(await screen.findByTestId("chat-open-search"));
    fireEvent.change(screen.getByTestId("chat-search-input"), { target: { value: "báo cáo" } });
    fireEvent.click(await screen.findByTestId("chat-search-result"));

    await waitFor(() =>
      expect(getMessages).toHaveBeenCalledWith(ROOM_ID, { beforeSeq: 43, limit: 25 }),
    );
    expect(getMessages).toHaveBeenCalledWith(ROOM_ID, { afterSeq: 42, limit: 25 });

    // Cửa sổ THAY THẾ danh sách + mỏ neo trỏ đúng tin đích.
    await waitFor(() =>
      expect(useChatStore.getState().contextByRoom[ROOM_ID]).toMatchObject({
        targetSeq: 42,
        windowEndSeq: 43,
      }),
    );
    expect(await screen.findByTestId("chat-context-banner")).toBeTruthy();
  });

  it("tin đích KHÔNG có trong cửa sổ (đã thu hồi) ⇒ báo lỗi, KHÔNG vào chế độ ngữ cảnh", async () => {
    useChatStore.getState().syncRoomList([room()], false);
    search.mockResolvedValue({ data: [searchResult], nextCursor: null });
    getMessages.mockResolvedValue([contextMessage(41)]); // thiếu tin 42

    renderPage();
    fireEvent.click(await screen.findByTestId("chat-open-search"));
    fireEvent.change(screen.getByTestId("chat-search-input"), { target: { value: "báo cáo" } });
    fireEvent.click(await screen.findByTestId("chat-search-result"));

    expect(await screen.findByText(/Không mở được tin đó/)).toBeTruthy();
    expect(useChatStore.getState().contextByRoom[ROOM_ID]).toBeUndefined();
  });

  it("'Về tin mới nhất' ⇒ xoá mỏ neo và nạp lại trang mới nhất", async () => {
    useChatStore.getState().syncRoomList([room({ lastMessageSeq: 500 })], false);
    search.mockResolvedValue({ data: [searchResult], nextCursor: null });
    getMessages.mockImplementation((_roomId: string, q?: { beforeSeq?: number }) =>
      Promise.resolve(q?.beforeSeq === 43 ? [contextMessage(42)] : [contextMessage(43)]),
    );
    renderPage();

    fireEvent.click(await screen.findByTestId("chat-open-search"));
    fireEvent.change(screen.getByTestId("chat-search-input"), { target: { value: "báo cáo" } });
    fireEvent.click(await screen.findByTestId("chat-search-result"));
    await screen.findByTestId("chat-context-banner");

    fireEvent.click(screen.getByText("Về tin mới nhất"));
    await waitFor(() => expect(useChatStore.getState().contextByRoom[ROOM_ID]).toBeUndefined());
    await waitFor(() => expect(screen.queryByTestId("chat-context-banner")).toBeNull());
  });
});
