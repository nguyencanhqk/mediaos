/**
 * S7-CHAT-BE-6 — thông báo CHAT qua `OutboxNotificationBridge` (SPEC-15 §17), trên Postgres THẬT.
 *
 * Bộ này đo đúng thứ mà đọc code KHÔNG chứng minh được:
 *   • **producer có được gọi không, và ở ĐÚNG chỗ nào trong tx** — ba ràng buộc vị trí (không enqueue ở
 *     nhánh replay idempotent · không enqueue ở nhánh đua `23505` · cùng commit/rollback với tin) chỉ
 *     phân biệt được khi có transaction thật;
 *   • **whitelist `payloadOf`** — mặc định của bridge là forward NGUYÊN payload, nên nếu whitelist hỏng,
 *     nội dung tin chảy vào `notifications.payload` mà không lỗi gì cả;
 *   • **hai tầng chống-trùng** — tầng 2 (`uq_notifications_dedupe_active`) chỉ hoạt động khi `dedupe_key`
 *     khác NULL, và điều đó phụ thuộc một entry trong `notification-dedupe.const.ts`. Bỏ entry đi thì
 *     mọi thứ vẫn "chạy", chỉ là re-consume sinh thông báo trùng.
 *
 * Chủ thể KHÔNG PHẢI Super Admin. GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { DatabaseService } from "../../src/db/db.service";
import { EventBus } from "../../src/events/event-bus";
import { OutboxService } from "../../src/events/outbox.service";
import { OutboxWorker } from "../../src/events/outbox-worker";
import { OutboxNotificationBridge } from "../../src/notifications/outbox-notification-bridge.service";
import { ChatAudienceReader } from "../../src/notifications/chat-audience.reader";
import { ChatMessagesRepository } from "../../src/chat/chat-messages.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import {
  acquireOutboxWorkerLock,
  OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  type OutboxWorkerLock,
} from "../helpers/outbox-worker-lock";
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
const LOGIN_PW = ["Passw0rd", "chatbe6"].join("!");

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

const CHAT_PAIRS: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
];

describe.skipIf(!hasLaneDb)("S7-CHAT-BE-6 — thông báo CHAT (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let uSender = "";
  let uPeer = "";
  let uThird = "";
  let uLeft = "";
  let tSender = "";

  let db: DatabaseService;
  let bus: EventBus;
  let outbox: OutboxService;
  let worker: OutboxWorker;
  let bridge: OutboxNotificationBridge;
  let reader: ChatAudienceReader;
  let messagesRepo: ChatMessagesRepository;
  // S7-QA-OUTBOXPROBE-1 — ca 6b đo THỨ TỰ giao event, mà thứ tự chỉ có bảo đảm trong MỘT lô claim của MỘT
  // worker. Không có khoá này, worker của spec outbox khác chia lẻ ba event của cùng một phòng ⇒ đỏ ngắt quãng.
  let outboxLock: OutboxWorkerLock | undefined;

  // ─── helper ───

  async function grant(companyId: string, userId: string, label: string): Promise<void> {
    const roleId = await seedRole(direct, companyId, `cb6-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of CHAT_PAIRS) {
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

  async function createGroup(token: string, memberUserIds: string[]): Promise<string> {
    const res = await authPost(token, "/chat/rooms").send({
      roomType: "group",
      name: `Nhóm ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      memberUserIds,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function openDirect(token: string, peerUserId: string): Promise<string> {
    const res = await authPost(token, "/chat/rooms/direct").send({ peerUserId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data.id as string;
  }

  async function send(
    token: string,
    roomId: string,
    body: string,
    opts: { mentions?: string[]; clientMessageId?: string } = {},
  ) {
    return authPost(token, `/chat/rooms/${roomId}/messages`).send({
      body,
      clientMessageId: opts.clientMessageId ?? randomUUID(),
      mentions: opts.mentions,
    });
  }

  /** Người dùng MỚI + grant — mỗi ca cần đếm phải có phòng DM RIÊNG (openDirect idempotent). */
  async function freshPeer(label: string): Promise<string> {
    const hash = await new PasswordService().hash(LOGIN_PW);
    const uid = await seedUser(
      direct,
      A.companyId,
      `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@${A.slug}.test`,
      hash,
    );
    await grant(A.companyId, uid, label);
    return uid;
  }

  async function drain(): Promise<void> {
    await drainOutboxUntilSettled({ worker, direct, companyIds });
  }

  async function notificationsOf(
    userId: string,
    eventCode: string,
  ): Promise<
    { payload: Record<string, unknown>; body: string; title: string; dedupe_key: string }[]
  > {
    const r = await direct.query(
      `SELECT payload, body, title, dedupe_key FROM notifications
        WHERE recipient_user_id = $1 AND event_code = $2 ORDER BY created_at`,
      [userId, eventCode],
    );
    return r.rows;
  }

  async function outboxCount(eventType: string, roomId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM outbox_events
        WHERE event_type = $1 AND payload->>'roomId' = $2`,
      [eventType, roomId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    db = app.get(DatabaseService);
    bus = app.get(EventBus);
    outbox = app.get(OutboxService);
    worker = app.get(OutboxWorker);
    bridge = app.get(OutboxNotificationBridge);
    reader = app.get(ChatAudienceReader);
    messagesRepo = app.get(ChatMessagesRepository);

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "cb6a");
    B = await seedCompany(direct, "cb6b");
    companyIds.push(A.companyId, B.companyId);

    const mk = async (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uSender = await mk("sender");
    uPeer = await mk("peer");
    uThird = await mk("third");
    uLeft = await mk("left");
    for (const [u, label] of [
      [uSender, "s"],
      [uPeer, "p"],
      [uThird, "t"],
      [uLeft, "l"],
    ] as const) {
      await grant(A.companyId, u, label);
    }
    tSender = await login(A.slug, `sender@${A.slug}.test`);

    // CUỐI beforeAll: boot + seed vẫn chạy SONG SONG với spec khác, chỉ THÂN test mới xếp hàng.
    outboxLock = await acquireOutboxWorkerLock("chat-noti-e2e");
  }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await outboxLock?.release();
    await app?.close();
    await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ══════════════ A. BOOT ══════════════

  describe("A. đăng ký lúc boot", () => {
    it("ca 2b — mỗi eventType CHAT có ĐÚNG 1 consumer", () => {
      // Bắt lỗi "dựng bridge tay nhưng quên khai registrar vào providers": app vẫn boot, tin vẫn gửi,
      // chỉ là không ai tiêu thụ event ⇒ 0 thông báo và không có lỗi nào.
      expect(bus.consumersFor("chat.message.mentioned")).toHaveLength(1);
      expect(bus.consumersFor("chat.message.direct_sent")).toHaveLength(1);
    });

    it("ca 2 — wire eventCode NGOÀI catalog ⇒ ném NGAY tại boot, không chờ dead-letter", () => {
      expect(() =>
        bridge.registerSource({
          eventType: "chat.message.typing",
          eventCode: "CHAT_TYPING",
          sourceModule: "CHAT",
          sourceEntityType: "chat_message",
          sourceEntityIdOf: () => undefined,
          resolveRecipients: () => Promise.resolve([]),
        }),
      ).toThrow(/CHAT_TYPING/);
    });
  });

  // ══════════════ B. ĐƯỜNG THẬT QUA HTTP ══════════════

  describe("B. producer + consumer trên đường HTTP thật", () => {
    it("ca 3 — mention trong phòng nhóm: chỉ người CÒN trong phòng nhận; payload đúng 3 khoá", async () => {
      const roomId = await createGroup(tSender, [uPeer, uThird, uLeft]);
      // uLeft rời phòng TRƯỚC khi gửi — payload vẫn mang họ nếu producer không lọc, reader phải chặn.
      await direct.query(
        `UPDATE chat_room_members SET left_at = now() WHERE room_id = $1 AND user_id = $2`,
        [roomId, uLeft],
      );

      const res = await send(tSender, roomId, "chào @peer @left", { mentions: [uPeer, uLeft] });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await drain();

      const forPeer = await notificationsOf(uPeer, "CHAT_MENTIONED");
      expect(forPeer).toHaveLength(1);
      expect(await notificationsOf(uLeft, "CHAT_MENTIONED")).toHaveLength(0);

      // Whitelist: ĐÚNG 3 khoá, không hơn. Thừa một khoá ở đây nghĩa là payload outbox đang chảy thẳng.
      expect(Object.keys(forPeer[0].payload).sort()).toEqual([
        "actor_name",
        "room_id",
        "room_name",
      ]);
      expect(forPeer[0].payload.actor_name).toBeTruthy();
    });

    it("ca 4 — người bị mention đang tắt thông báo (`muted_until` tương lai) ⇒ KHÔNG nhận", async () => {
      const roomId = await createGroup(tSender, [uThird]);
      await direct.query(
        `UPDATE chat_room_members SET muted_until = now() + interval '1 hour'
          WHERE room_id = $1 AND user_id = $2`,
        [roomId, uThird],
      );
      const before = (await notificationsOf(uThird, "CHAT_MENTIONED")).length;

      const res = await send(tSender, roomId, "@third", { mentions: [uThird] });
      expect(res.status).toBe(200);
      await drain();

      expect(await notificationsOf(uThird, "CHAT_MENTIONED")).toHaveLength(before);

      // CHỨNG-DƯƠNG: gỡ mute rồi gửi lại ⇒ CÓ nhận. Không có vế này thì ca trên xanh cả khi producer
      // chưa từng phát event nào cho phòng đó.
      await direct.query(
        `UPDATE chat_room_members SET muted_until = NULL WHERE room_id = $1 AND user_id = $2`,
        [roomId, uThird],
      );
      expect((await send(tSender, roomId, "@third lần 2", { mentions: [uThird] })).status).toBe(
        200,
      );
      await drain();
      expect(await notificationsOf(uThird, "CHAT_MENTIONED")).toHaveLength(before + 1);
    });

    it("ca 5 — DM: người nhận có CHAT_DIRECT_MESSAGE, payload 3 khoá, unread_count = 1", async () => {
      const roomId = await openDirect(tSender, uPeer);
      expect((await send(tSender, roomId, "xin chào")).status).toBe(200);
      await drain();

      const rows = await notificationsOf(uPeer, "CHAT_DIRECT_MESSAGE");
      const mine = rows.filter((r) => r.payload.room_id === roomId);
      expect(mine).toHaveLength(1);
      expect(Object.keys(mine[0].payload).sort()).toEqual([
        "actor_name",
        "room_id",
        "unread_count",
      ]);
      expect(mine[0].payload.unread_count).toBe(1);
    });

    it("ca 6 — 3 DM cùng lô 15 phút ⇒ ĐÚNG 1 thông báo", async () => {
      const peer = await freshPeer("bucket");
      const roomId = await openDirect(tSender, peer);
      for (const i of [1, 2, 3]) {
        expect((await send(tSender, roomId, `tin ${i}`)).status).toBe(200);
      }
      await drain();

      const mine = (await notificationsOf(peer, "CHAT_DIRECT_MESSAGE")).filter(
        (r) => r.payload.room_id === roomId,
      );
      expect(mine, "gộp lô: 3 tin trong cùng bucket = 1 thông báo").toHaveLength(1);
      // Engine tự tiền tố `dedupe_key` bằng eventCode ⇒ khớp phần ĐUÔI do mapping của WO này sinh ra.
      expect(mine[0].dedupe_key).toMatch(new RegExp(`chat:${roomId}:${peer}:\\d+$`));
      // `unread_count` là ảnh chụp của MỘT trong ba tin, không phải tổng 3 và cũng không phải placeholder
      // chưa thay — vế này đúng bất kể event nào thắng cuộc gộp lô. Vế MẠNH hơn ("đúng giá trị của tin
      // ĐẦU") nằm ở ca 6b; giữ vế yếu ở đây để ca này vẫn đo ĐÚNG thứ nó nói (gộp lô), không đo thứ tự.
      expect([1, 2, 3]).toContain(mine[0].payload.unread_count);
    });

    // ✅ KI-059 ĐÃ ĐÓNG bởi `S7-INT-OUTBOX-FIFO-1` — ca này là NGHIỆM THU end-to-end của bản vá đó.
    //
    // Lịch sử để người sau không vá lùi: `OutboxWorker.claim()` từng đặt `UPDATE … RETURNING` làm câu
    // NGOÀI CÙNG, nên `ORDER BY` trong CTE chỉ chọn hàng nào được claim chứ không định thứ tự trả về —
    // planner sinh thứ tự đó. Đo thật: gieo seq 0..11 nhận về `[0,8,10,7,6,11,5,2,1,4,3,9]`. Event nào
    // tiêu thụ TRƯỚC thắng cuộc gộp lô và đóng dấu `unread_count` của chính nó ⇒ con số này từng là 1
    // HOẶC 2 HOẶC 3 tuỳ lượt chạy. Ca này khi đó để `skip` với assert ĐÚNG (không hạ assert xuống cho
    // khớp hành vi hỏng — làm thế là đóng đinh lỗ hổng ở tư thế mở).
    //
    // ⚠️ Giới hạn tồn dư (KHÔNG do ca này phủ): ba tin dưới đi qua BA transaction HTTP riêng nên
    // `available_at` tăng thật. Event enqueue trong CÙNG một transaction thì chia sẻ `now()` ⇒ cả
    // `available_at` lẫn `created_at` bằng nhau, tie-break rơi xuống `id` (UUID ngẫu nhiên) ⇒ thứ tự
    // trong-tx vẫn KHÔNG phải thứ tự enqueue. Muốn đúng tuyệt đối cần cột bigserial = migration = WO khác.
    it("ca 6b (KI-059) — unread_count giữ giá trị của tin ĐẦU trong lô", async () => {
      const peer = await freshPeer("bucketfirst");
      const roomId = await openDirect(tSender, peer);
      for (const i of [1, 2, 3]) {
        expect((await send(tSender, roomId, `tin ${i}`)).status).toBe(200);
      }
      await drain();

      const mine = (await notificationsOf(peer, "CHAT_DIRECT_MESSAGE")).filter(
        (r) => r.payload.room_id === roomId,
      );
      expect(mine).toHaveLength(1);
      // `intake()` SKIP hoàn toàn khi trùng dedupeKey (không có nhánh UPDATE) ⇒ con số này là ảnh chụp
      // lúc tin ĐẦU, KHÔNG phải tổng 3. Khác badge `GET /chat/unread-count` (real-time) — CHỦ Ý.
      expect(mine[0].payload.unread_count).toBe(1);
    });

    it("ca 7 — hai lô 15 phút KHÁC nhau ⇒ 2 thông báo riêng (bucket suy từ payload.createdAt)", async () => {
      const peer = await freshPeer("twobuckets");
      const roomId = await openDirect(tSender, peer);

      // Gieo thẳng hai event với `createdAt` cách nhau 30 phút. Gửi hai tin thật cách nhau vài giây sẽ
      // LUÔN rơi vào cùng bucket, nên không đo được gì — và chính vì bucket suy từ `payload.createdAt`
      // (KHÔNG từ `Date.now()` lúc consume) mà cách gieo này mới phản ánh đúng hành vi thật.
      const base = Date.now();
      for (const offsetMs of [0, 30 * 60_000]) {
        await db.withTenant(A.companyId, (tx) =>
          outbox.enqueue(tx, {
            eventType: "chat.message.direct_sent",
            payload: {
              roomId,
              messageId: randomUUID(),
              actorUserId: uSender,
              recipientUserId: peer,
              createdAt: new Date(base + offsetMs).toISOString(),
              actor_name: "Người Gửi",
              unread_count: 1,
            },
          }),
        );
      }
      await drain();

      const mine = (await notificationsOf(peer, "CHAT_DIRECT_MESSAGE")).filter(
        (r) => r.payload.room_id === roomId,
      );
      expect(mine, "hai bucket khác nhau ⇒ hai thông báo").toHaveLength(2);
      expect(new Set(mine.map((r) => r.dedupe_key)).size).toBe(2);
    });

    it("ca 8 — tin nhóm KHÔNG mention ai ⇒ KHÔNG phát event nào", async () => {
      const roomId = await createGroup(tSender, [uPeer]);
      expect((await send(tSender, roomId, "tin thường")).status).toBe(200);
      await drain();

      expect(await outboxCount("chat.message.mentioned", roomId)).toBe(0);
      expect(await outboxCount("chat.message.direct_sent", roomId)).toBe(0);

      // CHỨNG-DƯƠNG: cùng phòng đó, có mention ⇒ CÓ event. Không có vế này thì "0 event" xanh kể cả khi
      // producer chưa bao giờ được gọi.
      expect((await send(tSender, roomId, "@peer", { mentions: [uPeer] })).status).toBe(200);
      await drain();
      expect(await outboxCount("chat.message.mentioned", roomId)).toBe(1);
    });

    it("ca 9 — gửi lại CÙNG clientMessageId ⇒ 1 tin, 1 event (không enqueue ở nhánh replay)", async () => {
      const roomId = await openDirect(tSender, await freshPeer("replay"));
      const cid = randomUUID();
      expect((await send(tSender, roomId, "một lần", { clientMessageId: cid })).status).toBe(200);
      expect((await send(tSender, roomId, "một lần", { clientMessageId: cid })).status).toBe(200);
      await drain();

      const msgs = await direct.query(
        `SELECT count(*)::int AS n FROM chat_messages WHERE room_id = $1`,
        [roomId],
      );
      expect(msgs.rows[0].n).toBe(1);
      // Ràng buộc (a): nhánh `if (existing) return` return SỚM, TRƯỚC điểm chèn ⇒ đúng bằng CẤU TRÚC.
      expect(await outboxCount("chat.message.direct_sent", roomId)).toBe(1);
    });

    it("ca 10 — hai request ĐỒNG THỜI cùng clientMessageId ⇒ 1 tin, 1 event (nhánh đua 23505)", async () => {
      const roomId = await openDirect(tSender, await freshPeer("race"));
      const cid = randomUUID();
      const [r1, r2] = await Promise.all([
        send(tSender, roomId, "đua", { clientMessageId: cid }),
        send(tSender, roomId, "đua", { clientMessageId: cid }),
      ]);
      // ⚠️ KHÔNG assert cả hai đều 200. Đo 03/08: bên thua cuộc nhận **500**, và điều đó xảy ra Y HỆT
      // khi TẮT producer của WO này ⇒ khuyết tật có sẵn của `S7-CHAT-BE-2` ở nhánh `.catch` đua 23505
      // (lớp chống-trùng thứ ba của nó không trả về tin của bên thắng như đã hứa). Ngoài phạm vi BE-6 —
      // đã báo owner, cần WO riêng. Ở đây chỉ đo BẤT BIẾN mà WO này sở hữu, và CỐ Ý không đóng đinh 500
      // thành "hành vi đúng" (đóng đinh là giữ lỗ mở).
      expect([r1.status, r2.status]).toContain(200);
      await drain();

      const msgs = await direct.query(
        `SELECT count(*)::int AS n FROM chat_messages WHERE room_id = $1`,
        [roomId],
      );
      expect(msgs.rows[0].n).toBe(1);
      // Ràng buộc (b): `.catch` đua nằm NGOÀI closure của tx ⇒ bên thua không enqueue lần hai.
      expect(await outboxCount("chat.message.direct_sent", roomId)).toBe(1);
    });

    it("ca 11 — bước CUỐI của tx hỏng ⇒ tin VÀ event cùng rollback (không phải chỉ một trong hai)", async () => {
      const roomId = await openDirect(tSender, await freshPeer("rollback"));
      const before = await direct.query(
        `SELECT count(*)::int AS n FROM chat_messages WHERE room_id = $1`,
        [roomId],
      );

      // `advanceLastReadSeq` chạy SAU `enqueueNotifications` trong CÙNG tx — ép nó hỏng là cách duy nhất
      // chứng minh enqueue thật sự nằm TRONG ranh giới transaction, không phải cạnh nó.
      const proto = Object.getPrototypeOf(messagesRepo) as Record<string, unknown>;
      const original = proto.advanceLastReadSeq;
      proto.advanceLastReadSeq = async () => {
        throw new Error("gia lap loi buoc cuoi");
      };
      try {
        const res = await send(tSender, roomId, "sẽ rollback");
        expect(res.status).toBeGreaterThanOrEqual(500);
      } finally {
        proto.advanceLastReadSeq = original;
      }

      const after = await direct.query(
        `SELECT count(*)::int AS n FROM chat_messages WHERE room_id = $1`,
        [roomId],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
      expect(await outboxCount("chat.message.direct_sent", roomId)).toBe(0);
    });

    it("ca 15 — không thông báo nào còn placeholder `{…}` chưa thay", async () => {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM notifications
          WHERE event_code IN ('CHAT_MENTIONED','CHAT_DIRECT_MESSAGE')
            AND (title LIKE '%{%' OR body LIKE '%{%' OR coalesce(target_url,'') LIKE '%{%')`,
      );
      const total = await direct.query(
        `SELECT count(*)::int AS n FROM notifications
          WHERE event_code IN ('CHAT_MENTIONED','CHAT_DIRECT_MESSAGE')`,
      );
      expect(total.rows[0].n, "phải có thông báo thật để phép đếm có nghĩa").toBeGreaterThan(0);
      expect(r.rows[0].n).toBe(0);
    });
  });

  // ══════════════ C. ĐỐI KHÁNG (gieo payload tay, KHÔNG qua producer) ══════════════

  describe("C. đối kháng — payload hỏng/độc gieo thẳng vào outbox", () => {
    async function enqueueRaw(
      companyId: string,
      eventType: string,
      payload: Record<string, unknown>,
    ): Promise<void> {
      await db.withTenant(companyId, (tx) => outbox.enqueue(tx, { eventType, payload }));
    }

    it("ca 12 — payload mang `body`/`preview` ⇒ whitelist CHẶN, không lọt vào notifications", async () => {
      const roomId = await createGroup(tSender, [uPeer]);
      await enqueueRaw(A.companyId, "chat.message.mentioned", {
        roomId,
        messageId: "00000000-0000-0000-0000-000000000001",
        actorUserId: uSender,
        mentionedUserIds: [uPeer],
        createdAt: new Date().toISOString(),
        actor_name: "Kẻ Gieo",
        room_name: "Phòng",
        body: "NOI DUNG TIN NHAN KHONG DUOC RA KHOI CHAT",
        preview: "trich doan",
      });
      await drain();

      const rows = (await notificationsOf(uPeer, "CHAT_MENTIONED")).filter(
        (r) => r.payload.room_id === roomId,
      );
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0].payload).sort()).toEqual(["actor_name", "room_id", "room_name"]);
      expect(JSON.stringify(rows[0])).not.toContain("NOI DUNG TIN NHAN");
    });

    it("ca 13 — `direct_sent` gieo cho phòng KHÔNG phải `direct` ⇒ 0 thông báo", async () => {
      const roomId = await createGroup(tSender, [uPeer]);
      const before = (await notificationsOf(uPeer, "CHAT_DIRECT_MESSAGE")).length;
      await enqueueRaw(A.companyId, "chat.message.direct_sent", {
        roomId,
        messageId: "00000000-0000-0000-0000-000000000002",
        actorUserId: uSender,
        recipientUserId: uPeer,
        createdAt: new Date().toISOString(),
        actor_name: "Kẻ Gieo",
        unread_count: 9,
      });
      await drain();

      expect(await notificationsOf(uPeer, "CHAT_DIRECT_MESSAGE")).toHaveLength(before);
    });

    it("ca 14 — payload THIẾU trường bắt buộc ⇒ dead-letter LOUD, KHÔNG 'done' im lặng", async () => {
      // Ranh giới mà ca này canh: "hợp đồng payload đã lệch" PHẢI ồn, còn "không còn ai để báo" thì im.
      // Trước khi vá, cả hai đều rơi vào `return []` ⇒ engine ghi `no_recipient`, outbox về `done`, và một
      // WO đổi tên khoá (`roomId` → `room_id`) sẽ tắt TOÀN BỘ thông báo CHAT mà CI vẫn xanh, log vẫn sạch.
      const roomId = await openDirect(tSender, await freshPeer("malformed"));
      await enqueueRaw(A.companyId, "chat.message.direct_sent", {
        roomId,
        messageId: "00000000-0000-0000-0000-000000000005",
        actorUserId: uSender,
        // `recipientUserId` CỐ Ý vắng mặt — đây là hình dạng của một hợp đồng payload bị lệch.
        createdAt: new Date().toISOString(),
        actor_name: "Kẻ Gieo",
        unread_count: 1,
      });
      await drain();

      const dead = await direct.query(
        `SELECT d.error FROM dead_letter_events d JOIN outbox_events o ON o.id = d.event_id
          WHERE o.event_type = 'chat.message.direct_sent' AND o.payload->>'roomId' = $1`,
        [roomId],
      );
      expect(
        dead.rows,
        "payload hỏng phải tới dead-letter, không được 'done' im lặng",
      ).toHaveLength(1);
      expect(dead.rows[0].error).toContain("recipientUserId");

      const stuck = await direct.query(
        `SELECT status FROM outbox_events WHERE event_type = 'chat.message.direct_sent'
           AND payload->>'roomId' = $1`,
        [roomId],
      );
      expect(stuck.rows[0].status).not.toBe("done");
    });

    it("ca 14b — mention gieo cho phòng `direct` ⇒ 0 thông báo (vế ne(roomType,'direct'))", async () => {
      // Đối xứng ca 13. Không có ca này thì vế `ne(chatRooms.roomType, "direct")` trong
      // ChatAudienceReader có thể bị xoá mà cả bộ vẫn xanh.
      const peer = await freshPeer("mentiondirect");
      const roomId = await openDirect(tSender, peer);
      const before = (await notificationsOf(peer, "CHAT_MENTIONED")).length;

      await enqueueRaw(A.companyId, "chat.message.mentioned", {
        roomId,
        messageId: "00000000-0000-0000-0000-000000000006",
        actorUserId: uSender,
        mentionedUserIds: [peer],
        createdAt: new Date().toISOString(),
        actor_name: "Kẻ Gieo",
        room_name: "Phòng",
      });
      await drain();

      expect(await notificationsOf(peer, "CHAT_MENTIONED")).toHaveLength(before);
    });

    it("ca 16 — mention một userId của tenant KHÁC ⇒ 0 thông báo", async () => {
      const roomId = await createGroup(tSender, [uPeer]);
      const foreign = await seedUser(direct, B.companyId, `x-${Date.now()}@${B.slug}.test`);
      await enqueueRaw(A.companyId, "chat.message.mentioned", {
        roomId,
        messageId: "00000000-0000-0000-0000-000000000003",
        actorUserId: uSender,
        mentionedUserIds: [foreign],
        createdAt: new Date().toISOString(),
        actor_name: "Kẻ Gieo",
        room_name: "Phòng",
      });
      await drain();

      const r = await direct.query(
        `SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1`,
        [foreign],
      );
      expect(r.rows[0].n).toBe(0);
    });

    it("re-consume CÙNG event ⇒ vẫn ĐÚNG 1 thông báo (tầng 2 dedupe thật sự có hiệu lực)", async () => {
      const roomId = await createGroup(tSender, [uThird]);
      await enqueueRaw(A.companyId, "chat.message.mentioned", {
        roomId,
        messageId: "00000000-0000-0000-0000-000000000004",
        actorUserId: uSender,
        mentionedUserIds: [uThird],
        createdAt: new Date().toISOString(),
        actor_name: "Kẻ Gieo",
        room_name: "Phòng",
      });
      await drain();
      const once = (await notificationsOf(uThird, "CHAT_MENTIONED")).filter(
        (r) => r.payload.room_id === roomId,
      );
      expect(once).toHaveLength(1);

      // Xoá dấu tầng 1 (`processed_events`) rồi trả event về `pending` — mô phỏng crash giữa
      // insert↔markProcessed rồi reaper re-claim. Nếu `dedupe_key` NULL (thiếu entry
      // `CHAT_MENTIONED` trong notification-dedupe.const.ts) thì partial-unique coi NULL là distinct
      // và người dùng nhận thông báo TRÙNG.
      await direct.query(
        `DELETE FROM processed_events pe USING outbox_events oe
          WHERE pe.event_id = oe.id AND oe.event_type = 'chat.message.mentioned'
            AND oe.payload->>'roomId' = $1`,
        [roomId],
      );
      await direct.query(
        `UPDATE outbox_events SET status = 'pending', attempts = 0, available_at = now()
          WHERE event_type = 'chat.message.mentioned' AND payload->>'roomId' = $1`,
        [roomId],
      );
      await drain();

      const twice = (await notificationsOf(uThird, "CHAT_MENTIONED")).filter(
        (r) => r.payload.room_id === roomId,
      );
      expect(twice, "re-consume KHÔNG được sinh thông báo thứ hai").toHaveLength(1);
    });
  });

  // ══════════════ D. VỊ TỪ AUDIENCE gọi TRỰC TIẾP ══════════════

  describe("D. ChatAudienceReader — defense-in-depth", () => {
    it("ca 17 — phòng đã LƯU TRỮ / XOÁ MỀM ⇒ trả rỗng (đường HTTP không tới đây được)", async () => {
      const roomId = await createGroup(tSender, [uPeer]);

      // Chứng-dương trước: phòng bình thường thì CÓ người nhận.
      const open = await db.withTenant(A.companyId, (tx) =>
        reader.resolveMentionRecipients(tx, A.companyId, roomId, [uPeer]),
      );
      expect(open).toEqual([uPeer]);

      await direct.query(`UPDATE chat_rooms SET is_archived = true WHERE id = $1`, [roomId]);
      expect(
        await db.withTenant(A.companyId, (tx) =>
          reader.resolveMentionRecipients(tx, A.companyId, roomId, [uPeer]),
        ),
      ).toEqual([]);

      await direct.query(
        `UPDATE chat_rooms SET is_archived = false, deleted_at = now() WHERE id = $1`,
        [roomId],
      );
      expect(
        await db.withTenant(A.companyId, (tx) =>
          reader.resolveMentionRecipients(tx, A.companyId, roomId, [uPeer]),
        ),
      ).toEqual([]);
    });

    it("findDirectPeer trả null khi người kia đã rời phòng ⇒ KHÔNG enqueue", async () => {
      const roomId = await openDirect(tSender, uThird);
      await direct.query(
        `UPDATE chat_room_members SET left_at = now() WHERE room_id = $1 AND user_id = $2`,
        [roomId, uThird],
      );

      const peer = await db.withTenant(A.companyId, (tx) =>
        messagesRepo.findDirectPeer(tx, A.companyId, roomId, uSender),
      );
      expect(peer).toBeNull();

      const before = await outboxCount("chat.message.direct_sent", roomId);
      expect((await send(tSender, roomId, "gửi vào phòng trống")).status).toBe(200);
      await drain();
      // Tin vẫn gửi được (phòng chưa lưu trữ), nhưng không còn ai để báo ⇒ không đẻ event mồ côi.
      expect(await outboxCount("chat.message.direct_sent", roomId)).toBe(before);
    });

    it("ca 19 — census: vị từ 'còn nhận được' chỉ có ĐÚNG 1 bản ngoài chat-access.service.ts", async () => {
      const { readdirSync, readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory()
            ? walk(join(dir, e.name))
            : e.name.endsWith(".ts") && !e.name.endsWith(".spec.ts")
              ? [join(dir, e.name)]
              : [],
        );

      // Bản sao thứ hai của vị từ membership sẽ TRÔI khỏi bản gốc — đó là cách công thức đếm chưa đọc
      // đã lệch giữa BE-1 và BE-2 (vá ở GATE-2).
      //
      // ⚠️ GIỚI HẠN ĐÃ BIẾT của phép đếm này (lệch so với plan §4, ghi ra thay vì giấu): discriminator là
      // `leftAt` + `mutedUntil`, KHÔNG phải `leftAt` + `deletedAt` như plan viết. Đổi theo plan sẽ bắt oan
      // `chat-messages.repository.ts::unreadTotals` và `chat-rooms.repository.ts` (đo 03/08: cả hai khớp),
      // buộc phải dựng allowlist 3 file — mà mỗi ô allowlist chính là một chỗ bản sao THẬT có thể nấp.
      // Cái giá phải trả: một reader audience tương lai quên HẲN `mutedUntil` sẽ KHÔNG bị bắt ở đây. Đó là
      // đánh đổi có chủ ý — một lỗ hẹp đã biết còn hơn ba lỗ rộng do allowlist mục ruỗng theo thời gian.
      const hits = [...walk("src/chat"), ...walk("src/notifications")]
        .filter((f) => {
          const src = readFileSync(f, "utf8");
          return (
            /isNull\(\s*chatRoomMembers\.leftAt\s*\)/.test(src) &&
            /chatRoomMembers\.mutedUntil/.test(src)
          );
        })
        .map((f) => f.replace(/\\/g, "/"))
        .filter((f) => !f.endsWith("chat-access.service.ts"));

      expect(hits).toEqual(["src/notifications/chat-audience.reader.ts"]);
    });
  });
});
