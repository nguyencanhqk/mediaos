/**
 * S7-CHAT-FE-2 — ConversationPanel: 5 trong 8 trạng thái §14 hội tụ ở đây (loading · error+thử lại ·
 * empty · mất kết nối · phòng đã lưu trữ). Ba trạng thái còn lại nằm ở `MessageComposer.spec`
 * (đang gửi/gửi lỗi), `MessageBubble.spec` (đã thu hồi) và `ChatPage.spec` (không có quyền).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";

const getMessages = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    useCan: vi.fn(() => true),
    chatApi: {
      ...actual.chatApi,
      getMessages: (...args: unknown[]) => getMessages(...args),
      markRead: vi.fn().mockResolvedValue({ roomId: "", lastReadSeq: 0, unreadCount: 0 }),
    },
  };
});

import { useChatStore } from "@/stores/chat.store";
import { ConversationPanel } from "./ConversationPanel";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";

const room: ChatRoomDto = {
  id: ROOM_ID,
  companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  refId: null,
  roomType: "group",
  name: "Phòng thử",
  roomCode: "CHAT-0001",
  description: null,
  lastMessageAt: null,
  lastMessageSeq: null,
  isArchived: false,
  unreadCount: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
};

function renderPanel(
  over: Partial<ChatRoomDto> = {},
  panelProps: Partial<Parameters<typeof ConversationPanel>[0]> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ConversationPanel
          room={{ ...room, ...over }}
          members={[]}
          myRole="member"
          isInfoOpen={false}
          onToggleInfo={vi.fn()}
          {...panelProps}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Một tin có thật trong phòng — cần cho các ca phím tắt (phải trả lời được một tin nào đó). */
function seededMessage() {
  return {
    id: "00000001-1111-4111-8111-111111111111",
    companyId: room.companyId,
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
    roomSeq: 5,
    createdAt: "2026-08-04T10:00:00.000Z",
  };
}

beforeEach(() => {
  getMessages.mockReset();
  getMessages.mockResolvedValue([]);
  useChatStore.getState().resetChatStore();
});

describe("ConversationPanel · §14 loading / error / empty", () => {
  it("loading: skeleton trong lúc chờ trang đầu", () => {
    getMessages.mockReturnValue(new Promise(() => {})); // không bao giờ resolve
    renderPanel();
    expect(screen.getByTestId("chat-messages-loading")).toBeTruthy();
  });

  it("error: thông điệp + nút 'Thử lại' gọi LẠI getMessages", async () => {
    getMessages.mockRejectedValue(new Error("mạng chập"));
    renderPanel();

    const retry = await screen.findByText("Thử lại");
    expect(screen.getByText("Không tải được tin nhắn.")).toBeTruthy();

    getMessages.mockResolvedValue([]);
    retry.click();
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(2));
  });

  it("empty: 'Chưa có tin nhắn nào' + gợi ý bắt đầu", async () => {
    renderPanel();
    expect(await screen.findByText("Chưa có tin nhắn nào.")).toBeTruthy();
    expect(screen.getByText(/gửi tin đầu tiên/i)).toBeTruthy();
  });
});

describe("ConversationPanel · §14 mất kết nối", () => {
  it("KHÔNG hiện dải lúc 'connecting' (lần bắt tay đầu) và lúc 'connected'", async () => {
    renderPanel();
    await screen.findByText("Chưa có tin nhắn nào.");
    expect(screen.queryByTestId("chat-connection-banner")).toBeNull();

    useChatStore.getState().setConnectionStatus("connected");
    await waitFor(() => expect(screen.queryByTestId("chat-connection-banner")).toBeNull());
  });

  it("'disconnected' ⇒ 'đang kết nối lại'; 'polling-fallback' ⇒ nói đúng là bù mỗi 10 giây", async () => {
    renderPanel();
    await screen.findByText("Chưa có tin nhắn nào.");

    useChatStore.getState().setConnectionStatus("disconnected");
    await waitFor(() =>
      expect(screen.getByTestId("chat-connection-banner").textContent).toMatch(/kết nối lại/i),
    );

    useChatStore.getState().setConnectionStatus("polling-fallback");
    await waitFor(() => {
      const text = screen.getByTestId("chat-connection-banner").textContent ?? "";
      expect(text).toMatch(/10 giây/);
      // Nói "đang kết nối lại" ở đây là nói dối: auto-reconnect ĐÃ bị tắt.
      expect(text).not.toMatch(/đang kết nối lại/i);
    });
  });
});

