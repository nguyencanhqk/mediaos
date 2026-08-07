/**
 * S7-CHAT-BE-2 — tin nhắn: con trỏ · gửi idempotent · trả lời · thu hồi · ghim · đã-đọc · tổng chưa đọc
 * (SPEC-15 §13.1/§13.2/§13.4/§13.6 · API-13 §5.1, §6 nguyên tắc 4·5·7·8).
 *
 * ⚠️ CHỦ THỂ KHÔNG PHẢI SUPER ADMIN — lý do đầy đủ ở đầu `chat-be1-access.int-spec.ts`.
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
import { ChatMessagesRepository } from "../../src/chat/chat-messages.repository";
import { CHAT_PIN_MAX_PER_ROOM } from "../../src/chat/chat-message-rules";
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
const LOGIN_PW = "Passw0rd!chatbe2";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

/** Cả 8 cặp CHAT thường @Company — KHÔNG có `('view','chat-oversight')`. */
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

describe.skipIf(!hasLaneDb)("S7-CHAT-BE-2 — tin nhắn (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let uAdmin = "";
  let uMember = "";
  let uOutsider = "";
  let uB = "";
  let tAdmin = "";
  let tMember = "";
  let tOutsider = "";
  let tB = "";

  /** Phòng nhóm chính: uAdmin(admin) + uMember(member). Dựng lại cho từng nhóm ca cần cô lập. */
  let room = "";

  async function grantPairs(companyId: string, userId: string, label: string): Promise<void> {
    const roleId = await seedRole(direct, companyId, `chatm-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of CHAT_FULL) {
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

  const authGet = (t: string, u: string) =>
    request(app.getHttpServer()).get(u).set("Authorization", `Bearer ${t}`);
  const authPost = (t: string, u: string) =>
    request(app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);
  const authDelete = (t: string, u: string) =>
    request(app.getHttpServer()).delete(u).set("Authorization", `Bearer ${t}`);

  /** Tạo phòng nhóm qua API THẬT (không gieo tay) — giữ đường đi giống production. */
  async function newRoom(name: string, members: string[] = [uMember]): Promise<string> {
    const res = await authPost(tAdmin, "/chat/rooms").send({ name, memberUserIds: members });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  async function send(token: string, roomId: string, body: string, extra: object = {}) {
    return authPost(token, `/chat/rooms/${roomId}/messages`).send({
      body,
      clientMessageId: randomUUID(),
      ...extra,
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "chatbe2a");
    B = await seedCompany(direct, "chatbe2b");
    companyIds.push(A.companyId, B.companyId);

    const mk = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uAdmin = await mk("owner");
    uMember = await mk("mate");
    uOutsider = await mk("outsider");
    uB = await seedUser(direct, B.companyId, `bob@${B.slug}.test`, hash);
    for (const [u, l] of [
      [uAdmin, "owner"],
      [uMember, "mate"],
      [uOutsider, "outsider"],
    ] as const) {
      await grantPairs(A.companyId, u, l);
    }
    await grantPairs(B.companyId, uB, "b");

    tAdmin = await login(A.slug, `owner@${A.slug}.test`);
    tMember = await login(A.slug, `mate@${A.slug}.test`);
    tOutsider = await login(A.slug, `outsider@${A.slug}.test`);
    tB = await login(B.slug, `bob@${B.slug}.test`);

    room = await newRoom("Phòng chính");
  }, 120_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── Ca 1: 404 của trục TIN NHẮN không phân biệt được ───────────────────────

  it("ca 1: messageId KHÔNG tồn tại vs messageId CÓ THẬT ở phòng mình không thuộc → 404 GIỐNG HỆT (cả 3 route)", async () => {
    const sent = await send(tAdmin, room, "tin bí mật");
    expect(sent.status).toBe(200);
    const realId = sent.body.data.id as string;
    const ghostId = randomUUID();

    const normalize = (body: unknown, id: string): string =>
      JSON.stringify(body)
        .replace(id, "<id>")
        .replace(/"timestamp":"[^"]*"/, '"timestamp":"<ts>"')
        .replace(/"request_id":"[^"]*"/, '"request_id":"<rid>"');

    // `tOutsider` KHÔNG thuộc phòng nhưng giữ ĐỦ 8 cặp @Company — nếu cặp quyền thay được membership
    // thì ca này xanh sai. Nó phải 404 y hệt ca "tin không tồn tại".
    for (const [method, path] of [
      ["post", "recall"],
      ["post", "pin"],
      ["delete", "pin"],
    ] as const) {
      const call = (id: string) =>
        method === "post"
          ? authPost(tOutsider, `/chat/messages/${id}/${path}`)
          : authDelete(tOutsider, `/chat/messages/${id}/${path}`);
      const real = await call(realId);
      const ghost = await call(ghostId);
      expect(real.status, `${method} ${path} real`).toBe(404);
      expect(ghost.status, `${method} ${path} ghost`).toBe(404);
      expect(normalize(ghost.body, ghostId), `${method} ${path}`).toBe(
        normalize(real.body, realId),
      );
    }
  });

  it("ca 2: đọc tin ở phòng mình không thuộc / tenant khác → 404", async () => {
    expect((await authGet(tOutsider, `/chat/rooms/${room}/messages`)).status).toBe(404);
    expect((await authGet(tB, `/chat/rooms/${room}/messages`)).status).toBe(404);
    expect((await authGet(tOutsider, `/chat/rooms/${room}/pinned`)).status).toBe(404);
    expect((await authPost(tOutsider, `/chat/rooms/${room}/read`).send({ seq: 1 })).status).toBe(
      404,
    );
    expect((await send(tOutsider, room, "chen ngang")).status).toBe(404);
  });

  // ── Ca 3 + 4 + 22: con trỏ ─────────────────────────────────────────────────

  it("ca 3+4: beforeSeq VÀ afterSeq cùng lúc → CHAT-ERR-016; limit=101 → 400", async () => {
    const both = await authGet(tAdmin, `/chat/rooms/${room}/messages?beforeSeq=5&afterSeq=1`);
    expect(both.status).toBe(422);
    expect(JSON.stringify(both.body)).toContain("CHAT-ERR-016");

    const over = await authGet(tAdmin, `/chat/rooms/${room}/messages?limit=101`);
    expect(over.status, "trần 100 phải ép ở Zod, không ở service").toBe(400);
  });

  it("ca 22: DTO tin nhắn KHÔNG lộ `seq` toàn cục, chỉ có `roomSeq`", async () => {
    const res = await authGet(tAdmin, `/chat/rooms/${room}/messages`);
    expect(res.status).toBe(200);
    const list = res.body.data as Record<string, unknown>[];
    expect(list.length).toBeGreaterThan(0);
    for (const m of list) {
      expect(Object.keys(m), "identity cấp BẢNG không được rời server").not.toContain("seq");
      expect(typeof m.roomSeq).toBe("number");
    }
  });

  it("con trỏ beforeSeq/afterSeq trả đúng lát cắt, LUÔN tăng dần, không dùng offset", async () => {
    const r = await newRoom("Phòng phân trang");
    for (let i = 1; i <= 7; i += 1) await send(tAdmin, r, `tin ${i}`);

    const all = await authGet(tAdmin, `/chat/rooms/${r}/messages`);
    const seqs = (all.body.data as { roomSeq: number }[]).map((m) => m.roomSeq);
    expect(seqs, "room_seq LIÊN TỤC TỪ 1 trong phòng").toEqual([1, 2, 3, 4, 5, 6, 7]);

    const before = await authGet(tAdmin, `/chat/rooms/${r}/messages?beforeSeq=5&limit=2`);
    expect((before.body.data as { roomSeq: number }[]).map((m) => m.roomSeq)).toEqual([3, 4]);

    const after = await authGet(tAdmin, `/chat/rooms/${r}/messages?afterSeq=5&limit=2`);
    expect((after.body.data as { roomSeq: number }[]).map((m) => m.roomSeq)).toEqual([6, 7]);
  });

  // ── Ca 5 + 6: idempotent + cấp số ──────────────────────────────────────────

  it("ca 5: gửi lại cùng clientMessageId → CÙNG messageId, 200, ĐÚNG 1 hàng, last_message_seq KHÔNG tăng", async () => {
    const r = await newRoom("Phòng idempotent");
    const cid = randomUUID();
    const body = { body: "gửi một lần thôi", clientMessageId: cid };

    const first = await authPost(tAdmin, `/chat/rooms/${r}/messages`).send(body);
    const second = await authPost(tAdmin, `/chat/rooms/${r}/messages`).send(body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.roomSeq).toBe(first.body.data.roomSeq);

    const rows = await direct.query(
      "SELECT count(*)::int AS n FROM chat_messages WHERE room_id = $1 AND client_message_id = $2",
      [r, cid],
    );
    expect(rows.rows[0].n).toBe(1);

    const seq = await direct.query("SELECT last_message_seq FROM chat_rooms WHERE id = $1", [r]);
    expect(
      Number(seq.rows[0].last_message_seq),
      "gửi lại KHÔNG được đốt số — room_seq phải liên tục (0539 verify)",
    ).toBe(1);
  });

  it("ca 6: nhiều người gửi vào cùng phòng → room_seq LIÊN TỤC, không trùng, không lỗ", async () => {
    const r = await newRoom("Phòng đua");
    await Promise.all([
      send(tAdmin, r, "A1"),
      send(tMember, r, "B1"),
      send(tAdmin, r, "A2"),
      send(tMember, r, "B2"),
      send(tAdmin, r, "A3"),
    ]);

    const rows = await direct.query(
      "SELECT room_seq FROM chat_messages WHERE room_id = $1 ORDER BY room_seq",
      [r],
    );
    const got = rows.rows.map((x) => Number(x.room_seq));
    expect(got, "khoá hàng phòng phải tuần tự hoá — 1..5 không lỗ không trùng").toEqual([
      1, 2, 3, 4, 5,
    ]);

    const room2 = await direct.query("SELECT last_message_seq FROM chat_rooms WHERE id = $1", [r]);
    expect(Number(room2.rows[0].last_message_seq)).toBe(5);
  });

  it("room_seq đếm ĐỘC LẬP theo từng phòng (không phải seq toàn cục)", async () => {
    const r1 = await newRoom("Phòng độc lập 1");
    const r2 = await newRoom("Phòng độc lập 2");
    await send(tAdmin, r1, "x");
    for (let i = 0; i < 4; i += 1) await send(tAdmin, r2, `y${i}`);
    const again = await send(tAdmin, r1, "z");
    expect(again.body.data.roomSeq, "4 tin ở phòng khác KHÔNG được đẩy con trỏ của phòng này").toBe(
      2,
    );
  });

  // ── Ca 7: phòng lưu trữ ────────────────────────────────────────────────────

  it("ca 7: gửi vào phòng ĐÃ LƯU TRỮ → 409 CHAT-ERR-005 (vẫn đọc được)", async () => {
    const r = await newRoom("Phòng đóng");
    await send(tAdmin, r, "tin trước khi đóng");
    expect((await authPost(tAdmin, `/chat/rooms/${r}/archive`)).status).toBe(200);

    const res = await send(tAdmin, r, "tin sau khi đóng");
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-005");
    expect((await authGet(tAdmin, `/chat/rooms/${r}/messages`)).status).toBe(200);
  });

  // ── Ca 8..11: thu hồi ──────────────────────────────────────────────────────

  it("ca 8: thành viên thường thu hồi tin NGƯỜI KHÁC → 403 CHAT-ERR-006", async () => {
    const sent = await send(tAdmin, room, "tin của admin");
    const res = await authPost(tMember, `/chat/messages/${sent.body.data.id}/recall`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-006");
  });

  it("ca 9: người gửi THƯỜNG thu hồi tin của mình QUÁ 15 PHÚT → 403 (gieo created_at lùi 16 phút)", async () => {
    // ⚠️ CHỦ THỂ PHẢI LÀ THÀNH VIÊN THƯỜNG. Dùng người tạo phòng thì họ là admin phòng nhóm ⇒ §13.6 cho
    // thu hồi BẤT KỲ LÚC NÀO ⇒ ca này xanh-giả (đã vấp đúng lỗi đó khi viết test lần đầu). Cửa sổ 15 phút
    // chỉ ràng buộc người gửi KHÔNG phải admin.
    const r = await newRoom("Phòng quá hạn");
    const sent = await send(tMember, r, "tin cũ");
    const id = sent.body.data.id as string;
    await direct.query(
      "UPDATE chat_messages SET created_at = now() - interval '16 minutes' WHERE id = $1",
      [id],
    );

    const res = await authPost(tMember, `/chat/messages/${id}/recall`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-006");

    // Đối chứng: 14 phút thì vẫn thu hồi được — chứng minh ca trên đỏ vì CỬA SỔ, không phải vì lý do khác.
    await direct.query(
      "UPDATE chat_messages SET created_at = now() - interval '14 minutes' WHERE id = $1",
      [id],
    );
    expect((await authPost(tMember, `/chat/messages/${id}/recall`)).status).toBe(200);
  });

  it("admin phòng NHÓM thu hồi được bất kỳ lúc nào; admin phòng DẪN XUẤT thì KHÔNG", async () => {
    // Vế 1 — phòng nhóm: quá hạn vẫn thu hồi được (§13.6 "bất kỳ lúc nào").
    const r = await newRoom("Phòng admin thu hồi");
    const old = await send(tMember, r, "tin rất cũ");
    await direct.query(
      "UPDATE chat_messages SET created_at = now() - interval '3 hours' WHERE id = $1",
      [old.body.data.id],
    );
    expect((await authPost(tAdmin, `/chat/messages/${old.body.data.id}/recall`)).status).toBe(200);

    // Vế 2 — phòng DẪN XUẤT: vai trò `admin` ở đó là cache đồng bộ từ HR/TASK, không phải uỷ quyền
    // kiểm duyệt do người chọn ⇒ KHÔNG được mượn nó để thu hồi tin người khác.
    const ou = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,'Kỹ thuật','department') RETURNING id",
      [A.companyId],
    );
    const deptRoom = await direct.query(
      `INSERT INTO chat_rooms (company_id, room_type, name, room_code, sync_source, org_unit_id)
       VALUES ($1,'department','Phòng Kỹ thuật','ROOM-8001','department',$2) RETURNING id`,
      [A.companyId, ou.rows[0].id],
    );
    const dr = deptRoom.rows[0].id as string;
    // Gieo phòng thẳng bằng SQL kèm `room_code` thì PHẢI nâng counter theo — nếu không,
    // `s7-chat-db1-invariants` ("current_value không thấp hơn số mã đã cấp") ĐỎ khi hai spec chạy chồng
    // lấn trong cùng lane DB. Bất biến đó ĐÚNG: current_value thấp hơn ⇒ nextCode đụng mã cũ ⇒ 23505 ở
    // phòng kế tiếp. Lối đúng là mở lối gieo CÓ KIỂM SOÁT, không phải nới bất biến.
    await direct.query(
      `UPDATE sequence_counters sc
          SET current_value = GREATEST(
                sc.current_value,
                (SELECT count(*) FROM chat_rooms cr
                  WHERE cr.company_id = $1 AND cr.room_code IS NOT NULL))
        WHERE sc.company_id = $1 AND sc.sequence_key = 'chat_room'`,
      [A.companyId],
    );
    await direct.query(
      `INSERT INTO chat_room_members (company_id, room_id, user_id, role) VALUES ($1,$2,$3,'admin'),($1,$2,$4,'member')`,
      [A.companyId, dr, uAdmin, uMember],
    );

    const inDept = await send(tMember, dr, "tin trong phòng ban");
    expect(inDept.status).toBe(200);
    await direct.query(
      "UPDATE chat_messages SET created_at = now() - interval '3 hours' WHERE id = $1",
      [inDept.body.data.id],
    );
    const denied = await authPost(tAdmin, `/chat/messages/${inDept.body.data.id}/recall`);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain("CHAT-ERR-006");
  });

  it("ca 10+11: admin phòng nhóm thu hồi tin người khác — body:null ra ngoài, body GỐC còn trong DB; lần hai idempotent", async () => {
    const r = await newRoom("Phòng thu hồi");
    const sent = await send(tMember, r, "nội dung cần thu hồi");
    const id = sent.body.data.id as string;

    const res = await authPost(tAdmin, `/chat/messages/${id}/recall`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.body, "che ở SERVER, không ở client").toBeNull();
    expect(res.body.data.recalledAt).not.toBeNull();

    const db = await direct.query("SELECT body, recalled_by FROM chat_messages WHERE id = $1", [
      id,
    ]);
    expect(db.rows[0].body, "append-only: bản gốc PHẢI còn cho tranh chấp nội bộ").toBe(
      "nội dung cần thu hồi",
    );
    expect(db.rows[0].recalled_by).toBe(uAdmin);

    // Đường ĐỌC cũng phải che, không chỉ phản hồi của chính lệnh thu hồi.
    const list = await authGet(tAdmin, `/chat/rooms/${r}/messages`);
    const found = (list.body.data as { id: string; body: string | null }[]).find(
      (m) => m.id === id,
    );
    expect(found?.body).toBeNull();

    const twice = await authPost(tAdmin, `/chat/messages/${id}/recall`);
    expect(twice.status, "bấm hai lần không đáng nhận màn hình đỏ").toBe(200);

    const audits = await direct.query(
      "SELECT action FROM audit_logs WHERE object_type = 'chat_message' AND object_id = $1",
      [id],
    );
    expect(audits.rows.map((x) => x.action)).toEqual(["chat.message.recalled"]);

    // Audit KHÔNG được chứa nội dung tin (SPEC-15 §18).
    const raw = await direct.query(
      "SELECT coalesce(new_values::text,'') || coalesce(old_values::text,'') AS blob FROM audit_logs WHERE object_id = $1",
      [id],
    );
    expect(raw.rows[0].blob).not.toContain("nội dung cần thu hồi");
  });

  // ── Ca 12..14: ghim ────────────────────────────────────────────────────────

  it(`ca 12: ghim tin thứ ${CHAT_PIN_MAX_PER_ROOM + 1} → 409 CHAT-ERR-008`, async () => {
    const r = await newRoom("Phòng ghim", []);
    const ids: string[] = [];
    for (let i = 0; i < CHAT_PIN_MAX_PER_ROOM + 1; i += 1) {
      const s = await send(tAdmin, r, `tin ${i}`);
      ids.push(s.body.data.id as string);
    }
    for (let i = 0; i < CHAT_PIN_MAX_PER_ROOM; i += 1) {
      const res = await authPost(tAdmin, `/chat/messages/${ids[i]}/pin`);
      expect(res.status, `ghim thứ ${i + 1}`).toBe(200);
    }
    const over = await authPost(tAdmin, `/chat/messages/${ids[CHAT_PIN_MAX_PER_ROOM]}/pin`);
    expect(over.status).toBe(409);
    expect(JSON.stringify(over.body)).toContain("CHAT-ERR-008");

    // Bỏ ghim một cái → lại ghim được (trần là trạng thái, không phải cửa một chiều).
    expect((await authDelete(tAdmin, `/chat/messages/${ids[0]}/pin`)).status).toBe(200);
    expect(
      (await authPost(tAdmin, `/chat/messages/${ids[CHAT_PIN_MAX_PER_ROOM]}/pin`)).status,
    ).toBe(200);

    const pinned = await authGet(tAdmin, `/chat/rooms/${r}/pinned`);
    expect((pinned.body.data as unknown[]).length).toBe(CHAT_PIN_MAX_PER_ROOM);
  });

  it("ca 13: thành viên thường ghim → 403 (cần admin phòng, dù có cặp pin:chat-message @Company)", async () => {
    const sent = await send(tMember, room, "tin của member");
    const res = await authPost(tMember, `/chat/messages/${sent.body.data.id}/pin`);
    expect(res.status).toBe(403);
  });

  it("ca 14: ghim tin ĐÃ THU HỒI → 422; tin đã thu hồi rơi khỏi danh sách ghim", async () => {
    const r = await newRoom("Phòng ghim-thu hồi", []);
    const sent = await send(tAdmin, r, "sẽ ghim rồi thu hồi");
    const id = sent.body.data.id as string;
    expect((await authPost(tAdmin, `/chat/messages/${id}/pin`)).status).toBe(200);
    expect((await authPost(tAdmin, `/chat/messages/${id}/recall`)).status).toBe(200);

    const pinned = await authGet(tAdmin, `/chat/rooms/${r}/pinned`);
    expect((pinned.body.data as unknown[]).length, "ghim một ô trống là vô nghĩa").toBe(0);

    const again = await authPost(tAdmin, `/chat/messages/${id}/pin`);
    expect(again.status).toBe(422);
  });

  // ── Ca 15 + 16: trả lời + mention ──────────────────────────────────────────

  it("ca 15: trả lời tin KHÁC PHÒNG hoặc tin ĐÃ THU HỒI → 422 CHAT-ERR-009", async () => {
    const r1 = await newRoom("Phòng trả lời 1", []);
    const r2 = await newRoom("Phòng trả lời 2", []);
    const inR2 = await send(tAdmin, r2, "tin phòng khác");

    const cross = await send(tAdmin, r1, "trả lời chéo phòng", {
      replyToMessageId: inR2.body.data.id,
    });
    expect(cross.status).toBe(422);
    expect(JSON.stringify(cross.body)).toContain("CHAT-ERR-009");

    const target = await send(tAdmin, r1, "sẽ bị thu hồi");
    await authPost(tAdmin, `/chat/messages/${target.body.data.id}/recall`);
    const toRecalled = await send(tAdmin, r1, "trả lời tin đã thu hồi", {
      replyToMessageId: target.body.data.id,
    });
    expect(toRecalled.status).toBe(422);

    const ok = await send(tAdmin, r1, "trả lời hợp lệ", {
      replyToMessageId: (await send(tAdmin, r1, "gốc")).body.data.id,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.replyToMessageId).not.toBeNull();
  });

  it("ca 16: mention người NGOÀI phòng → gửi THÀNH CÔNG, người đó bị loại khỏi mentions", async () => {
    const res = await send(tAdmin, room, "chào cả nhà", {
      mentions: [uMember, uOutsider],
    });
    expect(res.status, "CHAT-ERR-010: loại khỏi danh sách, KHÔNG chặn gửi").toBe(200);
    expect(res.body.data.mentions).toEqual([uMember]);
  });

  // ── Ca 17..19: con trỏ đã đọc ──────────────────────────────────────────────

  it("ca 17+18: /read chỉ TIẾN (2 thiết bị) và bị KẸP TRẦN ở last_message_seq", async () => {
    const r = await newRoom("Phòng đã đọc");
    for (let i = 0; i < 3; i += 1) await send(tAdmin, r, `tin ${i}`);

    const fast = await authPost(tMember, `/chat/rooms/${r}/read`).send({ seq: 3 });
    expect(fast.status).toBe(200);
    expect(fast.body.data.lastReadSeq).toBe(3);

    // Thiết bị chậm báo số nhỏ hơn → 200, IM LẶNG bỏ qua (CHAT-ERR-018), KHÔNG lỗi và KHÔNG lùi.
    const slow = await authPost(tMember, `/chat/rooms/${r}/read`).send({ seq: 1 });
    expect(slow.status).toBe(200);
    expect(slow.body.data.lastReadSeq).toBe(3);

    // Vượt thực tế → kẹp về last_message_seq, nếu không thì tin gửi SAU bị tính là đã đọc.
    const over = await authPost(tMember, `/chat/rooms/${r}/read`).send({ seq: 999 });
    expect(over.body.data.lastReadSeq).toBe(3);

    const db = await direct.query(
      "SELECT last_read_seq FROM chat_room_members WHERE room_id = $1 AND user_id = $2",
      [r, uMember],
    );
    expect(Number(db.rows[0].last_read_seq)).toBe(3);

    await send(tAdmin, r, "tin thứ 4");
    const detail = await authGet(tMember, `/chat/rooms/${r}`);
    expect(detail.body.data.unreadCount, "tin mới sau khi đã đọc phải hiện chưa đọc").toBe(1);
  });

  /**
   * FULL gate S7-CHAT-BE-GATE-3 (L3 H-1) — `seq` lớn phải KẸP TRẦN, không được 500.
   *
   * `advanceLastReadSeq` từng ép `LEAST(${wanted}::int, ${ceiling}::int)`, trong khi `last_read_seq` /
   * `room_seq` / `last_message_seq` đều là **bigint**. Mọi `seq >= 2^31` ném `22003 integer out of range`
   * ⇒ HTTP 500, tức đúng cái trần mà jsdoc hứa bị vô hiệu. Idiom FE "mark-all-read gửi sentinel lớn" rơi
   * thẳng vào đây, mà ca 17+18 chỉ thử `seq: 999` nên lưới hoàn toàn mù. typecheck + unit test cũng mù —
   * chỉ int-spec chạm DB thật mới bắt được (cùng lớp `drizzle-array-bind-sql-param`).
   */
  it("ca 18b: /read với seq ≥ 2^31 và sentinel MAX_SAFE_INTEGER ⇒ 200 kẹp trần, KHÔNG 500", async () => {
    const r = await newRoom("Phòng sentinel");
    for (let i = 0; i < 3; i += 1) await send(tAdmin, r, `tin ${i}`);

    // Ngay trên biên int4 — giá trị nhỏ hơn 1 đơn vị (2^31 - 1) vẫn chạy được trên code CŨ, nên biên
    // này mới là chỗ phân định; thử 2^31 - 1 thì ca sẽ xanh trên cả code hỏng.
    const atBoundary = await authPost(tMember, `/chat/rooms/${r}/read`).send({ seq: 2 ** 31 });
    expect(atBoundary.status, "2^31 phải kẹp trần, không được 500").toBe(200);
    expect(atBoundary.body.data.lastReadSeq).toBe(3);

    // Sentinel thật sự mà FE hay dùng cho "đánh dấu đọc hết".
    const sentinel = await authPost(tMember, `/chat/rooms/${r}/read`).send({
      seq: Number.MAX_SAFE_INTEGER,
    });
    expect(sentinel.status).toBe(200);
    expect(sentinel.body.data.lastReadSeq).toBe(3);

    // Vượt trần an toàn của JS number ⇒ chặn ở BIÊN (400), không để rơi xuống bind bigint rồi 22003.
    const absurd = await authPost(tMember, `/chat/rooms/${r}/read`).send({ seq: 1e300 });
    expect(absurd.status, "giá trị ngoài MAX_SAFE_INTEGER phải bị chặn ở validation").toBe(400);

    const db = await direct.query(
      "SELECT last_read_seq FROM chat_room_members WHERE room_id = $1 AND user_id = $2",
      [r, uMember],
    );
    expect(Number(db.rows[0].last_read_seq), "con trỏ không được vượt số tin thật").toBe(3);
  });

  it("ca 19: tin của CHÍNH MÌNH tự nâng con trỏ đọc trong cùng tx — unread của người gửi = 0", async () => {
    const r = await newRoom("Phòng tự nâng");
    await send(tAdmin, r, "tin của tôi");
    const detail = await authGet(tAdmin, `/chat/rooms/${r}`);
    expect(detail.body.data.unreadCount).toBe(0);

    const other = await authGet(tMember, `/chat/rooms/${r}`);
    expect(other.body.data.unreadCount, "người khác vẫn thấy chưa đọc").toBe(1);
  });

  // ── Ca 23..26: vá FULL gate BE-1/BE-2 ──────────────────────────────────────

  it("ca 23: hai giao dịch /read ĐỒNG THỜI → con trỏ KHÔNG lùi (clamp phải nằm trong SQL)", async () => {
    // ⚠️ CA NÀY KHÔNG THỂ VIẾT TUẦN TỰ. Bản cũ tính `Math.max` ở JS rồi GÁN ĐÈ: gọi /read 5 rồi /read 2
    // vẫn ra 5 (vì nó đọc lại con trỏ trước khi ghi) ⇒ test tuần tự XANH trên cả code hỏng. Chỉ khi hai
    // giao dịch CHỒNG NHAU — bên đến sau đã đọc trạng thái CŨ — thì phép gán đè mới lộ ra là đường lùi.
    const r = await newRoom("Phòng đua con trỏ");
    for (let i = 0; i < 5; i += 1) await send(tAdmin, r, `tin ${i}`);
    const mrow = await direct.query(
      "SELECT id FROM chat_room_members WHERE room_id = $1 AND user_id = $2",
      [r, uMember],
    );
    const memberRowId = mrow.rows[0].id as string;
    const db = app.get(DatabaseService);
    const repo = app.get(ChatMessagesRepository);

    // T1 nâng con trỏ lên 5 rồi GIỮ giao dịch mở ⇒ giữ khoá hàng thành viên.
    let release!: () => void;
    const held = new Promise<void>((res) => {
      release = res;
    });
    const t1 = db.withTenant(A.companyId, async (tx) => {
      await repo.advanceLastReadSeq(tx, A.companyId, memberRowId, 5, 5);
      await held;
    });
    await new Promise((res) => setTimeout(res, 150));

    // T2 vào sau với số NHỎ HƠN: bị chặn tại UPDATE cho tới khi T1 commit, rồi mới đánh giá vế phải.
    const t2 = db.withTenant(A.companyId, (tx) =>
      repo.advanceLastReadSeq(tx, A.companyId, memberRowId, 2, 2),
    );
    setTimeout(release, 150);
    const [, afterT2] = await Promise.all([t1, t2]);

    expect(afterT2, "T2 thấy 5 đã commit ⇒ GREATEST giữ 5; gán đè sẽ ra 2").toBe(5);
    const dbrow = await direct.query("SELECT last_read_seq FROM chat_room_members WHERE id = $1", [
      memberRowId,
    ]);
    expect(Number(dbrow.rows[0].last_read_seq)).toBe(5);
  });

  it("ca 24: ghim DÙNG ĐƯỢC trong phòng direct — DM không bao giờ có admin phòng", async () => {
    // DM insert cả hai người với role 'member' và `assertManualMembership` chặn đổi vai trò trên phòng
    // `direct` ⇒ nếu ghim đòi admin phòng thì đó là tính năng CHẾT, không phải tính năng bị hạn chế.
    const dm = await authPost(tAdmin, "/chat/rooms/direct").send({ peerUserId: uMember });
    expect(dm.status, JSON.stringify(dm.body)).toBe(200);
    const dmId = dm.body.data.id as string;

    const sent = await send(tAdmin, dmId, "tin trong DM");
    const id = sent.body.data.id as string;
    expect(
      (await authPost(tMember, `/chat/messages/${id}/pin`)).status,
      "hai người DM ngang vai — không có ai để mà đòi làm admin",
    ).toBe(200);
    const pinned = await authGet(tMember, `/chat/rooms/${dmId}/pinned`);
    expect((pinned.body.data as unknown[]).length).toBe(1);
    expect((await authDelete(tMember, `/chat/messages/${id}/pin`)).status).toBe(200);
  });

  it("ca 25: phòng ĐÃ LƯU TRỮ chặn CẢ thu hồi/ghim/bỏ ghim — chỉ-đọc là chỉ-đọc", async () => {
    const r = await newRoom("Phòng đóng - kiểm duyệt", []);
    const a = await send(tAdmin, r, "tin sẽ ghim trước khi đóng");
    const b = await send(tAdmin, r, "tin sẽ thu hồi sau khi đóng");
    const idA = a.body.data.id as string;
    const idB = b.body.data.id as string;
    expect((await authPost(tAdmin, `/chat/messages/${idA}/pin`)).status).toBe(200);
    expect((await authPost(tAdmin, `/chat/rooms/${r}/archive`)).status).toBe(200);

    const cases = [
      ["ghim", await authPost(tAdmin, `/chat/messages/${idB}/pin`)],
      ["bỏ ghim", await authDelete(tAdmin, `/chat/messages/${idA}/pin`)],
      ["thu hồi", await authPost(tAdmin, `/chat/messages/${idB}/recall`)],
    ] as const;
    for (const [label, res] of cases) {
      expect(res.status, `${label} trong phòng lưu trữ`).toBe(422);
      expect(JSON.stringify(res.body), label).toContain("CHAT-ERR-005");
    }
    expect((await authGet(tAdmin, `/chat/rooms/${r}/pinned`)).status, "đọc vẫn phải được").toBe(
      200,
    );
  });

  it("ca 26: tạo phòng với >200 thành viên → 400 (chặn cạn tài nguyên bằng tài khoản HỢP LỆ)", async () => {
    const res = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng khổng lồ",
      memberUserIds: Array.from({ length: 201 }, () => randomUUID()),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  // ── Ca 20: tổng chưa đọc ───────────────────────────────────────────────────

  it("ca 20: /unread-count bằng tổng phép trừ và dùng ĐÚNG 1 truy vấn (không COUNT(*) per-room)", async () => {
    const r1 = await newRoom("Tổng 1");
    const r2 = await newRoom("Tổng 2");
    await send(tAdmin, r1, "a");
    await send(tAdmin, r1, "b");
    await send(tAdmin, r2, "c");

    const res = await authGet(tMember, "/chat/unread-count");
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(3);
    expect(res.body.data.rooms).toBeGreaterThanOrEqual(2);

    const db = app.get(DatabaseService);
    const repo = app.get(ChatMessagesRepository);
    let selectCalls = 0;
    await db.withTenant(A.companyId, async (tx) => {
      const counting = new Proxy(tx as object, {
        get(target, prop, receiver) {
          if (prop === "select") selectCalls += 1;
          return Reflect.get(target, prop, receiver);
        },
      }) as typeof tx;
      return repo.unreadTotals(counting, A.companyId, uMember);
    });
    expect(selectCalls, "badge header chạy mỗi lần đổi trang — N+1 ở đây là chết").toBe(1);
  });

  it("phòng ĐÃ LƯU TRỮ không tính vào /unread-count (badge phải khớp danh sách phòng mặc định)", async () => {
    const before = await authGet(tMember, "/chat/unread-count");
    const r = await newRoom("Sẽ lưu trữ");
    await send(tAdmin, r, "tin chưa đọc");
    const mid = await authGet(tMember, "/chat/unread-count");
    expect(mid.body.data.total).toBe(before.body.data.total + 1);

    await authPost(tAdmin, `/chat/rooms/${r}/archive`);
    const after = await authGet(tMember, "/chat/unread-count");
    expect(after.body.data.total, "badge kêu vì phòng không nhìn thấy = badge không tắt được").toBe(
      before.body.data.total,
    );
  });

  // ── Ca 21: không có đường sửa body ─────────────────────────────────────────

  describe("ca 21 — KHÔNG đường nào sửa `body` (CHAT-ERR-007)", () => {
    it("0 route @Patch/@Put nhắm CHÍNH tin nhắn trong toàn module CHAT", () => {
      // ─────────────────────────────────────────────────────────────────────────────────────────
      // S8-CHAT-UX-BE-3 — SIẾT ĐÚNG THỨ CẦN GIỮ, thay vì giữ một cái đại diện dễ kiểm mà nói sai.
      //
      // Bản trước cấm MỌI `@Put`/`@Patch` có chữ `messages` trong đường dẫn. Cái nó THỰC SỰ canh là
      // SPEC-15 §3.4/CHAT-ERR-007: "không đường nào sửa nội dung một tin nhắn". Hai mệnh đề đó trùng
      // nhau đúng tới lúc module có tài nguyên CON nằm dưới `messages/` — `CHAT-API-022a`
      // (`PUT messages/:id/reactions/:emoji`) ghi vào bảng RIÊNG `chat_message_reactions` và không
      // chạm một cột nào của `chat_messages`.
      //
      // ⇒ Cấm `@Put`/`@Patch` nhắm CHÍNH tin (đường dẫn KẾT THÚC ở `messages/:id`), cho phép tài
      //   nguyên con. Đây là siết ĐỘ CHÍNH XÁC, không phải nới: `@Put("messages/:id")` — dạng route
      //   sửa tin duy nhất có thể tồn tại — vẫn ĐỎ. Và ca thứ hai bên dưới mới là bằng chứng CỨNG:
      //   `mediaos_app` không có UPDATE cấp bảng trên `chat_messages`, column-GRANT đúng 4 cột, nên
      //   dù ai đó viết được một route như thế thì nó cũng chết bằng `42501` chứ không sửa nổi `body`.
      //   (memory `index-ratchet-must-pin-definition-not-name`.)
      // ─────────────────────────────────────────────────────────────────────────────────────────
      const chatDir = join(__dirname, "..", "..", "src", "chat");
      const offenders: string[] = [];
      for (const f of readdirSync(chatDir).filter((x) => x.endsWith(".controller.ts"))) {
        const src = readFileSync(join(chatDir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const m of src.matchAll(/@(Patch|Put)\(\s*["'`]([^"'`]*)["'`]/g)) {
          const path = m[2];
          // "nhắm chính tin" = có đoạn `messages/<tham số>` và KẾT THÚC ngay ở đó.
          if (/(^|\/)messages\/:[^/]+$/.test(path)) offenders.push(`${f} › @${m[1]}("${path}")`);
        }
      }
      expect(offenders, "route sửa CHÍNH tin nhắn — cấm tuyệt đối (CHAT-ERR-007)").toEqual([]);
    });

    it("DB ép bất biến: `mediaos_app` có 0 UPDATE cấp bảng trên chat_messages, column-GRANT ĐÚNG 4 cột", async () => {
      const table = await direct.query(
        `SELECT privilege_type FROM information_schema.table_privileges
          WHERE grantee = 'mediaos_app' AND table_name = 'chat_messages'
            AND privilege_type IN ('UPDATE','DELETE')`,
      );
      expect(
        table.rows.map((r) => r.privilege_type),
        "0539 verify (3) cũng gác điều này ở tầng migration",
      ).toEqual([]);

      const cols = await direct.query(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE grantee = 'mediaos_app' AND table_name = 'chat_messages'
            AND privilege_type = 'UPDATE' ORDER BY column_name`,
      );
      expect(cols.rows.map((r) => r.column_name)).toEqual([
        "pinned_at",
        "pinned_by",
        "recalled_at",
        "recalled_by",
      ]);
    });
  });
});
