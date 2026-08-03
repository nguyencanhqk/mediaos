/**
 * S7-CHAT-BE-1 — đường CHẠY ĐƯỢC của phòng & thành viên (CHAT-API-001..008).
 * Phủ 6 mệnh đề mà đọc code KHÔNG chứng minh nổi, phải chạy trên Postgres thật:
 *   • DM idempotent theo `direct_key` (2 lần gọi = 1 hàng);
 *   • đếm chưa đọc bằng PHÉP TRỪ trong hệ `room_seq`, danh sách phòng chỉ 1 truy vấn (không N+1);
 *   • lazy-create counter `chat_room` cho company tạo SAU mig `0538` — nợ FULL gate của S7-CHAT-DB-1;
 *   • rời rồi vào lại tái dùng ĐÚNG hàng cũ, `joined_at` KHÔNG đổi (cột đó không có GRANT UPDATE ⇒ 42501);
 *   • mọi hành động quản trị ghi ĐÚNG MỘT dòng `audit_logs`;
 *   • phòng lưu trữ = chỉ đọc.
 *
 * Chủ thể vẫn KHÔNG PHẢI Super Admin (xem ghi chú đầu `chat-be1-access.int-spec.ts`).
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
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
import { ChatRoomsRepository } from "../../src/chat/chat-rooms.repository";
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
const LOGIN_PW = "Passw0rd!chatbe1r";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

const CHAT_FULL: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
];

describe.skipIf(!hasLaneDb)("S7-CHAT-BE-1 — phòng & thành viên (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let uAdmin = "";
  let uMember = "";
  let uThird = "";
  let tAdmin = "";
  let tMember = "";

  async function grantPairs(companyId: string, userId: string, label: string): Promise<void> {
    const roleId = await seedRole(direct, companyId, `chatr-${label}-${userId.slice(0, 8)}`);
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
  const authPatch = (t: string, u: string) =>
    request(app.getHttpServer()).patch(u).set("Authorization", `Bearer ${t}`);
  const authDelete = (t: string, u: string) =>
    request(app.getHttpServer()).delete(u).set("Authorization", `Bearer ${t}`);

  /** Số dòng audit của một phòng — assert "đúng 1 hàng" theo từng hành động. */
  async function auditRows(roomId: string): Promise<{ action: string; result_status: string }[]> {
    const r = await direct.query(
      `SELECT action, result_status FROM audit_logs
        WHERE object_type = 'chat_room' AND object_id = $1 ORDER BY created_at`,
      [roomId],
    );
    return r.rows;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    // ⚠️ CỐ Ý KHÔNG seed counter `chat_room`: company này tạo SAU mig 0538 ⇒ đây chính là kịch bản
    //    nợ-từ-DB-1. Phòng đầu tiên phải lazy-create counter và ra ROOM-0001 (ca 12).
    A = await seedCompany(direct, "chatbe1r");
    companyIds.push(A.companyId);

    const mk = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uAdmin = await mk("owner");
    uMember = await mk("mate");
    uThird = await mk("third");
    for (const [u, l] of [
      [uAdmin, "owner"],
      [uMember, "mate"],
      [uThird, "third"],
    ] as const) {
      await grantPairs(A.companyId, u, l);
    }

    tAdmin = await login(A.slug, `owner@${A.slug}.test`);
    tMember = await login(A.slug, `mate@${A.slug}.test`);
  }, 120_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── Ca 12: lazy-create counter theo CONTRACT LITERAL của 0538 ──────────────

  it("ca 12: company chưa có counter — phòng đầu ra ROOM-0001, counter khớp ĐỦ 9 trường của 0538", async () => {
    const before = await direct.query(
      "SELECT count(*)::int AS n FROM sequence_counters WHERE company_id = $1 AND sequence_key = 'chat_room'",
      [A.companyId],
    );
    expect(before.rows[0].n, "tiền đề: company này CHƯA có counter").toBe(0);

    const res = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng đầu tiên",
      memberUserIds: [uMember],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.roomCode).toBe("ROOM-0001");

    const c = await direct.query(
      `SELECT module_code, sequence_key, scope_type, prefix, padding_length,
              reset_policy, increment_by, current_value, status
         FROM sequence_counters WHERE company_id = $1 AND sequence_key = 'chat_room'`,
      [A.companyId],
    );
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toMatchObject({
      module_code: "CHAT",
      sequence_key: "chat_room",
      scope_type: "Company",
      prefix: "ROOM-",
      padding_length: 4,
      reset_policy: "Never",
      increment_by: 1,
      status: "Active",
    });
    // `current_value` = 1 sau khi cấp mã đầu: contract chốt current_value=0 lúc tạo + increment_by=1.
    expect(String(c.rows[0].current_value)).toBe("1");
  });

  it("ca 13: tạo phòng ghi ĐÚNG 1 dòng audit chat_room, và KHÔNG dòng nào chứa nội dung tin", async () => {
    const res = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng có audit",
      memberUserIds: [],
    });
    expect(res.status).toBe(201);
    const rows = await auditRows(res.body.data.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "chat.room.created", result_status: "Success" });

    const modules = await direct.query(
      "SELECT DISTINCT module_code FROM audit_logs WHERE object_type = 'chat_room' AND object_id = $1",
      [res.body.data.id],
    );
    expect(modules.rows.map((r) => r.module_code)).toEqual(["CHAT"]);
  });

  it("người tạo phòng nhóm tự động là admin; người được mời là member", async () => {
    const res = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng vai trò",
      memberUserIds: [uMember],
    });
    const detail = await authGet(tAdmin, `/chat/rooms/${res.body.data.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.myRole).toBe("admin");
    const roles = Object.fromEntries(
      (detail.body.data.members as { userId: string; role: string }[]).map((m) => [
        m.userId,
        m.role,
      ]),
    );
    expect(roles[uAdmin]).toBe("admin");
    expect(roles[uMember]).toBe("member");
  });

  // ── Ca 9: DM idempotent ────────────────────────────────────────────────────

  it("ca 9: POST /chat/rooms/direct hai lần → CÙNG roomId, 200 cả hai lần, ĐÚNG 1 hàng", async () => {
    const first = await authPost(tAdmin, "/chat/rooms/direct").send({ peerUserId: uMember });
    const second = await authPost(tAdmin, "/chat/rooms/direct").send({ peerUserId: uMember });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);

    const rows = await direct.query(
      "SELECT count(*)::int AS n FROM chat_rooms WHERE company_id = $1 AND room_type = 'direct'",
      [A.companyId],
    );
    expect(rows.rows[0].n).toBe(1);

    // Lần thứ hai KHÔNG được ghi thêm dòng audit "mở DM" — audit chỉ ở LẦN TẠO ĐẦU (API-13 §5.1).
    const audits = await auditRows(first.body.data.id);
    expect(audits.filter((a) => a.action === "chat.room.direct_opened")).toHaveLength(1);
  });

  it("ca 9b: B mở DM với A cũng ra ĐÚNG phòng đó (direct_key sort tăng dần, không phụ thuộc ai mở trước)", async () => {
    const fromA = await authPost(tAdmin, "/chat/rooms/direct").send({ peerUserId: uMember });
    const fromB = await authPost(tMember, "/chat/rooms/direct").send({ peerUserId: uAdmin });
    expect(fromB.body.data.id).toBe(fromA.body.data.id);
    expect(fromA.body.data.name, "phòng direct KHÔNG có tên — client dựng từ 2 người").toBeNull();
  });

  // ── Ca 11 + 15: danh sách phòng, unread, không N+1 ─────────────────────────

  it("ca 11: danh sách ≥3 phòng dùng ĐÚNG 1 truy vấn SELECT (không N+1), unread bằng phép trừ", async () => {
    for (const name of ["N+1 A", "N+1 B", "N+1 C"]) {
      const r = await authPost(tAdmin, "/chat/rooms").send({ name, memberUserIds: [] });
      expect(r.status).toBe(201);
    }

    const db = app.get(DatabaseService);
    const repo = app.get(ChatRoomsRepository);
    let selectCalls = 0;
    const rows = await db.withTenant(A.companyId, async (tx) => {
      // Proxy đếm số lần builder `select` được dựng: N+1 nghĩa là 1 + số phòng, không phải 1.
      const counting = new Proxy(tx as object, {
        get(target, prop, receiver) {
          if (prop === "select") selectCalls += 1;
          return Reflect.get(target, prop, receiver);
        },
      }) as typeof tx;
      return repo.listRoomsForUser(counting, A.companyId, uAdmin, { archived: false });
    });

    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(selectCalls, `số truy vấn SELECT cho ${rows.length} phòng`).toBe(1);
  });

  it("ca 15: phòng CHƯA có tin nào (last_message_seq NULL) → unreadCount = 0, KHÔNG phải null", async () => {
    const res = await authGet(tAdmin, "/chat/rooms");
    expect(res.status).toBe(200);
    const list = res.body.data as { unreadCount: unknown; lastMessageSeq: unknown }[];
    expect(list.length).toBeGreaterThan(0);
    for (const room of list) {
      expect(room.lastMessageSeq, "tiền đề: chưa WO nào ghi tin nhắn").toBeNull();
      expect(room.unreadCount).toBe(0);
    }
  });

  it("unread = last_message_seq − last_read_seq trong hệ room_seq (gieo con trỏ trực tiếp)", async () => {
    const created = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng đếm chưa đọc",
      memberUserIds: [uMember],
    });
    const roomId = created.body.data.id as string;
    // Gieo THẲNG con trỏ: WO này chưa có đường ghi tin nhắn (đó là BE-2), nhưng công thức đếm phải đúng
    // NGAY — sai công thức thì badge của FE sai từ ngày đầu bật CHAT.
    await direct.query("UPDATE chat_rooms SET last_message_seq = 7 WHERE id = $1", [roomId]);
    await direct.query(
      "UPDATE chat_room_members SET last_read_seq = 5 WHERE room_id = $1 AND user_id = $2",
      [roomId, uAdmin],
    );

    const list = await authGet(tAdmin, "/chat/rooms");
    const mine = (list.body.data as { id: string; unreadCount: number }[]).find(
      (r) => r.id === roomId,
    );
    expect(mine?.unreadCount).toBe(2);

    // Đường ĐỌC MỘT PHÒNG phải cho CÙNG con số với đường danh sách (hai bản của công thức, một kết quả).
    const detail = await authGet(tAdmin, `/chat/rooms/${roomId}`);
    expect(detail.body.data.unreadCount).toBe(2);

    // Con trỏ vượt mốc (dữ liệu lệch) → 0, KHÔNG âm.
    await direct.query(
      "UPDATE chat_room_members SET last_read_seq = 99 WHERE room_id = $1 AND user_id = $2",
      [roomId, uAdmin],
    );
    const after = await authGet(tAdmin, `/chat/rooms/${roomId}`);
    expect(after.body.data.unreadCount).toBe(0);
  });

  // ── Ca 10 + 16: rời rồi vào lại ────────────────────────────────────────────

  it("ca 10+16: rời rồi được thêm lại — TÁI DÙNG hàng cũ, không 23505, `joined_at` GIỮ NGUYÊN", async () => {
    const created = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng vào lại",
      memberUserIds: [uMember],
    });
    const roomId = created.body.data.id as string;

    const before = await direct.query(
      "SELECT id, joined_at FROM chat_room_members WHERE room_id = $1 AND user_id = $2",
      [roomId, uMember],
    );
    expect(before.rows).toHaveLength(1);

    const left = await authPost(tMember, `/chat/rooms/${roomId}/leave`);
    expect(left.status, JSON.stringify(left.body)).toBe(200);

    // Đã rời ⇒ không đọc được nữa (404), và không nằm trong danh sách thành viên.
    expect((await authGet(tMember, `/chat/rooms/${roomId}`)).status).toBe(404);

    const again = await authPost(tAdmin, `/chat/rooms/${roomId}/members`).send({
      userId: uMember,
      role: "member",
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);

    const after = await direct.query(
      "SELECT id, joined_at, left_at FROM chat_room_members WHERE room_id = $1 AND user_id = $2",
      [roomId, uMember],
    );
    expect(after.rows, "KHÔNG được đẻ hàng thứ hai (unique room_id,user_id)").toHaveLength(1);
    expect(after.rows[0].id).toBe(before.rows[0].id);
    expect(after.rows[0].left_at).toBeNull();
    expect(
      new Date(after.rows[0].joined_at).toISOString(),
      "joined_at KHÔNG có GRANT UPDATE — chạm vào là 42501",
    ).toBe(new Date(before.rows[0].joined_at).toISOString());

    expect((await authGet(tMember, `/chat/rooms/${roomId}`)).status).toBe(200);
  });

  // ── Lưu trữ = chỉ đọc ──────────────────────────────────────────────────────

  it("lưu trữ phòng: khoá mọi đường GHI, vẫn ĐỌC được, vẫn RỜI được, lưu trữ lần hai → CHAT-ERR-005", async () => {
    const created = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng sẽ lưu trữ",
      memberUserIds: [uMember],
    });
    const roomId = created.body.data.id as string;

    const arch = await authPost(tAdmin, `/chat/rooms/${roomId}/archive`);
    expect(arch.status, JSON.stringify(arch.body)).toBe(200);
    expect(arch.body.data.isArchived).toBe(true);

    for (const res of await Promise.all([
      authPatch(tAdmin, `/chat/rooms/${roomId}`).send({ name: "đổi sau khi lưu trữ" }),
      authPost(tAdmin, `/chat/rooms/${roomId}/members`).send({ userId: uThird }),
      authDelete(tAdmin, `/chat/rooms/${roomId}/members/${uMember}`),
    ])) {
      expect(res.status, `${res.request.method} ${res.request.url}`).toBe(422);
      expect(JSON.stringify(res.body)).toContain("CHAT-ERR-005");
    }

    const twice = await authPost(tAdmin, `/chat/rooms/${roomId}/archive`);
    expect(twice.status).toBe(422);
    expect(JSON.stringify(twice.body)).toContain("CHAT-ERR-005");

    // Vẫn đọc được (chỉ-đọc, không phải biến mất) — nhưng KHÔNG nằm trong danh sách mặc định.
    expect((await authGet(tAdmin, `/chat/rooms/${roomId}`)).status).toBe(200);
    const def = await authGet(tAdmin, "/chat/rooms");
    expect((def.body.data as { id: string }[]).map((r) => r.id)).not.toContain(roomId);
    const arc = await authGet(tAdmin, "/chat/rooms?archived=true");
    expect((arc.body.data as { id: string }[]).map((r) => r.id)).toContain(roomId);

    // Rời phòng đã lưu trữ vẫn được — chặn nốt lối này là nhốt người dùng vĩnh viễn.
    expect((await authPost(tMember, `/chat/rooms/${roomId}/leave`)).status).toBe(200);
  });

  it("`archived=false` (chuỗi) không bị coerce thành true — pipe Zod chạy 2 lần vẫn idempotent", async () => {
    const res = await authGet(tAdmin, "/chat/rooms?archived=false");
    expect(res.status).toBe(200);
    for (const room of res.body.data as { isArchived: boolean }[]) {
      expect(room.isArchived).toBe(false);
    }
  });

  // ── Sửa tên/mô tả + phong vai trò ──────────────────────────────────────────

  it("PATCH tên/mô tả ghi đúng 1 dòng audit kèm oldValues/newValues; body rỗng → 400", async () => {
    const created = await authPost(tAdmin, "/chat/rooms").send({
      name: "Tên cũ",
      memberUserIds: [],
    });
    const roomId = created.body.data.id as string;

    const res = await authPatch(tAdmin, `/chat/rooms/${roomId}`).send({
      name: "Tên mới",
      description: "Mô tả mới",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.name).toBe("Tên mới");

    const rows = await auditRows(roomId);
    expect(rows.filter((r) => r.action === "chat.room.updated")).toHaveLength(1);

    const empty = await authPatch(tAdmin, `/chat/rooms/${roomId}`).send({});
    expect(empty.status, "body rỗng phải bị Zod chặn, không trả 200 'đã đổi'").toBe(400);
  });

  it("phong thành viên lên admin rồi hạ admin cũ xuống được (phòng vẫn còn 1 admin)", async () => {
    const created = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng chuyển quyền",
      memberUserIds: [uMember],
    });
    const roomId = created.body.data.id as string;

    const promote = await authPatch(tAdmin, `/chat/rooms/${roomId}/members/${uMember}`).send({
      role: "admin",
    });
    expect(promote.status, JSON.stringify(promote.body)).toBe(200);
    expect(promote.body.data.role).toBe("admin");

    const demote = await authPatch(tAdmin, `/chat/rooms/${roomId}/members/${uAdmin}`).send({
      role: "member",
    });
    expect(demote.status, "còn 1 admin khác nên hạ cấp hợp lệ").toBe(200);

    // Người vừa bị hạ cấp mất quyền quản trị NGAY (403), không phải sau khi đăng nhập lại.
    const denied = await authPatch(tAdmin, `/chat/rooms/${roomId}`).send({ name: "x" });
    expect(denied.status).toBe(403);

    const rows = await auditRows(roomId);
    expect(rows.filter((r) => r.action === "chat.room.member_role_changed")).toHaveLength(2);
  });

  it("bớt thành viên = SET left_at (giữ hàng), ghi 1 dòng audit member_removed", async () => {
    const created = await authPost(tAdmin, "/chat/rooms").send({
      name: "Phòng bớt người",
      memberUserIds: [uMember],
    });
    const roomId = created.body.data.id as string;

    const res = await authDelete(tAdmin, `/chat/rooms/${roomId}/members/${uMember}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const rows = await direct.query(
      "SELECT left_at FROM chat_room_members WHERE room_id = $1 AND user_id = $2",
      [roomId, uMember],
    );
    expect(rows.rows, "hàng phải CÒN (DELETE đã REVOKE ở 0538)").toHaveLength(1);
    expect(rows.rows[0].left_at).not.toBeNull();

    const audits = await auditRows(roomId);
    expect(audits.filter((a) => a.action === "chat.room.member_removed")).toHaveLength(1);
  });
});
