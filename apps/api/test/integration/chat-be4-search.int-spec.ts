/**
 * S7-CHAT-BE-4 — tìm kiếm toàn văn tiếng Việt (SPEC-15 §13.7 · §12 CHAT-ERR-017 · §20 ca 11 · API-13 §5).
 *
 * ⚠️ **ĐÂY LÀ ĐƯỜNG ĐỌC RỘNG NHẤT CỦA MODULE.** Mọi đường đọc khác bó theo MỘT `roomId` đã đi qua
 * `ChatAccessService.assertMember`; đường này quét toàn bộ `chat_messages` của tenant rồi mới lọc. Sai
 * một vế = rò nguyên nội dung công ty, và rò IM LẶNG (HTTP 200, kết quả trông hợp lý).
 *
 * ⚠️ CHỦ THỂ KHÔNG PHẢI SUPER ADMIN — SA giữ `*:*` nên mọi ca deny sẽ xanh-giả. GATE CỨNG
 * `hasDb && LANE_DB`.
 *
 * ⚠️ FIXTURE CÓ **BỐN** PHÒNG, và `P4` là bắt buộc chứ không phải cho đủ bộ:
 *   P1 — actor LÀ thành viên                        → phải THẤY
 *   P2 — actor KHÔNG thuộc                          → phải KHÔNG thấy
 *   P3 — actor ĐÃ RỜI (`left_at`)                   → phải KHÔNG thấy
 *   P4 — actor LÀ thành viên, phòng ĐÃ XOÁ MỀM      → phải KHÔNG thấy
 * Thiếu `P4`, ca "phòng xoá mềm" phải mượn P2/P3 — và khi đó **gỡ hẳn** vế `chat_rooms.deleted_at IS
 * NULL` khỏi truy vấn thì test VẪN XANH vì membership đã loại rồi. Ca không canh gì cả.
 *
 * Mọi phòng chứa tin có CÙNG từ khoá "báo cáo tài chính" — đó là điều làm các ca deny có nghĩa.
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
const LOGIN_PW = "Passw0rd!chatbe4";
const KEYWORD_ACCENTED = "báo cáo tài chính";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

const CHAT_PAIRS: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
  ["send", "chat-message", "Company"],
  // `recall` là cặp RIÊNG (không suy ra từ `send`) — ca 8 cần nó để thu hồi tin qua đường thật.
  ["recall", "chat-message", "Company"],
];

/**
 * Cặp đọc-vượt của CHAT-DEC-004. Cấp cho MỘT tài khoản thường (KHÔNG phải SA) để ca 9 chứng minh được
 * điều SPEC-15 §20 ca 11 đòi: cặp này **không** mở tìm kiếm. Dùng SA làm chủ thể là tautology — SA lọt
 * nhờ `*:*` chứ không nhờ cặp nào (memory `superadmin-not-a-canonical-role`).
 */
const OVERSIGHT_PAIR: PairGrant = ["view", "chat-oversight", "Company"];

interface Ctx {
  app: INestApplication;
  direct: Pool;
}

