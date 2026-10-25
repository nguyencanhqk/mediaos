/**
 * S20-CHAT-UNREAD-1 — mở phòng có tin mới là đứng ở tin chưa đọc ĐẦU TIÊN dưới vạch «N tin chưa đọc»
 * (US-CHAT-NV-04, SPEC-15 §13.2 · §14).
 *
 * Ca đắt nhất là ca đầu: mã cũ khởi tạo `isNearBottom = true` ⇒ lần vẽ đầu cuộn thẳng xuống đáy VÀ gọi
 * `onMarkRead` ngay, nên badge về 0 trước khi người dùng kịp đọc tin nào.
 *
 * jsdom KHÔNG có layout. Hình học được giả lập ở tầng prototype TRƯỚC khi render (lần định vị chạy trong
 * `useLayoutEffect` của lần vẽ đầu — gắn số đo lên phần tử sau `render()` là quá muộn): khung cuộn cao
 * `clientHeight`, nội dung cao `scrollHeight`, vạch nằm ở toạ độ nội dung `dividerTop`. `getBoundingClientRect`
 * của vạch trừ `scrollTop` hiện tại — đúng quan hệ trình duyệt thật áp.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto } from "@mediaos/contracts";
import type { StoredChatMessage } from "@/stores/chat.store";
import { MessageList } from "./MessageList";
import { UNREAD_DIVIDER_TOP_GAP_PX } from "./chat-unread";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BASE_TIME = Date.parse("2026-08-04T08:00:00.000Z");

function roomWith(over: Partial<ChatRoomDto>): ChatRoomDto {
  return {
    id: ROOM_ID,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: "Phòng thử",
    roomCode: "CHAT-0001",
    description: null,
    lastMessageAt: "2026-08-04T10:00:00.000Z",
    lastMessageSeq: 125,
    isArchived: false,
    unreadCount: 25,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function idOf(seq: number): string {
  return `${String(seq).padStart(8, "0")}-1111-4111-8111-111111111111`;
}

function message(seq: number, over: Partial<StoredChatMessage> = {}): StoredChatMessage {
  return {
    id: idOf(seq),
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomId: ROOM_ID,
    senderId: OTHER,
    senderName: "Trần B",
    body: `tin ${seq}`,
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: seq,
    // Cách nhau 10 phút ⇒ không gộp cụm, mỗi tin một bong bóng có tên — dễ đọc khi ca đỏ.
    createdAt: new Date(BASE_TIME + seq * 10 * 60 * 1000).toISOString(),
    ...over,
  };
}

function range(from: number, to: number): StoredChatMessage[] {
  const out: StoredChatMessage[] = [];
  for (let seq = from; seq <= to; seq += 1) out.push(message(seq));
  return out;
}

const noopActions = {
  onReply: vi.fn(),
  onPin: vi.fn(),
  onUnpin: vi.fn(),
  onRecall: vi.fn(),
  onToggleReaction: vi.fn(),
  onCopy: vi.fn(),
};

interface ListProps {
  room: ChatRoomDto;
  messages: readonly StoredChatMessage[];
  hasMoreOlder?: boolean;
  historyLimitReached?: boolean;
  isFirstPageLoaded?: boolean;
  onLoadOlder?: () => Promise<number>;
  onMarkRead?: (seq: number) => void;
  highlightMessageId?: string | null;
}

function listElement(props: ListProps): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <MessageList
        room={props.room}
        messages={props.messages}
        pending={[]}
        members={[]}
        myUserId={ME}
        myRole="member"
        canRecallPair={false}
        canPinPair={false}
        hasMoreOlder={props.hasMoreOlder ?? false}
        isLoadingOlder={false}
        historyLimitReached={props.historyLimitReached ?? false}
        isFirstPageLoaded={props.isFirstPageLoaded}
        onLoadOlder={props.onLoadOlder ?? (() => Promise.resolve(0))}
        onMarkRead={props.onMarkRead ?? vi.fn()}
        highlightMessageId={props.highlightMessageId ?? null}
        onResendPending={vi.fn()}
        onDiscardPending={vi.fn()}
        actions={noopActions}
      />
    </I18nextProvider>
  );
}

interface FakeLayout {
  scrollHeight: number;
  clientHeight: number;
  /** Toạ độ NỘI DUNG (tính từ đỉnh nội dung cuộn, không phải từ màn hình) của vạch chưa đọc. */
  dividerTop: number;
}

const SCROLLER = "chat-message-scroll";
const DIVIDER = "chat-unread-divider";

function scroller(): HTMLElement {
  return screen.getByTestId(SCROLLER);
}

