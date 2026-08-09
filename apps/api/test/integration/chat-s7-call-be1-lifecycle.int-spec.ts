/**
 * S7-CALL-BE-1 — vòng đời cuộc gọi trên đường THẬT (`CHAT-API-026..029`, hàng rào **R4** của `CHAT-DEC-020`).
 *
 * Phủ những mệnh đề mà unit test KHÔNG chứng minh nổi vì chúng nói về DB thật + pipeline guard:
 *   • **404 hằng trên trục `callId`** — người ngoài phòng không phân biệt được với cuộc gọi không tồn tại;
 *   • `('view','chat-oversight')` **KHÔNG** miễn `assertMember` cho bất kỳ đường CALL nào (SPEC-15 §5.1c);
 *   • **409 dưới ĐUA THẬT** — hai lời mời song song, ép bằng partial unique index chứ không bằng `if`;
 *   • **FSM một chiều** ở CẢ HAI tầng: service (422) và trigger DB (23514);
 *   • **column-GRANT** của mig `0546`: ghi 3 cột vòng đời không `42501`, và app role KHÔNG xoá được lịch sử;
 *   • audit đủ cho MỖI thao tác, và **0 dòng** cho deny-path;
 *   • job quét `ringing` quá hạn: idempotent + THẬT SỰ được scheduler gom (không chỉ resolve bằng tay).
 *
 * ⚠️ **CHỐNG XANH-GIẢ.** 404 của "route chưa tồn tại" trông y hệt 404 của membership ⇒ mọi ca deny-path
 * assert **mã lỗi trong thân**, không chỉ status. Và mỗi ca DENY đi kèm ca ALLOW tương ứng: thiếu ca cho
 * phép, một service ném 404 vô điều kiện vẫn làm toàn bộ ca deny XANH
 * (memory `deny-cases-vacuous-without-allow-case`).
 *
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
import { CHAT_CALL_RING_TIMEOUT_MS } from "../../src/chat/chat-calls.service";
import { ChatCallRingingTimeoutJobHandler } from "../../src/chat/chat-call-ringing-timeout.job-handler";
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
const LOGIN_PW = "Passw0rd!s7call1";
const UNKNOWN_UUID = "00000000-0000-4000-8000-0000000000fe";

type Scope = "Own" | "Team" | "Department" | "Company";
/**
 * `sensitive` phải khớp **ĐÚNG giá trị đang có trong catalog toàn cục** — `seedPermissionCatalog` ném
 * nếu lệch. `permissions` không có `company_id` nên `cleanupTenants()` không dọn được nó: ghi đè cờ ở
 * đây là đóng dấu VĨNH VIỄN lên lane DB và làm spec khác đỏ ở nơi không liên quan
 * (memory `test-fixture-stamps-global-permission-catalog`).
 */
type PairGrant = [action: string, resource: string, scope: Scope, sensitive?: boolean];

/** Cặp nền để dựng phòng/DM — KHÔNG gồm `('call','chat-room')`. */
const PAIRS_BASE: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
];

const PAIR_CALL: PairGrant = ["call", "chat-room", "Company"];
/**
 * Đọc-vượt membership (CHAT-DEC-004). Có nó KHÔNG được nghe cuộc gọi — đó là ca 4.
 * `is_sensitive = true` là giá trị THẬT trong catalog (mig `0538` khối D′) — không được "sửa" ở fixture.
 */
const PAIR_OVERSIGHT: PairGrant = ["view", "chat-oversight", "Company", true];

