/**
 * S7-CHAT-RT-1 — realtime CHAT đầu-cuối: join server-side · cổng quyền · emit sau commit · đồng bộ
 * membership tức thì (SPEC-15 §3.5 · §13.8 · API-13 §7).
 *
 * ⚠️ CHỦ THỂ KHÔNG PHẢI SUPER ADMIN — SA giữ toàn bộ catalog nên mọi cổng quyền đều "đạt" với họ; test
 * bằng SA là tautology (memory `superadmin-not-a-canonical-role`). Mọi actor ở đây là role THƯỜNG.
 *
 * WS thật (`socket.io-client` qua cổng TCP thật, `app.listen(0)`) + REST thật (`supertest`) + DB thật.
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WS_EVENTS, WS_NAMESPACE } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { loadEnv } from "../../src/config/env.schema";
import { setupWebSocketAdapter } from "../../src/realtime/setup-websocket-adapter";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = "Passw0rd!chatrt1";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

const CHAT_FULL: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
  ["recall", "chat-message", "Company"],
  ["pin", "chat-message", "Company"],
];

/** Mọi cặp CHAT TRỪ `('view','chat-room')` — dựng người "là thành viên nhưng không có quyền ĐỌC". */
const CHAT_NO_VIEW: PairGrant[] = CHAT_FULL.filter(
  ([a, r]) => !(a === "view" && r === "chat-room"),
);