/** Hình học giả cho MỌI phần tử — cài TRƯỚC `render()` (xem docblock đầu tệp). */
function installLayout(layout: FakeLayout): void {
  const testIdOf = (el: Element): string | null => el.getAttribute("data-testid");
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
    return testIdOf(this) === SCROLLER ? layout.scrollHeight : 0;
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return testIdOf(this) === SCROLLER ? layout.clientHeight : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const scrollEl = document.querySelector(`[data-testid="${SCROLLER}"]`);
    const top = testIdOf(this) === DIVIDER ? layout.dividerTop - (scrollEl?.scrollTop ?? 0) : 0;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top } as DOMRect;
  });
}

/** Người dùng cuộn tới `scrollTop` rồi trình duyệt bắn `scroll`. */
function userScrollsTo(top: number): void {
  act(() => {
    scroller().scrollTop = top;
    fireEvent.scroll(scroller());
  });
}

function messageNode(seq: number): Element {
  const node = document.querySelector(`[data-message-id="${idOf(seq)}"]`);
  if (!node) throw new Error(`tin ${seq} không có trong DOM`);
  return node;
}

/** `a` đứng TRƯỚC `b` theo thứ tự tài liệu. */
function precedes(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

const LAYOUT: FakeLayout = { scrollHeight: 5000, clientHeight: 300, dividerTop: 2000 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MessageList · mở phòng tại tin chưa đọc đầu tiên (US-CHAT-NV-04)", () => {
  it("RED: 25 tin chưa đọc ⇒ đứng ở vạch, tin 101 ngay dưới vạch, KHÔNG báo đọc ở lần vẽ đầu", () => {
    installLayout(LAYOUT);
    const onMarkRead = vi.fn();

    render(listElement({ room: roomWith({}), messages: range(76, 125), onMarkRead }));

    const divider = screen.getByTestId(DIVIDER);
    expect(divider.textContent).toContain("25 tin chưa đọc");
    // «ngay dưới vạch» = vạch nằm GIỮA tin 100 (đã đọc) và tin 101 (chưa đọc đầu tiên).
    expect(precedes(messageNode(100), divider)).toBe(true);
    expect(precedes(divider, messageNode(101))).toBe(true);
    // Vạch ở mép trên khung nhìn (chừa khe) ⇒ tin 101 nằm trong khung nhìn ngay dưới nó.
    expect(scroller().scrollTop).toBe(LAYOUT.dividerTop - UNREAD_DIVIDER_TOP_GAP_PX);
    expect(onMarkRead).not.toHaveBeenCalled();
    // Vạch đã nói «25 tin chưa đọc». Nút «↓ 25 tin mới» cùng lúc là lặp đúng con số đó, và nút nổi giữa
    // đáy khung đè lên chữ của tin đang đọc (lượt đo trình duyệt thật). Nút chỉ đếm tin tới SAU lúc mở.
    expect(screen.queryByRole("button", { name: /tin mới/ })).toBeNull();
  });

  it("badge chỉ về 0 khi cuộn SÁT ĐÁY — cuộn giữa chừng không báo đọc", () => {
    installLayout(LAYOUT);
    const onMarkRead = vi.fn();
    render(listElement({ room: roomWith({}), messages: range(76, 125), onMarkRead }));

    userScrollsTo(3000);
    expect(onMarkRead).not.toHaveBeenCalled();
    // Cuộn dở trong phần chưa đọc, không có tin nào tới thêm ⇒ không có gì «mới» để báo.
    expect(screen.queryByRole("button", { name: /tin mới/ })).toBeNull();

    userScrollsTo(LAYOUT.scrollHeight - LAYOUT.clientHeight);
    expect(onMarkRead).toHaveBeenCalledWith(125);
    expect(screen.queryByRole("button", { name: /tin mới/ })).toBeNull();
  });

  it("tab ẩn (`document.hidden`) ⇒ cuộn tới đáy cũng KHÔNG báo đọc; tab hiện lại ⇒ báo đọc", () => {
    installLayout(LAYOUT);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const onMarkRead = vi.fn();
    render(listElement({ room: roomWith({}), messages: range(76, 125), onMarkRead }));

    userScrollsTo(LAYOUT.scrollHeight - LAYOUT.clientHeight);
    expect(onMarkRead).not.toHaveBeenCalled();

    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onMarkRead).toHaveBeenCalledWith(125);
  });

  it("unreadCount = 0 ⇒ không vạch, xuống đáy và báo đọc như cũ", () => {
    installLayout(LAYOUT);
    const onMarkRead = vi.fn();
    render(
      listElement({ room: roomWith({ unreadCount: 0 }), messages: range(76, 125), onMarkRead }),
    );

    expect(screen.queryByTestId(DIVIDER)).toBeNull();
    expect(scroller().scrollTop).toBe(LAYOUT.scrollHeight);
    expect(onMarkRead).toHaveBeenCalledWith(125);
  });

  it("server cũ thiếu `unreadCount`/`lastMessageSeq` ⇒ hành vi cũ (đáy + báo đọc), không nổ", () => {
    installLayout(LAYOUT);
    const onMarkRead = vi.fn();
    const legacy = roomWith({});
    delete legacy.unreadCount;
    delete legacy.lastMessageSeq;
    render(listElement({ room: legacy, messages: range(76, 125), onMarkRead }));

    expect(screen.queryByTestId(DIVIDER)).toBeNull();
    expect(scroller().scrollTop).toBe(LAYOUT.scrollHeight);
    expect(onMarkRead).toHaveBeenCalledWith(125);
  });

  it("tin chưa đọc đầu tiên đã THU HỒI ⇒ vạch đặt trước tin chưa đọc kế tiếp còn hiển thị", () => {
    installLayout(LAYOUT);
    const messages = range(76, 125).map((m) =>
      m.roomSeq === 101 ? { ...m, body: null, recalledAt: "2026-08-04T10:00:00.000Z" } : m,
    );
    render(listElement({ room: roomWith({}), messages }));

    const divider = screen.getByTestId(DIVIDER);
    expect(precedes(messageNode(101), divider)).toBe(true);
    expect(precedes(divider, messageNode(102))).toBe(true);
  });

  it("mở qua `?msg=` ⇒ tin làm nổi THẮNG vạch: không vạch, không cuộn tới vạch", () => {
    installLayout(LAYOUT);
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const onMarkRead = vi.fn();
    render(
      listElement({
        room: roomWith({}),
        messages: range(76, 125),
        highlightMessageId: idOf(90),
        onMarkRead,
      }),
    );

    expect(screen.queryByTestId(DIVIDER)).toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scroller().scrollTop).toBe(0);
    expect(onMarkRead).not.toHaveBeenCalled();
  });

  it("trang đầu CHƯA về (store chỉ có tin cũ) ⇒ chưa định vị, chưa báo đọc; về rồi mới định vị", () => {
    installLayout(LAYOUT);
    const onMarkRead = vi.fn();
    const onLoadOlder = vi.fn(() => Promise.resolve(0));
    const { rerender } = render(
      listElement({
        room: roomWith({}),
        messages: range(76, 125),
        isFirstPageLoaded: false,
        hasMoreOlder: true,
        onLoadOlder,
        onMarkRead,
      }),
    );
    expect(scroller().scrollTop).toBe(0);
    expect(onMarkRead).not.toHaveBeenCalled();
    expect(onLoadOlder).not.toHaveBeenCalled();

    rerender(
      listElement({
        room: roomWith({}),
        messages: range(76, 125),
        isFirstPageLoaded: true,
        hasMoreOlder: true,
        onLoadOlder,
        onMarkRead,
      }),
    );
    expect(scroller().scrollTop).toBe(LAYOUT.dividerTop - UNREAD_DIVIDER_TOP_GAP_PX);
    expect(onLoadOlder).not.toHaveBeenCalled();
    expect(onMarkRead).not.toHaveBeenCalled();
  });
});