describe.skipIf(!hasLaneDb)("S7-CALL-BE-1 — vòng đời cuộc gọi REST (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  /** Người khởi tạo — có đủ cặp + `call`. */
  let uCaller = "";
  /** Người được mời — có đủ cặp + `call`. */
  let uCallee = "";
  /** THÀNH VIÊN phòng nhưng **thiếu** `('call','chat-room')` ⇒ 403 (CHAT-ERR-027). */
  let uNoCallPair = "";
  /** CÓ `call` nhưng KHÔNG thuộc phòng ⇒ 404 (CHAT-ERR-026/001). */
  let uOutsider = "";
  /** CÓ `call` + `view:chat-oversight`, KHÔNG thuộc phòng ⇒ vẫn 404 (SPEC-15 §5.1c). */
  let uOversight = "";
  /** CÓ đủ cặp kể cả `call`; vào phòng SAU khi cuộc gọi bắt đầu ⇒ 403 vì không ở trong cuộc gọi (ca 4b). */
  let uLateJoiner = "";

  let tCaller = "";
  let tCallee = "";
  let tNoCallPair = "";
  let tOutsider = "";
  let tOversight = "";
  let tLateJoiner = "";

  /** Phòng nhóm chính: caller + callee + uNoCallPair. */
  let roomId = "";
  /** Phòng phụ cho các ca cần một cuộc gọi sạch (mỗi phòng chỉ 1 cuộc gọi sống một lúc). */
  const spareRooms: string[] = [];
  let spareIdx = 0;
  const nextRoom = (): string => {
    const r = spareRooms[spareIdx];
    spareIdx += 1;
    if (!r) throw new Error("hết phòng dự phòng — tăng số phòng gieo ở beforeAll");
    return r;
  };

  const srv = () => request(app.getHttpServer());
  const authPost = (t: string, u: string) => srv().post(u).set("Authorization", `Bearer ${t}`);
  const authGet = (t: string, u: string) => srv().get(u).set("Authorization", `Bearer ${t}`);

  async function grantPairs(userId: string, label: string, pairs: PairGrant[]): Promise<void> {
    const roleId = await seedRole(direct, A.companyId, `s7call-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope, sensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, sensitive ?? false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, A.companyId);
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function createGroup(name: string, members: string[]): Promise<string> {
    const res = await authPost(tCaller, "/chat/rooms").send({ name, memberUserIds: members });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  /** Mời một cuộc gọi và trả `callId` — dùng ở mọi ca cần cuộc gọi đang đổ chuông. */
  async function invite(room: string, kind: "audio" | "video" = "audio"): Promise<string> {
    const res = await authPost(tCaller, `/chat/rooms/${room}/calls`).send({ kind });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  /** Đọc THẲNG hàng trong DB — không tin DTO, vì DTO là đúng thứ đang được kiểm. */
  async function callRow(callId: string): Promise<{
    status: string;
    accepted_at: Date | null;
    ended_at: Date | null;
    room_id: string;
  }> {
    const r = await direct.query(
      "SELECT status, accepted_at, ended_at, room_id FROM chat_calls WHERE id = $1",
      [callId],
    );
    return r.rows[0];
  }

  async function participantRows(
    callId: string,
  ): Promise<{ user_id: string; outcome: string | null; joined_at: Date | null }[]> {
    const r = await direct.query(
      "SELECT user_id, outcome, joined_at FROM chat_call_participants WHERE call_id = $1 ORDER BY invited_at",
      [callId],
    );
    return r.rows;
  }

  async function auditRows(
    callId: string,
  ): Promise<{ action: string; actor_type: string | null }[]> {
    const r = await direct.query(
      `SELECT action, actor_type FROM audit_logs
        WHERE object_type = 'chat_call' AND object_id = $1 ORDER BY created_at`,
      [callId],
    );
    return r.rows;
  }

  /** Đẩy `started_at` lùi quá ngưỡng đổ chuông — mô phỏng "không ai nhấc máy" mà không phải chờ thật. */
  async function ageCall(callId: string, extraMs = 5_000): Promise<void> {
    await direct.query(
      `UPDATE chat_calls SET started_at = now() - ($2::int * interval '1 millisecond') WHERE id = $1`,
      [callId, CHAT_CALL_RING_TIMEOUT_MS + extraMs],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s7call");
    B = await seedCompany(direct, "s7callother");
    companyIds.push(A.companyId, B.companyId);

    const mk = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uCaller = await mk("caller");
    uCallee = await mk("callee");
    uNoCallPair = await mk("nopair");
    uOutsider = await mk("outsider");
    uOversight = await mk("oversight");
    uLateJoiner = await mk("latejoiner");

    await grantPairs(uCaller, "caller", [...PAIRS_BASE, PAIR_CALL]);
    await grantPairs(uCallee, "callee", [...PAIRS_BASE, PAIR_CALL]);
    // THÀNH VIÊN phòng, đủ mọi cặp CHAT khác, CHỈ thiếu `call` — đó là điều làm ca 403 có nghĩa.
    await grantPairs(uNoCallPair, "nopair", PAIRS_BASE);
    // Người ngoài có ĐỦ cặp kể cả `call` — ca 404 vì thế chứng minh MEMBERSHIP là hàng rào, không phải
    // cặp quyền đang chặn.
    await grantPairs(uOutsider, "outsider", [...PAIRS_BASE, PAIR_CALL]);
    await grantPairs(uOversight, "oversight", [...PAIRS_BASE, PAIR_CALL, PAIR_OVERSIGHT]);
    // ĐỦ quyền — ca 4b phải đo `findParticipant`, không đo `PermissionGuard`.
    await grantPairs(uLateJoiner, "latejoiner", [...PAIRS_BASE, PAIR_CALL]);

    tCaller = await login(`caller@${A.slug}.test`);
    tCallee = await login(`callee@${A.slug}.test`);
    tNoCallPair = await login(`nopair@${A.slug}.test`);
    tOutsider = await login(`outsider@${A.slug}.test`);
    tOversight = await login(`oversight@${A.slug}.test`);
    tLateJoiner = await login(`latejoiner@${A.slug}.test`);

    roomId = await createGroup("Phòng gọi", [uCallee, uNoCallPair]);
    // Mỗi ca cần cuộc gọi SẠCH phải có phòng riêng: partial unique index chỉ cho MỘT cuộc gọi sống mỗi
    // phòng, nên dùng lại phòng của ca trước sẽ đo nhầm 409 thay vì thứ ca đó muốn đo. Dư vài phòng là
    // rẻ; thiếu thì ca CUỐI ném "hết phòng dự phòng" và người đọc tưởng tính năng hỏng.
    for (let i = 0; i < 18; i += 1) {
      spareRooms.push(await createGroup(`Phòng gọi ${i}`, [uCallee]));
    }
  }, 240_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ═══════════ deny-path ═══════════

  it("ca 1 — MỜI ở phòng KHÔNG thuộc ⇒ 404 CHAT-ERR-001, giống hệt phòng không tồn tại", async () => {
    const notMine = await authPost(tOutsider, `/chat/rooms/${roomId}/calls`).send({
      kind: "audio",
    });
    const unknown = await authPost(tOutsider, `/chat/rooms/${UNKNOWN_UUID}/calls`).send({
      kind: "audio",
    });

    expect(notMine.status, JSON.stringify(notMine.body)).toBe(404);
    expect(JSON.stringify(notMine.body)).toContain("CHAT-ERR-001");
    // Hai phản hồi phải KHÔNG phân biệt được — nếu khác nhau, `roomId` trở lại thành oracle dò.
    expect(unknown.status).toBe(notMine.status);
    expect(unknown.body.error?.message ?? unknown.body.message).toEqual(
      notMine.body.error?.message ?? notMine.body.message,
    );
  });

  it("ca 1b — ALLOW đối chứng: người TRONG phòng có cặp `call` mời được (nếu không, ca 1 vô nghĩa)", async () => {
    const res = await authPost(tCaller, `/chat/rooms/${nextRoom()}/calls`).send({ kind: "video" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe("ringing");
    expect(res.body.data.kind).toBe("video");
  });

  it("ca 2 — thành viên phòng THIẾU cặp ('call','chat-room') ⇒ 403 (CHAT-ERR-027), không phải 404", async () => {
    const res = await authPost(tNoCallPair, `/chat/rooms/${roomId}/calls`).send({ kind: "audio" });

    // 403 ở đây KHÔNG lộ gì thêm: người gọi vốn đã là thành viên nên đã biết phòng tồn tại. Trả 404
    // ngược lại sẽ làm người dùng hợp lệ tưởng phòng biến mất.
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("ca 3 — thao tác trên `callId` của TENANT KHÁC ⇒ 404 CHAT-ERR-026 và 0 byte đổi ở tenant kia", async () => {
    // Gieo THẲNG một cuộc gọi ở công ty B (không qua API — B không có người dùng nào đăng nhập ở đây).
    const bUser = await seedUser(direct, B.companyId, `peer@${B.slug}.test`);
    const bRoom = await direct.query(
      `INSERT INTO chat_rooms (company_id, room_type, name, room_code, created_by)
       VALUES ($1, 'group', 'B room', $2, $3) RETURNING id`,
      [B.companyId, `ROOM-B-${Date.now()}`, bUser],
    );
    const bRoomId = bRoom.rows[0].id as string;
    const bCall = await direct.query(
      `INSERT INTO chat_calls (company_id, room_id, initiator_user_id, kind)
       VALUES ($1, $2, $3, 'audio') RETURNING id`,
      [B.companyId, bRoomId, bUser],
    );
    const bCallId = bCall.rows[0].id as string;

    const res = await authPost(tCaller, `/chat/calls/${bCallId}/accept`);

    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-026");
    // Cô lập không chỉ là "không đọc được" — phải chứng minh KHÔNG GHI được.
    expect((await callRow(bCallId)).status).toBe("ringing");
  });

  it("ca 3b — `callId` KHÔNG TỒN TẠI trả phản hồi GIỐNG HỆT `callId` của tenant khác", async () => {
    const unknown = await authPost(tCaller, `/chat/calls/${UNKNOWN_UUID}/accept`);

    expect(unknown.status).toBe(404);
    expect(JSON.stringify(unknown.body)).toContain("CHAT-ERR-026");
  });

  it("ca 4 — `view:chat-oversight` KHÔNG miễn membership: 404 ở CẢ 5 route (SPEC-15 §5.1c)", async () => {
    const callId = await invite(nextRoom());

    // Đọc-vượt là quyền đọc LỊCH SỬ TIN NHẮN. Suy diễn "quản trị đọc được mọi phòng ⇒ nghe được mọi
    // cuộc gọi" là suy diễn nguy hiểm nhất của wave — ca này đóng đinh nó là SAI.
    for (const path of ["accept", "reject", "cancel", "hangup"]) {
      const res = await authPost(tOversight, `/chat/calls/${callId}/${path}`);
      expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(404);
      expect(JSON.stringify(res.body)).toContain("CHAT-ERR-026");
    }
    const inviteRes = await authPost(tOversight, `/chat/rooms/${roomId}/calls`).send({
      kind: "audio",
    });
    expect(inviteRes.status).toBe(404);
    expect(JSON.stringify(inviteRes.body)).toContain("CHAT-ERR-001");
  });

  it("ca 4b — vào phòng SAU khi cuộc gọi bắt đầu ⇒ 403: là thành viên KHÔNG có nghĩa là ở trong cuộc gọi", async () => {
    const room = nextRoom();
    const callId = await invite(room);

    // ⚠️ Người này có ĐỦ cặp quyền kể cả `('call','chat-room')` — nếu dùng `uNoCallPair` thì
    // `PermissionGuard` chặn TRƯỚC và ca test không bao giờ chạm tới `findParticipant`: một ca DENY
    // xanh mà nhánh cần đo chưa từng thực thi (memory `deny-cases-vacuous-without-allow-case`).
    await direct.query(
      `INSERT INTO chat_room_members (company_id, room_id, user_id, role)
       VALUES ($1, $2, $3, 'member') ON CONFLICT DO NOTHING`,
      [A.companyId, room, uLateJoiner],
    );

    // `assertCallAccess` CHO QUA (đúng — họ là thành viên phòng, và cuộc gọi tồn tại). Vế chặn duy nhất
    // là `findParticipant`. Thiếu nó, người vừa vào phòng gác được máy cuộc gọi của hai người khác.
    const denied = await authPost(tLateJoiner, `/chat/calls/${callId}/hangup`);
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(JSON.stringify(denied.body)).toContain("CHAT-ERR-027");
    expect((await callRow(callId)).status).toBe("ringing");

    // ALLOW đối chứng trên CHÍNH cuộc gọi đó: người ĐƯỢC mời vẫn thao tác được ⇒ 403 ở trên là do tư
    // cách tham gia, không phải do cuộc gọi hỏng.
    const ok = await authPost(tCallee, `/chat/calls/${callId}/accept`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("ca 5 — deny-path KHÔNG để lại dòng audit nào (không audit thứ chưa xảy ra)", async () => {
    const before = await direct.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE object_type = 'chat_call'",
    );
    await authPost(tOutsider, `/chat/rooms/${roomId}/calls`).send({ kind: "audio" });
    await authPost(tCaller, `/chat/calls/${UNKNOWN_UUID}/accept`);
    const after = await direct.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE object_type = 'chat_call'",
    );

    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  // ═══════════ vòng đời ═══════════

  it("ca 6 — MỜI seed người tham gia cho TOÀN BỘ thành viên, người gọi vào ngay", async () => {
    const callId = await invite(roomId);

    const rows = await participantRows(callId);
    expect(rows.map((r) => r.user_id).sort()).toEqual([uCallee, uCaller, uNoCallPair].sort());
    // Người khởi tạo không phải "nhận" lời mời của chính mình.
    expect(rows.find((r) => r.user_id === uCaller)?.joined_at).not.toBeNull();
    expect(rows.find((r) => r.user_id === uCallee)?.joined_at).toBeNull();
    expect(rows.every((r) => r.outcome === null)).toBe(true);

    await authPost(tCaller, `/chat/calls/${callId}/hangup`);
  });

  it("ca 7 — NHẬN: `ringing` → `active`, có `accepted_at`, outcome `accepted`", async () => {
    const callId = await invite(nextRoom());

    const res = await authPost(tCallee, `/chat/calls/${callId}/accept`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.acceptedAt).not.toBeNull();
    const row = await callRow(callId);
    expect(row.status).toBe("active");
    expect(row.accepted_at).not.toBeNull();
    expect(row.ended_at).toBeNull();
    const mine = (await participantRows(callId)).find((r) => r.user_id === uCallee);
    expect(mine?.outcome).toBe("accepted");
    expect(mine?.joined_at).not.toBeNull();
  });

  it("ca 8 — người KHỞI TẠO không nhận/từ chối lời mời của chính mình ⇒ 403 (CHAT-ERR-027)", async () => {
    const callId = await invite(nextRoom());

    for (const path of ["accept", "reject"]) {
      const res = await authPost(tCaller, `/chat/calls/${callId}/${path}`);
      expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain("CHAT-ERR-027");
    }
    // Vẫn còn `ringing` — 403 không được nuốt mất cuộc gọi.
    expect((await callRow(callId)).status).toBe("ringing");
  });

  it("ca 9 — HUỶ chỉ dành cho người khởi tạo; người khác ⇒ 403 (CHAT-ERR-027)", async () => {
    const callId = await invite(nextRoom());

    const denied = await authPost(tCallee, `/chat/calls/${callId}/cancel`);
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(JSON.stringify(denied.body)).toContain("CHAT-ERR-027");

    const ok = await authPost(tCaller, `/chat/calls/${callId}/cancel`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe("cancelled");
    expect((await callRow(callId)).ended_at).not.toBeNull();
  });

  it("ca 10 — TỪ CHỐI kết thúc cuộc gọi; người chưa kịp bấm gì là `missed`", async () => {
    const callId = await invite(roomId);

    const res = await authPost(tCallee, `/chat/calls/${callId}/reject`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("rejected");
    const rows = await participantRows(callId);
    expect(rows.find((r) => r.user_id === uCallee)?.outcome).toBe("rejected");
    // uNoCallPair được mời nhưng không bấm gì — sổ phải nói đúng điều đó, không phải "đã rời".
    expect(rows.find((r) => r.user_id === uNoCallPair)?.outcome).toBe("missed");
  });

  it("ca 11 — GÁC MÁY sau khi nối: `ended`, actor `left`, người treo `missed`", async () => {
    const callId = await invite(roomId);
    await authPost(tCallee, `/chat/calls/${callId}/accept`);

    const res = await authPost(tCaller, `/chat/calls/${callId}/hangup`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("ended");
    const rows = await participantRows(callId);
    expect(rows.find((r) => r.user_id === uCaller)?.outcome).toBe("left");
    // Người đã NHẬN giữ nguyên `accepted` — `closeOpenParticipants` chỉ đụng hàng chưa ngã ngũ.
    expect(rows.find((r) => r.user_id === uCallee)?.outcome).toBe("accepted");
    expect(rows.find((r) => r.user_id === uNoCallPair)?.outcome).toBe("missed");
  });

  // ═══════════ ràng buộc DB (chỗ code KHÔNG tự chứng minh được) ═══════════

  it("ca 12 — 409 CHAT-ERR-028 dưới ĐUA THẬT: hai lời mời song song ⇒ đúng 1 cuộc gọi sống", async () => {
    const room = nextRoom();

    // SONG SONG, không tuần tự: tuần tự chỉ đo được cái `if` ở service, không đo được index.
    const [r1, r2] = await Promise.all([
      authPost(tCaller, `/chat/rooms/${room}/calls`).send({ kind: "audio" }),
      authPost(tCallee, `/chat/rooms/${room}/calls`).send({ kind: "audio" }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses, `${JSON.stringify(r1.body)} | ${JSON.stringify(r2.body)}`).toEqual([201, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(JSON.stringify(loser.body)).toContain("CHAT-ERR-028");

    const live = await direct.query(
      `SELECT count(*)::int AS n FROM chat_calls
        WHERE room_id = $1 AND status IN ('ringing','active')`,
      [room],
    );
    expect(live.rows[0].n).toBe(1);
  });

  it("ca 13 — 422 CHAT-ERR-029: thao tác lên cuộc gọi ĐÃ kết thúc (FSM một chiều ở tầng service)", async () => {
    const callId = await invite(nextRoom());
    await authPost(tCaller, `/chat/calls/${callId}/cancel`);

    for (const [token, path] of [
      [tCallee, "accept"],
      [tCallee, "reject"],
      [tCaller, "cancel"],
      [tCaller, "hangup"],
    ] as const) {
      const res = await authPost(token, `/chat/calls/${callId}/${path}`);
      expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(422);
      expect(JSON.stringify(res.body)).toContain("CHAT-ERR-029");
    }
    // Trạng thái KHÔNG bị thao tác hỏng làm nhiễu.
    expect((await callRow(callId)).status).toBe("cancelled");
  });

  it("ca 14 — trigger DB chặn HỒI SINH kể cả khi ghi thẳng SQL (lưới cuối, không chỉ service)", async () => {
    const callId = await invite(nextRoom());
    await authPost(tCaller, `/chat/calls/${callId}/cancel`);

    // Service có thể bị sửa sai ngày mai; ràng buộc này thì không. Hàng hồi sinh sẽ quay lại chiếm chỗ
    // "cuộc gọi sống" của partial unique index ⇒ phòng bị khoá VĨNH VIỄN (mig `0546` khối A3).
    await expect(
      direct.query("UPDATE chat_calls SET status = 'ringing' WHERE id = $1", [callId]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("ca 15 — append-only: app role KHÔNG xoá được lịch sử, KHÔNG ghi được cột ngoài vòng đời", async () => {
    // Đo quyền THẬT tại thời điểm chạy, không đọc migration (memory `grant-in-old-migration-is-not-current-state`).
    const r = await direct.query(
      `SELECT
         has_table_privilege('mediaos_app','chat_calls','DELETE')            AS del,
         has_table_privilege('mediaos_app','chat_calls','UPDATE')            AS upd_table,
         has_column_privilege('mediaos_app','chat_calls','status','UPDATE')  AS upd_status,
         has_column_privilege('mediaos_app','chat_calls','room_id','UPDATE') AS upd_room,
         has_table_privilege('mediaos_app','chat_call_participants','DELETE') AS p_del`,
    );
    const row = r.rows[0];

    expect(row.del).toBe(false);
    // UPDATE cấp BẢNG phải false — chỉ column-GRANT mới được cấp (mig `0546` khối C).
    expect(row.upd_table).toBe(false);
    expect(row.upd_status).toBe(true);
    expect(row.upd_room).toBe(false);
    expect(row.p_del).toBe(false);
  });

  it("ca 16 — audit đủ cho MỖI thao tác vòng đời, `object_type='chat_call'`", async () => {
    const callId = await invite(nextRoom());
    await authPost(tCallee, `/chat/calls/${callId}/accept`);
    await authPost(tCallee, `/chat/calls/${callId}/hangup`);

    const actions = (await auditRows(callId)).map((r) => r.action);
    expect(actions).toEqual(["chat.call.invited", "chat.call.accepted", "chat.call.ended"]);
  });

  // ═══════════ hết hạn đổ chuông ═══════════

  it("ca 17 — MỜI dọn cuộc gọi quá hạn của CHÍNH phòng đó ⇒ phòng không kẹt tới nhịp job", async () => {
    const room = nextRoom();
    const stale = await invite(room);
    await ageCall(stale);

    // Không có bước dọn này thì đây là 409 và người dùng phải chờ ~60s cho nhịp scheduler.
    const res = await authPost(tCaller, `/chat/rooms/${room}/calls`).send({ kind: "audio" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await callRow(stale)).status).toBe("missed");
    expect((await callRow(stale)).ended_at).not.toBeNull();
    expect((await participantRows(stale)).every((p) => p.outcome === "missed")).toBe(true);
    // Cuộc gọi bị đánh nhỡ vẫn phải có dấu vết — và là dấu vết của HỆ THỐNG, không phải của người bấm.
    const missed = (await auditRows(stale)).find((a) => a.action === "chat.call.missed");
    expect(missed?.actor_type).toBe("System");
  });

  it("ca 18 — job đánh nhỡ cuộc gọi quá hạn, và chạy lại lập tức là NO-OP (idempotent)", async () => {
    const room = nextRoom();
    const stale = await invite(room);
    await ageCall(stale);

    const handler = app.get(ChatCallRingingTimeoutJobHandler, { strict: false });
    const first = await handler.run({ companyId: A.companyId });
    const second = await handler.run({ companyId: A.companyId });

    expect(first.success).toBeGreaterThanOrEqual(1);
    expect(second.total).toBe(0);
    expect((await callRow(stale)).status).toBe("missed");
    const missed = (await auditRows(stale)).find((a) => a.action === "chat.call.missed");
    // Không người nào đứng sau nhịp job — `actor_type='Job'`, khác đường mời ở ca 17.
    expect(missed?.actor_type).toBe("Job");
  });

  it("ca 19 — job KHÔNG đụng cuộc gọi còn trong hạn (ngưỡng thật, không phải quét sạch)", async () => {
    const fresh = await invite(nextRoom());

    const handler = app.get(ChatCallRingingTimeoutJobHandler, { strict: false });
    await handler.run({ companyId: A.companyId });

    expect((await callRow(fresh)).status).toBe("ringing");
  });

  it("ca 20 — wiring: job ĐƯỢC scheduler gom qua DiscoveryService (không chỉ resolve bằng tay)", async () => {
    // `app.get(handler)` chỉ chứng minh DI resolve. Thứ quyết định job có CHẠY hay không là
    // DiscoveryService quét đúng metadata trên provider ĐÃ DỰNG — và ca này cũng là bằng chứng
    // AppModule bootstrap được với handler mới (lớp `systemjobhandler-optional-dbw-di`).
    const { DiscoveryService } = await import("@nestjs/core");
    const { SYSTEM_JOB_HANDLER } = await import("../../src/scheduler/job-handler");
    const discovery = app.get(DiscoveryService);

    const codes = discovery
      .getProviders()
      .filter(
        (w) =>
          w.metatype &&
          w.instance != null &&
          Reflect.getMetadata(SYSTEM_JOB_HANDLER, w.metatype) === true,
      )
      .map((w) => (w.instance as { jobCode?: string }).jobCode);

    expect(codes).toContain("CHAT_CALL_RINGING_TIMEOUT");
    // jobCode phải DUY NHẤT toàn hệ — nó là khoá `system_job_locks`; trùng = hai job giành một khoá.
    expect(codes.filter((c) => c === "CHAT_CALL_RINGING_TIMEOUT")).toHaveLength(1);
  });

  // ═══════════ ICE config (CHAT-API-029) ═══════════

  it("ca 21 — ice-config: gate ('call','chat-room') — thiếu cặp ⇒ 403, có cặp ⇒ STUN khi chưa cấu hình TURN", async () => {
    const denied = await authGet(tNoCallPair, "/chat/calls/ice-config");
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);

    const ok = await authGet(tCaller, "/chat/calls/ice-config");
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const servers = ok.body.data.iceServers as { urls: string | string[] }[];
    expect(servers.length).toBeGreaterThan(0);
    // Không cấu hình TURN ⇒ tắt MỀM về STUN, KHÔNG phải 500. Và không có `credential` nào để lộ.
    expect(servers.every((s) => JSON.stringify(s.urls).includes("stun:"))).toBe(true);
    expect(JSON.stringify(ok.body)).not.toContain("credential");
  });

  it("ca 22 — phòng ĐÃ LƯU TRỮ: không mời được (CHAT-ERR-005) nhưng cuộc gọi đang chạy vẫn gác được", async () => {
    const room = nextRoom();
    const live = await invite(room);
    await authPost(tCallee, `/chat/calls/${live}/accept`);
    await request(app.getHttpServer())
      .post(`/chat/rooms/${room}/archive`)
      .set("Authorization", `Bearer ${tCaller}`)
      .send({});

    const blocked = await authPost(tCaller, `/chat/rooms/${room}/calls`).send({ kind: "audio" });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(422);
    expect(JSON.stringify(blocked.body)).toContain("CHAT-ERR-005");

    // ⚠️ Vế THỨ HAI là vế quan trọng: chặn cả `hangup` sẽ nhốt cuộc gọi ở `active` và giữ khoá
    // "một cuộc gọi sống mỗi phòng" cho tới khi có người vào DB sửa tay.
    const ok = await authPost(tCaller, `/chat/calls/${live}/hangup`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});
