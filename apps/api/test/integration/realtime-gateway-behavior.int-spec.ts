import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { io, type Socket } from "socket.io-client";
import {
  WS_EVENTS,
  WS_NAMESPACE,
  type WsAck,
  type WsChatSendAck,
  type WsPresenceListAck,
} from "@mediaos/contracts";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser } from "../helpers/seed";
import { RealtimeModule } from "../../src/realtime/realtime.module";
import { TokenService } from "../../src/auth/token.service";

/**
 * G10-1 — POSITIVE-PATH realtime behaviors (bổ sung deny-path ở realtime-gateway.int-spec.ts).
 *
 * Phủ 3 chiều CÒN THIẾU của lưới G10-1 (deny-path spec đã phủ fail-closed + cross-tenant + masking +
 * append-only). 3 chiều này KHÔNG dựa kỷ luật client — đều quan sát qua hợp đồng WS thật:
 *
 *   • LIFECYCLE   — connect (auth ở handshake) → join room → presence phản chiếu self → leave →
 *                   presence trả `not_joined` (socket đã rời room) → disconnect sạch.
 *   • RECONNECT   — sau disconnect, room membership KHÔNG sống sót: socket MỚI phải re-auth (handshake)
 *                   + RE-JOIN trước khi nhận event lại. Đây là hợp đồng FE phải tuân khi reconnect.
 *   • ORDERING    — N `chat:send` tuần tự (await ack) → người trong room nhận `chat:message` ĐÚNG thứ tự
 *                   gửi (Socket.IO giữ thứ tự emit trên 1 connection; await ack ép thứ tự insert DB).
 *
 * Chạy khi có DB (skipIf(!hasDb)) — gateway cần TokenService + ChatService + Postgres (membership thật).
 */

const WS_PORT = 3198; // khác cổng deny-path spec (3199) — 2 file có thể chạy song song không đụng cổng.

function connect(token: string | undefined): Socket {
  return io(`http://127.0.0.1:${WS_PORT}/${WS_NAMESPACE}`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    auth: token ? { token } : {},
  });
}

function waitConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (err) => reject(err));
    socket.on("disconnect", (reason) => reject(new Error(`disconnected: ${reason}`)));
    setTimeout(() => reject(new Error("connect timeout")), 4000);
  });
}

/** Chờ socket nhận `disconnect` (dùng cho lifecycle/reconnect — xác nhận đóng sạch). */
function waitDisconnect(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.disconnected) return resolve();
    socket.on("disconnect", () => resolve());
  });
}

const SETTLE_MS = 400; // chờ event server→client lắng (emit là async qua transport).