describe("MessageList · số chưa đọc vượt trang đầu (> 50)", () => {
  it("mốc ngoài trang đầu ⇒ nạp thêm `beforeSeq` tới mốc rồi mới đặt vạch (không cuộn tới chỗ sai)", async () => {
    installLayout(LAYOUT);
    const onLoadOlder = vi.fn(() => Promise.resolve(50));
    const onMarkRead = vi.fn();
    const room = roomWith({ unreadCount: 60 });
    const { rerender } = render(
      listElement({ room, messages: range(76, 125), hasMoreOlder: true, onLoadOlder, onMarkRead }),
    );

    // Mốc 66 chưa có trong 76..125 ⇒ CHƯA vạch, chưa định vị, chưa báo đọc, đã xin thêm MỘT trang.
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(DIVIDER)).toBeNull();
    expect(scroller().scrollTop).toBe(0);
    expect(onMarkRead).not.toHaveBeenCalled();

    await act(async () => {
      rerender(
        listElement({
          room,
          messages: range(26, 125),
          hasMoreOlder: true,
          onLoadOlder,
          onMarkRead,
        }),
      );
    });

    const divider = screen.getByTestId(DIVIDER);
    expect(divider.textContent).toContain("60 tin chưa đọc");
    expect(precedes(messageNode(65), divider)).toBe(true);
    expect(precedes(divider, messageNode(66))).toBe(true);
    expect(screen.queryByText(/còn tin chưa đọc phía trên/i)).toBeNull();
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
    expect(scroller().scrollTop).toBe(LAYOUT.dividerTop - UNREAD_DIVIDER_TOP_GAP_PX);
  });

  it("không nạp thêm được (hết lịch sử phía server trả rỗng) ⇒ dừng ở tin cũ nhất + nhãn", async () => {
    installLayout(LAYOUT);
    const onLoadOlder = vi.fn(() => Promise.resolve(0));
    render(
      listElement({
        room: roomWith({ unreadCount: 60 }),
        messages: range(76, 125),
        hasMoreOlder: true,
        onLoadOlder,
      }),
    );
    await act(async () => {});

    const divider = screen.getByTestId(DIVIDER);
    expect(divider.textContent).toMatch(/còn tin chưa đọc phía trên/i);
    expect(precedes(divider, messageNode(76))).toBe(true);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("220 tin chưa đọc (4 trang nạp thêm) ⇒ trang 4 còn đang bay thì CHƯA định vị; trang 4 về mới đặt vạch đúng mốc", async () => {
    // Bản sao có thể đổi: vạch ở trang 4 nằm chỗ khác vạch tạm ở tin cũ nhất của trang 3.
    const layout: FakeLayout = { ...LAYOUT };
    installLayout(layout);
    const resolvers: Array<(added: number) => void> = [];
    const onLoadOlder = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    // last 300, 220 chưa đọc ⇒ mốc 81. Trang đầu 251..300; mỗi trang thêm 50 ⇒ trang 4 (51..300) chứa mốc.
    const room = roomWith({ lastMessageSeq: 300, unreadCount: 220 });
    const view = (from: number): React.ReactElement =>
      listElement({ room, messages: range(from, 300), hasMoreOlder: true, onLoadOlder });
    const { rerender } = render(view(251));

    for (const from of [201, 151, 101]) {
      await act(async () => {
        rerender(view(from));
        resolvers[resolvers.length - 1](50);
      });
    }

    // Trang 4 đang bay: vạch «phía trên» ở tin 101 là chỗ SAI — mốc thật sắp về.
    expect(onLoadOlder).toHaveBeenCalledTimes(4);
    expect(screen.queryByTestId(DIVIDER)).toBeNull();
    expect(scroller().scrollTop).toBe(0);

    layout.dividerTop = 2500;
    await act(async () => {
      rerender(view(51));
      resolvers[3](50);
    });

    const divider = screen.getByTestId(DIVIDER);
    expect(divider.textContent).toContain("220 tin chưa đọc");
    expect(precedes(messageNode(80), divider)).toBe(true);
    expect(precedes(divider, messageNode(81))).toBe(true);
    expect(screen.queryByText(/còn tin chưa đọc phía trên/i)).toBeNull();
    expect(scroller().scrollTop).toBe(2500 - UNREAD_DIVIDER_TOP_GAP_PX);
    expect(onLoadOlder).toHaveBeenCalledTimes(4);
  });

  it("chạm trần lịch sử ⇒ KHÔNG xin thêm, dừng ở tin cũ nhất + nhãn", () => {
    installLayout(LAYOUT);
    const onLoadOlder = vi.fn(() => Promise.resolve(50));
    render(
      listElement({
        room: roomWith({ unreadCount: 60 }),
        messages: range(76, 125),
        hasMoreOlder: true,
        historyLimitReached: true,
        onLoadOlder,
      }),
    );

    expect(onLoadOlder).not.toHaveBeenCalled();
    expect(screen.getByTestId(DIVIDER).textContent).toMatch(/còn tin chưa đọc phía trên/i);
  });
});

describe("MessageList · tin mới tới khi đang đọc giữa chừng", () => {
  it("đang ở vạch, 2 tin mới tới ⇒ khung nhìn ĐỨNG YÊN, nút «↓ 2 tin mới» (không cộng 25 của vạch)", () => {
    installLayout(LAYOUT);
    const room = roomWith({});
    const { rerender } = render(listElement({ room, messages: range(76, 125) }));
    const before = scroller().scrollTop;

    rerender(listElement({ room, messages: range(76, 127) }));

    expect(scroller().scrollTop).toBe(before);
    expect(screen.getByRole("button", { name: /^2 tin mới$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /27 tin mới/ })).toBeNull();
  });

  it("đã đọc hết rồi cuộn lên, 3 tin mới tới ⇒ không kéo, «↓ 3 tin mới»; bấm ⇒ xuống đáy + báo đọc", () => {
    installLayout(LAYOUT);
    const room = roomWith({ unreadCount: 0 });
    const onMarkRead = vi.fn();
    const { rerender } = render(listElement({ room, messages: range(76, 125), onMarkRead }));
    expect(screen.queryByRole("button", { name: /tin mới/ })).toBeNull();

    userScrollsTo(1200);
    rerender(listElement({ room, messages: range(76, 128), onMarkRead }));

    expect(scroller().scrollTop).toBe(1200);
    fireEvent.click(screen.getByRole("button", { name: /3 tin mới/ }));
    expect(scroller().scrollTop).toBe(LAYOUT.scrollHeight);
    expect(onMarkRead).toHaveBeenLastCalledWith(128);
  });
});
