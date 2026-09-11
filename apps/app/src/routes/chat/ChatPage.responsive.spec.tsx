// @vitest-environment jsdom
/**
 * S17-CHAT-UX2-FE-5 — `/chat` responsive ba mốc (CHAT-DEC-026 · SPEC-15 §9 CHAT-SCREEN-001 v2).
 *
 * Tách khỏi `ChatPage.spec.tsx` vì mọi ca ở đây phải stub `matchMedia`, còn bộ cũ CỐ Ý chạy không có nó
 * (fail-soft ⇒ mốc ba cột) — trộn hai khuôn vào một file là mở đường cho một ca quên dọn stub và kéo
 * theo cả bộ sang mốc khác.
 *
 * Mỗi mốc khẳng định CẢ cái có LẪN cái không: "hai cột" mà chỉ đo "có danh sách" thì ba cột cũng xanh.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

import { useChatStore } from "@/stores/chat.store";
import { CHAT_MD_QUERY, CHAT_XL_QUERY } from "@/components/chat/use-chat-viewport";
import { ChatPage } from "./ChatPage";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

type Listener = () => void;

/**
 * `matchMedia` trả `matches` THEO QUERY, không trả một hằng số.
 *
 * Mock trả cứng làm cả ba mốc đọc cùng một giá trị: bài test vẫn xanh nhưng chỉ chứng minh hook có gọi
 * `matchMedia`, chứ không chứng minh trang phân biệt được ba bố cục.
 */
