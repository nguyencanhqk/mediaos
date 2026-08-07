/**
 * S8-CHAT-UX-BE-1 — tuỳ chọn per-phòng trên đường THẬT: ghim (CHAT-API-024a/b) · tắt thông báo
 * (CHAT-API-025) · đánh dấu chưa đọc (CHAT-API-020).
 *
 * Phủ 6 mệnh đề mà unit test KHÔNG chứng minh nổi vì chúng nói về DB thật + pipeline guard:
 *   • deny-path: không-thành-viên ⇒ 404 **mang mã CHAT-ERR-001**, và phòng-lạ trả phản hồi GIỐNG HỆT;
 *   • **column-level GRANT** (mig `0543` mục C): ghi 3 cột mới KHÔNG ném `42501` — TypeScript và unit
 *     test đều mù với quyền cột, chỉ đường này bắt được;
 *   • trần 10 ghim đứng vững dưới **ĐUA THẬT** (2 request song song ở ranh giới), nhờ khoá advisory;
 *   • phòng đã tắt: đường phát noti **thật sự** bỏ qua (gọi thẳng `ChatAudienceReader` — đúng hàm mà
 *     bridge dùng), NHƯNG `unreadCount` **vẫn tăng**. Hai vế nằm trong CÙNG một ca, cạnh nhau;
 *   • đánh dấu chưa đọc KHÔNG lùi `last_read_seq` (đọc thẳng cột trong DB, không tin DTO);
 *   • cô lập tenant: `pinned_at` của công ty A không rò sang B.
 *
 * ⚠️ **CHỐNG XANH-GIẢ.** 404 của "route chưa tồn tại" trông y hệt 404 của CHAT-ERR-001 ⇒ mọi ca
 * deny-path assert **mã lỗi trong thân**, không chỉ status.
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
import { CHAT_ROOM_PIN_MAX } from "../../src/chat/chat-room-prefs.service";
import { DatabaseService } from "../../src/db/db.service";
import { ChatAudienceReader } from "../../src/notifications/chat-audience.reader";
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
const LOGIN_PW = "Passw0rd!s8be1prefs";
const UNKNOWN_ROOM = "00000000-0000-4000-8000-0000000000fe";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

const PAIRS_FULL: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
];

describe.skipIf(!hasLaneDb)("S8-CHAT-UX-BE-1 — tuỳ chọn per-phòng (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let db: DatabaseService;
  let audience: ChatAudienceReader;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let uOwner = "";
  let uMate = "";
  let uOutsider = "";
  let tOwner = "";
  let tMate = "";
  let tOutsider = "";
  /** Phòng nhóm chính (owner + mate) — chủ thể của deny-path và của ca mention. */
  let roomId = "";
  /** DM owner↔mate — chủ thể của ca "tắt thông báo mà badge vẫn tăng". */
  let dmId = "";
  /** Kho phòng cho ca trần + ca đua. */
  const extraRooms: string[] = [];

  async function grantPairs(userId: string, label: string): Promise<void> {
    const roleId = await seedRole(direct, A.companyId, `s8be1-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of PAIRS_FULL) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
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

  const srv = () => request(app.getHttpServer());
  const authPut = (t: string, u: string) => srv().put(u).set("Authorization", `Bearer ${t}`);
  const authPost = (t: string, u: string) => srv().post(u).set("Authorization", `Bearer ${t}`);
  const authDel = (t: string, u: string) => srv().delete(u).set("Authorization", `Bearer ${t}`);
  const authGet = (t: string, u: string) => srv().get(u).set("Authorization", `Bearer ${t}`);

  async function createGroup(name: string, members: string[]): Promise<string> {
    const res = await authPost(tOwner, "/chat/rooms").send({ name, memberUserIds: members });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.id as string;
  }

  /** Đọc THẲNG cột trong DB — không tin DTO, vì DTO là đúng thứ đang được kiểm. */
  async function memberRow(
    roomIdArg: string,
    userId: string,
  ): Promise<{
    pinned_at: Date | null;
    muted_until: Date | null;
    marked_unread_at: Date | null;
    last_read_seq: string;
  }> {
    const r = await direct.query(
      `SELECT pinned_at, muted_until, marked_unread_at, last_read_seq
         FROM chat_room_members WHERE room_id = $1 AND user_id = $2`,
      [roomIdArg, userId],
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    db = app.get(DatabaseService, { strict: false });
    audience = app.get(ChatAudienceReader, { strict: false });

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s8be1prefs");
    B = await seedCompany(direct, "s8be1other");
    companyIds.push(A.companyId, B.companyId);

    const mk = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uOwner = await mk("owner");
    uMate = await mk("mate");
    uOutsider = await mk("outsider");

    await grantPairs(uOwner, "owner");
    await grantPairs(uMate, "mate");
    // Người ngoài có ĐỦ cặp quyền — chỉ KHÔNG phải thành viên. Đó là điều làm ca 404 có nghĩa: nó
    // chứng minh MEMBERSHIP là hàng rào, không phải cặp quyền đang chặn.
    await grantPairs(uOutsider, "outsider");

    tOwner = await login(`owner@${A.slug}.test`);
    tMate = await login(`mate@${A.slug}.test`);
    tOutsider = await login(`outsider@${A.slug}.test`);

    roomId = await createGroup("Phòng tuỳ chọn", [uMate]);

    const dm = await authPost(tOwner, "/chat/rooms/direct").send({ peerUserId: uMate });
    expect(dm.status, JSON.stringify(dm.body)).toBe(200);
    dmId = dm.body.data.id as string;

    // Đủ phòng cho ca trần (cần CHAT_ROOM_PIN_MAX + 1 phòng ghim được) và ca đua.
    // `uMate` PHẢI là thành viên: chủ thể của mọi ca ghim là mate, mà không-thành-viên ⇒ 404 (đúng
    // luật, nhưng sẽ làm ca trần đo nhầm thứ — 404 chứ không phải 409).
    for (let i = 0; i < CHAT_ROOM_PIN_MAX + 2; i += 1) {
      extraRooms.push(await createGroup(`Kho ${i}`, [uMate]));
    }
  }, 180_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── deny-path (RED trước) ───────────────────────────────────────────────────

  const denyPaths: readonly [string, () => request.Test][] = [
    ["PUT /pin", () => authPut(tOutsider, `/chat/rooms/${roomId}/pin`).send({})],
    ["DELETE /pin", () => authDel(tOutsider, `/chat/rooms/${roomId}/pin`).send({})],
    [
      "PUT /mute",
      () => authPut(tOutsider, `/chat/rooms/${roomId}/mute`).send({ mutedUntil: null }),
    ],
    ["POST /unread", () => authPost(tOutsider, `/chat/rooms/${roomId}/unread`).send({})],
  ];

  it.each(denyPaths)(
    "ca 1 — %s trên phòng KHÔNG thuộc ⇒ 404 mang mã CHAT-ERR-001 (không phải 403, không phải 404 route lạ)",
    async (_name, run) => {
      const res = await run();

      expect(res.status, JSON.stringify(res.body)).toBe(404);
      // 403 sẽ xác nhận phòng CÓ TỒN TẠI ⇒ oracle dò. Mã lỗi trong thân phân biệt "route chưa viết"
      // với "phòng không thuộc về bạn" — thiếu assert này thì ca test XANH cả khi route chưa tồn tại.
      expect(JSON.stringify(res.body)).toContain("CHAT-ERR-001");
    },
  );

  it("ca 2 — phòng KHÔNG TỒN TẠI trả phản hồi GIỐNG HỆT phòng-không-thuộc", async () => {
    const unknown = await authPut(tOutsider, `/chat/rooms/${UNKNOWN_ROOM}/pin`).send({});
    const notMine = await authPut(tOutsider, `/chat/rooms/${roomId}/pin`).send({});

    expect(unknown.status).toBe(notMine.status);
    expect(unknown.body.error?.code ?? unknown.body.code).toEqual(
      notMine.body.error?.code ?? notMine.body.code,
    );
    expect(unknown.body.error?.message ?? unknown.body.message).toEqual(
      notMine.body.error?.message ?? notMine.body.message,
    );
  });

  it("ca 3 — chưa đăng nhập ⇒ 401 (pipeline guard toàn cục chạy trước)", async () => {
    const res = await srv().put(`/chat/rooms/${roomId}/pin`).send({});
    expect(res.status).toBe(401);
  });

  // ── column-level GRANT: ba cột mới ghi ĐƯỢC (42501 chỉ lộ ở đây) ────────────

  it("ca 4 — ghi được cả 3 cột mới: pinned_at · muted_until · marked_unread_at (không 42501)", async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();

    const pin = await authPut(tMate, `/chat/rooms/${roomId}/pin`).send({});
    const mute = await authPut(tMate, `/chat/rooms/${roomId}/mute`).send({ mutedUntil: until });
    const unread = await authPost(tMate, `/chat/rooms/${roomId}/unread`).send({});

    expect(pin.status, JSON.stringify(pin.body)).toBe(200);
    expect(mute.status, JSON.stringify(mute.body)).toBe(200);
    expect(unread.status, JSON.stringify(unread.body)).toBe(200);

    const row = await memberRow(roomId, uMate);
    expect(row.pinned_at).not.toBeNull();
    expect(row.muted_until).not.toBeNull();
    expect(row.marked_unread_at).not.toBeNull();
  });

  it("ca 5 — tuỳ chọn là PER-USER: owner nhìn cùng phòng đó KHÔNG thấy gì bị đặt", async () => {
    // Vế quyết định của CHAT-DEC-015: ghim ở `chat_room_members`, không ở `chat_rooms`. Đặt nhầm bảng
    // thì ca này đỏ — một người ghim, cả phòng bị ghim.
    const res = await authGet(tOwner, "/chat/rooms");
    expect(res.status).toBe(200);
    const room = (res.body.data as { id: string; pinnedAt: string | null }[]).find(
      (r) => r.id === roomId,
    );
    expect(room?.pinnedAt ?? null).toBeNull();

    const mine = await authGet(tMate, "/chat/rooms");
    const mineRoom = (mine.body.data as { id: string; pinnedAt: string | null }[]).find(
      (r) => r.id === roomId,
    );
    expect(mineRoom?.pinnedAt ?? null).not.toBeNull();
  });

  // ── trần 10 + ĐUA THẬT ──────────────────────────────────────────────────────

  it(`ca 6 — ghim tới đúng ${CHAT_ROOM_PIN_MAX}, phòng kế tiếp ⇒ 409 CHAT-ERR-021`, async () => {
    // `roomId` đã ghim ở ca 4 ⇒ mate đang có 1 suất. Ghim thêm cho đủ trần.
    for (let i = 0; i < CHAT_ROOM_PIN_MAX - 1; i += 1) {
      const r = await authPut(tMate, `/chat/rooms/${extraRooms[i]}/pin`).send({});
      expect(r.status, `phòng thứ ${i + 2}: ${JSON.stringify(r.body)}`).toBe(200);
    }

    const over = await authPut(tMate, `/chat/rooms/${extraRooms[CHAT_ROOM_PIN_MAX - 1]}/pin`).send(
      {},
    );
    expect(over.status, JSON.stringify(over.body)).toBe(409);
    expect(JSON.stringify(over.body)).toContain("CHAT-ERR-021");

    // Ghim LẠI một phòng đang ghim vẫn 200 dù đã chạm trần — idempotent không tiêu thêm suất.
    const again = await authPut(tMate, `/chat/rooms/${roomId}/pin`).send({});
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  });

  it("ca 7 — ĐUA: bỏ 1 suất rồi bắn 2 lệnh ghim SONG SONG ⇒ đúng MỘT thành công", async () => {
    // Đưa về đúng ranh giới: 9 phòng đang ghim, còn 1 suất.
    const freed = await authDel(tMate, `/chat/rooms/${extraRooms[0]}/pin`).send({});
    expect(freed.status).toBe(200);

    const a = extraRooms[CHAT_ROOM_PIN_MAX];
    const b = extraRooms[CHAT_ROOM_PIN_MAX + 1];
    const [r1, r2] = await Promise.all([
      authPut(tMate, `/chat/rooms/${a}/pin`).send({}),
      authPut(tMate, `/chat/rooms/${b}/pin`).send({}),
    ]);

    const codes = [r1.status, r2.status].sort();
    expect(codes, `hai phản hồi: ${JSON.stringify([r1.body, r2.body])}`).toEqual([200, 409]);

    // Vế THẬT SỰ quan trọng: đếm trong DB. Hai 200 mà số đếm ra 11 là lỗ; một 200 mà số đếm ra 11 cũng
    // là lỗ (ghi lọt rồi mới báo lỗi). Đếm mới là bằng chứng, status chỉ là triệu chứng.
    const n = await direct.query(
      `SELECT count(*)::int AS n FROM chat_room_members
        WHERE company_id = $1 AND user_id = $2 AND pinned_at IS NOT NULL AND left_at IS NULL`,
      [A.companyId, uMate],
    );
    expect(n.rows[0].n).toBe(CHAT_ROOM_PIN_MAX);
  });

  // ── tắt thông báo: đường phát noti THẬT bỏ qua, badge VẪN tăng ──────────────

  it("ca 8 — phòng đã tắt: audience DM trả RỖNG, nhưng unreadCount VẪN tăng", async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const mute = await authPut(tMate, `/chat/rooms/${dmId}/mute`).send({ mutedUntil: until });
    expect(mute.status, JSON.stringify(mute.body)).toBe(200);

    const sent = await authPost(tOwner, `/chat/rooms/${dmId}/messages`).send({
      body: "tin thử khi đã tắt thông báo",
      clientMessageId: "11111111-1111-4111-8111-00000000be01",
    });
    // 200, KHÔNG 201: `POST /messages` idempotent theo `clientMessageId` (`@HttpCode(200)`).
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);

    // (a) ĐƯỜNG PHÁT NOTI — gọi ĐÚNG hàm mà bridge dùng, không mô phỏng lại điều kiện.
    const recipients = await db.withTenant(A.companyId, (tx) =>
      audience.resolveDirectRecipient(tx, A.companyId, dmId, uMate),
    );
    expect(recipients).toEqual([]);

    // (b) BADGE — vế thứ hai của CHAT-FUNC-015, nằm ngay cạnh vế (a) để không ai làm một nửa.
    const rooms = await authGet(tMate, "/chat/rooms?type=direct");
    const dm = (rooms.body.data as { id: string; unreadCount: number }[]).find(
      (r) => r.id === dmId,
    );
    expect(dm?.unreadCount).toBeGreaterThan(0);
  });

  it("ca 9 — bật lại thông báo (mutedUntil: null) ⇒ audience nhận lại được", async () => {
    const un = await authPut(tMate, `/chat/rooms/${dmId}/mute`).send({ mutedUntil: null });
    expect(un.status, JSON.stringify(un.body)).toBe(200);

    const recipients = await db.withTenant(A.companyId, (tx) =>
      audience.resolveDirectRecipient(tx, A.companyId, dmId, uMate),
    );
    expect(recipients).toEqual([uMate]);
  });

  it("ca 10 — mốc ĐÃ QUA chuẩn hoá về NULL ở DB (không giữ giá trị mà đường đọc coi là 'không tắt')", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await authPut(tMate, `/chat/rooms/${dmId}/mute`).send({ mutedUntil: past });

    expect(res.status).toBe(200);
    expect(res.body.data.mutedUntil).toBeNull();
    expect((await memberRow(dmId, uMate)).muted_until).toBeNull();
  });

  it("ca 11 — phòng đã tắt vẫn bị loại khỏi audience MENTION (không riêng DM)", async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    await authPut(tMate, `/chat/rooms/${roomId}/mute`).send({ mutedUntil: until });

    const muted = await db.withTenant(A.companyId, (tx) =>
      audience.resolveMentionRecipients(tx, A.companyId, roomId, [uMate]),
    );
    expect(muted).toEqual([]);

    await authPut(tMate, `/chat/rooms/${roomId}/mute`).send({ mutedUntil: null });
    const back = await db.withTenant(A.companyId, (tx) =>
      audience.resolveMentionRecipients(tx, A.companyId, roomId, [uMate]),
    );
    expect(back).toEqual([uMate]);
  });

  // ── đánh dấu chưa đọc: con trỏ chỉ-tiến BẤT ĐỘNG ───────────────────────────

  it("ca 12 — POST /unread KHÔNG lùi last_read_seq (SPEC-15 §13.2), và POST /read xoá cờ", async () => {
    // Đẩy con trỏ lên hết trước.
    const before = await authPost(tMate, `/chat/rooms/${dmId}/read`).send({ seq: 999 });
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    const seqAfterRead = (await memberRow(dmId, uMate)).last_read_seq;

    const mark = await authPost(tMate, `/chat/rooms/${dmId}/unread`).send({});
    expect(mark.status).toBe(200);
    const afterMark = await memberRow(dmId, uMate);

    expect(afterMark.marked_unread_at).not.toBeNull();
    // VẾ CHÍNH: con trỏ ĐỨNG YÊN. Lùi nó là phá phép trừ đếm chưa đọc và mọi thứ dựng trên đó.
    expect(afterMark.last_read_seq).toBe(seqAfterRead);

    // "Mở phòng ⇒ cờ về NULL" — kể cả khi con trỏ KHÔNG tiến (không có tin mới nào).
    const reopen = await authPost(tMate, `/chat/rooms/${dmId}/read`).send({ seq: 1 });
    expect(reopen.status).toBe(200);
    const afterReopen = await memberRow(dmId, uMate);
    expect(afterReopen.marked_unread_at).toBeNull();
    expect(afterReopen.last_read_seq).toBe(seqAfterRead);
  });

  // ── cô lập tenant ───────────────────────────────────────────────────────────

  it("ca 13 — cô lập: 0 hàng của công ty B mang pinned_at/marked_unread_at do A ghi", async () => {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM chat_room_members
        WHERE company_id = $1 AND (pinned_at IS NOT NULL OR marked_unread_at IS NOT NULL
                                   OR muted_until IS NOT NULL)`,
      [B.companyId],
    );
    expect(r.rows[0].n).toBe(0);
  });
});