describe("ConversationPanel · §14 phòng đã lưu trữ", () => {
  it("khoá ô soạn + hiện nhãn chỉ-đọc", async () => {
    renderPanel({ isArchived: true });
    await screen.findByText("Chưa có tin nhắn nào.");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByText(/vẫn đọc được nhưng không gửi tin mới/i)).toBeTruthy();
  });
});

describe("ConversationPanel · vòng đời phòng", () => {
  it("mount ⇒ theo dõi phòng (bật lưới bù); unmount ⇒ gỡ theo dõi", async () => {
    const { unmount } = renderPanel();
    await screen.findByText("Chưa có tin nhắn nào.");
    expect(useChatStore.getState().subscribedRoomIds[ROOM_ID]).toBeDefined();

    unmount();
    expect(useChatStore.getState().subscribedRoomIds[ROOM_ID]).toBeUndefined();
  });

  it("trang đầu gọi getMessages ĐÚNG phòng đang mở", async () => {
    renderPanel();
    await waitFor(() => expect(getMessages).toHaveBeenCalled());
    expect(getMessages.mock.calls[0][0]).toBe(ROOM_ID);
  });
});

/**
 * S7-CHAT-FE-4 — chế độ xem ngữ cảnh.
 *
 * Ca "gửi tin trong lúc xem ngữ cảnh" là ca nguy hiểm nhất của WO: tin vừa gửi có `roomSeq` lớn hơn cửa
 * sổ nên chốt chèn CHẶN nó. Người dùng bấm Gửi, POST thành công, và tin không xuất hiện ở đâu cả —
 * không lỗi, không cảnh báo, không cách nào đoán ra.
 */
