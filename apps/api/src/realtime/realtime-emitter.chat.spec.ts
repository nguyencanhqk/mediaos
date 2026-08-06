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
  const disconnectSockets = vi.fn();
  const toTargets: unknown[] = [];
  const inTargets: string[] = [];
  const server = {
    to: vi.fn((t: unknown) => {
      toTargets.push(t);
      return { emit };
    }),
    in: vi.fn((t: string) => {
      inTargets.push(t);
      return { socketsJoin, socketsLeave, disconnectSockets };
    }),
  };
  return { server, emit, socketsJoin, socketsLeave, disconnectSockets, toTargets, inTargets };
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

  // ─── 🔒 masking đính kèm (FULL gate S7-CHAT-BE-GATE-3 — CRITICAL) ───────────────
  //
  // `sendMessage` dựng DTO bằng `readMessage(actor, …)` = ĐÃ KÝ CHO NGƯỜI GỬI, rồi phát nguyên object
  // đó cho CẢ PHÒNG. Quyết định ký là per-recipient (`decideForLinkedFile` = AND trên mọi link, tính
  // riêng từng user), nên một `url` lọt vào payload WS là URL của người gửi tới tay mọi người nhận —
  // và URL presign là bearer, ai cầm cũng tải được, không guard nào chặn nữa.
  //
  // Ca này gieo DTO có `url`/`thumbnailUrl` KHÁC null (đúng thứ `readMessage` trả cho người gửi) và
  // đòi payload phát ra KHÔNG CÒN hai khoá đó. Gỡ `.extend({attachments})` ở `wsChatMessageEventSchema`
  // ⇒ ca này ĐỎ ngay.
  it("🔒 emitChatMessage KHÔNG phát url/thumbnailUrl của đính kèm (URL ký là per-recipient)", () => {
    const { svc, emit } = makeEmitter();
    const withSignedFile = {
      ...messageDto,
      attachmentCount: 1,
      attachments: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          fileId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          name: "hop-dong.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          isImage: false,
          url: "https://storage.example/signed?token=SECRET-BEARER",
          thumbnailUrl: "https://storage.example/signed-thumb?token=SECRET-BEARER",
        },
      ],
    };

    svc.emitChatMessage(COMPANY, ROOM, withSignedFile as never);

    const [, payload] = emit.mock.calls[0] as [string, { attachments: Record<string, unknown>[] }];
    // Metadata vẫn tới (FE hiện tên/kích thước ngay, không phải đợi REST) — đây là đối chứng dương:
    // nếu ca này chỉ assert "vắng url" thì một payload RỖNG cũng làm nó xanh.
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].name).toBe("hop-dong.pdf");
    expect(payload.attachments[0].fileId).toBe("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    // Khoá phải VẮNG MẶT, không phải `null`: khoá tồn tại là lời mời điền giá trị thật ở lần sửa sau.
    expect(Object.keys(payload.attachments[0]).sort()).toEqual([
      "fileId",
      "id",
      "isImage",
      "mimeType",
      "name",
      "sizeBytes",
    ]);
    // Chốt cuối bằng chuỗi thô: không byte nào của URL ký rời server qua kênh này.
    expect(JSON.stringify(payload)).not.toContain("SECRET-BEARER");
  });

  // ─── 🔒 cắt phiên WS (FULL gate S7-CHAT-BE-GATE-3 — L2 HIGH) ───────────────────
  it("🔒 severUserSessions cắt MỌI socket của user qua user-room (rộng nhất), có tiền tố tenant", () => {
    const { svc, server, disconnectSockets } = makeEmitter();
    svc.severUserSessions(COMPANY, USER_B);

    // `userRoomName` chứ KHÔNG phải `chatUserRoomName`: socket trượt cổng quyền CHAT vẫn nằm trong
    // user-room và vẫn nhận `notification:new` — bỏ sót nó là để phiên sống sau khi tài khoản bị khoá.
    expect(server.in).toHaveBeenCalledWith(userRoomName(COMPANY, USER_B));
    expect(server.in).not.toHaveBeenCalledWith(chatUserRoomName(COMPANY, USER_B));
    // `true` = đóng cả kết nối tầng dưới, không chỉ rời namespace.
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it("severUserSessions no-op khi chưa gắn server (boot sớm / REALTIME_ENABLED=false)", () => {
    const svc = new RealtimeEmitterService();
    expect(() => svc.severUserSessions(COMPANY, USER_B)).not.toThrow();
  });

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

  // ─── S8-CHAT-UX-RT-1 — chat:typing ─────────────────────────────────────────────
  describe("emitChatTyping (CHAT-API-023)", () => {
    it("phát vào ĐÚNG phòng, đúng tên sự kiện", () => {
      const { svc, emit, toTargets } = makeEmitter();

      svc.emitChatTyping(COMPANY, ROOM, { roomId: ROOM, userId: USER_A });

      expect(toTargets).toEqual([chatRoomName(COMPANY, ROOM)]);
      expect(emit).toHaveBeenCalledWith(WS_EVENTS.CHAT_TYPING, { roomId: ROOM, userId: USER_A });
    });

    it("🔒 `.parse()` STRIP mọi khoá thừa — nội dung đang gõ KHÔNG lọt ra kênh", () => {
      const { svc, emit } = makeEmitter();

      // Gieo đúng thứ một lần sửa cẩu thả sẽ nhét vào: bản nháp chưa gửi.
      svc.emitChatTyping(COMPANY, ROOM, {
        roomId: ROOM,
        userId: USER_A,
        body: "bản nháp bí mật chưa gửi",
        preview: "abc",
      } as never);

      const payload = emit.mock.calls[0][1] as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(["roomId", "userId"]);
      expect(payload).not.toHaveProperty("body");
      expect(payload).not.toHaveProperty("preview");
    });

    it("payload sai hình dạng ⇒ nuốt-có-log, KHÔNG ném lên caller", () => {
      const { svc, emit } = makeEmitter();

      expect(() =>
        svc.emitChatTyping(COMPANY, ROOM, { roomId: "not-a-uuid" } as never),
      ).not.toThrow();
      expect(emit).not.toHaveBeenCalled();
    });
  });

  // ─── S8-CHAT-UX-RT-1 — chat:presence ───────────────────────────────────────────
  describe("emitChatPresence (CHAT-FUNC-021)", () => {
    it("🔒 đích là chat-user-room của peer — KHÔNG phải user-room (cổng quyền WS)", () => {
      const { svc, emit, toTargets } = makeEmitter();

      svc.emitChatPresence(COMPANY, { userId: USER_A, status: "online" }, [USER_B]);

      // `userRoomName` chứa MỌI socket đã xác thực, kể cả người đã bị thu hồi `view:chat-room`.
      expect(toTargets).toEqual([[chatUserRoomName(COMPANY, USER_B)]]);
      expect(toTargets[0]).not.toContain(userRoomName(COMPANY, USER_B));
      expect(emit).toHaveBeenCalledWith(WS_EVENTS.CHAT_PRESENCE, {
        userId: USER_A,
        status: "online",
      });
    });

    it("🔒 danh sách peer RỖNG ⇒ KHÔNG gọi `.to([])` (mảng rỗng = phát cả namespace = rò xuyên tenant)", () => {
      const { svc, emit, server } = makeEmitter();

      svc.emitChatPresence(COMPANY, { userId: USER_A, status: "online" }, []);

      expect(server.to).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it("`.parse()` strip khoá thừa — không rò lastSeenAt/deviceCount qua kênh phụ", () => {
      const { svc, emit } = makeEmitter();

      svc.emitChatPresence(
        COMPANY,
        {
          userId: USER_A,
          status: "offline",
          lastSeenAt: "2026-08-06T00:00:00.000Z",
          deviceCount: 3,
        } as never,
        [USER_B],
      );

      const payload = emit.mock.calls[0][1] as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(["status", "userId"]);
    });

    it("status ngoài bộ đóng ⇒ nuốt-có-log, KHÔNG ném", () => {
      const { svc, emit } = makeEmitter();

      expect(() =>
        svc.emitChatPresence(COMPANY, { userId: USER_A, status: "away" } as never, [USER_B]),
      ).not.toThrow();
      expect(emit).not.toHaveBeenCalled();
    });

    it("chưa có server ⇒ no-op (REALTIME_ENABLED=false)", () => {
      const svc = new RealtimeEmitterService();

      expect(() =>
        svc.emitChatPresence(COMPANY, { userId: USER_A, status: "online" }, [USER_B]),
      ).not.toThrow();
    });

    it("nhiều peer ⇒ mỗi người MỘT room, Socket.IO tự union (không phát trùng)", () => {
      const { svc, toTargets } = makeEmitter();

      svc.emitChatPresence(COMPANY, { userId: USER_A, status: "online" }, [USER_B, USER_A]);

      expect(toTargets).toEqual([
        [chatUserRoomName(COMPANY, USER_B), chatUserRoomName(COMPANY, USER_A)],
      ]);
    });
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
