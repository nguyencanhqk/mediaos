import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { io, type Socket } from "socket.io-client";
import {
  WS_EVENTS,
  WS_NAMESPACE,
  chatMessageSchema,
  type WsChatSendAck,
} from "@mediaos/contracts";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser } from "../helpers/seed";
// RED (G10-1): RealtimeModule CHƯA tồn tại. Import này làm suite fail-to-load → ĐỎ vì lý do ĐÚNG
// (chưa có RealtimeGateway được wire thành module). Khi GREEN: tạo src/realtime/realtime.module.ts
// (RealtimeGateway + TokenService + ChatService + RealtimeEmitterService) rồi import vào app.module.ts.
import { RealtimeModule } from "../../src/realtime/realtime.module";
import { TokenService } from "../../src/auth/token.service";

/**
 * G10-1 — DENY-PATH realtime (RED-first, CLAUDE.md §6 + §5 "WS qua cùng masking như REST").
 *
 * 4 bất biến phải ép ở tầng WS, KHÔNG dựa kỷ luật dev:
 *   (a) FAIL-CLOSED handshake — thiếu/sai token ⇒ disconnect, KHÔNG nhận event nào.
 *   (b) CROSS-TENANT — client tenant A KHÔNG bao giờ nhận message/presence room tenant B (0 row).
 *   (c) MASKING — payload chat:message PHẢI là output chatMessageSchema.parse() (strip field thừa);
 *       cấm io.emit thẳng row DB (key nội bộ như password_hash/internal flags không được rò ra client).
 *   (d) APPEND-ONLY — app role bị TỪ CHỐI UPDATE body/sender của chat_messages (chỉ cột pinned).
 *
 * Đây là bước RED: RealtimeModule chưa có ⇒ toàn bộ suite ĐỎ. KHÔNG implement GREEN trong lượt này.
 */

const WS_PORT = 3199;

function connect(token: string | undefined): Socket {
  return io(`http://127.0.0.1:${WS_PORT}/${WS_NAMESPACE}`, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    auth: token ? { token } : {},
  });
}

/** Chờ socket connect (resolve) hoặc bị từ chối/disconnect (reject) — dùng cho fail-closed test. */
function waitConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (err) => reject(err));
    socket.on("disconnect", (reason) => reject(new Error(`disconnected: ${reason}`)));
    setTimeout(() => reject(new Error("connect timeout")), 4000);
  });
}

