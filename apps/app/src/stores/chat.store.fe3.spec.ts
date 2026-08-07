/**
 * S8-CHAT-UX-FE-3 — ba nhánh mới của store: cảm xúc · đang gõ · đang online.
 *
 * Bài quan trọng nhất ở đây là **`mine` phải sống sót qua sự kiện WS**. `wsChatReactionEventSchema` cố ý
 * `.omit({mine: true})` vì `mine` là per-user còn sự kiện phát cho CẢ phòng; một hiện thực đọc thẳng
 * payload vào state sẽ làm mọi người trong phòng thấy dấu tích của người vừa bấm
 * (memory `ws-payload-narrower-than-rest-dto`). Lỗi đó KHÔNG lộ ra ở typecheck — payload thiếu khoá thì
 * `mine` chỉ đơn giản là `undefined` — nên nó phải bị đóng đinh ở đây.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TYPING_TTL_MS, useChatStore, type StoredChatMessage } from "./chat.store";

const ROOM = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MSG = "00000001-1111-4111-8111-111111111111";

function message(over: Partial<StoredChatMessage> = {}): StoredChatMessage {
  return {
    id: MSG,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomId: ROOM,
    senderId: OTHER,
    senderName: "Bình",
    body: "xin chào",
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: 5,
    createdAt: "2026-08-07T10:00:00.000Z",
    ...over,
  };
}

/** Nạp một tin vào store mà không đi qua `applyIncomingMessage` (nó còn đụng tổng hợp phòng). */
function seedMessage(msg: StoredChatMessage): void {
  useChatStore.setState({ messagesByRoom: { [msg.roomId]: [msg] } });
}

beforeEach(() => {
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
});

describe("cảm xúc — patchMessageReactions", () => {
  it("đặt thẳng tổng hợp mới lên đúng tin", () => {
    seedMessage(message());
    useChatStore
      .getState()
      .patchMessageReactions(ROOM, MSG, [{ emoji: "like", count: 2, mine: true }]);
    expect(useChatStore.getState().messagesByRoom[ROOM][0].reactions).toEqual([
      { emoji: "like", count: 2, mine: true },
    ]);
  });

  it("gọi lần hai với giá trị TRƯỚC = hoàn nguyên nguyên trạng", () => {
    seedMessage(message({ reactions: [{ emoji: "like", count: 1, mine: false }] }));
    const before = useChatStore.getState().messagesByRoom[ROOM][0].reactions;

    useChatStore
      .getState()
      .patchMessageReactions(ROOM, MSG, [{ emoji: "like", count: 2, mine: true }]);
    useChatStore.getState().patchMessageReactions(ROOM, MSG, before ?? []);

    expect(useChatStore.getState().messagesByRoom[ROOM][0].reactions).toEqual([
      { emoji: "like", count: 1, mine: false },
    ]);
  });

  it("tin không có trong danh sách ⇒ KHÔNG dựng bong bóng ma", () => {
    seedMessage(message());
    const before = useChatStore.getState().messagesByRoom[ROOM];
    useChatStore
      .getState()
      .patchMessageReactions(ROOM, "00000099-1111-4111-8111-111111111111", [
        { emoji: "like", count: 1, mine: true },
      ]);
    expect(useChatStore.getState().messagesByRoom[ROOM]).toBe(before);
  });
});

describe("cảm xúc — applyReactionEvent (payload WS HẸP HƠN DTO REST)", () => {
  it("GIỮ NGUYÊN `mine` đang có, chỉ thay `count`", () => {
    seedMessage(message({ reactions: [{ emoji: "like", count: 1, mine: true }] }));

    // Payload WS KHÔNG có `mine` — đúng hợp đồng `wsChatReactionEventSchema`.
    useChatStore.getState().applyReactionEvent({
      roomId: ROOM,
      messageId: MSG,
      reactions: [{ emoji: "like", count: 4 }],
    });

    expect(useChatStore.getState().messagesByRoom[ROOM][0].reactions).toEqual([
      { emoji: "like", count: 4, mine: true },
    ]);
  });

  it("emoji mình CHƯA từng thả ⇒ `mine: false`, không phải `undefined`", () => {
    seedMessage(message({ reactions: [{ emoji: "like", count: 1, mine: true }] }));
    useChatStore.getState().applyReactionEvent({
      roomId: ROOM,
      messageId: MSG,
      reactions: [
        { emoji: "like", count: 1 },
        { emoji: "love", count: 3 },
      ],
    });
    const reactions = useChatStore.getState().messagesByRoom[ROOM][0].reactions;
    expect(reactions).toEqual([
      { emoji: "like", count: 1, mine: true },
      { emoji: "love", count: 3, mine: false },
    ]);
  });

  it("mảng RỖNG là hợp lệ: người cuối cùng vừa bỏ thả ⇒ xoá sạch thanh cảm xúc", () => {
    seedMessage(message({ reactions: [{ emoji: "like", count: 1, mine: true }] }));
    useChatStore.getState().applyReactionEvent({ roomId: ROOM, messageId: MSG, reactions: [] });
    expect(useChatStore.getState().messagesByRoom[ROOM][0].reactions).toEqual([]);
  });
});

