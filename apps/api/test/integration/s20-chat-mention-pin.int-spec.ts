/**
 * S20-CHAT-MENTIONPIN-1 — `mentionUnreadCount` trên danh sách phòng + `chat:message-pinned` sau commit
 * (US-CHAT-NV-07 · US-CHAT-NV-08 · SPEC-15 CHAT-FUNC-014 / CHAT-FUNC-010).
 *
 * Bất biến đo:
 *   M-1  số @ chưa đọc = tin `room_seq > last_read_seq` có `mentions` chứa NGƯỜI GỌI, `recalled_at IS NULL`;
 *        mỗi người một con số (người khác được nhắc không làm đổi số của tôi, không lộ id của họ).
 *   M-2  con trỏ đọc tiến ⇒ số giảm đúng phần đã đọc; đọc tới đáy ⇒ 0.
 *   M-3  chỉ membership của CHÍNH người gọi: người ngoài phòng ⇒ không có số; tenant khác ⇒ không có số
 *        (vị từ `company_id` + RLS), kèm neo dương cùng hàm ở tenant đúng.
 *   M-4  EXPLAIN ANALYZE dưới APP ROLE + `set_config` tenant (như `withTenant`), KHÔNG tắt seqscan, trên
 *        phòng `BULK` tin: `chat_messages` đọc qua index hệ `room_seq` với `room_seq > …` ở **Index Cond**
 *        (không phải Filter), số hàng chạm tới ≤ dải chưa đọc — chi phí theo tin CHƯA ĐỌC, không theo lịch sử.
 *   M-5  vị từ §13.4: tin nhắc nằm TRƯỚC `visible_from_seq` không được đếm (mốc là biên ĐÓNG — neo dương).
 *   P-1  ghim/bỏ ghim THẬT ⇒ đúng một `chat:message-pinned` mỗi lần, ĐÚNG 4 khoá (không `body`); ghim lặp
 *        (idempotent) và lời bỏ ghim bị server từ chối ⇒ 0 sự kiện (neo dương = sự kiện bỏ ghim sau đó).
 *
 * Boot qua `applyMainPipeline` + `setupWebSocketAdapter` + `listen(0)` như PROD. GATE `hasDb && LANE_DB`.
 * File chạy TUẦN TỰ — thứ tự ca CÓ ý nghĩa.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import type { Namespace } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WS_EVENTS } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import {
  countUnreadMentionsByRoom,
  unreadMentionCountQuery,
} from "../../src/chat/chat-room-mention-count";
import { loadEnv } from "../../src/config/env.schema";
import { DatabaseService } from "../../src/db/db.service";
import { chatRoomName } from "../../src/realtime/rooms";
import { setupWebSocketAdapter } from "../../src/realtime/setup-websocket-adapter";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import {
  connectChatReady,
  countEvents,
  waitForEvent,
  type WsRecorder,
} from "../helpers/chat-call-fixture";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";
import { gatewayNamespace, seedActor } from "../helpers/social-group-rooms-fixture";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = ["Passw0rd!", "s20", "mp"].join("-");
const PAIRS = [
  "view:chat-room",
  "create:chat-room",
  "manage:chat-member",
  "send:chat-message",
  "pin:chat-message",
  "recall:chat-message",
] as const;

interface Who {
  userId: string;
  token: string;
}

/** M-4 — phòng lớn để kế hoạch là kế hoạch thật; chỉ `UNREAD` tin cuối là chưa đọc, mỗi 10 tin có 1 tin nhắc Me. */
const BULK = 4000;
const UNREAD = 25;
const NOISE_ROOMS = 9;
const ROOM_SEQ_INDEXES = new Set(["idx_chat_messages_room_seq", "uq_chat_messages_room_seq"]);

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Index Cond"?: string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Rows Removed by Filter"?: number;
  "Rows Removed by Index Recheck"?: number;
  Plans?: PlanNode[];
}

function flattenPlan(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flattenPlan)];
}