describe.skipIf(!hasDb)("G10-1 realtime gateway — deny-path (RED)", () => {
  const direct = directPool();
  const app = appPool(2);
  let nest: INestApplication;
  let tokens: TokenService;
  const tenantIds: string[] = [];

  // Tenant A + B, mỗi tenant 1 user là member của 1 room riêng.
  let companyA: string;
  let companyB: string;
  let userA: string;
  let userB: string;
  let roomA: string;
  let roomB: string;
  let msgBId: string; // 1 message của tenant B (để chứng minh A không đọc được + append-only)

  beforeAll(async () => {
    const a = await seedCompany(direct, "rt-a");
    const b = await seedCompany(direct, "rt-b");
    companyA = a.companyId;
    companyB = b.companyId;
    tenantIds.push(companyA, companyB);

    userA = await seedUser(direct, companyA, `a-${companyA.slice(0, 6)}@t.local`);
    userB = await seedUser(direct, companyB, `b-${companyB.slice(0, 6)}@t.local`);

    // Room + membership + 1 message của mỗi tenant (qua direct/superuser — chỉ dựng lưới test).
    const ra = await direct.query(
      `INSERT INTO chat_rooms (company_id, room_type, name) VALUES ($1, 'group', 'Room A') RETURNING id`,
      [companyA],
    );
    roomA = ra.rows[0].id as string;
    const rb = await direct.query(
      `INSERT INTO chat_rooms (company_id, room_type, name) VALUES ($1, 'group', 'Room B') RETURNING id`,
      [companyB],
    );
    roomB = rb.rows[0].id as string;

    await direct.query(
      `INSERT INTO chat_room_members (company_id, room_id, user_id) VALUES ($1, $2, $3)`,
      [companyA, roomA, userA],
    );
    await direct.query(
      `INSERT INTO chat_room_members (company_id, room_id, user_id) VALUES ($1, $2, $3)`,
      [companyB, roomB, userB],
    );

    const mb = await direct.query(
      `INSERT INTO chat_messages (company_id, room_id, sender_id, body)
       VALUES ($1, $2, $3, 'secret of tenant B') RETURNING id`,
      [companyB, roomB, userB],
    );
    msgBId = mb.rows[0].id as string;

    const mod = await Test.createTestingModule({ imports: [RealtimeModule] }).compile();
    nest = mod.createNestApplication();
    tokens = mod.get(TokenService);
    await nest.listen(WS_PORT);
  });

  afterAll(async () => {
    if (nest) await nest.close();
    await cleanupTenants(direct, tenantIds);
    await direct.end();
    await app.end();
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

  // ─── (a) FAIL-CLOSED handshake ───────────────────────────────────────────────
  it("(a) từ chối connection khi THIẾU token (fail-closed)", async () => {
    const s = track(connect(undefined));
    await expect(waitConnect(s)).rejects.toThrow();
  });

  it("(a) từ chối connection khi token KHÔNG hợp lệ (fail-closed)", async () => {
    const s = track(connect("not-a-real-jwt"));
    await expect(waitConnect(s)).rejects.toThrow();
  });

  // ─── (b) CROSS-TENANT isolation ──────────────────────────────────────────────
  it("(b) client tenant A KHÔNG join được room tenant B (forbidden, 0 row)", async () => {
    const s = track(connect(tokenFor(userA, companyA)));
    await waitConnect(s);
    const ack = await s.emitWithAck(WS_EVENTS.CHAT_JOIN, { roomId: roomB });
    expect(ack.ok).toBe(false);
  });

  it("(b) client tenant A KHÔNG nhận chat:message phát ở room tenant B (cross-tenant 0 row)", async () => {
    const sa = track(connect(tokenFor(userA, companyA)));
    const sb = track(connect(tokenFor(userB, companyB)));
    await Promise.all([waitConnect(sa), waitConnect(sb)]);

    const received: unknown[] = [];
    sa.on(WS_EVENTS.CHAT_MESSAGE, (m) => received.push(m));

    await sa.emitWithAck(WS_EVENTS.CHAT_JOIN, { roomId: roomA });
    await sb.emitWithAck(WS_EVENTS.CHAT_JOIN, { roomId: roomB });
    await sb.emitWithAck(WS_EVENTS.CHAT_SEND, { roomId: roomB, body: "hello B-only" });

    await new Promise((r) => setTimeout(r, 500));
    expect(received).toHaveLength(0);
  });

  it("(b) presence:list room tenant B KHÔNG lộ cho client tenant A (not_joined)", async () => {
    const sa = track(connect(tokenFor(userA, companyA)));
    await waitConnect(sa);
    const ack = await sa.emitWithAck(WS_EVENTS.CHAT_PRESENCE_LIST, { roomId: roomB });
    expect(ack.ok).toBe(false);
  });

  // ─── (c) MASKING — chatMessageSchema.parse() trước emit ───────────────────────
  it("(c) payload chat:message là output chatMessageSchema.parse() — KHÔNG rò key nội bộ", async () => {
    const sb = track(connect(tokenFor(userB, companyB)));
    await waitConnect(sb);

    const received: unknown[] = [];
    sb.on(WS_EVENTS.CHAT_MESSAGE, (m) => received.push(m));

    await sb.emitWithAck(WS_EVENTS.CHAT_JOIN, { roomId: roomB });
    const ack: WsChatSendAck = await sb.emitWithAck(WS_EVENTS.CHAT_SEND, {
      roomId: roomB,
      body: "masked payload check",
    });
    expect(ack.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 500));
    expect(received.length).toBeGreaterThan(0);
    const payload = received[0];

    // PHẢI parse sạch qua schema chung REST/WS (đúng shape, không thừa key).
    expect(() => chatMessageSchema.parse(payload)).not.toThrow();
    // strict() loại mọi key thừa → nếu server io.emit thẳng row, key nội bộ (vd password_hash) sẽ làm fail.
    expect(() => chatMessageSchema.strict().parse(payload)).not.toThrow();
  });

  // ─── (d) APPEND-ONLY chat_messages — app role chỉ UPDATE cột pinned ───────────
  it("(d) app role bị TỪ CHỐI UPDATE body của chat_messages (append-only)", async () => {
    await expect(
      app.query(
        `UPDATE chat_messages SET body = 'tampered' WHERE company_id = $1 AND id = $2`,
        [companyB, msgBId],
      ),
    ).rejects.toThrow();
  });

  it("(d) app role bị TỪ CHỐI UPDATE sender_id của chat_messages (append-only)", async () => {
    await expect(
      app.query(
        `UPDATE chat_messages SET sender_id = $3 WHERE company_id = $1 AND id = $2`,
        [companyB, msgBId, userB],
      ),
    ).rejects.toThrow();
  });

  it("(d) app role ĐƯỢC PHÉP UPDATE cột pinned_at/pinned_by (column-grant hợp lệ)", async () => {
    // Cột pinned là ngoại lệ duy nhất app role được sửa. Phải set company GUC để RLS cho phép.
    await expect(
      app.query("SELECT set_config('app.current_company_id', $1, false)", [companyB]),
    ).resolves.toBeDefined();
    await expect(
      app.query(
        `UPDATE chat_messages SET pinned_at = now(), pinned_by = $3 WHERE company_id = $1 AND id = $2`,
        [companyB, msgBId, userB],
      ),
    ).resolves.toBeDefined();
  });
});