function stubViewport(initialWidth: number) {
  const listeners = new Set<Listener>();
  let width = initialWidth;

  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        if (query === CHAT_XL_QUERY) return width >= 1280;
        if (query === CHAT_MD_QUERY) return width >= 768;
        throw new Error(`query ngoài hợp đồng: ${query}`);
      },
      media: query,
      addEventListener: (_t: string, cb: Listener) => listeners.add(cb),
      removeEventListener: (_t: string, cb: Listener) => listeners.delete(cb),
    })),
  );

  return {
    resizeTo(next: number) {
      width = next;
      for (const cb of [...listeners]) cb();
    },
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

/** Chọn phòng bằng đúng thao tác người dùng làm (bấm dòng phòng ở cột trái). */
async function selectRoom(): Promise<void> {
  fireEvent.click(await screen.findByText("Phòng thử"));
  await screen.findByTestId("chat-conversation");
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  getRoom.mockReset();
  getRoom.mockResolvedValue({ ...room(), members: [], myRole: "member" });
  getMessages.mockReset();
  getMessages.mockResolvedValue([]);
  search.mockReset();
  search.mockResolvedValue({ data: [], nextCursor: null });
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
  useChatStore.getState().syncRoomList([room()], false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatPage · mốc ≥1280 (ba cột)", () => {
  it("danh sách + hội thoại + bảng thông tin là CỘT, KHÔNG có Sheet", async () => {
    stubViewport(1440);
    renderPage();
    await selectRoom();

    expect(screen.getByTestId("chat-room-list")).toBeTruthy();
    expect(screen.getByTestId("chat-conversation")).toBeTruthy();
    expect(screen.getByTestId("chat-room-info").getAttribute("data-variant")).toBe("page");
    // Vế "KHÔNG": thiếu nó thì một bố cục hai cột kèm Sheet cũng xanh.
    expect(screen.queryByTestId("chat-info-sheet")).toBeNull();
  });

  it("KHÔNG có nút ‹ (danh sách vẫn nằm ngay bên trái)", async () => {
    stubViewport(1440);
    renderPage();
    await selectRoom();

    expect(screen.queryByTestId("chat-header-back")).toBeNull();
  });
});

describe("ChatPage · mốc 768–1279 (hai cột + Sheet)", () => {
  it("mặc định KHÔNG bung Sheet — người dùng chưa bấm gì", async () => {
    stubViewport(1024);
    renderPage();
    await selectRoom();

    // Đây là lý do trang giữ HAI state "info đang mở": dùng chung một state mặc định `true` sẽ che kín
    // hội thoại ngay khi mở trang ở màn 1024px.
    expect(screen.queryByTestId("chat-info-sheet")).toBeNull();
    expect(screen.queryByTestId("chat-room-info")).toBeNull();
  });

  it("bấm ⓘ ⇒ bảng thông tin mở dạng Sheet, danh sách phòng VẪN thấy", async () => {
    stubViewport(1024);
    renderPage();
    await selectRoom();

    fireEvent.click(screen.getByLabelText(i18n.t("chat:conversation.infoToggle")));

    expect(await screen.findByTestId("chat-info-sheet")).toBeTruthy();
    expect(screen.getByTestId("chat-room-info").getAttribute("data-variant")).toBe("sheet");
    // "Hai cột": danh sách không bị đẩy đi như ở mốc một cột.
    expect(screen.getByTestId("chat-room-list")).toBeTruthy();
  });

  it("bấm NỀN không đóng Sheet (RoomInfoPanel giữ nháp đổi tên bằng state cục bộ)", async () => {
    stubViewport(1024);
    const { container } = renderPage();
    await selectRoom();

    fireEvent.click(screen.getByLabelText(i18n.t("chat:conversation.infoToggle")));
    await screen.findByTestId("chat-info-sheet");

    // Nền của Sheet là node `role="presentation"` DUY NHẤT trên trang ở mốc này.
    fireEvent.click(container.querySelector('[role="presentation"]')!);
    expect(screen.getByTestId("chat-info-sheet")).toBeTruthy();

    // ĐỐI CHỨNG trong cùng ca: `closeOnBackdrop={false}` không được khoá luôn nút đóng — nếu không,
    // panel thành cái bẫy chỉ thoát được bằng Esc.
    fireEvent.click(screen.getByTestId("sheet-close"));
    expect(screen.queryByTestId("chat-info-sheet")).toBeNull();
  });

  it("Esc đóng Sheet ĐÚNG MỘT lần (không đóng rồi mở lại)", async () => {
    /*
     * Ca này khoá `escapeClosesInfo`. Nếu `ConversationPanel` cũng xử Esc ở mốc này, React gộp batch
     * `setInfoSheetOpen(false)` rồi `setInfoSheetOpen(v => !v)` ⇒ `false` → `true` và Sheet KHÔNG BAO
     * GIỜ đóng được bằng Esc — mà `done_when` #4 lại đòi đúng điều đó.
     */
    stubViewport(1024);
    renderPage();
    await selectRoom();

    fireEvent.click(screen.getByLabelText(i18n.t("chat:conversation.infoToggle")));
    await screen.findByTestId("chat-info-sheet");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("chat-info-sheet")).toBeNull();
  });
});