describe("ConversationPanel · ngữ cảnh tìm kiếm", () => {
  function contextMessage(seq: number) {
    return {
      id: `${String(seq).padStart(8, "0")}-1111-4111-8111-111111111111`,
      companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      roomId: ROOM_ID,
      senderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
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

  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("đang xem ngữ cảnh ⇒ LUÔN hiện dải báo + nút thoát (không có trạng thái ẩn)", async () => {
    useChatStore.getState().hydrateRooms([room]);
    useChatStore.getState().enterMessageContext(ROOM_ID, [contextMessage(41), contextMessage(42)], {
      messageId: contextMessage(42).id,
      seq: 42,
    });
    renderPanel();

    expect(await screen.findByTestId("chat-context-banner")).toBeTruthy();
    expect(screen.getByText("Về tin mới nhất")).toBeTruthy();
  });

  it("GỬI TIN trong lúc xem ngữ cảnh ⇒ rời ngữ cảnh TRƯỚC (nếu không, tin gửi xong biến mất)", async () => {
    useChatStore.getState().hydrateRooms([room]);
    useChatStore.getState().enterMessageContext(ROOM_ID, [contextMessage(41)], {
      messageId: contextMessage(41).id,
      seq: 41,
    });
    renderPanel();
    await screen.findByTestId("chat-context-banner");

    fireEvent.change(screen.getByPlaceholderText("Nhập tin nhắn…"), {
      target: { value: "tin mới" },
    });
    fireEvent.click(screen.getByLabelText("Gửi tin nhắn"));

    await waitFor(() => expect(useChatStore.getState().contextByRoom[ROOM_ID]).toBeUndefined());
  });
});

// ── S17-CHAT-UX2-FE-2 — phím tắt khung hội thoại (done_when #6) ──────────────────────────────────────

describe("ConversationPanel · phím tắt", () => {
  it("Esc HUỶ trả lời trước, KHÔNG đóng bảng thông tin cùng lúc", async () => {
    getMessages.mockResolvedValue([seededMessage()]);
    const onToggleInfo = vi.fn();
    renderPanel({}, { isInfoOpen: true, onToggleInfo });

    fireEvent.click(await screen.findByLabelText("Trả lời"));
    expect(await screen.findByText(/Trả lời Trần B/)).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByText(/Trả lời Trần B/)).toBeNull());
    // Một lần Esc = một ý định. Đóng luôn bảng thông tin là làm hai việc cho một lần bấm.
    expect(onToggleInfo).not.toHaveBeenCalled();
  });

  it("Esc khi KHÔNG có trả lời đang chờ ⇒ đóng bảng thông tin", async () => {
    getMessages.mockResolvedValue([seededMessage()]);
    const onToggleInfo = vi.fn();
    renderPanel({}, { isInfoOpen: true, onToggleInfo });
    await screen.findByTestId("chat-composer");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onToggleInfo).toHaveBeenCalledTimes(1);
  });

  it("Esc KHÔNG đụng gì khi bảng thông tin đã đóng (không có gì để huỷ)", async () => {
    const onToggleInfo = vi.fn();
    renderPanel({}, { isInfoOpen: false, onToggleInfo });
    await screen.findByTestId("chat-composer");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onToggleInfo).not.toHaveBeenCalled();
  });

  it("Esc NHƯỜNG cho lớp nổi đang mở (popover/sheet tự đóng trước)", async () => {
    const onToggleInfo = vi.fn();
    renderPanel({}, { isInfoOpen: true, onToggleInfo });
    await screen.findByTestId("chat-composer");

    // Hợp đồng `data-floating-layer="open"` của `Popover`/`Sheet`. Thiếu vế nhường thì một lần Esc
    // đóng CẢ popover LẪN thứ nằm dưới nó.
    const layer = document.createElement("div");
    layer.setAttribute("data-floating-layer", "open");
    document.body.appendChild(layer);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onToggleInfo).not.toHaveBeenCalled();
    layer.remove();
  });

  it("Ctrl+Shift+F mở tìm-trong-phòng", async () => {
    const onSearchInRoom = vi.fn();
    renderPanel({}, { onSearchInRoom });
    await screen.findByTestId("chat-composer");

    fireEvent.keyDown(document, { key: "F", ctrlKey: true, shiftKey: true });
    expect(onSearchInRoom).toHaveBeenCalledTimes(1);
  });

  it("⌘+Shift+F cũng mở (macOS)", async () => {
    const onSearchInRoom = vi.fn();
    renderPanel({}, { onSearchInRoom });
    await screen.findByTestId("chat-composer");

    fireEvent.keyDown(document, { key: "f", metaKey: true, shiftKey: true });
    expect(onSearchInRoom).toHaveBeenCalledTimes(1);
  });

  it("KHÔNG cướp Ctrl/⌘+K — đó là phím tắt TOÀN CỤC của App Switcher", async () => {
    // `apps/app/src/layouts/home/AppSwitcher.tsx` gắn Ctrl/⌘+K trên `document` với `preventDefault`,
    // luôn sống. Bắt thêm ở đây là hai handler cùng nổ trên một lần bấm: bảng chuyển app bật lên ĐỒNG
    // THỜI với cột tìm kiếm. Ca này ghim quyết định đó lại.
    const onSearchInRoom = vi.fn();
    renderPanel({}, { onSearchInRoom });
    await screen.findByTestId("chat-composer");

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(onSearchInRoom).not.toHaveBeenCalled();
  });

  it("không có `onSearchInRoom` (drawer FE-5) ⇒ phím tắt IM, không nuốt tổ hợp của trình duyệt", async () => {
    renderPanel();
    await screen.findByTestId("chat-composer");
    const event = new KeyboardEvent("keydown", {
      key: "F",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
      bubbles: true,
    });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
