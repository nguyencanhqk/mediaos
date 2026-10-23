/**
 * S20-CHAT-MENTIONPIN-1 — «@» chưa đọc trên FE (US-CHAT-NV-07): realtime tăng khi `chat:message` nhắc tôi,
 * `chat:read` của tôi kẹp về ≤ số chưa đọc (đọc tới đáy ⇒ 0), server cũ thiếu khoá ⇒ FE KHÔNG tự đếm.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useChatStore, type StoredChatMessage } from "./chat.store";

const ROOM = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const THIRD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function room(over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id: ROOM,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: "Phòng R",
    roomCode: "ROOM-0001",
    lastMessageSeq: 4,
    unreadCount: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    mentionUnreadCount: 0,
    ...over,
  };
}

let seq = 4;
function message(over: Partial<StoredChatMessage> = {}): StoredChatMessage {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
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
    roomSeq: seq,
    createdAt: "2026-10-23T10:00:00.000Z",
    ...over,
  };
}

const current = (): ChatRoomDto | undefined => useChatStore.getState().roomsById[ROOM];

beforeEach(() => {
  seq = 4;
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
});

describe("«@» realtime — applyIncomingMessage", () => {
  it("tin của người khác NHẮC TÔI ⇒ unread +1 và «@» +1", () => {
    useChatStore.getState().hydrateRooms([room()]);
    useChatStore.getState().applyIncomingMessage(message({ mentions: [ME] }));
    expect(current()).toMatchObject({ unreadCount: 1, mentionUnreadCount: 1 });
  });

  it("nhắc NGƯỜI KHÁC ⇒ unread +1, «@» của tôi đứng yên", () => {
    useChatStore.getState().hydrateRooms([room()]);
    useChatStore.getState().applyIncomingMessage(message({ mentions: [THIRD] }));
    expect(current()).toMatchObject({ unreadCount: 1, mentionUnreadCount: 0 });
  });

  it("tin của CHÍNH tôi (kể cả tự nhắc) ⇒ không tăng gì", () => {
    useChatStore.getState().hydrateRooms([room()]);
    useChatStore.getState().applyIncomingMessage(message({ senderId: ME, mentions: [ME] }));
    expect(current()).toMatchObject({ unreadCount: 0, mentionUnreadCount: 0 });
  });

  it("server CŨ (phòng không có khoá) ⇒ FE KHÔNG tự khởi đếm — chip vẫn ẩn", () => {
    const { mentionUnreadCount: _omit, ...legacy } = room();
    useChatStore.getState().hydrateRooms([legacy]);
    useChatStore.getState().applyIncomingMessage(message({ mentions: [ME] }));
    expect(current()?.unreadCount).toBe(1);
    expect(current()?.mentionUnreadCount).toBeUndefined();
  });
});

describe("«@» về 0 — applyReadEvent của tôi", () => {
  it("đọc tới ĐÁY ⇒ «@» = 0", () => {
    useChatStore
      .getState()
      .hydrateRooms([room({ lastMessageSeq: 9, unreadCount: 5, mentionUnreadCount: 2 })]);
    useChatStore.getState().applyReadEvent({ roomId: ROOM, userId: ME, lastReadSeq: 9 });
    expect(current()).toMatchObject({ unreadCount: 0, mentionUnreadCount: 0 });
  });

  it("đọc DỞ ⇒ kẹp về ≤ số chưa đọc còn lại", () => {
    useChatStore
      .getState()
      .hydrateRooms([room({ lastMessageSeq: 9, unreadCount: 5, mentionUnreadCount: 2 })]);
    useChatStore.getState().applyReadEvent({ roomId: ROOM, userId: ME, lastReadSeq: 8 });
    expect(current()).toMatchObject({ unreadCount: 1, mentionUnreadCount: 1 });
  });

  it("con trỏ của NGƯỜI KHÁC ⇒ không đụng «@» của tôi", () => {
    useChatStore
      .getState()
      .hydrateRooms([room({ lastMessageSeq: 9, unreadCount: 5, mentionUnreadCount: 2 })]);
    useChatStore.getState().applyReadEvent({ roomId: ROOM, userId: OTHER, lastReadSeq: 9 });
    expect(current()?.mentionUnreadCount).toBe(2);
  });
});

describe("trộn ảnh chụp REST — mergeServerRoom", () => {
  it("ảnh chụp mới VẮNG khoá (đường một phòng) ⇒ GIỮ «@» đang có; có số ⇒ server thắng", () => {
    useChatStore.getState().hydrateRooms([room({ mentionUnreadCount: 3 })]);
    const { mentionUnreadCount: _omit, ...detailLike } = room({ lastMessageSeq: 5 });
    useChatStore.getState().hydrateRooms([detailLike]);
    expect(current()?.mentionUnreadCount).toBe(3);

    useChatStore.getState().hydrateRooms([room({ lastMessageSeq: 5, mentionUnreadCount: 0 })]);
    expect(current()?.mentionUnreadCount).toBe(0);
  });
});
