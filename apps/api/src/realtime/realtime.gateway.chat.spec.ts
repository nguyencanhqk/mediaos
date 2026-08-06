import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeGateway } from "./realtime.gateway";
import { chatRoomName, chatUserRoomName, userRoomName } from "./rooms";
import type { TokenService } from "../auth/token.service";
import type { RealtimeEmitterService } from "./realtime-emitter.service";
import type { PermissionService } from "../permission/permission.service";
import type { ChatRoomsRepository } from "../chat/chat-rooms.repository";
import type { DatabaseService } from "../db/db.service";

/**
 * S7-CHAT-RT-1 — `handleConnection`: cổng quyền · join server-side · tự vá đua · fail-loud.
 *
 * Cố ý là UNIT (không DB, không server socket.io): mỗi ca dưới đây phải ĐỎ TẤT ĐỊNH khi gỡ đúng một
 * dòng thiết kế. Đường đầu-cuối thật do `chat-rt1-realtime.int-spec.ts` chứng minh.
 */

const USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY = "c0000000-0000-0000-0000-00000000000a";
const ROOM_1 = "11111111-1111-4111-8111-111111111111";
const ROOM_2 = "22222222-2222-4222-8222-222222222222";

function makeSocket(user?: { id: string; companyId: string }) {
  const joined: string[] = [];
  const left: string[] = [];
  return {
    // Socket.IO cấp `id` cho MỌI socket; presence khoá theo id này nên fake phải có nó, nếu không ca
    // presence đo một `undefined` và vẫn xanh.
    id: `sock-${user?.id ?? "anon"}`,
    data: user ? { user } : {},
    joined,
    left,
    join: vi.fn(async (room: string) => {
      joined.push(room);
    }),
    leave: vi.fn(async (room: string) => {
      left.push(room);
    }),
    disconnect: vi.fn(),
    handshake: { auth: {}, headers: {} },
  };
}