describe("ChatPage · mốc <768 (một khung)", () => {
  it("chưa chọn phòng ⇒ CHỈ danh sách (không có hero cạnh nó)", async () => {
    stubViewport(390);
    renderPage();

    expect(await screen.findByTestId("chat-room-list")).toBeTruthy();
    expect(screen.queryByTestId("chat-empty-hero")).toBeNull();
  });

  it("chọn phòng ⇒ hội thoại + nút ‹, danh sách BIẾN; bấm ‹ ⇒ về danh sách", async () => {
    stubViewport(390);
    renderPage();
    await selectRoom();

    expect(screen.queryByTestId("chat-room-list")).toBeNull();
    const back = screen.getByTestId("chat-header-back");

    fireEvent.click(back);

    expect(await screen.findByTestId("chat-room-list")).toBeTruthy();
    expect(screen.queryByTestId("chat-conversation")).toBeNull();
  });

  it("bảng thông tin mở TOÀN MÀN (max-w-none), không phải panel 400px", async () => {
    stubViewport(390);
    renderPage();
    await selectRoom();

    fireEvent.click(screen.getByLabelText(i18n.t("chat:conversation.infoToggle")));

    // ⚠️ Khẳng định CHUỖI CLASS — jsdom không tính CSS. Nó bắt được việc ai đó bỏ `max-w-none` (khi ấy
    // `max-w-2xl` mặc định của Sheet thắng), nhưng KHÔNG chứng minh trình duyệt vẽ ra sao.
    const sheet = await screen.findByTestId("chat-info-sheet");
    expect(sheet.className).toContain("max-w-none");
  });

  it("mở tìm kiếm rồi bấm một kết quả ⇒ đúng MỘT khung (không hai khung w-full chồng nhau)", async () => {
    search.mockResolvedValue({
      data: [
        {
          id: "00000001-1111-4111-8111-111111111111",
          roomId: ROOM_ID,
          roomName: "Phòng thử",
          roomType: "group",
          senderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          senderName: "Trần B",
          body: "xin chào",
          roomSeq: 3,
          createdAt: "2026-08-04T10:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
    getMessages.mockResolvedValue([
      {
        id: "00000001-1111-4111-8111-111111111111",
        companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        roomId: ROOM_ID,
        senderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        senderName: "Trần B",
        body: "xin chào",
        messageType: "text" as const,
        mentions: [],
        pinnedAt: null,
        pinnedBy: null,
        replyToMessageId: null,
        recalledAt: null,
        attachmentCount: 0,
        attachments: [],
        roomSeq: 3,
        createdAt: "2026-08-04T10:00:00.000Z",
      },
    ]);

    stubViewport(390);
    renderPage();

    fireEvent.click(await screen.findByTestId("chat-open-search"));
    fireEvent.change(await screen.findByTestId("chat-search-input"), {
      target: { value: "xin chào" },
    });
    fireEvent.click(await screen.findByTestId("chat-search-result"));

    // `jumpToMessage` tự `setSelectedRoomId`, nên nếu cột tìm kiếm không tự đóng ở mốc này thì nó và
    // hội thoại — cả hai `w-full` — nằm cạnh nhau.
    expect(await screen.findByTestId("chat-conversation")).toBeTruthy();
    expect(screen.queryByTestId("chat-search-panel")).toBeNull();
    expect(screen.queryByTestId("chat-room-list")).toBeNull();
  });
});

describe("ChatPage · đổi mốc KHÔNG dựng lại cột hội thoại", () => {
  it("three → two ⇒ VẪN là cùng một node DOM (không remount)", async () => {
    /*
     * Đo ĐỊNH DANH NODE, không đo `subscribedRoomIds`.
     *
     * `useChatConversation` gỡ khoá lúc unmount rồi thêm lại lúc mount, mà React chạy passive-unmount
     * TRƯỚC passive-mount trong CÙNG một commit ⇒ `subscribedRoomIds` kết thúc y hệt dù có remount hay
     * không. Một khẳng định trên nó sẽ xanh cả khi bố cục đang dựng lại cả cột — và remount ở đây không
     * im lặng: cleanup chạy `trimRoomHistory`, cắt lịch sử về 200 tin.
     */
    const viewport = stubViewport(1440);
    renderPage();
    await selectRoom();

    const before = screen.getByTestId("chat-conversation");

    act(() => viewport.resizeTo(1024));

    expect(screen.getByTestId("chat-conversation")).toBe(before);
    // ĐỐI CHỨNG: mốc THẬT SỰ đã đổi (nếu không, ca trên xanh vì chẳng có gì xảy ra).
    expect(screen.getByTestId("chat-page").getAttribute("data-layout")).toBe("two");
  });

  it("two → single ⇒ danh sách biến nhưng hội thoại vẫn là node cũ", async () => {
    const viewport = stubViewport(1024);
    renderPage();
    await selectRoom();

    const before = screen.getByTestId("chat-conversation");
    expect(screen.getByTestId("chat-room-list")).toBeTruthy();

    act(() => viewport.resizeTo(390));

    expect(screen.queryByTestId("chat-room-list")).toBeNull();
    expect(screen.getByTestId("chat-conversation")).toBe(before);
  });
});