describe("đang gõ", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T10:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("ping của người khác ⇒ vào sổ với mốc hết hạn = now + TTL", () => {
    useChatStore.getState().applyTypingEvent({ roomId: ROOM, userId: OTHER });
    expect(useChatStore.getState().typingByRoom[ROOM][OTHER]).toBe(Date.now() + TYPING_TTL_MS);
  });

  it("ping của CHÍNH MÌNH bị lọc — server phát cho cả phòng kể cả người ping", () => {
    useChatStore.getState().applyTypingEvent({ roomId: ROOM, userId: ME });
    expect(useChatStore.getState().typingByRoom[ROOM]).toBeUndefined();
  });

  it("tự tắt sau 5s KHÔNG nhận ping (done_when #4)", () => {
    useChatStore.getState().applyTypingEvent({ roomId: ROOM, userId: OTHER });

    vi.advanceTimersByTime(TYPING_TTL_MS - 1);
    useChatStore.getState().pruneTyping();
    expect(useChatStore.getState().typingByRoom[ROOM]?.[OTHER]).toBeDefined();

    vi.advanceTimersByTime(2);
    useChatStore.getState().pruneTyping();
    // Phòng rỗng ⇒ khoá bị BỎ HẲN, không để lại object rỗng.
    expect(useChatStore.getState().typingByRoom[ROOM]).toBeUndefined();
  });

  it("ping mới GIA HẠN, không cộng dồn entry thứ hai", () => {
    useChatStore.getState().applyTypingEvent({ roomId: ROOM, userId: OTHER });
    vi.advanceTimersByTime(3000);
    useChatStore.getState().applyTypingEvent({ roomId: ROOM, userId: OTHER });

    vi.advanceTimersByTime(TYPING_TTL_MS - 2999);
    useChatStore.getState().pruneTyping();
    expect(Object.keys(useChatStore.getState().typingByRoom[ROOM] ?? {})).toEqual([OTHER]);
  });

  it("nhịp dọn KHÔNG có gì hết hạn ⇒ trả CHÍNH state cũ (không re-render vô ích)", () => {
    useChatStore.getState().applyTypingEvent({ roomId: ROOM, userId: OTHER });
    const before = useChatStore.getState().typingByRoom;
    useChatStore.getState().pruneTyping();
    expect(useChatStore.getState().typingByRoom).toBe(before);
  });
});

describe("đang online", () => {
  it("ảnh chụp từ roster vào store", () => {
    useChatStore.getState().hydratePresence([
      { userId: OTHER, isOnline: true },
      { userId: ME, isOnline: false },
    ]);
    expect(useChatStore.getState().presenceByUser).toEqual({ [OTHER]: true, [ME]: false });
  });

  it("sự kiện `chat:presence` vá đè ảnh chụp", () => {
    useChatStore.getState().hydratePresence([{ userId: OTHER, isOnline: true }]);
    useChatStore.getState().applyPresenceEvent({ userId: OTHER, status: "offline" });
    expect(useChatStore.getState().presenceByUser[OTHER]).toBe(false);
  });

  it("trạng thái KHÔNG đổi ⇒ giữ nguyên tham chiếu", () => {
    useChatStore.getState().hydratePresence([{ userId: OTHER, isOnline: true }]);
    const before = useChatStore.getState().presenceByUser;
    useChatStore.getState().applyPresenceEvent({ userId: OTHER, status: "online" });
    expect(useChatStore.getState().presenceByUser).toBe(before);
  });
});
