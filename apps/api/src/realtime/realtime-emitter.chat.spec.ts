import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS_EVENTS } from "@mediaos/contracts";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { chatRoomName, chatUserRoomName, userRoomName } from "./rooms";

/** S7-CHAT-RT-1 — cụm emit CHAT: đích phát · masking `.parse()` · no-op khi chưa có server. */

const COMPANY = "c0000000-0000-0000-0000-00000000000a";
const ROOM = "11111111-1111-4111-8111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const MESSAGE_ID = "99999999-9999-4999-8999-999999999999";

function makeServer() {
  const emit = vi.fn();
  const socketsJoin = vi.fn();
  const socketsLeave = vi.fn();
  const toTargets: unknown[] = [];
  const inTargets: string[] = [];
  const server = {
    to: vi.fn((t: unknown) => {
      toTargets.push(t);
      return { emit };
    }),
    in: vi.fn((t: string) => {
      inTargets.push(t);
      return { socketsJoin, socketsLeave };
    }),
  };
  return { server, emit, socketsJoin, socketsLeave, toTargets, inTargets };
}

function makeEmitter() {
  const h = makeServer();
  const svc = new RealtimeEmitterService();
  svc.setServer(h.server as never);
  return { svc, ...h };
}

const messageDto = {
  id: MESSAGE_ID,
  companyId: COMPANY,
  roomId: ROOM,
  senderId: USER_A,
  senderName: "Người A",
  body: "xin chào",
  messageType: "text" as const,
  fileUrl: null,
  fileName: null,
  mentions: [],
  pinnedAt: null,
  pinnedBy: null,
  replyToMessageId: null,
  recalledAt: null,
  attachmentCount: 0,
  attachments: [],
  roomSeq: 7,
  createdAt: new Date().toISOString(),
};

