/**
 * S7-CHAT-BE-GATE-2 — vị từ "lịch sử trước khi tham gia" (SPEC-15 §13.4) trên **mọi** đường đọc.
 *
 * ⚠️ VÌ SAO SUITE NÀY PHẢI TỰ GIEO `visible_from_seq`: cột LUÔN NULL ở v1 (CHAT-DEC-008) và KHÔNG
 * writer nào trong sản phẩm được set nó — kể cả `S7-CHAT-BE-5`. Nghĩa là không có kịch bản người dùng
 * nào làm lộ thiếu sót, và cả BE-1 lẫn BE-2 đã đi qua FULL gate với 5/6 đường đọc KHÔNG có vị từ mà
 * không ai thấy. Ở đây ta gieo cột bằng tay (đường ghi HỢP LỆ — `0538:258` cấp UPDATE đúng cột này)
 * để kiểm chứng lời hứa "phase sau bật bằng một câu UPDATE, không phải audit lại từng đường đọc".
 *
 * ⚠️ CHỦ THỂ KHÔNG PHẢI SUPER ADMIN — lý do đầy đủ ở đầu `chat-be1-access.int-spec.ts`.
 * GATE CỨNG `hasDb && LANE_DB`.
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
const LOGIN_PW = "Passw0rd!chatgate2";

/** Cả 8 cặp CHAT thường @Company — KHÔNG có `('view','chat-oversight')`. */
const CHAT_FULL: ReadonlyArray<[action: string, resource: string]> = [
  ["view", "chat-room"],
  ["create", "chat-room"],
  ["update", "chat-room"],
  ["archive", "chat-room"],
  ["manage", "chat-member"],
  ["send", "chat-message"],
  ["recall", "chat-message"],
  ["pin", "chat-message"],
];

/** Mốc gieo: thành viên chỉ được thấy từ tin thứ 3 trở đi. */
const VISIBLE_FROM = 3;
const TOTAL_MESSAGES = 5;