/** Nút index THẬT SỰ định vị dải: Index Scan tự nó; Bitmap Heap Scan → con Bitmap Index Scan. */
function locatingIndex(heap: PlanNode): PlanNode | undefined {
  if (heap["Node Type"] === "Bitmap Heap Scan") {
    return flattenPlan(heap).find((n) => n["Node Type"] === "Bitmap Index Scan");
  }
  return heap["Index Name"] ? heap : undefined;
}

/** Số hàng heap bị chạm tới (giữ + loại bởi Filter/Recheck), cộng qua mọi vòng lặp. */
function rowsTouched(heap: PlanNode): number {
  const perLoop =
    (heap["Actual Rows"] ?? 0) +
    (heap["Rows Removed by Filter"] ?? 0) +
    (heap["Rows Removed by Index Recheck"] ?? 0);
  return perLoop * (heap["Actual Loops"] ?? 1);
}

describe.skipIf(!hasLaneDb)(
  "S20-CHAT-MENTIONPIN-1 · @ chưa đọc theo membership + ghim phát sau commit (DB cô lập)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let ws: Namespace;
    let dbs: DatabaseService;
    let port = 0;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];
    const open: ClientSocket[] = [];

    let Adm: Who;
    let Me: Who;
    let C: Who;
    let Out: Who;
    let X: Who;
    let Y: Who;
    let R = "";
    let RB = "";
    let m1 = "";
    let seqM2 = 0;
    let seqC = 0;
    let lastSeq = 0;
    let meSock: WsRecorder;

    const http = () => request(app.getHttpServer());
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

    async function actor(tenant: SeededTenant, label: string, hash: string): Promise<Who> {
      const { userId, email } = await seedActor(direct, tenant, label, hash, PAIRS);
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return { userId, token: res.body.data.accessToken as string };
    }

    async function newRoom(owner: Who, name: string, members: readonly Who[]): Promise<string> {
      const res = await http()
        .post("/chat/rooms")
        .set(auth(owner.token))
        .send({ name, memberUserIds: members.map((m) => m.userId) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    }

    async function send(
      who: Who,
      roomId: string,
      body: string,
      mentions: readonly Who[] = [],
    ): Promise<{ id: string; roomSeq: number }> {
      const res = await http()
        .post(`/chat/rooms/${roomId}/messages`)
        .set(auth(who.token))
        .send({ body, clientMessageId: randomUUID(), mentions: mentions.map((m) => m.userId) });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return { id: res.body.data.id as string, roomSeq: res.body.data.roomSeq as number };
    }

    async function roomFor(who: Who, roomId: string): Promise<Record<string, unknown> | undefined> {
      const res = await http().get("/chat/rooms").set(auth(who.token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rooms = res.body.data as Record<string, unknown>[];
      return rooms.find((r) => r.id === roomId);
    }

    beforeAll(async () => {
      process.env.REALTIME_ENABLED = "true";
      direct = directPool();
      A = await seedCompany(direct, "s20mp");
      B = await seedCompany(direct, "s20mpx");
      companyIds.push(A.companyId, B.companyId);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = applyMainPipeline(moduleRef.createNestApplication());
      await setupWebSocketAdapter(app as never, loadEnv());
      await app.listen(0);
      port = (app.getHttpServer().address() as AddressInfo).port;
      ws = gatewayNamespace(app);
      dbs = app.get(DatabaseService);

      const hash = await app.get(PasswordService).hash(LOGIN_PW);
      Adm = await actor(A, "adm", hash);
      Me = await actor(A, "me", hash);
      C = await actor(A, "c", hash);
      Out = await actor(A, "out", hash);
      X = await actor(B, "x", hash);
      Y = await actor(B, "y", hash);

      R = await newRoom(Adm, "s20mp r", [Me, C]);
      RB = await newRoom(Y, "s20mp rb", [X]);

      m1 = (await send(Adm, R, "chung")).id;
      seqM2 = (await send(Adm, R, "nhắc me 1", [Me])).roomSeq;
      seqC = (await send(Adm, R, "nhắc c", [C])).roomSeq;
      lastSeq = (await send(Adm, R, "nhắc me 2", [Me])).roomSeq;
      const m5 = await send(Adm, R, "nhắc me rồi thu hồi", [Me]);
      lastSeq = m5.roomSeq;
      const recall = await http().post(`/chat/messages/${m5.id}/recall`).set(auth(Adm.token));
      expect(recall.status, JSON.stringify(recall.body)).toBe(200);
      await send(Y, RB, "nhắc x", [X]);

      meSock = await connectChatReady(port, ws, Me.token, chatRoomName(A.companyId, R), open);
      meSock.socket.on(WS_EVENTS.CHAT_MESSAGE_PINNED, (payload: Record<string, unknown>) =>
        meSock.events.push({ name: WS_EVENTS.CHAT_MESSAGE_PINNED, payload }),
      );
    }, 120_000);

    afterAll(async () => {
      while (open.length) open.pop()?.disconnect();
      if (app) await app.close();
      if (direct) {
        await cleanupTenants(direct, companyIds);
        await direct.end();
      }
    });

    it("M-1 mỗi người một con số: Me = 2 (tin thu hồi không tính) · C = 1 · người gửi = 0", async () => {
      const mine = await roomFor(Me, R);
      expect(mine?.mentionUnreadCount).toBe(2);
      expect((await roomFor(C, R))?.mentionUnreadCount).toBe(1);
      expect((await roomFor(Adm, R))?.mentionUnreadCount).toBe(0);
      // Payload phòng của Me KHÔNG mang id người khác được nhắc.
      expect(JSON.stringify(mine)).not.toContain(C.userId);
    });

    it("M-2 đọc tới tin nhắc thứ nhất ⇒ 1 · đọc tới đáy ⇒ 0", async () => {
      const partial = await http()
        .post(`/chat/rooms/${R}/read`)
        .set(auth(Me.token))
        .send({ seq: seqM2 });
      expect(partial.status, JSON.stringify(partial.body)).toBe(200);
      expect((await roomFor(Me, R))?.mentionUnreadCount).toBe(1);

      const all = await http()
        .post(`/chat/rooms/${R}/read`)
        .set(auth(Me.token))
        .send({ seq: lastSeq });
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect((await roomFor(Me, R))?.mentionUnreadCount).toBe(0);
    });

    it("M-3 người ngoài phòng ⇒ không có phòng, không có số (HTTP + hàm đếm)", async () => {
      expect(await roomFor(Out, R)).toBeUndefined();
      const counts = await dbs.withTenant(A.companyId, (tx) =>
        countUnreadMentionsByRoom(tx, A.companyId, Out.userId, [R]),
      );
      expect(counts.size).toBe(0);
    });

    it("M-3 chéo tenant ⇒ 0 hàng; neo dương: cùng hàm ở tenant ĐÚNG ra 1", async () => {
      const own = await dbs.withTenant(B.companyId, (tx) =>
        countUnreadMentionsByRoom(tx, B.companyId, X.userId, [RB]),
      );
      expect(own.get(RB)).toBe(1);
      expect((await roomFor(X, RB))?.mentionUnreadCount).toBe(1);
      expect(await roomFor(X, R)).toBeUndefined();

      // Ngữ cảnh tenant A hỏi phòng/người của tenant B — vị từ `company_id` và RLS cùng chặn.
      const crossCompanyArg = await dbs.withTenant(A.companyId, (tx) =>
        countUnreadMentionsByRoom(tx, B.companyId, X.userId, [RB]),
      );
      expect(crossCompanyArg.size).toBe(0);
      const crossRoom = await dbs.withTenant(A.companyId, (tx) =>
        countUnreadMentionsByRoom(tx, A.companyId, X.userId, [RB]),
      );
      expect(crossRoom.size).toBe(0);
    });

    it("M-5 §13.4 — tin nhắc TRƯỚC `visible_from_seq` không tính; mốc là biên ĐÓNG (neo dương)", async () => {
      // v1 không có writer nào của cột này (CHAT-DEC-008 · 0540 REVOKE) ⇒ đặt thẳng bằng kết nối direct để
      // đo vị từ — đây là trạng thái mà WO bật §13.4 sẽ tạo ra.
      const setVisible = (v: number | null) =>
        direct.query(
          `UPDATE chat_room_members SET visible_from_seq = $1 WHERE room_id = $2 AND user_id = $3`,
          [v, R, C.userId],
        );
      const countC = () =>
        dbs.withTenant(A.companyId, (tx) =>
          countUnreadMentionsByRoom(tx, A.companyId, C.userId, [R]),
        );
      try {
        await setVisible(seqC);
        expect((await countC()).get(R)).toBe(1);
        expect((await roomFor(C, R))?.mentionUnreadCount).toBe(1);

        await setVisible(seqC + 1);
        expect((await countC()).get(R)).toBeUndefined();
        expect((await roomFor(C, R))?.mentionUnreadCount).toBe(0);
      } finally {
        await setVisible(null);
      }
      expect((await countC()).get(R)).toBe(1);
    });

    it("M-4 EXPLAIN ANALYZE (app role + tenant, seqscan BẬT, phòng lớn) — dò dải `room_seq` trên index, chạm ≤ dải chưa đọc", async () => {
      // Phòng là một phần NHỎ của bảng (như PROD): khi phòng ≈ cả bảng, quét tuần tự rẻ hơn và planner
      // chọn nó — đúng, nhưng không đo được điều ta hỏi. `NOISE_ROOMS` phòng khác cùng tenant, mỗi phòng
      // `BULK` tin, room_seq lệch xa để không đụng tin hệ thống lúc tạo phòng.
      const noiseRooms: string[] = [];
      for (let i = 0; i < NOISE_ROOMS; i++)
        noiseRooms.push(await newRoom(Adm, `s20mp n${i}`, [Me]));
      await direct.query(
        `INSERT INTO chat_messages (company_id, room_id, sender_id, body, room_seq)
         SELECT $1, r, $2, 'noise ' || g, 100000 + g
           FROM unnest($3::uuid[]) AS r CROSS JOIN generate_series(1, $4::int) AS g`,
        [A.companyId, Adm.userId, noiseRooms, BULK],
      );
      await direct.query(`UPDATE chat_rooms SET last_message_seq = $1 WHERE id = ANY($2::uuid[])`, [
        100000 + BULK,
        noiseRooms,
      ]);

      const RX = await newRoom(Adm, "s20mp rx", [Me]);
      const baseRes = await direct.query(
        `SELECT COALESCE(last_message_seq, 0) AS base FROM chat_rooms WHERE id = $1`,
        [RX],
      );
      const base = Number(baseRes.rows[0]?.base ?? 0);
      await direct.query(
        `INSERT INTO chat_messages (company_id, room_id, sender_id, body, room_seq, mentions)
         SELECT $1, $2, $3, 'bulk ' || g, $4::bigint + g,
                CASE WHEN g % 10 = 0 THEN jsonb_build_array($5::text) ELSE '[]'::jsonb END
           FROM generate_series(1, $6::int) AS g`,
        [A.companyId, RX, Adm.userId, base, Me.userId, BULK],
      );
      await direct.query(`UPDATE chat_rooms SET last_message_seq = $1 WHERE id = $2`, [
        base + BULK,
        RX,
      ]);
      await direct.query(
        `UPDATE chat_room_members SET last_read_seq = $1 WHERE room_id = $2 AND user_id = $3`,
        [base + BULK - UNREAD, RX, Me.userId],
      );
      await direct.query("ANALYZE chat_messages, chat_room_members");

      let expected = 0;
      for (let i = BULK - UNREAD + 1; i <= BULK; i++) if (i % 10 === 0) expected++;
      const counts = await dbs.withTenant(A.companyId, (tx) =>
        countUnreadMentionsByRoom(tx, A.companyId, Me.userId, [RX]),
      );
      expect(counts.get(RX)).toBe(expected);

      const query = await dbs.withTenant(A.companyId, async (tx) =>
        unreadMentionCountQuery(tx, A.companyId, Me.userId, [RX]).toSQL(),
      );
      // Cùng vai trò + cùng ngữ cảnh tenant với `withTenant` ⇒ kế hoạch có đủ vế RLS của app role.
      const pool = appPool();
      const client = await pool.connect();
      let plan: PlanNode | undefined;
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
        const res = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`, query.params);
        plan = (res.rows[0] as { "QUERY PLAN": { Plan: PlanNode }[] })["QUERY PLAN"][0]?.Plan;
      } finally {
        await client.query("ROLLBACK");
        client.release();
        await pool.end();
      }
      const dump = JSON.stringify(plan);
      const heaps = plan
        ? flattenPlan(plan).filter((n) => n["Relation Name"] === "chat_messages")
        : [];
      expect(heaps.length, dump).toBe(1);
      const heap = heaps[0] as PlanNode;
      const index = locatingIndex(heap);
      expect(ROOM_SEQ_INDEXES.has(index?.["Index Name"] ?? ""), dump).toBe(true);
      // Vế dải nằm ở Index Cond (định vị), không phải Filter (lọc sau khi đã quét).
      expect(index?.["Index Cond"] ?? "", dump).toMatch(/room_seq\s*>/);
      const touched = rowsTouched(heap);
      expect(touched, dump).toBeGreaterThan(0);
      expect(touched, dump).toBeLessThanOrEqual(UNREAD);
    });
    it("P-1 ghim/bỏ ghim THẬT ⇒ đúng 2 sự kiện 4 khoá; ghim lặp + bỏ ghim bị từ chối ⇒ 0 sự kiện", async () => {
      const pin = await http().post(`/chat/messages/${m1}/pin`).set(auth(Adm.token));
      expect([200, 201], JSON.stringify(pin.body)).toContain(pin.status);
      await pollPinned(m1, (p) => p.pinnedAt !== null);

      const again = await http().post(`/chat/messages/${m1}/pin`).set(auth(Adm.token));
      expect([200, 201], JSON.stringify(again.body)).toContain(again.status);

      // C là thành viên THƯỜNG (có cặp `pin`, không phải admin phòng nhóm) ⇒ server từ chối.
      const denied = await http().delete(`/chat/messages/${m1}/pin`).set(auth(C.token));
      expect(denied.status, JSON.stringify(denied.body)).toBeGreaterThanOrEqual(400);
      const still = await direct.query(`SELECT pinned_at FROM chat_messages WHERE id = $1`, [m1]);
      expect(still.rows[0]?.pinned_at).not.toBeNull();

      const unpin = await http().delete(`/chat/messages/${m1}/pin`).set(auth(Adm.token));
      expect([200, 201], JSON.stringify(unpin.body)).toContain(unpin.status);
      // Neo dương: sự kiện bỏ ghim tới SAU ghim-lặp và lời từ chối ⇒ hai lần đó đã có cơ hội phát.
      await pollPinned(m1, (p) => p.pinnedAt === null);

      const events = meSock.events.filter((e) => e.name === WS_EVENTS.CHAT_MESSAGE_PINNED);
      expect(countEvents(meSock, WS_EVENTS.CHAT_MESSAGE_PINNED, "messageId", m1)).toBe(2);
      for (const e of events) {
        expect(Object.keys(e.payload).sort()).toEqual([
          "messageId",
          "pinnedAt",
          "pinnedBy",
          "roomId",
        ]);
        expect(e.payload.roomId).toBe(R);
      }
      expect(events[0]?.payload.pinnedBy).toBe(Adm.userId);
    });

    async function pollPinned(
      messageId: string,
      match: (payload: Record<string, unknown>) => boolean,
    ): Promise<void> {
      await waitForEvent(meSock, WS_EVENTS.CHAT_MESSAGE_PINNED, "messageId", messageId);
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const hit = meSock.events.some(
          (e) =>
            e.name === WS_EVENTS.CHAT_MESSAGE_PINNED &&
            e.payload.messageId === messageId &&
            match(e.payload),
        );
        if (hit) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`không nhận được chat:message-pinned khớp cho ${messageId}`);
    }
  },
);