describe.skipIf(!hasDb)("G10-1 realtime gateway — behavior (lifecycle/reconnect/ordering)", () => {
  const direct = directPool();
  let nest: INestApplication;
  let tokens: TokenService;
  const tenantIds: string[] = [];

  let companyA: string;
  let userA: string;
  let roomA: string;

  beforeAll(async () => {
    const a = await seedCompany(direct, "rtb-a");
    companyA = a.companyId;
    tenantIds.push(companyA);

    userA = await seedUser(direct, companyA, `a-${companyA.slice(0, 6)}@t.local`);

    const ra = await direct.query(
      `INSERT INTO chat_rooms (company_id, room_type, name) VALUES ($1, 'group', 'Room A') RETURNING id`,
      [companyA],
    );
    roomA = ra.rows[0].id as string;
    await direct.query(
      `INSERT INTO chat_room_members (company_id, room_id, user_id) VALUES ($1, $2, $3)`,
      [companyA, roomA, userA],
    );

    const mod = await Test.createTestingModule({ imports: [RealtimeModule] }).compile();
    nest = mod.createNestApplication();
    tokens = mod.get(TokenService);
    await nest.listen(WS_PORT);
  });

  afterAll(async () => {
    if (nest) await nest.close();
    await cleanupTenants(direct, tenantIds);
    await direct.end();
  });

  let sockets: Socket[] = [];
  afterEach(() => {
    for (const s of sockets) s.disconnect();
    sockets = [];
  });

  function track(s: Socket): Socket {
    sockets.push(s);
    return s;
  }

  function tokenFor(userId: string, companyId: string): string {
    return tokens.signAccessToken({ sub: userId, companyId, email: "x@t.local" });
  }

  // ─── LIFECYCLE ────────────────────────────────────────────────────────────────
  it("lifecycle: connect → join → presence chứa self → leave → presence not_joined", async () => {
    const s = track(connect(tokenFor(userA, companyA)));
    await waitConnect(s);

    const joinAck: WsAck = await s.emitWithAck(WS_EVENTS.CHAT_JOIN, { roomId: roomA });
    expect(joinAck.ok).toBe(true);

    const presence: WsPresenceListAck = await s.emitWithAck(WS_EVENTS.CHAT_PRESENCE_LIST, {
      roomId: roomA,
    });
    expect(presence.ok).toBe(true);
    expect(presence.ok && presence.userIds).toContain(userA);

    const leaveAck: WsAck = await s.emitWithAck(WS_EVENTS.CHAT_LEAVE, { roomId: roomA });
    expect(leaveAck.ok).toBe(true);

    // Đã rời room ⇒ presence:list bị từ chối not_joined (client.rooms.has(room) === false).
    const afterLeave: WsPresenceListAck = await s.emitWithAck(WS_EVENTS.CHAT_PRESENCE_LIST, {
      roomId: roomA,
    });
    expect(afterLeave.ok).toBe(false);
  });

  it("lifecycle: disconnect đóng sạch (server tự rời room, không treo)", async () => {
    const s = track(connect(tokenFor(userA, companyA)));
    await waitConnect(s);
    await s.emitWithAck(WS_EVENTS.CHAT_JOIN, { roomId: roomA });

    const closed = waitDisconnect(s);
    s.disconnect();
    await expect(closed).resolves.toBeUndefined();
  });

  // ─── RECONNECT ──────────────────────────────────────────────────────────────────
  it("reconnect: room membership KHÔNG sống sót — socket mới phải re-join trước khi nhận event", async () => {
    const first = track(connect(tokenFor(userA, companyA)));
    await waitConnect(first);
    await first.emitWithAck(WS_EVENTS.CHAT_JOIN, { roomId: roomA });
    first.disconnect();
    await waitDisconnect(first);

    // "Reconnect" = socket MỚI (re-auth ở handshake). Membership room cũ KHÔNG kế thừa.
    const second = track(connect(tokenFor(userA, companyA)));
    await waitConnect(second);

    // Trước khi re-join: presence:list bị từ chối (chưa ở trong room).
    const beforeRejoin: WsPresenceListAck = await second.emitWithAck(WS_EVENTS.CHAT_PRESENCE_LIST, {
      roomId: roomA,
    });
    expect(beforeRejoin.ok).toBe(false);

    // Re-join thành công ⇒ lại nhận được presence.
    const rejoin: WsAck = await second.emitWithAck(WS_EVENTS.CHAT_JOIN, { roomId: roomA });
    expect(rejoin.ok).toBe(true);
    const afterRejoin: WsPresenceListAck = await second.emitWithAck(WS_EVENTS.CHAT_PRESENCE_LIST, {
      roomId: roomA,
    });
    expect(afterRejoin.ok).toBe(true);
    expect(afterRejoin.ok && afterRejoin.userIds).toContain(userA);
  });

  // ─── ORDERING ─────────────────────────────────────────────────────────────────
  it("ordering: N chat:send tuần tự → chat:message nhận ĐÚNG thứ tự gửi", async () => {
    const s = track(connect(tokenFor(userA, companyA)));
    await waitConnect(s);
    await s.emitWithAck(WS_EVENTS.CHAT_JOIN, { roomId: roomA });

    const received: string[] = [];
    s.on(WS_EVENTS.CHAT_MESSAGE, (m: { body?: unknown }) => {
      if (typeof m.body === "string") received.push(m.body);
    });

    const sentOrder = ["ord-0", "ord-1", "ord-2", "ord-3", "ord-4"];
    for (const body of sentOrder) {
      const ack: WsChatSendAck = await s.emitWithAck(WS_EVENTS.CHAT_SEND, { roomId: roomA, body });
      expect(ack.ok).toBe(true);
    }

    await new Promise((r) => setTimeout(r, SETTLE_MS));
    // server.to(room) bao gồm cả sender ⇒ socket này nhận lại đúng N message của chính mình.
    expect(received).toEqual(sentOrder);
  });
});