describe("RealtimeEmitterService — cụm CHAT (S7-CHAT-RT-1)", () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  // ─── đích phát ─────────────────────────────────────────────────────────────────
  it("emitChatMessage phát tới ĐÚNG room của phòng (tiền tố tenant `co:{companyId}:`)", () => {
    const { svc, server, emit } = makeEmitter();
    svc.emitChatMessage(COMPANY, ROOM, messageDto as never);

    expect(server.to).toHaveBeenCalledWith(chatRoomName(COMPANY, ROOM));
    expect(emit).toHaveBeenCalledWith(
      WS_EVENTS.CHAT_MESSAGE,
      expect.objectContaining({ id: MESSAGE_ID }),
    );
  });

  it("emitChatRoom nhắm room phòng + CHAT-USER-room của người bị ảnh hưởng", () => {
    const { svc, server, emit } = makeEmitter();
    svc.emitChatRoom(COMPANY, ROOM, { roomId: ROOM, action: "member_added" }, [USER_B]);

    expect(server.to).toHaveBeenCalledWith([
      chatRoomName(COMPANY, ROOM),
      chatUserRoomName(COMPANY, USER_B),
    ]);
    expect(emit).toHaveBeenCalledWith(WS_EVENTS.CHAT_ROOM, {
      roomId: ROOM,
      action: "member_added",
    });
  });

  it("🔒 emitChatRoom KHÔNG BAO GIỜ nhắm `userRoomName` — dùng nó là đi vòng cổng quyền view:chat-room", () => {
    // `userRoomName` được MỌI socket đã xác thực join (đích notification:new), kể cả người bị thu hồi
    // cặp CHAT. `chatUserRoomName` chỉ join sau khi qua cổng. Nhầm hai cái là rò sự kiện chat.
    const { svc, toTargets } = makeEmitter();
    svc.emitChatRoom(COMPANY, ROOM, { roomId: ROOM, action: "created" }, [USER_A, USER_B]);

    const flat = toTargets.flat() as string[];
    expect(flat).toContain(chatUserRoomName(COMPANY, USER_A));
    expect(flat).not.toContain(userRoomName(COMPANY, USER_A));
    expect(flat).not.toContain(userRoomName(COMPANY, USER_B));
  });

  it("🔒 syncRoomMembership('join') quét CHAT-USER-room — socket trượt cổng quyền không bị kéo vào phòng", () => {
    const { svc, server, socketsJoin } = makeEmitter();
    svc.syncRoomMembership(COMPANY, ROOM, USER_B, "join");

    expect(server.in).toHaveBeenCalledWith(chatUserRoomName(COMPANY, USER_B));
    expect(server.in).not.toHaveBeenCalledWith(userRoomName(COMPANY, USER_B));
    expect(socketsJoin).toHaveBeenCalledWith(chatRoomName(COMPANY, ROOM));
  });

  it("syncRoomMembership('leave') quét user-room (RỘNG HƠN) — rời nhầm là fail-safe, sót lại là rò", () => {
    const { svc, server, socketsLeave } = makeEmitter();
    svc.syncRoomMembership(COMPANY, ROOM, USER_B, "leave");

    expect(server.in).toHaveBeenCalledWith(userRoomName(COMPANY, USER_B));
    expect(socketsLeave).toHaveBeenCalledWith(chatRoomName(COMPANY, ROOM));
  });

  // ─── masking: `.parse()` TRƯỚC emit ────────────────────────────────────────────
  it("🔒 chat:message-recalled KHÔNG có khoá `body` — kể cả khi caller cố nhét vào", () => {
    const { svc, emit } = makeEmitter();
    svc.emitChatMessageRecalled(COMPANY, ROOM, {
      messageId: MESSAGE_ID,
      roomId: ROOM,
      recalledAt: new Date().toISOString(),
      body: "nội dung đáng lẽ đã biến mất",
    } as never);

    const payload = emit.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["messageId", "recalledAt", "roomId"]);
    expect(payload).not.toHaveProperty("body");
  });

  it("🔒 chat:room strip `unreadCount` khỏi `room` — số PER-MEMBER không được broadcast chung", () => {
    const { svc, emit } = makeEmitter();
    svc.emitChatRoom(
      COMPANY,
      ROOM,
      {
        roomId: ROOM,
        action: "updated",
        room: {
          id: ROOM,
          companyId: COMPANY,
          refId: null,
          roomType: "group",
          name: "Phòng A",
          roomCode: "ROOM-0001",
          description: null,
          isArchived: false,
          createdAt: new Date().toISOString(),
          unreadCount: 42, // của riêng actor — KHÔNG được phát cho cả phòng
        },
      } as never,
      [],
    );

    const payload = emit.mock.calls[0]?.[1] as { room: Record<string, unknown> };
    expect(payload.room).not.toHaveProperty("unreadCount");
    expect(payload.room.name).toBe("Phòng A");
  });

  it("payload SAI shape → log warn, KHÔNG throw lên caller (giao dịch đã commit rồi)", () => {
    const { svc, emit } = makeEmitter();
    expect(() =>
      svc.emitChatRead(COMPANY, ROOM, { roomId: ROOM, userId: USER_A, lastReadSeq: -5 } as never),
    ).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });

  // ─── no-op khi gateway chưa init / REALTIME_ENABLED=false ──────────────────────
  it("chưa setServer → mọi method là no-op, không throw (nghiệp vụ REST vẫn đúng)", () => {
    const svc = new RealtimeEmitterService();
    expect(() => {
      svc.emitChatMessage(COMPANY, ROOM, messageDto as never);
      svc.emitChatRead(COMPANY, ROOM, { roomId: ROOM, userId: USER_A, lastReadSeq: 1 });
      svc.emitChatMessageRecalled(COMPANY, ROOM, {
        messageId: MESSAGE_ID,
        roomId: ROOM,
        recalledAt: new Date().toISOString(),
      });
      svc.emitChatRoom(COMPANY, ROOM, { roomId: ROOM, action: "left" }, [USER_A]);
      svc.syncRoomMembership(COMPANY, ROOM, USER_A, "leave");
    }).not.toThrow();
  });

  // ─── cô lập tenant ở tầng room ─────────────────────────────────────────────────
  it("hai công ty KHÔNG BAO GIỜ chung tên room dù trùng roomId/userId", () => {
    const other = "c0000000-0000-0000-0000-00000000000b";
    expect(chatRoomName(COMPANY, ROOM)).not.toBe(chatRoomName(other, ROOM));
    expect(chatUserRoomName(COMPANY, USER_A)).not.toBe(chatUserRoomName(other, USER_A));
    // Và chat-user-room không bao giờ trùng user-room của chính người đó.
    expect(chatUserRoomName(COMPANY, USER_A)).not.toBe(userRoomName(COMPANY, USER_A));
  });
});