function makeGateway(over: {
  allow?: boolean;
  rooms?: string[][];
  withTenantImpl?: (companyId: string, fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
}) {
  const calls = over.rooms ?? [[]];
  let call = 0;
  const listRoomsForUser = vi.fn(async () => {
    const ids = calls[Math.min(call, calls.length - 1)] ?? [];
    call += 1;
    return ids.map((id) => ({ id }));
  });
  const permissions = {
    can: vi.fn(async () => ({
      allow: over.allow ?? true,
      reason: "ok",
      auditRequired: false,
    })),
  } as unknown as PermissionService;
  const db = {
    withTenant:
      over.withTenantImpl ??
      vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;

  // S8-CHAT-UX-RT-1 — presence stub (mỹ thuật, không ném). Trả ra để ca test cổng quyền đóng đinh được
  // "người trượt `view:chat-room` KHÔNG vào presence".
  const presence = {
    markOnline: vi.fn(async () => {}),
    markOffline: vi.fn(async () => {}),
    refreshLocal: vi.fn(async () => {}),
  };

  const gw = new RealtimeGateway(
    { verifyAccessToken: vi.fn() } as unknown as TokenService,
    { setServer: vi.fn() } as unknown as RealtimeEmitterService,
    permissions,
    { listRoomsForUser } as unknown as ChatRoomsRepository,
    db,
    presence as never,
  );
  return { gw, permissions, listRoomsForUser, presence };
}

describe("RealtimeGateway.handleConnection — S7-CHAT-RT-1", () => {
  beforeEach(() => {
    process.env.REALTIME_ENABLED = "true";
    vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.REALTIME_ENABLED;
  });

  // ─── (A) cổng quyền ────────────────────────────────────────────────────────────
  it("có cặp view:chat-room → join user-room + chat-user-room + ĐỦ mọi phòng", async () => {
    const { gw } = makeGateway({ allow: true, rooms: [[ROOM_1, ROOM_2]] });
    const client = makeSocket({ id: USER, companyId: COMPANY });

    await gw.handleConnection(client as never);

    expect(client.joined).toEqual(
      expect.arrayContaining([
        userRoomName(COMPANY, USER),
        chatUserRoomName(COMPANY, USER),
        chatRoomName(COMPANY, ROOM_1),
        chatRoomName(COMPANY, ROOM_2),
      ]),
    );
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it("kiểm cặp quyền Ở MỨC TYPE, đúng cặp mà route đọc REST bắt buộc", async () => {
    const { gw, permissions } = makeGateway({ allow: true });
    await gw.handleConnection(makeSocket({ id: USER, companyId: COMPANY }) as never);

    expect(permissions.can).toHaveBeenCalledWith({
      userId: USER,
      companyId: COMPANY,
      action: "view",
      resourceType: "chat-room",
    });
    // KHÔNG truyền `resourceId` ⇒ type-level, CÙNG MỨC `@RequirePermission("view","chat-room")`.
    expect(vi.mocked(permissions.can).mock.calls[0]?.[0]).not.toHaveProperty("resourceId");
  });

  it("THIẾU cặp view:chat-room → 0 phòng chat, KHÔNG chat-user-room, nhưng NOTI vẫn sống (không ngắt)", async () => {
    // Là thành viên hợp lệ của 2 phòng, chỉ thiếu cặp quyền — membership KHÔNG thay được cặp quyền.
    const { gw, listRoomsForUser } = makeGateway({ allow: false, rooms: [[ROOM_1, ROOM_2]] });
    const client = makeSocket({ id: USER, companyId: COMPANY });

    await gw.handleConnection(client as never);

    // Positive control: user-room PHẢI được join — nếu không, "0 phòng chat" là vô nghĩa vì có thể
    // handleConnection đã chết sớm vì lý do khác.
    expect(client.joined).toEqual([userRoomName(COMPANY, USER)]);
    expect(client.joined).not.toContain(chatUserRoomName(COMPANY, USER));
    expect(client.joined).not.toContain(chatRoomName(COMPANY, ROOM_1));
    // Fail-SOFT: thiếu quyền không phải sự cố hạ tầng.
    expect(client.disconnect).not.toHaveBeenCalled();
    // Không đọc danh sách phòng khi đã bị cổng quyền chặn — không tốn truy vấn thừa.
    expect(listRoomsForUser).not.toHaveBeenCalled();
  });

  // ─── (A2) presence — S8-CHAT-UX-RT-1 ──────────────────────────────────────────
  describe("presence bám theo cổng quyền CHAT (CHAT-DEC-017)", () => {
    it("🔒 THIẾU cặp view:chat-room → KHÔNG vào presence của ai", async () => {
      const { gw, presence } = makeGateway({ allow: false, rooms: [[ROOM_1]] });
      const client = makeSocket({ id: USER, companyId: COMPANY });

      await gw.handleConnection(client as never);

      // Cổng quyền CHAT phủ CẢ kênh presence, không riêng kênh tin nhắn: người bị thu hồi quyền chat
      // không được phép hiện "đang online" với các peer DM cũ.
      expect(presence.markOnline).not.toHaveBeenCalled();
    });

    it("qua cổng quyền → đánh dấu online với socket id THẬT của kết nối", async () => {
      const { gw, presence } = makeGateway({ allow: true, rooms: [[ROOM_1]] });
      const client = makeSocket({ id: USER, companyId: COMPANY });

      await gw.handleConnection(client as never);

      expect(presence.markOnline).toHaveBeenCalledWith(COMPANY, USER, client.id);
    });

    it("disconnect → gỡ khỏi presence (đường mà severUserSessions đi qua)", () => {
      const { gw, presence } = makeGateway({ allow: true, rooms: [[ROOM_1]] });
      const client = makeSocket({ id: USER, companyId: COMPANY });

      // `severUserSessions` (tài khoản bị khoá/vô hiệu) gọi `disconnectSockets(true)` ⇒ Socket.IO phát
      // `disconnect` ⇒ gateway chạy hook này. Đo hook, không đo lời hứa trong jsdoc.
      gw.handleDisconnect(client as never);

      expect(presence.markOffline).toHaveBeenCalledWith(COMPANY, USER, client.id);
    });

    it("🔒 presence NÉM → KHÔNG ngắt kết nối (mỹ thuật không được giết đường sống của tin nhắn)", async () => {
      const { gw, presence } = makeGateway({ allow: true, rooms: [[ROOM_1]] });
      presence.markOnline.mockRejectedValue(new Error("valkey down") as never);
      const client = makeSocket({ id: USER, companyId: COMPANY });

      await gw.handleConnection(client as never);

      // Đây là ĐIỂM KHÁC BIỆT có chủ đích với `listRoomsForUser` ném (ca dưới → disconnect):
      // "connected mà 0 phòng" là sống dối; "connected mà không ai thấy mình online" chỉ là thiếu mỹ thuật.
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.joined).toContain(chatRoomName(COMPANY, ROOM_1));
    });

    it("handleDisconnect nuốt promise reject — không đẻ unhandledRejection (Socket.IO không await)", () => {
      const { gw, presence } = makeGateway({ allow: true, rooms: [[ROOM_1]] });
      presence.markOffline.mockRejectedValue(new Error("valkey down") as never);
      const client = makeSocket({ id: USER, companyId: COMPANY });

      expect(() => gw.handleDisconnect(client as never)).not.toThrow();
    });
  });

  // ─── (B) danh sách phòng đọc TỪ SERVER ─────────────────────────────────────────
  it("KHÔNG BAO GIỜ đọc roomId từ handshake của client", async () => {
    const { gw, listRoomsForUser } = makeGateway({ allow: true, rooms: [[ROOM_1]] });
    const client = makeSocket({ id: USER, companyId: COMPANY });
    // Client cố nhét phòng của người khác vào handshake.
    client.handshake.auth = { token: "x", roomIds: [ROOM_2], rooms: [ROOM_2] } as never;

    await gw.handleConnection(client as never);

    expect(listRoomsForUser).toHaveBeenCalled();
    expect(client.joined).toContain(chatRoomName(COMPANY, ROOM_1));
    // Phòng do client tự khai KHÔNG được join.
    expect(client.joined).not.toContain(chatRoomName(COMPANY, ROOM_2));
  });

  it("AWAIT mọi lời gọi join — handleConnection resolve nghĩa là đã join xong, không còn treo", async () => {
    // Cổng dựng SẴN trước khi chạy — join phòng sẽ treo ở đây tới khi ta mở.
    let openGate!: () => void;
    const gate = new Promise<void>((r) => (openGate = r));

    const { gw } = makeGateway({ allow: true, rooms: [[ROOM_1]] });
    const client = makeSocket({ id: USER, companyId: COMPANY });
    let joinFinished = false;
    client.join = vi.fn(async (room: string) => {
      client.joined.push(room);
      if (room === chatRoomName(COMPANY, ROOM_1)) {
        await gate;
        joinFinished = true;
      }
    });

    const pending = gw.handleConnection(client as never);
    let settled = false;
    void pending.then(() => (settled = true));
    // Xả hết microtask đang chờ — nếu `join` KHÔNG được await, handleConnection đã xong ở đây.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(settled).toBe(false);
    expect(joinFinished).toBe(false);

    openGate();
    await pending;
    expect(joinFinished).toBe(true);
  });

  // ─── (C) tự vá đua connect ↔ removeMember ──────────────────────────────────────
  it("phòng biến mất giữa hai lần đọc → RỜI phòng đó (không kẹt lại vĩnh viễn)", async () => {
    // Lần đọc 1 thấy [R1, R2]; lần đọc 2 (sau vòng join) chỉ còn [R2] — R1 vừa bị gỡ.
    const { gw } = makeGateway({ allow: true, rooms: [[ROOM_1, ROOM_2], [ROOM_2]] });
    const client = makeSocket({ id: USER, companyId: COMPANY });

    await gw.handleConnection(client as never);

    expect(client.left).toEqual([chatRoomName(COMPANY, ROOM_1)]);
    // Positive control: R2 vẫn được giữ — bước (C) không đá nhầm phòng còn hợp lệ.
    expect(client.left).not.toContain(chatRoomName(COMPANY, ROOM_2));
    expect(client.joined).toContain(chatRoomName(COMPANY, ROOM_2));
  });

  it("không có gì đổi giữa hai lần đọc → KHÔNG rời phòng nào", async () => {
    const { gw } = makeGateway({ allow: true, rooms: [[ROOM_1], [ROOM_1]] });
    const client = makeSocket({ id: USER, companyId: COMPANY });

    await gw.handleConnection(client as never);

    expect(client.left).toEqual([]);
  });

  // ─── fail-loud khi DB lỗi ──────────────────────────────────────────────────────
  it("listRoomsForUser NÉM → disconnect(true) + log ERROR (không sống dối 'connected mà 0 phòng')", async () => {
    const errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { gw } = makeGateway({
      allow: true,
      withTenantImpl: async () => {
        throw new Error("DB down");
      },
    });
    const client = makeSocket({ id: USER, companyId: COMPANY });

    await expect(gw.handleConnection(client as never)).resolves.toBeUndefined();

    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // Positive control: user-room đã join TRƯỚC khi lỗi xảy ra ⇒ lỗi đến từ bước (B), không phải sớm hơn.
    expect(client.joined).toContain(userRoomName(COMPANY, USER));
  });

  it("bước (C) ném → VẪN disconnect (re-check nằm TRONG cùng try, không lọt ra ngoài)", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    let call = 0;
    const { gw } = makeGateway({
      allow: true,
      withTenantImpl: async (_c, fn) => {
        call += 1;
        // Lần đọc ĐẦU (bước B) OK; lần đọc THỨ HAI (bước C) hỏng.
        if (call >= 2) throw new Error("DB down giữa chừng");
        return fn({});
      },
    });
    const client = makeSocket({ id: USER, companyId: COMPANY });

    await expect(gw.handleConnection(client as never)).resolves.toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});