describe.skipIf(!hasLaneDb)("S7-CHAT-BE-4 — tìm kiếm (DB cô lập, đường thật)", () => {
  const ctx = {} as Ctx;
  const companyIds: string[] = [];

  let A: SeededTenant;
  let B: SeededTenant;
  let uActor = "";
  let uOther = "";
  let uOversight = "";
  let uB = "";
  let tActor = "";
  let tOversight = "";
  let tB = "";

  let P1 = "";
  let P2 = "";
  let P3 = "";
  let P4 = "";
  let roomB = "";

  const authGet = (t: string, u: string) =>
    request(ctx.app.getHttpServer()).get(u).set("Authorization", `Bearer ${t}`);
  const authPost = (t: string, u: string) =>
    request(ctx.app.getHttpServer()).post(u).set("Authorization", `Bearer ${t}`);
  const direct = (): Pool => ctx.direct;

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(ctx.app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: PairGrant[],
  ): Promise<void> {
    const roleId = await seedRole(direct(), companyId, `chats-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of pairs) {
      // ⚠️ `is_sensitive` phải khớp SEED THẬT của mig `0538`: 8 cặp CHAT thường = `false`, riêng
      // `('view','chat-oversight')` = **`true`** (SPEC-15 §3.3 bắt buộc). `seedPermissionCatalog` ghi
      // `ON CONFLICT DO UPDATE SET is_sensitive = EXCLUDED.is_sensitive` lên catalog **TOÀN CỤC** và
      // `cleanupTenants` chỉ dọn tenant ⇒ truyền `false` ở đây là **lật cờ vĩnh viễn trên lane DB**.
      // Cờ đó lái `getCapabilities()`, nên int-spec của BE-7 sẽ phụ thuộc THỨ TỰ CHẠY — đúng lớp
      // `canonical-seed-pin-regression`.
      const isSensitive = resource === "chat-oversight";
      const permId = await seedPermissionCatalog(direct(), action, resource, isSensitive);
      await seedRolePermission(direct(), roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct(), userId, roleId, companyId);
  }

  /** Phòng nhóm qua API THẬT — giữ nguyên đường đi production. */
  async function createRoom(token: string, name: string, members: string[]): Promise<string> {
    const res = await authPost(token, "/chat/rooms").send({ name, memberUserIds: members });
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

  type SearchRow = Record<string, unknown>;
  async function search(token: string, qs: string): Promise<{ status: number; body: SearchRow }> {
    const res = await authGet(token, `/chat/search?${qs}`);
    return { status: res.status, body: res.body as SearchRow };
  }

  async function rowsOf(token: string, qs: string): Promise<SearchRow[]> {
    const res = await search(token, qs);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body.data as { data: SearchRow[] }).data;
  }

  const roomIdsOf = (rows: SearchRow[]): string[] => [
    ...new Set(rows.map((r) => String(r.roomId))),
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    ctx.app = moduleRef.createNestApplication();
    ctx.app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    ctx.app.useGlobalFilters(new AllExceptionsFilter());
    await ctx.app.init();

    ctx.direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);

    A = await seedCompany(ctx.direct, "chatbe4a");
    B = await seedCompany(ctx.direct, "chatbe4b");
    companyIds.push(A.companyId, B.companyId);

    uActor = await seedUser(ctx.direct, A.companyId, `actor@${A.slug}.test`, hash);
    uOther = await seedUser(ctx.direct, A.companyId, `other@${A.slug}.test`, hash);
    uOversight = await seedUser(ctx.direct, A.companyId, `oversight@${A.slug}.test`, hash);
    uB = await seedUser(ctx.direct, B.companyId, `bob@${B.slug}.test`, hash);

    await grantPairs(A.companyId, uActor, "actor", CHAT_PAIRS);
    await grantPairs(A.companyId, uOther, "other", CHAT_PAIRS);
    // Người này có ĐỦ cặp thường + cặp ĐỌC-VƯỢT — ca 9 chứng minh cặp đó không mở tìm kiếm.
    await grantPairs(A.companyId, uOversight, "ovs", [...CHAT_PAIRS, OVERSIGHT_PAIR]);
    await grantPairs(B.companyId, uB, "bob", CHAT_PAIRS);

    tActor = await login(A.slug, `actor@${A.slug}.test`);
    tOversight = await login(A.slug, `oversight@${A.slug}.test`);
    tB = await login(B.slug, `bob@${B.slug}.test`);
    const tOther = await login(A.slug, `other@${A.slug}.test`);

    // P1 — actor là thành viên.
    P1 = await createRoom(tActor, "P1 thành viên", [uOther]);
    await send(tActor, P1, `${KEYWORD_ACCENTED} quý 3`);

    // P2 — actor KHÔNG thuộc (do `uOther` tạo, không mời actor).
    P2 = await createRoom(tOther, "P2 ngoài phạm vi", [uOversight]);
    await send(tOther, P2, `${KEYWORD_ACCENTED} của phòng khác`);

    // P3 — actor ĐÃ RỜI. Gửi tin TRƯỚC khi rời để tin có thật trong phòng.
    P3 = await createRoom(tOther, "P3 đã rời", [uActor]);
    await send(tOther, P3, `${KEYWORD_ACCENTED} trước khi rời`);
    await direct().query(
      `UPDATE chat_room_members SET left_at = now() WHERE room_id = $1 AND user_id = $2`,
      [P3, uActor],
    );

    // P4 — actor LÀ thành viên đang hoạt động, nhưng PHÒNG đã xoá mềm.
    P4 = await createRoom(tOther, "P4 phòng xoá mềm", [uActor]);
    await send(tOther, P4, `${KEYWORD_ACCENTED} trong phòng đã xoá`);
    await direct().query(`UPDATE chat_rooms SET deleted_at = now() WHERE id = $1`, [P4]);

    // Tenant B — cùng từ khoá, để ca cross-tenant có nghĩa.
    roomB = await createRoom(tB, "Phòng tenant B", []);
    await send(tB, roomB, `${KEYWORD_ACCENTED} của tenant B`);
  }, 180_000);

  afterAll(async () => {
    await cleanupTenants(ctx.direct, companyIds);
    await ctx.direct.end();
    await ctx.app.close();
  });

  // ── Ranh giới membership — nhóm quan trọng nhất của WO ────────────────────────

  it("ca 1: không dấu 'bao cao' → CHỈ thấy P1, không thấy P2/P3/P4", async () => {
    const rows = await rowsOf(tActor, "q=bao%20cao");
    expect(rows.length).toBeGreaterThan(0);
    expect(roomIdsOf(rows)).toEqual([P1]);
  });

  it("ca 2: CÓ dấu 'báo cáo' → cùng kết quả ca 1 (f_unaccent áp cả vế truy vấn)", async () => {
    // Quên `f_unaccent` ở vế query thì gõ CÓ DẤU ra 0 kết quả — hỏng theo chiều khó phát hiện nhất:
    // người test gõ không dấu thấy chạy, tưởng xong.
    const rows = await rowsOf(tActor, `q=${encodeURIComponent("báo cáo")}`);
    expect(rows.length).toBeGreaterThan(0);
    expect(roomIdsOf(rows)).toEqual([P1]);
  });

  it("ca 3+4: roomId KHÔNG thuộc và roomId không tồn tại → 404 GIỐNG HỆT NHAU", async () => {
    // Trả mã khác nhau là biến ô tìm kiếm thành oracle dò sự tồn tại của phòng — đúng thứ CHAT-ERR-001
    // dựng 404 để chặn.
    const notMine = await search(tActor, `q=bao%20cao&roomId=${P2}`);
    const ghost = await search(tActor, `q=bao%20cao&roomId=${randomUUID()}`);
    expect(notMine.status).toBe(404);
    expect(ghost.status).toBe(404);

    // So phần MANG THÔNG TIN, bỏ `meta` (chứa `timestamp` biến thiên theo từng request — so cả gói làm
    // ca này đỏ vì lý do không liên quan tới điều nó canh).
    const shape = (b: SearchRow): string => {
      const { meta: _meta, ...rest } = b as { meta?: unknown };
      return JSON.stringify(rest);
    };
    expect(shape(notMine.body), "hai lý do phải KHÔNG phân biệt được").toBe(shape(ghost.body));
    // Và không được kèm `roomId` vào thông điệp — kèm là biến 404 trở lại thành oracle.
    expect(shape(notMine.body)).not.toContain(P2);
  });

  it("ca 5: roomId = P1 → chỉ tin của P1", async () => {
    const rows = await rowsOf(tActor, `q=bao%20cao&roomId=${P1}`);
    expect(roomIdsOf(rows)).toEqual([P1]);
  });

  it("ca 6: actor ĐÃ RỜI P3 → 0 kết quả từ P3", async () => {
    const rows = await rowsOf(tActor, "q=bao%20cao");
    expect(rows.some((r) => r.roomId === P3)).toBe(false);
  });

  it("ca 7: cross-tenant — user tenant B không thấy tin tenant A và ngược lại", async () => {
    const fromB = await rowsOf(tB, "q=bao%20cao");
    expect(roomIdsOf(fromB)).toEqual([roomB]);
    const fromA = await rowsOf(tActor, "q=bao%20cao");
    expect(fromA.some((r) => r.roomId === roomB)).toBe(false);
  });

  it("ca 19: P4 — actor LÀ thành viên nhưng phòng ĐÃ XOÁ MỀM → 0 kết quả", async () => {
    // Ca DUY NHẤT canh được vế `chat_rooms.deleted_at IS NULL`: membership của actor ở P4 vẫn sống, nên
    // gỡ vế đó ra là ca này ĐỎ ngay (các ca khác vẫn xanh vì membership đã loại).
    const rows = await rowsOf(tActor, "q=bao%20cao");
    expect(rows.some((r) => r.roomId === P4)).toBe(false);
  });

  it("ca 20: roomId = phòng của TENANT KHÁC → 404 (trục roomId cũng có vế cross-tenant)", async () => {
    const res = await search(tActor, `q=bao%20cao&roomId=${roomB}`);
    expect(res.status).toBe(404);
  });

  it("ca 9: role có ('view','chat-oversight') — KHÔNG phải SA — vẫn chỉ thấy phòng mình thuộc", async () => {
    // SPEC-15 §20 ca 11 + §3.3: CHAT-DEC-004 **không** mở tìm kiếm. `uOversight` thuộc P2 (không thuộc
    // P1) nên nếu cặp đọc-vượt lọt vào truy vấn thì P1 sẽ xuất hiện ở đây.
    const rows = await rowsOf(tOversight, "q=bao%20cao");
    const rooms = roomIdsOf(rows);
    expect(rooms).toContain(P2);
    expect(rooms).not.toContain(P1);
    expect(rooms).not.toContain(P4);
  });

  // ── Tin đã thu hồi ────────────────────────────────────────────────────────────

  it("ca 8: tin ĐÃ THU HỒI biến mất khỏi kết quả (search_vector vẫn còn sau thu hồi)", async () => {
    const uniq = "matkhauthuhoi";
    const id = await send(tActor, P1, `${uniq} nội dung sẽ thu hồi`);
    expect((await rowsOf(tActor, `q=${uniq}`)).length).toBe(1);

    const recalled = await authPost(tActor, `/chat/messages/${id}/recall`);
    expect(recalled.status, JSON.stringify(recalled.body)).toBe(200);

    // Thu hồi KHÔNG xoá `body` (append-only) ⇒ cột generated vẫn khớp. Mapper che `body` nên nội dung
    // không rò, nhưng SỐ LƯỢNG kết quả thì rò: gõ từng từ khoá và đếm hit là đọc lại được tin đã thu hồi.
    expect(await rowsOf(tActor, `q=${uniq}`)).toEqual([]);
  });

  // ── Validate đầu vào ──────────────────────────────────────────────────────────

  it("ca 10: q quá ngắn — '  a  ' cũng phải trượt (trim TRƯỚC khi đếm)", async () => {
    for (const q of ["a", "%20%20a%20%20", ""]) {
      const res = await search(tActor, `q=${q}`);
      expect(res.status, `q='${q}'`).toBe(400);
    }
    expect(JSON.stringify((await search(tActor, "q=a")).body)).toContain("CHAT-ERR-017");
  });

  it("ca 11: q toàn dấu câu → 200 + rỗng (tsquery rỗng), KHÔNG 500 và KHÔNG trả tất", async () => {
    const res = await search(tActor, `q=${encodeURIComponent("...")}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as { data: SearchRow[] }).data).toEqual([]);
  });

  it("ca 12: q chứa ký tự cú pháp tsquery → 200, không 500", async () => {
    // `to_tsquery` sẽ NÉM ở đây; `websearch_to_tsquery` nuốt. Ca này đóng đinh lựa chọn đó.
    for (const q of ["a & b", "a | b", "!a", "((", "a:*"]) {
      const res = await search(tActor, `q=${encodeURIComponent(q)}`);
      expect(res.status, `q='${q}': ${JSON.stringify(res.body)}`).toBe(200);
    }
  });

  it("ca 12b: q chứa ký tự ĐIỀU KHIỂN → 400, KHÔNG 500", async () => {
    // Đo thật trên lane DB: `websearch_to_tsquery('simple', f_unaccent($1))` với chuỗi chứa NUL ném
    // `22021 invalid byte sequence for encoding "UTF8"` ⇒ 500. Mỗi request như vậy mở rồi rollback một
    // transaction và bơm stack vào log — DoS rẻ tiền trên đúng đường gõ-là-gọi. Chặn ở BIÊN.
    for (const encoded of ["%00ab", "ab%00", "a%01b", "%1Fab"]) {
      const res = await search(tActor, `q=${encoded}`);
      expect(res.status, `q=${encoded}: ${JSON.stringify(res.body)}`).toBe(400);
    }
    // Đối chứng dương: dấu câu thường vẫn PHẢI lọt (ca 11 dựa vào đó để có nghĩa).
    expect((await search(tActor, `q=${encodeURIComponent("a.b")}`)).status).toBe(200);
  });

  it("ca 16+22: limit ngoài khoảng → 400 (51, 0, -1, abc)", async () => {
    for (const limit of ["51", "0", "-1", "abc"]) {
      const res = await search(tActor, `q=bao%20cao&limit=${limit}`);
      expect(res.status, `limit=${limit}`).toBe(400);
    }
  });

  it("ca 14: cursor rác → 400, KHÔNG im lặng rơi về trang đầu", async () => {
    // Rơi về trang đầu biến con trỏ hỏng thành vòng lặp vô hạn ở FE.
    for (const c of ["!!!", "abc", Buffer.from("khong|phai").toString("base64url")]) {
      const res = await search(tActor, `q=bao%20cao&cursor=${encodeURIComponent(c)}`);
      expect(res.status, `cursor='${c}'`).toBe(400);
    }
  });

  // ── Phân trang keyset ─────────────────────────────────────────────────────────

  it("ca 13: hai trang không sót, không lặp; trang cuối nextCursor = null", async () => {
    const uniq = "phantrangkeyset";
    for (let i = 0; i < 3; i += 1) await send(tActor, P1, `${uniq} tin ${i}`);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const qs = `q=${uniq}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await search(tActor, qs);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const payload = res.body.data as { data: SearchRow[]; nextCursor: string | null };
      seen.push(...payload.data.map((r) => String(r.id)));
      cursor = payload.nextCursor;
      if (!cursor) break;
    }
    expect(cursor, "phải kết thúc bằng nextCursor = null").toBeNull();
    expect(seen.length, "không sót").toBe(3);
    expect(new Set(seen).size, "không lặp").toBe(3);
  });

  it("ca 21: 3 tin lệch nhau 1µs trong CÙNG mili-giây → phân trang limit=1 vẫn trả đủ 3", async () => {
    // ⚠️ Ca này KHÔNG tái hiện được bằng đường API: fixture gieo trong một tx có `now()` bằng nhau từng
    // bit. Phải gieo thẳng bằng `directPool` với `created_at` lệch micro-giây.
    //
    // Nếu khoá sắp xếp là `created_at` THÔ mà con trỏ chỉ mang mili-giây, vế `(created_at,id) < ($ms,$id)`
    // loại LUÔN hai hàng còn lại trong chính mili-giây đó ⇒ trang sau sót tin, HTTP 200, không lỗi.
    const uniq = "microgiay";
    const base = "2026-08-03 04:05:06.123456+00";
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (let i = 0; i < ids.length; i += 1) {
      await direct().query(
        `INSERT INTO chat_messages
           (id, company_id, room_id, sender_id, message_type, body, room_seq, created_at)
         VALUES ($1, $2, $3, $4, 'text', $5,
                 (SELECT coalesce(max(room_seq), 0) + 1 FROM chat_messages WHERE room_id = $3),
                 ($6::timestamptz + make_interval(secs => $7::numeric)))`,
        [ids[i], A.companyId, P1, uActor, `${uniq} tin ${i}`, base, i * 0.000001],
      );
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page += 1) {
      const qs = `q=${uniq}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await search(tActor, qs);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const payload = res.body.data as { data: SearchRow[]; nextCursor: string | null };
      seen.push(...payload.data.map((r) => String(r.id)));
      cursor = payload.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size, `phải trả đủ 3 tin lệch µs, nhận ${seen.length}`).toBe(3);
    for (const id of ids) expect(seen).toContain(id);
  });

  it("ca 23: cursor HỢP LỆ của người khác không rò gì (vị từ membership vẫn áp)", async () => {
    // Đây là lý do duy nhất khiến "opaque không cần ký" là an toàn: con trỏ chỉ định VỊ TRÍ, không cấp
    // quyền. `uOversight` thuộc P2; con trỏ của họ đem sang actor phải không mở được P2.
    // ⚠️ P2 phải có ĐỦ ≥2 tin khớp, nếu không `limit=1` cho `hasMore=false` ⇒ `nextCursor=null` ⇒ ca này
    // thoát sớm và **đóng đinh con số không**. Bản đầu đúng như vậy: ca "lý do duy nhất khiến con trỏ
    // opaque không cần ký vẫn an toàn" chưa từng chạy một dòng assert nào.
    await send(tOversight, P2, `${KEYWORD_ACCENTED} tin thứ hai của P2`);

    const ovs = await search(tOversight, "q=bao%20cao&limit=1");
    const cursor = (ovs.body.data as { nextCursor: string | null }).nextCursor;
    expect(cursor, "P2 phải có ≥2 tin khớp thì ca này mới có nghĩa").not.toBeNull();

    const rows = await rowsOf(
      tActor,
      `q=bao%20cao&limit=10&cursor=${encodeURIComponent(cursor as string)}`,
    );
    expect(rows.some((r) => r.roomId === P2)).toBe(false);
  });

  // ── Hình dạng DTO ─────────────────────────────────────────────────────────────

  it("ca 17: kết quả KHÔNG chứa URL ký nào (search không phát URL hàng loạt)", async () => {
    const rows = await rowsOf(tActor, "q=bao%20cao");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("url");
      expect(Object.keys(row)).not.toContain("thumbnailUrl");
      expect(Object.keys(row)).not.toContain("attachments");
      expect(JSON.stringify(row)).not.toContain("X-Amz-Signature");
    }
  });

  it("ca 18: kết quả mang đủ ngữ cảnh để nhảy tới tin (roomId + roomSeq + roomType)", async () => {
    const [row] = await rowsOf(tActor, "q=bao%20cao");
    expect(row.roomId).toBe(P1);
    expect(typeof row.roomSeq).toBe("number");
    expect(row.roomType).toBe("group");
    expect(typeof row.attachmentCount).toBe("number");
    // `seq` toàn cục KHÔNG được phơi — nó rò lưu lượng toàn công ty (lỗ S7-CHAT-DB-2 vừa bịt).
    expect(Object.keys(row)).not.toContain("seq");
  });

  it("ca 24: phòng ĐÃ LƯU TRỮ mà actor vẫn là thành viên → CÓ trong kết quả", async () => {
    // Quyết định tường minh (§1.5b): vẫn là thành viên, FE mở phòng ở chế độ chỉ-đọc. Ghi thành ca test
    // để nó là QUYẾT ĐỊNH chứ không phải tai nạn của một vế ai đó quên.
    const uniq = "phongluutru";
    const arch = await createRoom(tActor, "P5 lưu trữ", [uOther]);
    await send(tActor, arch, `${uniq} trước khi lưu trữ`);
    await direct().query(`UPDATE chat_rooms SET is_archived = true WHERE id = $1`, [arch]);

    const rows = await rowsOf(tActor, `q=${uniq}`);
    expect(roomIdsOf(rows)).toEqual([arch]);
  });
});