describe.skipIf(!hasLaneDb)("S7-CHAT-RT-1 — realtime CHAT (WS thật + DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let port: number;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  const openClients: ClientSocket[] = [];

  let uAdmin = "";
  let uMate = "";
  let uNoView = "";
  let uOutsider = "";
  let uB = "";
  let tAdmin = "";
  let tMate = "";
  let tNoView = "";
  let tOutsider = "";
  let tB = "";

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: PairGrant[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `chatrt1-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  const authPost = (t: string, u: string) =>
    request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);
  const authPatch = (t: string, u: string) =>
    request(app.getHttpServer()).patch(u).set("Authorization", `Bearer ${t}`);
  const authDelete = (t: string, u: string) =>
    request(app.getHttpServer()).delete(u).set("Authorization", `Bearer ${t}`);

  async function newRoom(name: string, members: string[]): Promise<string> {
    const res = await authPost(tAdmin, "/chat/rooms").send({ name, memberUserIds: members });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function send(token: string, roomId: string, body: string): Promise<string> {
    const res = await authPost(token, `/chat/rooms/${roomId}/messages`).send({
      body,
      clientMessageId: randomUUID(),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  /** Bộ thu sự kiện của MỘT socket — ghi lại mọi event chat để assert cả CÓ lẫn KHÔNG. */
  interface Recorder {
    socket: ClientSocket;
    events: { name: string; payload: Record<string, unknown> }[];
    clear(): void;
    waitFor(name: string, ms?: number): Promise<Record<string, unknown>>;
  }

  async function connect(token: string): Promise<Recorder> {
    const socket = ioClient(`http://127.0.0.1:${port}/${WS_NAMESPACE}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    openClients.push(socket);
    const events: { name: string; payload: Record<string, unknown> }[] = [];
    for (const name of [
      WS_EVENTS.CHAT_MESSAGE,
      WS_EVENTS.CHAT_MESSAGE_RECALLED,
      WS_EVENTS.CHAT_READ,
      WS_EVENTS.CHAT_ROOM,
      WS_EVENTS.NOTIFICATION_NEW,
    ]) {
      socket.on(name, (payload: Record<string, unknown>) => events.push({ name, payload }));
    }
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => resolve());
      socket.on("connect_error", reject);
    });
    // `handleConnection` chạy bất đồng bộ với sự kiện `connect` phía client (Socket.IO KHÔNG await nó).
    // Chờ nó tra DB + join xong, nếu không mọi assert "đã nhận" sẽ flaky.
    await settle(250);
    return {
      socket,
      events,
      clear: () => (events.length = 0),
      waitFor: async (name, ms = 2000) => {
        const start = Date.now();
        while (Date.now() - start < ms) {
          const hit = events.find((e) => e.name === name);
          if (hit) return hit.payload;
          await settle(20);
        }
        throw new Error(
          `hết giờ chờ sự kiện ${name}; đã nhận: ${events.map((e) => e.name).join(",")}`,
        );
      },
    };
  }

  const settle = (ms = 200): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const namesOf = (r: Recorder): string[] => r.events.map((e) => e.name);

  beforeAll(async () => {
    process.env.REALTIME_ENABLED = "true";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    // ĐÚNG lời gọi mà `main.ts` dùng (S7-CHAT-RT-0) — WS phải đi qua đường production thật.
    await setupWebSocketAdapter(app as never, loadEnv());
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "chatrt1a");
    B = await seedCompany(direct, "chatrt1b");
    companyIds.push(A.companyId, B.companyId);

    const mk = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uAdmin = await mk("owner");
    uMate = await mk("mate");
    uNoView = await mk("noview");
    uOutsider = await mk("outsider");
    uB = await seedUser(direct, B.companyId, `bob@${B.slug}.test`, hash);

    await grantPairs(A.companyId, uAdmin, "owner", CHAT_FULL);
    await grantPairs(A.companyId, uMate, "mate", CHAT_FULL);
    await grantPairs(A.companyId, uOutsider, "outsider", CHAT_FULL);
    // Là thành viên phòng THẬT nhưng bị thu hồi ĐÚNG cặp đọc — membership không thay được cặp quyền.
    await grantPairs(A.companyId, uNoView, "noview", CHAT_NO_VIEW);
    await grantPairs(B.companyId, uB, "b", CHAT_FULL);

    tAdmin = await login(A.slug, `owner@${A.slug}.test`);
    tMate = await login(A.slug, `mate@${A.slug}.test`);
    tNoView = await login(A.slug, `noview@${A.slug}.test`);
    tOutsider = await login(A.slug, `outsider@${A.slug}.test`);
    tB = await login(B.slug, `bob@${B.slug}.test`);
  }, 180_000);

  afterAll(async () => {
    while (openClients.length) openClients.pop()?.disconnect();
    if (direct) {
      await cleanupTenants(direct, companyIds);
      await direct.end();
    }
    await app?.close();
  });

  // ─── join server-side ────────────────────────────────────────────────────────
  it("thành viên phòng nhận `chat:message` realtime; NGƯỜI NGOÀI phòng thì không", async () => {
    const room = await newRoom("Phòng 1", [uMate]);
    const mate = await connect(tMate);
    const outsider = await connect(tOutsider);

    await send(tAdmin, room, "chào cả nhà");

    const msg = await mate.waitFor(WS_EVENTS.CHAT_MESSAGE);
    expect(msg.roomId).toBe(room);
    expect(msg.body).toBe("chào cả nhà");
    // Người ngoài: 0 sự kiện chat, dù kết nối hoàn toàn hợp lệ (positive control là ca của `mate` ở trên
    // — chứng minh đường phát thật sự hoạt động trong CÙNG lần chạy này).
    await settle(300);
    expect(namesOf(outsider)).not.toContain(WS_EVENTS.CHAT_MESSAGE);
  });

  it("phòng tạo TRƯỚC khi kết nối vẫn được join (danh sách đọc từ DB lúc handshake)", async () => {
    const room = await newRoom("Phòng có sẵn", [uMate]);
    // Kết nối SAU khi phòng đã tồn tại — không có bước nào để client tự khai phòng.
    const mate = await connect(tMate);
    await send(tAdmin, room, "tin sau khi nối");

    const msg = await mate.waitFor(WS_EVENTS.CHAT_MESSAGE);
    expect(msg.roomId).toBe(room);
  });

  // ─── cổng quyền đường đọc WS ─────────────────────────────────────────────────
  it("🔒 là THÀNH VIÊN nhưng THIẾU cặp view:chat-room → connect OK, 0 sự kiện chat, NOTI vẫn sống", async () => {
    const room = await newRoom("Phòng cấm đọc", [uNoView, uMate]);
    const noView = await connect(tNoView);
    const mate = await connect(tMate);

    await send(tAdmin, room, "tin bí mật");

    // POSITIVE CONTROL trong cùng lần chạy: `mate` (có cặp quyền, cùng phòng) PHẢI nhận được.
    const got = await mate.waitFor(WS_EVENTS.CHAT_MESSAGE);
    expect(got.body).toBe("tin bí mật");

    // Người thiếu cặp quyền: kết nối thành công (JWT hợp lệ) nhưng KHÔNG nhận gì của cụm chat.
    expect(noView.socket.connected).toBe(true);
    expect(namesOf(noView)).not.toContain(WS_EVENTS.CHAT_MESSAGE);
    expect(namesOf(noView)).not.toContain(WS_EVENTS.CHAT_ROOM);
  });

  it("🔒 thiếu cặp quyền: được THÊM vào phòng mới cũng KHÔNG bị kéo vào room chat", async () => {
    // Đóng lối đi vòng: `syncRoomMembership('join')` chỉ quét `chatUserRoomName`, mà socket trượt cổng
    // quyền không nằm trong đó. Nếu nó quét `userRoomName` thì cổng quyền chỉ có tác dụng đúng một lần.
    const room = await newRoom("Phòng thêm sau", [uMate]);
    const noView = await connect(tNoView);
    const mate = await connect(tMate);

    const added = await authPost(tAdmin, `/chat/rooms/${room}/members`).send({
      userId: uNoView,
      role: "member",
    });
    expect(added.status, JSON.stringify(added.body)).toBe(200);

    await settle(300);
    await send(tAdmin, room, "tin sau khi thêm");

    // POSITIVE CONTROL: `mate` nhận được cả `chat:room{member_added}` lẫn tin.
    await mate.waitFor(WS_EVENTS.CHAT_ROOM);
    await mate.waitFor(WS_EVENTS.CHAT_MESSAGE);
    // Người thiếu quyền: vẫn 0 sự kiện chat dù DB đã ghi họ là thành viên.
    expect(namesOf(noView)).not.toContain(WS_EVENTS.CHAT_MESSAGE);
    expect(namesOf(noView)).not.toContain(WS_EVENTS.CHAT_ROOM);
  });

  // ─── đồng bộ membership tức thì ──────────────────────────────────────────────
  it("thêm thành viên → socket join NGAY, nhận tin kế tiếp mà KHÔNG cần reconnect", async () => {
    const room = await newRoom("Phòng mời thêm", []);
    const mate = await connect(tMate); // chưa thuộc phòng lúc kết nối

    await send(tAdmin, room, "trước khi mời");
    await settle(300);
    expect(namesOf(mate)).not.toContain(WS_EVENTS.CHAT_MESSAGE);

    await authPost(tAdmin, `/chat/rooms/${room}/members`).send({ userId: uMate, role: "member" });
    const roomEvt = await mate.waitFor(WS_EVENTS.CHAT_ROOM);
    expect(roomEvt).toMatchObject({ roomId: room, action: "member_added" });

    mate.clear();
    await send(tAdmin, room, "sau khi mời");
    const msg = await mate.waitFor(WS_EVENTS.CHAT_MESSAGE);
    expect(msg.body).toBe("sau khi mời");
  });

  it("🔒 bớt thành viên → socket rời NGAY; tin kế tiếp KHÔNG tới người vừa bị gỡ", async () => {
    const room = await newRoom("Phòng gỡ người", [uMate]);
    const mate = await connect(tMate);

    // POSITIVE CONTROL trước khi gỡ: đường phát tới `mate` đang hoạt động.
    await send(tAdmin, room, "còn trong phòng");
    await mate.waitFor(WS_EVENTS.CHAT_MESSAGE);

    const removed = await authDelete(tAdmin, `/chat/rooms/${room}/members/${uMate}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    // Người bị gỡ VẪN nhận được thông báo mình bị gỡ (qua chat-user-room của họ).
    const evt = await mate.waitFor(WS_EVENTS.CHAT_ROOM);
    expect(evt).toMatchObject({ roomId: room, action: "member_removed" });

    mate.clear();
    await send(tAdmin, room, "tin sau khi gỡ");
    await settle(400);
    expect(namesOf(mate)).not.toContain(WS_EVENTS.CHAT_MESSAGE);
  });

  // ─── payload & idempotency ───────────────────────────────────────────────────
  it("thu hồi: đúng 1 `chat:message-recalled`, payload KHÔNG có `body`; lần hai KHÔNG phát nữa", async () => {
    const room = await newRoom("Phòng thu hồi", [uMate]);
    const mate = await connect(tMate);
    const messageId = await send(tAdmin, room, "lỡ tay gửi nhầm");
    await mate.waitFor(WS_EVENTS.CHAT_MESSAGE);
    mate.clear();

    expect((await authPost(tAdmin, `/chat/messages/${messageId}/recall`)).status).toBe(200);
    const evt = await mate.waitFor(WS_EVENTS.CHAT_MESSAGE_RECALLED);
    expect(Object.keys(evt).sort()).toEqual(["messageId", "recalledAt", "roomId"]);
    expect(evt).not.toHaveProperty("body");
    expect(evt.messageId).toBe(messageId);

    // Idempotent: bấm thu hồi lần hai vẫn 200 nhưng KHÔNG sinh sự kiện thứ hai.
    mate.clear();
    expect((await authPost(tAdmin, `/chat/messages/${messageId}/recall`)).status).toBe(200);
    await settle(400);
    expect(namesOf(mate)).not.toContain(WS_EVENTS.CHAT_MESSAGE_RECALLED);
  });

  it("gửi lại CÙNG clientMessageId → đúng MỘT `chat:message` (không nhân đôi)", async () => {
    const room = await newRoom("Phòng gửi lại", [uMate]);
    const mate = await connect(tMate);
    const clientMessageId = randomUUID();

    const body = { body: "gửi một lần thôi", clientMessageId };
    const first = await authPost(tAdmin, `/chat/rooms/${room}/messages`).send(body);
    expect(first.status).toBe(200);
    const retry = await authPost(tAdmin, `/chat/rooms/${room}/messages`).send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(first.body.data.id); // cùng một tin

    await mate.waitFor(WS_EVENTS.CHAT_MESSAGE);
    await settle(400);
    expect(namesOf(mate).filter((n) => n === WS_EVENTS.CHAT_MESSAGE)).toHaveLength(1);
  });

  it("đánh dấu đọc: con trỏ TIẾN → phát `chat:read`; gửi seq NHỎ HƠN → 200 nhưng KHÔNG phát", async () => {
    const room = await newRoom("Phòng đã đọc", [uMate]);
    const admin = await connect(tAdmin);
    await send(tAdmin, room, "tin 1");
    await send(tAdmin, room, "tin 2");
    await settle(300);
    admin.clear();

    const ok = await authPost(tMate, `/chat/rooms/${room}/read`).send({ seq: 2 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const evt = await admin.waitFor(WS_EVENTS.CHAT_READ);
    expect(evt).toMatchObject({ roomId: room, userId: uMate, lastReadSeq: 2 });

    // Lùi con trỏ: REST vẫn 200 (hành vi không đổi) nhưng không có gì mới để báo.
    admin.clear();
    const back = await authPost(tMate, `/chat/rooms/${room}/read`).send({ seq: 1 });
    expect(back.status).toBe(200);
    expect(back.body.data.lastReadSeq).toBe(2); // kẹp ở SQL, không lùi
    await settle(400);
    expect(namesOf(admin)).not.toContain(WS_EVENTS.CHAT_READ);
  });

  it("người GỬI không nhận `chat:read` dội lại cho lần tự-nâng con trỏ của chính mình", async () => {
    const room = await newRoom("Phòng tự nâng", [uMate]);
    const admin = await connect(tAdmin);
    admin.clear();

    await send(tAdmin, room, "tin của chính tôi");

    await admin.waitFor(WS_EVENTS.CHAT_MESSAGE); // có tin…
    await settle(400);
    expect(namesOf(admin)).not.toContain(WS_EVENTS.CHAT_READ); // …nhưng không có chat:read
  });

  it("`chat:room{updated}` KHÔNG mang `unreadCount` (số PER-MEMBER không broadcast chung)", async () => {
    const room = await newRoom("Phòng đổi tên", [uMate]);
    const mate = await connect(tMate);

    const res = await authPatch(tAdmin, `/chat/rooms/${room}`).send({ name: "Tên mới" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const evt = (await mate.waitFor(WS_EVENTS.CHAT_ROOM)) as { room?: Record<string, unknown> };
    expect(evt).toMatchObject({ roomId: room, action: "updated" });
    expect(evt.room?.name).toBe("Tên mới");
    expect(evt.room).not.toHaveProperty("unreadCount");
  });

  it("mở DM hai lần (idempotent) → chỉ lần ĐẦU phát `chat:room{created}`", async () => {
    const mate = await connect(tMate);
    const first = await authPost(tAdmin, "/chat/rooms/direct").send({ peerUserId: uMate });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const evt = await mate.waitFor(WS_EVENTS.CHAT_ROOM);
    expect(evt).toMatchObject({ action: "created" });

    mate.clear();
    const again = await authPost(tAdmin, "/chat/rooms/direct").send({ peerUserId: uMate });
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    await settle(400);
    expect(namesOf(mate)).not.toContain(WS_EVENTS.CHAT_ROOM);
  });

  // ─── cô lập tenant ───────────────────────────────────────────────────────────
  it("🔒 cross-tenant: socket công ty B không bao giờ nhận sự kiện của công ty A", async () => {
    const room = await newRoom("Phòng của A", [uMate]);
    const bob = await connect(tB);
    const mate = await connect(tMate);

    await send(tAdmin, room, "chuyện nội bộ A");

    // POSITIVE CONTROL: người trong công ty A nhận được.
    await mate.waitFor(WS_EVENTS.CHAT_MESSAGE);
    await settle(300);
    expect(namesOf(bob)).toHaveLength(0);
  });

  // ─── kill-switch ─────────────────────────────────────────────────────────────
  it("REALTIME_ENABLED=false → gateway TỪ CHỐI ở handshake, REST vẫn đúng hoàn toàn", async () => {
    process.env.REALTIME_ENABLED = "false";
    const other = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app2 = other.createNestApplication();
    app2.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app2.useGlobalFilters(new AllExceptionsFilter());
    await setupWebSocketAdapter(app2 as never, loadEnv());
    await app2.listen(0);
    const port2 = (app2.getHttpServer().address() as AddressInfo).port;

    try {
      const err = await new Promise<Error>((resolve) => {
        const c = ioClient(`http://127.0.0.1:${port2}/${WS_NAMESPACE}`, {
          auth: { token: tAdmin },
          transports: ["websocket"],
          reconnection: false,
          forceNew: true,
        });
        openClients.push(c);
        c.on("connect_error", (e) => resolve(e as Error));
      });
      expect(err.message).toMatch(/realtime_disabled/);

      // Nghiệp vụ KHÔNG phụ thuộc realtime: tạo phòng + gửi tin vẫn đúng, FE bù bằng afterSeq.
      const created = await request(app2.getHttpServer())
        .post("/chat/rooms")
        .set("Authorization", `Bearer ${tAdmin}`)
        .send({ name: "Phòng không realtime", memberUserIds: [uMate] });
      expect(created.status, JSON.stringify(created.body)).toBe(201);

      const sent = await request(app2.getHttpServer())
        .post(`/chat/rooms/${created.body.data.id}/messages`)
        .set("Authorization", `Bearer ${tAdmin}`)
        .send({ body: "vẫn gửi được", clientMessageId: randomUUID() });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      expect(sent.body.data.body).toBe("vẫn gửi được");
    } finally {
      await app2.close();
      process.env.REALTIME_ENABLED = "true";
    }
  }, 120_000);
});