describe.skipIf(!hasLaneDb)("S7-CHAT-BE-GATE-2 — visible_from_seq trên mọi đường đọc", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let uAdmin = "";
  let uMember = "";
  let tAdmin = "";
  let tMember = "";
  let room = "";

  /** id tin theo `roomSeq` (1-based): `msgId[1]` = tin có room_seq = 1. */
  const msgId: Record<number, string> = {};

  const authGet = (t: string, u: string) =>
    request(app.getHttpServer()).get(u).set("Authorization", `Bearer ${t}`);
  const authPost = (t: string, u: string) =>
    request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);
  const authDelete = (t: string, u: string) =>
    request(app.getHttpServer()).delete(u).set("Authorization", `Bearer ${t}`);

  async function grantPairs(companyId: string, userId: string, label: string): Promise<void> {
    const roleId = await seedRole(direct, companyId, `chatg2-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource] of CHAT_FULL) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  /** Đặt mốc hiển thị của một thành viên — đường ghi HỢP LỆ (`0538:258` cấp UPDATE cột này). */
  async function setVisibleFrom(userId: string, seq: number | null): Promise<void> {
    const res = await direct.query(
      `UPDATE chat_room_members SET visible_from_seq = $1
        WHERE company_id = $2 AND room_id = $3 AND user_id = $4`,
      [seq, A.companyId, room, userId],
    );
    expect(res.rowCount, "phải trúng ĐÚNG 1 hàng membership — trúng 0 là suite tự lừa mình").toBe(
      1,
    );
  }

  const roomSeqsOf = (body: { data: Array<{ roomSeq: number }> }): number[] =>
    body.data.map((m) => m.roomSeq).sort((a, b) => a - b);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "chatgate2");
    companyIds.push(A.companyId);

    uAdmin = await seedUser(direct, A.companyId, `owner@${A.slug}.test`, hash);
    uMember = await seedUser(direct, A.companyId, `mate@${A.slug}.test`, hash);
    await grantPairs(A.companyId, uAdmin, "owner");
    await grantPairs(A.companyId, uMember, "mate");

    tAdmin = await login(`owner@${A.slug}.test`);
    tMember = await login(`mate@${A.slug}.test`);

    const created = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng có lịch sử",
      memberUserIds: [uMember],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    room = created.body.data.id as string;

    // 5 tin của admin ⇒ room_seq 1..5. Thành viên KHÔNG gửi gì (last_read_seq giữ nguyên 0).
    for (let i = 1; i <= TOTAL_MESSAGES; i += 1) {
      const sent = await authPost(tAdmin, `/chat/rooms/${room}/messages`).send({
        body: `tin ${i}`,
        clientMessageId: randomUUID(),
      });
      expect(sent.status, JSON.stringify(sent.body)).toBe(200);
      expect(sent.body.data.roomSeq).toBe(i);
      msgId[i] = sent.body.data.id as string;
    }

    // Ghim MỘT tin ở mỗi bên mốc: #2 (bị che sau khi gieo) và #4 (vẫn thấy).
    for (const seq of [2, 4]) {
      const pinned = await authPost(tAdmin, `/chat/messages/${msgId[seq]}/pin`);
      expect(pinned.status, JSON.stringify(pinned.body)).toBe(200);
    }
  }, 120_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── Mốc 0: v1 (cột NULL) — số liệu PHẢI y hệt trước GATE-2 ──────────────────

  it("v1 (visible_from_seq NULL): thành viên đọc TOÀN BỘ lịch sử — §20 tiêu chí 3", async () => {
    const msgs = await authGet(tMember, `/chat/rooms/${room}/messages`);
    expect(msgs.status).toBe(200);
    expect(roomSeqsOf(msgs.body)).toEqual([1, 2, 3, 4, 5]);

    const pinned = await authGet(tMember, `/chat/rooms/${room}/pinned`);
    expect(roomSeqsOf(pinned.body)).toEqual([2, 4]);

    const unread = await authGet(tMember, "/chat/unread-count");
    expect(unread.body.data.total, "sàn -1 KHÔNG được đổi con số nào ở v1").toBe(TOTAL_MESSAGES);

    const rooms = await authGet(tMember, "/chat/rooms");
    const mine = (rooms.body.data as Array<{ id: string; unreadCount: number }>).find(
      (r) => r.id === room,
    );
    expect(mine?.unreadCount).toBe(TOTAL_MESSAGES);
  });

  // ── Mốc 1: bật mốc hiển thị bằng ĐÚNG một câu UPDATE ────────────────────────

  it("gieo visible_from_seq=3 → /messages cắt đúng lịch sử trước mốc", async () => {
    await setVisibleFrom(uMember, VISIBLE_FROM);
    const res = await authGet(tMember, `/chat/rooms/${room}/messages`);
    expect(res.status).toBe(200);
    expect(roomSeqsOf(res.body)).toEqual([3, 4, 5]);
  });

  it("/pinned KHÔNG còn là cửa hậu đọc tin trước mốc (cùng cột `body`, khác đường vào)", async () => {
    const res = await authGet(tMember, `/chat/rooms/${room}/pinned`);
    expect(res.status).toBe(200);
    expect(roomSeqsOf(res.body), "tin #2 ghim nhưng nằm trước mốc").toEqual([4]);

    // Người ghim (admin, mốc NULL) vẫn thấy đủ — vị từ bound theo NGƯỜI ĐỌC, không phải theo tin.
    const asAdmin = await authGet(tAdmin, `/chat/rooms/${room}/pinned`);
    expect(roomSeqsOf(asAdmin.body)).toEqual([2, 4]);
  });

  it("3 route theo `messageId` (thu hồi · ghim · bỏ ghim) → 404 GIỐNG HỆT ca tin không tồn tại", async () => {
    const ghostId = randomUUID();
    const normalize = (body: unknown, id: string): string =>
      JSON.stringify(body)
        .replace(id, "<id>")
        .replace(/"timestamp":"[^"]*"/, '"timestamp":"<ts>"')
        .replace(/"request_id":"[^"]*"/, '"request_id":"<rid>"');

    for (const [method, path] of [
      ["post", "recall"],
      ["post", "pin"],
      ["delete", "pin"],
    ] as const) {
      const call = (id: string) =>
        method === "post"
          ? authPost(tMember, `/chat/messages/${id}/${path}`)
          : authDelete(tMember, `/chat/messages/${id}/${path}`);
      // #2: TỒN TẠI, đã ghim, nằm TRƯỚC mốc ⇒ phải không phân biệt được với tin không có thật.
      const hidden = await call(msgId[2]);
      const ghost = await call(ghostId);
      expect(hidden.status, `${method} ${path} hidden`).toBe(404);
      expect(ghost.status, `${method} ${path} ghost`).toBe(404);
      expect(normalize(ghost.body, ghostId), `${method} ${path}`).toBe(
        normalize(hidden.body, msgId[2]),
      );
    }
  });

  it("trả lời tin trước mốc → CHAT-ERR-009 (trích dẫn là đường đọc gián tiếp)", async () => {
    const blocked = await authPost(tMember, `/chat/rooms/${room}/messages`).send({
      body: "trích tin tôi không được xem",
      clientMessageId: randomUUID(),
      replyToMessageId: msgId[1],
    });
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body)).toContain("CHAT-ERR-009");

    // Đối chứng: tin SAU mốc vẫn trả lời được — vị từ không chặn quá tay.
    const ok = await authPost(tMember, `/chat/rooms/${room}/messages`).send({
      body: "trích tin tôi được xem",
      clientMessageId: randomUUID(),
      replyToMessageId: msgId[4],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("đếm chưa đọc KHÔNG trải trên lịch sử bị che (cả badge tổng lẫn badge từng phòng)", async () => {
    // Tin trả lời ở ca trước là của CHÍNH thành viên ⇒ con trỏ đọc tự tiến tới room_seq = 6,
    // và last_message_seq = 6 ⇒ chưa đọc = 0. Gieo lại mốc đọc để đo đúng phần lịch sử bị che.
    const reset = await direct.query(
      `UPDATE chat_room_members SET last_read_seq = 0
        WHERE company_id = $1 AND room_id = $2 AND user_id = $3`,
      [A.companyId, room, uMember],
    );
    expect(reset.rowCount).toBe(1);

    const lastSeq = (
      await direct.query(`SELECT last_message_seq FROM chat_rooms WHERE id = $1`, [room])
    ).rows[0].last_message_seq as string | number;
    const total = Number(lastSeq);

    // unread = last_message_seq − GREATEST(last_read_seq, visible_from_seq − 1) = total − 2.
    const expected = total - (VISIBLE_FROM - 1);

    const unread = await authGet(tMember, "/chat/unread-count");
    expect(unread.status).toBe(200);
    expect(
      unread.body.data.total,
      "badge đếm cả phần không mở ra được = badge KHÔNG BAO GIỜ tắt",
    ).toBe(expected);

    const rooms = await authGet(tMember, "/chat/rooms");
    const mine = (rooms.body.data as Array<{ id: string; unreadCount: number }>).find(
      (r) => r.id === room,
    );
    expect(mine?.unreadCount, "badge từng phòng và badge header phải cùng một công thức").toBe(
      expected,
    );
  });

  it("gỡ mốc (về NULL) → mọi đường đọc trở lại đọc toàn bộ lịch sử", async () => {
    await setVisibleFrom(uMember, null);
    const msgs = await authGet(tMember, `/chat/rooms/${room}/messages?limit=100`);
    expect(roomSeqsOf(msgs.body)).toContain(1);
    const pinned = await authGet(tMember, `/chat/rooms/${room}/pinned`);
    expect(roomSeqsOf(pinned.body)).toEqual([2, 4]);
  });
});
