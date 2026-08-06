/**
 * S7-CHAT-BE-1 — DENY-PATH của điểm khẳng định membership (SPEC-15 §3.2/§3.3/§12 · API-13 §5.1/§6).
 * Đường THẬT: JwtAuthGuard → PermissionGuard → ChatRoomsController → service → `ChatAccessService`
 * → repository (`withTenant` + `company_id`) → RLS/FORCE. KHÔNG mock permission.
 *
 * ⚠️ CHỦ THỂ TEST KHÔNG ĐƯỢC LÀ SUPER ADMIN. Role SA giữ TOÀN BỘ catalog (sau `0538` là 389/389 nhờ
 * khối F′) nên nó mang luôn cả `('view','chat-oversight')` và sẽ LỌT mọi ca dưới đây — test xanh mà lỗ
 * vẫn mở (memory `superadmin-not-a-canonical-role` · `capability-allowlist-hides-admin-screens`).
 * Chủ thể ở đây là: (a) role thường, (b) role CÓ `('view','chat-room')` @Company nhưng KHÔNG có
 * `('view','chat-oversight')` — tức là kịch bản "quyền rộng nhất mà một người không-SA có thể có".
 *
 * QUY ƯỚC MÃ LỖI CỦA CHAT (NGƯỢC `goals` — đừng "sửa cho giống"):
 *   • không phải thành viên · phòng không tồn tại · tenant khác · đã xoá mềm · đã rời ⇒ **404 GIỐNG HỆT NHAU**;
 *   • ĐÃ là thành viên nhưng thiếu vai trò admin phòng                                 ⇒ **403**.
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`) — chỉ chạy trên DB cô lập lane.
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
const LOGIN_PW = "Passw0rd!chatbe1";

type Scope = "Own" | "Team" | "Department" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

/**
 * Bộ cặp quyền RỘNG NHẤT mà một người KHÔNG-SA có thể giữ ở module này: cả 5 cặp của WO, `@Company`.
 * CỐ Ý KHÔNG có `('view','chat-oversight')` — đó là điều kiện của ca "quyền rộng vẫn không đọc vượt".
 */
const CHAT_FULL: PairGrant[] = [
  ["view", "chat-room", "Company"],
  ["create", "chat-room", "Company"],
  ["update", "chat-room", "Company"],
  ["archive", "chat-room", "Company"],
  ["manage", "chat-member", "Company"],
];

describe.skipIf(!hasLaneDb)("S7-CHAT-BE-1 — membership deny-path (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let uAdmin = ""; // admin của phòng nhóm
  let uMember = ""; // thành viên thường của phòng nhóm
  let uOutsider = ""; // KHÔNG thuộc phòng nào — nhưng giữ CHAT_FULL @Company
  let uLeft = ""; // từng là thành viên, đã rời
  let uB = ""; // người của tenant B

  let tAdmin = "";
  let tMember = "";
  let tOutsider = "";
  let tLeft = "";

  let rGroup = "";
  let rDept = "";
  let rDirect = "";
  let rB = "";

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: PairGrant[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `chat-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  /** Gieo phòng TRỰC TIẾP (bypass service) — dựng lưới đọc/ghi không phụ thuộc đường API. */
  async function seedRoom(
    companyId: string,
    v: {
      roomType: "direct" | "group" | "department" | "project";
      name: string | null;
      code: string;
      directKey?: string | null;
      orgUnitId?: string | null;
      createdBy?: string | null;
    },
  ): Promise<string> {
    const syncSource = v.roomType === "department" ? "department" : "manual";
    const r = await direct.query(
      `INSERT INTO chat_rooms
         (company_id, room_type, name, room_code, sync_source, direct_key, org_unit_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        companyId,
        v.roomType,
        v.name,
        v.code,
        syncSource,
        v.directKey ?? null,
        v.orgUnitId ?? null,
        v.createdBy ?? null,
      ],
    );
    await syncRoomCounter(companyId);
    return r.rows[0].id as string;
  }

  /**
   * Gieo phòng thẳng bằng SQL thì PHẢI đồng bộ counter `chat_room` — nếu không, bất biến của
   * `s7-chat-db1-invariants.int-spec` ("current_value KHÔNG bao giờ thấp hơn số phòng đã cấp mã") ĐỎ
   * khi hai spec chạy chồng lấn trong cùng lane DB. Bất biến đó ĐÚNG và phải giữ: current_value thấp
   * hơn số mã đã cấp nghĩa là `nextCode` sẽ đụng mã cũ ⇒ 23505 ở phòng kế tiếp.
   *
   * Đây là ca "bất biến DB giết fixture đối kháng": lối đúng là MỞ LỐI GIEO CÓ KIỂM SOÁT, không phải
   * nới bất biến hay xoá ca test.
   */
  async function syncRoomCounter(companyId: string): Promise<void> {
    await direct.query(
      `INSERT INTO sequence_counters
         (company_id, module_code, sequence_key, scope_type, prefix, padding_length,
          reset_policy, increment_by, current_value, status)
       VALUES ($1,'CHAT','chat_room','Company','ROOM-',4,'Never',1,0,'Active')
       ON CONFLICT DO NOTHING`,
      [companyId],
    );
    await direct.query(
      `UPDATE sequence_counters sc
          SET current_value = GREATEST(
                sc.current_value,
                (SELECT count(*) FROM chat_rooms cr
                  WHERE cr.company_id = $1 AND cr.room_code IS NOT NULL))
        WHERE sc.company_id = $1 AND sc.sequence_key = 'chat_room'`,
      [companyId],
    );
  }

  async function seedMember(
    companyId: string,
    roomId: string,
    userId: string,
    role: "member" | "admin",
    left = false,
  ): Promise<void> {
    await direct.query(
      `INSERT INTO chat_room_members (company_id, room_id, user_id, role, left_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [companyId, roomId, userId, role, left ? new Date() : null],
    );
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "chatbe1a");
    B = await seedCompany(direct, "chatbe1b");
    companyIds.push(A.companyId, B.companyId);

    const mk = (name: string) => seedUser(direct, A.companyId, `${name}@${A.slug}.test`, hash);
    uAdmin = await mk("radmin");
    uMember = await mk("rmember");
    uOutsider = await mk("outsider");
    uLeft = await mk("left");
    uB = await seedUser(direct, B.companyId, `bob@${B.slug}.test`, hash);

    for (const [u, label] of [
      [uAdmin, "admin"],
      [uMember, "member"],
      [uOutsider, "outsider"],
      [uLeft, "left"],
    ] as const) {
      await grantPairs(A.companyId, u, label, CHAT_FULL);
    }
    await grantPairs(B.companyId, uB, "b", CHAT_FULL);

    const ouRes = await direct.query(
      "INSERT INTO org_units (company_id, name, type) VALUES ($1,'Kinh doanh','department') RETURNING id",
      [A.companyId],
    );
    const orgUnitId = ouRes.rows[0].id as string;

    rGroup = await seedRoom(A.companyId, {
      roomType: "group",
      name: "Nhóm dự án X",
      code: "ROOM-9001",
      createdBy: uAdmin,
    });
    await seedMember(A.companyId, rGroup, uAdmin, "admin");
    await seedMember(A.companyId, rGroup, uMember, "member");
    await seedMember(A.companyId, rGroup, uLeft, "member", true);

    rDept = await seedRoom(A.companyId, {
      roomType: "department",
      name: "Phòng Kinh doanh",
      code: "ROOM-9002",
      orgUnitId,
    });
    await seedMember(A.companyId, rDept, uAdmin, "admin");
    await seedMember(A.companyId, rDept, uMember, "member");

    rDirect = await seedRoom(A.companyId, {
      roomType: "direct",
      name: null,
      code: "ROOM-9003",
      directKey: [uAdmin, uMember].sort().join(":"),
    });
    await seedMember(A.companyId, rDirect, uAdmin, "member");
    await seedMember(A.companyId, rDirect, uMember, "member");

    rB = await seedRoom(B.companyId, {
      roomType: "group",
      name: "Nhóm của tenant B",
      code: "ROOM-9001",
      createdBy: uB,
    });
    await seedMember(B.companyId, rB, uB, "admin");

    tAdmin = await login(A.slug, `radmin@${A.slug}.test`);
    tMember = await login(A.slug, `rmember@${A.slug}.test`);
    tOutsider = await login(A.slug, `outsider@${A.slug}.test`);
    tLeft = await login(A.slug, `left@${A.slug}.test`);
  }, 120_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── Ca 1 + 2: 404 KHÔNG PHÂN BIỆT ĐƯỢC ─────────────────────────────────────

  it("ca 1+2: phòng có thật mà mình không thuộc và phòng KHÔNG tồn tại trả 404 GIỐNG HỆT NHAU", async () => {
    const ghostId = randomUUID();
    const real = await authGet(tOutsider, `/chat/rooms/${rGroup}`);
    const ghost = await authGet(tOutsider, `/chat/rooms/${ghostId}`);

    expect(real.status).toBe(404);
    expect(ghost.status).toBe(404);
    // So sánh THÂN phản hồi: chênh một ký tự là oracle dò sự tồn tại của phòng (CHAT-ERR-001).
    // Chuẩn hoá `meta.timestamp`/`meta.request_id` — hai trường của LỚP ENVELOPE, đổi theo từng request
    // ở MỌI endpoint nên không mang thông tin gì về phòng. Chuẩn hoá cả roomId để nếu sau này có ai đó
    // nhét id vào thân lỗi thì test vẫn không bị lệch VÌ LÝ DO SAI.
    const normalize = (body: unknown, id: string): string =>
      JSON.stringify(body)
        .replace(id, "<id>")
        .replace(/"timestamp":"[^"]*"/, '"timestamp":"<ts>"')
        .replace(/"request_id":"[^"]*"/, '"request_id":"<rid>"');
    expect(normalize(ghost.body, ghostId)).toBe(normalize(real.body, rGroup));
    // Và chốt thêm: thân lỗi KHÔNG chứa roomId dưới bất kỳ dạng nào.
    expect(JSON.stringify(real.body)).not.toContain(rGroup);
  });

  it("ca 3: roomId của TENANT KHÁC → 404 (không bao giờ lộ tồn tại chéo tenant)", async () => {
    const res = await authGet(tAdmin, `/chat/rooms/${rB}`);
    expect(res.status).toBe(404);
  });

  it("ca 4: người đã left_at đọc phòng cũ → 404 (thiếu vế left_at IS NULL là lỗ đọc-sau-khi-rời)", async () => {
    const res = await authGet(tLeft, `/chat/rooms/${rGroup}`);
    expect(res.status).toBe(404);

    const list = await authGet(tLeft, "/chat/rooms");
    expect(list.status).toBe(200);
    expect((list.body.data as { id: string }[]).map((r) => r.id)).not.toContain(rGroup);
  });

  /**
   * Quét TOÀN BỘ bề mặt của WO bằng roomId của tenant khác VÀ roomId mình không thuộc. Một endpoint quên
   * `assertMember` là lỗ, và lỗ đó không lộ ra ở ca đọc chi tiết — phải bắn hết.
   */
  it("ca 3b: MỌI endpoint nhận roomId đều 404 với phòng tenant khác + phòng mình không thuộc", async () => {
    const targets = [rB, rGroup]; // rB = tenant khác · rGroup = cùng tenant nhưng outsider không thuộc
    for (const roomId of targets) {
      const calls = [
        authGet(tOutsider, `/chat/rooms/${roomId}`),
        authGet(tOutsider, `/chat/rooms/${roomId}/members`),
        authPatch(tOutsider, `/chat/rooms/${roomId}`).send({ name: "đổi trộm" }),
        authPost(tOutsider, `/chat/rooms/${roomId}/archive`),
        authPost(tOutsider, `/chat/rooms/${roomId}/leave`),
        authPost(tOutsider, `/chat/rooms/${roomId}/members`).send({ userId: uOutsider }),
        authPatch(tOutsider, `/chat/rooms/${roomId}/members/${uMember}`).send({ role: "admin" }),
        authDelete(tOutsider, `/chat/rooms/${roomId}/members/${uMember}`),
      ];
      for (const res of await Promise.all(calls)) {
        expect(
          res.status,
          `${res.request.method} ${res.request.url} với room ${roomId}: ${JSON.stringify(res.body)}`,
        ).toBe(404);
      }
    }
  });

  // ── Ca 5: 403 khi ĐÃ là thành viên nhưng không phải admin phòng ─────────────

  it("ca 5: thành viên KHÔNG phải admin phòng → 403 (không giấu — đã biết phòng tồn tại)", async () => {
    const calls = [
      authPatch(tMember, `/chat/rooms/${rGroup}`).send({ name: "tên mới" }),
      authPost(tMember, `/chat/rooms/${rGroup}/archive`),
      authPost(tMember, `/chat/rooms/${rGroup}/members`).send({ userId: uOutsider }),
      authPatch(tMember, `/chat/rooms/${rGroup}/members/${uAdmin}`).send({ role: "member" }),
      authDelete(tMember, `/chat/rooms/${rGroup}/members/${uAdmin}`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status, `${res.request.method} ${res.request.url}`).toBe(403);
      expect(JSON.stringify(res.body)).toContain("CHAT-ERR-001");
    }
  });

  it("ca 5b: cặp quyền @Company KHÔNG thay được membership — outsider vẫn 404 dù giữ cả 5 cặp", async () => {
    // Đây là mệnh đề trung tâm của SPEC-15 §3.2. `uOutsider` có `view/create/update/archive:chat-room`
    // + `manage:chat-member` ở phạm vi Company — rộng hơn mọi nhân viên thường — mà vẫn không vào được.
    const res = await authGet(tOutsider, `/chat/rooms/${rGroup}/members`);
    expect(res.status).toBe(404);
  });

  // ── Ca 6/7/8: luật nghiệp vụ ───────────────────────────────────────────────

  it("ca 6: thao tác thành viên trên phòng DẪN XUẤT (department) → CHAT-ERR-012", async () => {
    const add = await authPost(tAdmin, `/chat/rooms/${rDept}/members`).send({ userId: uOutsider });
    expect(add.status).toBe(422);
    expect(JSON.stringify(add.body)).toContain("CHAT-ERR-012");

    const rename = await authPatch(tAdmin, `/chat/rooms/${rDept}`).send({ name: "Đổi tên tay" });
    expect(rename.status).toBe(422);
    expect(JSON.stringify(rename.body)).toContain("CHAT-ERR-012");

    // CẢ BỐN đường ghi thủ công, không chỉ đường "thêm": phong vai trò và bớt người cũng phải bị chặn,
    // nếu không thì thành viên dẫn xuất vẫn sửa được bằng hai lối còn lại.
    const role = await authPatch(tAdmin, `/chat/rooms/${rDept}/members/${uMember}`).send({
      role: "admin",
    });
    expect(role.status).toBe(422);
    expect(JSON.stringify(role.body)).toContain("CHAT-ERR-012");

    const drop = await authDelete(tAdmin, `/chat/rooms/${rDept}/members/${uMember}`);
    expect(drop.status).toBe(422);
    expect(JSON.stringify(drop.body)).toContain("CHAT-ERR-012");

    const archive = await authPost(tAdmin, `/chat/rooms/${rDept}/archive`);
    expect(archive.status).toBe(422);
    expect(JSON.stringify(archive.body)).toContain("CHAT-ERR-012");
  });

  it("ca 7: rời phòng direct/department → CHAT-ERR-013 (chỉ phòng nhóm mới rời được)", async () => {
    for (const roomId of [rDirect, rDept]) {
      const res = await authPost(tAdmin, `/chat/rooms/${roomId}/leave`);
      expect(res.status, `leave ${roomId}`).toBe(422);
      expect(JSON.stringify(res.body)).toContain("CHAT-ERR-013");
    }
  });

  it("ca 7b: thao tác thành viên trên phòng direct cũng bị chặn (2 người CỐ ĐỊNH)", async () => {
    const res = await authPost(tAdmin, `/chat/rooms/${rDirect}/members`).send({
      userId: uOutsider,
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-012");
  });

  it("ca 8: bớt / hạ cấp / để-rời admin CUỐI CÙNG → CHAT-ERR-011 (cả ba đường)", async () => {
    const remove = await authDelete(tAdmin, `/chat/rooms/${rGroup}/members/${uAdmin}`);
    expect(remove.status).toBe(422);
    expect(JSON.stringify(remove.body)).toContain("CHAT-ERR-011");

    const demote = await authPatch(tAdmin, `/chat/rooms/${rGroup}/members/${uAdmin}`).send({
      role: "member",
    });
    expect(demote.status).toBe(422);
    expect(JSON.stringify(demote.body)).toContain("CHAT-ERR-011");

    const leave = await authPost(tAdmin, `/chat/rooms/${rGroup}/leave`);
    expect(leave.status).toBe(422);
    expect(JSON.stringify(leave.body)).toContain("CHAT-ERR-011");
  });

  it("thêm người ĐÃ là thành viên → CHAT-ERR-011; thêm user tenant khác → CHAT-ERR-003", async () => {
    const dup = await authPost(tAdmin, `/chat/rooms/${rGroup}/members`).send({ userId: uMember });
    expect(dup.status).toBe(422);
    expect(JSON.stringify(dup.body)).toContain("CHAT-ERR-011");

    // FK `user_id → users.id` là FK MỘT CỘT và kiểm tra FK BỎ QUA RLS ⇒ chỉ lớp app chặn được ca này.
    const cross = await authPost(tAdmin, `/chat/rooms/${rGroup}/members`).send({ userId: uB });
    expect(cross.status).toBe(422);
    expect(JSON.stringify(cross.body)).toContain("CHAT-ERR-003");

    const rows = await direct.query(
      "SELECT count(*)::int AS n FROM chat_room_members WHERE room_id = $1 AND user_id = $2",
      [rGroup, uB],
    );
    expect(rows.rows[0].n, "user tenant khác KHÔNG được chèn vào phòng").toBe(0);
  });

  it("mở DM với CHÍNH MÌNH → CHAT-ERR-003; với user tenant khác → CHAT-ERR-003", async () => {
    const self = await authPost(tAdmin, "/chat/rooms/direct").send({ peerUserId: uAdmin });
    expect(self.status).toBe(422);
    expect(JSON.stringify(self.body)).toContain("CHAT-ERR-003");

    const cross = await authPost(tAdmin, "/chat/rooms/direct").send({ peerUserId: uB });
    expect(cross.status).toBe(422);
    expect(JSON.stringify(cross.body)).toContain("CHAT-ERR-003");
  });

  // ── Ca 14: MỘT điểm khẳng định, chứng minh bằng chính mã nguồn ──────────────

  describe("ca 14 — `assertMember` là ĐƯỜNG DUY NHẤT (kiểm trên mã nguồn)", () => {
    const chatDir = join(__dirname, "..", "..", "src", "chat");
    const readAll = (): { file: string; src: string }[] =>
      readdirSync(chatDir)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => ({ file: f, src: readFileSync(join(chatDir, f), "utf8") }));

    /**
     * Bỏ chú thích trước khi quét. Module này CỐ Ý viết dày ghi chú, và ghi chú nhắc đúng những từ khoá
     * ta đang cấm ("`isOversight`" trong lời giải thích vì sao KHÔNG có cửa hậu). Quét cả comment thì
     * test đỏ vì tài liệu — và cách sửa rẻ nhất lúc đó là XOÁ lời cảnh báo, tức là test tự phá thứ nó
     * canh (memory `guard-immutability-matches-comments`).
     */
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    /**
     * S7-CHAT-BE-2 mở rộng: module giờ có HAI cửa vào — `assertMember` (theo `roomId`) và
     * `assertMessageAccess` (theo `messageId`) — cộng predicate dùng chung `activeMembershipJoin`.
     * Cả ba PHẢI ở đúng một file; tách ra là "một điểm khẳng định" chỉ còn đúng trên giấy.
     */
    it("chỉ ĐÚNG MỘT file định nghĩa hai cửa vào membership + predicate dùng chung", () => {
      for (const fn of ["assertMember", "assertMessageAccess", "activeMembershipJoin"]) {
        const definers = readAll().filter((f) =>
          new RegExp(`(private\\s+)?(async\\s+)?${fn}\\s*\\(`).test(
            stripComments(f.src).replace(new RegExp(`(this\\.|\\.)${fn}\\s*\\(`, "g"), ""),
          ),
        );
        expect(
          definers.map((x) => x.file),
          `nơi ĐỊNH NGHĨA ${fn}`,
        ).toEqual(["chat-access.service.ts"]);
      }
    });

    /**
     * NGOẠI LỆ DUY NHẤT của luật "method public nhận `roomId` phải qua điểm khẳng định membership".
     *
     * `chat-oversight.service.ts` (`S7-CHAT-BE-7` · CHAT-DEC-004, owner chốt 02/08/2026) **CỐ Ý** không
     * gọi `assertMember` — đó là chức năng của nó, không phải lỗ. Nó trả giá bằng một ràng buộc KHÁC và
     * mạnh hơn, được canh ở `chat-be7-oversight.int-spec.ts`: MỌI hàm public phải ghi `audit_logs` trong
     * CÙNG transaction với truy vấn đọc, TRƯỚC khi dữ liệu rời server (CHAT-ERR-020) — ca ngay dưới ép
     * điều đó trên chính mã nguồn.
     *
     * ⚠️ **DANH SÁCH ĐÓNG.** Ca "rổ miễn trừ đúng một file" bên dưới làm ĐỎ ngay khi ai đó thêm file thứ
     * hai. Không có nó thì miễn trừ này là cửa sau: WO sau chỉ cần thêm một tên vào mảng là thoát lưới.
     */
    const MEMBERSHIP_EXEMPT_SERVICES = ["chat-oversight.service.ts"];

    it("rổ miễn trừ membership ĐÚNG MỘT file — thêm file thứ hai là mở cửa sau", () => {
      expect(MEMBERSHIP_EXEMPT_SERVICES).toEqual(["chat-oversight.service.ts"]);
      // Và file đó phải TỒN TẠI: rổ trỏ vào một file đã bị xoá/đổi tên thì luật chính đang miễn cho hư vô.
      expect(readAll().map((f) => f.file)).toContain("chat-oversight.service.ts");
    });

    it("file được MIỄN membership phải ghi audit ở MỌI method public nhận `roomId` (giá phải trả)", () => {
      // Miễn `assertMember` mà không ghi audit = đường đọc toàn tenant KHÔNG DẤU VẾT. Ca này là vế thứ
      // hai của cặp: một method public mới thêm vào service đọc-vượt mà quên audit sẽ ĐỎ ở đây.
      const src = stripComments(
        readAll().find((f) => f.file === "chat-oversight.service.ts")?.src ?? "",
      );
      const gaps: string[] = [];
      let counted = 0;
      for (const body of src.split(/\n {2}async /).slice(1)) {
        const head = body.split("\n")[0];
        if (!/roomId\s*:\s*string/.test(body.slice(0, body.indexOf("{")))) continue;
        counted += 1;
        if (!body.includes("recordSuccess(")) gaps.push(head.trim());
      }
      expect(
        counted,
        "phải quét được method public nhận roomId (0 = cách cắt hỏng)",
      ).toBeGreaterThan(0);
      expect(gaps, "method đọc-vượt nhận roomId mà KHÔNG ghi audit").toEqual([]);
    });

    it("MỌI method PUBLIC của service nhận `roomId` đều gọi assertMember (trực tiếp hoặc qua cổng ghi)", () => {
      const gaps: string[] = [];
      const publicMethods: string[] = [];

      /** Gọi THẲNG một trong hai cửa vào membership. */
      const assertsDirectly = (body: string): boolean =>
        body.includes("assertMember(") || body.includes("assertMessageAccess(");

      for (const { file, src } of readAll()) {
        if (!file.endsWith(".service.ts") || file === "chat-access.service.ts") continue;
        if (MEMBERSHIP_EXEMPT_SERVICES.includes(file)) continue;
        const clean = stripComments(src);

        // ─────────────────────────────────────────────────────────────────────────────────────────
        // S8-CHAT-UX-BE-3 — LẦN THEO MỘT CẤP GIÁN TIẾP thay vì tin vào một danh sách tên hard-code.
        //
        // Bản trước chỉ nhận `assertMember(` · `assertMessageAccess(` · `assertRoomAdminForWrite(`,
        // trong đó tên thứ ba là một cổng ghi CÓ THẬT nhưng được ghi cứng. Hệ quả: mọi service sau này
        // gói ba cổng của mình vào một helper riêng (đúng thực hành) sẽ ĐỎ, và cách sửa rẻ nhất lúc đó
        // là **thêm tên vào danh sách** — tức mỗi WO tự cấp cho mình một ô miễn trừ mới, và cái lưới
        // mục ruỗng dần đúng theo cách `MEMBERSHIP_EXEMPT_SERVICES` cảnh báo ở trên.
        //
        // Thay vào đó: thu thập MỌI helper trong CÙNG FILE có gọi cửa vào membership, rồi coi một
        // method public là hợp lệ nếu nó gọi một trong các helper đó. Luật giữ nguyên ("phải đi qua
        // điểm khẳng định"), chỉ bỏ đi giả định sai rằng lời gọi luôn nằm ngay trong thân method.
        // Đúng MỘT cấp: helper-của-helper-của-helper thì lưới không đọc nổi, và một chuỗi gián tiếp
        // dài như thế đáng bị viết lại chứ không đáng được lưới nới cho.
        // ─────────────────────────────────────────────────────────────────────────────────────────
        // ⚠️ Cắt theo VỊ TRÍ khai báo, KHÔNG bằng `split` với hai nhóm optional: `\n {2}(private )?(async )?`
        // khớp cả một dòng thụt 2 dấu cách bất kỳ, nên mọi "thân method" thu được chỉ còn ĐÚNG MỘT DÒNG
        // và không helper nào bị nhận là có gọi cửa vào. Bản đầu của khối này mắc đúng lỗi đó — lưới
        // trông vẫn chạy, chỉ là nó không thấy gì.
        // ⚠️ Thân method cắt theo VỊ TRÍ KHAI BÁO KẾ TIẾP, cho CẢ hai vế.
        //
        // Bản trước cắt bằng `clean.split(/\n {2}async /)` — chỉ tách ở method PUBLIC, nên thân của
        // method public CUỐI CÙNG nuốt trọn mọi helper `private` nằm dưới nó. Hệ quả đo được
        // (06/08/2026, khi cấy thử một method public không gác gì): nó "thấy" lời gọi
        // `assertMessageAccess` nằm trong thân một helper KHÁC và được coi là hợp lệ — lưới PASS OAN.
        // Lỗi này có sẵn từ trước và bị che vì chuỗi kiểm khi đó hẹp hơn; nó chỉ lộ khi thêm method.
        const decls = [
          ...clean.matchAll(/\n {2}(private\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g),
        ];
        const bodyOf = (i: number): string =>
          clean.slice(decls[i].index ?? 0, decls[i + 1]?.index ?? clean.length);

        const gateHelpers = new Set<string>(["assertRoomAdminForWrite"]);
        decls.forEach((d, i) => {
          if (assertsDirectly(bodyOf(i))) gateHelpers.add(d[2]);
        });

        decls.forEach((d, i) => {
          // `private` KHÔNG phải chủ thể của luật: helper nội bộ chạy SAU cổng.
          if (d[1]) return;
          const body = bodyOf(i);
          const head = body.split("\n")[0];
          const signature = body.slice(0, body.indexOf("{"));
          const takesRoom = /roomId\s*:\s*string/.test(signature);
          const takesMessage = /messageId\s*:\s*string/.test(signature);
          if (!takesRoom && !takesMessage) return;
          publicMethods.push(`${file} › ${head.trim()}`);
          // Chỉ nhận `this.<gate>(` — `<gate>(` trần sẽ khớp cả một lời gọi trùng tên trên đối tượng
          // khác (vd `this.repo.aggregateForMessages(`), tức lại nới lưới bằng một trùng hợp chuỗi.
          const asserts =
            assertsDirectly(body) || [...gateHelpers].some((h) => body.includes(`this.${h}(`));
          if (!asserts) gaps.push(`${file} › ${head.trim()}`);
        });
      }
      // Chống test rỗng-nên-xanh: cách cắt method hỏng (đổi khuôn class/thụt lề) thì danh sách rỗng và
      // `toEqual([])` PASS oan. Neo bằng SÀN đã đếm tay: BE-1 có 8 (4 phòng + 4 thành viên), BE-2 thêm 7
      // (4 nhận roomId + 3 nhận messageId) ⇒ ≥15. Dùng sàn để WO sau thêm endpoint không phải sửa test,
      // nhưng GỠ endpoint khỏi lưới thì vẫn đỏ.
      expect(
        publicMethods.length,
        `method public nhận roomId/messageId: ${publicMethods.join(" | ")}`,
      ).toBeGreaterThanOrEqual(15);
      expect(gaps, "method nhận roomId/messageId mà KHÔNG qua điểm khẳng định").toEqual([]);
    });

    it("KHÔNG file nào ngoài chat-access.service.ts dựng lại BỘ ĐIỀU KIỆN truy cập phòng", () => {
      // Bộ điều kiện truy cập = `chat_rooms.deleted_at IS NULL` GHÉP với `chat_room_members.left_at IS
      // NULL`. Từng vế riêng lẻ là hợp lệ ở nơi khác (danh sách phòng tự-bound theo actor, danh sách
      // thành viên đang hoạt động); GHÉP CẢ HAI trong một file khác nghĩa là có bản sao thứ hai của
      // luật truy cập — đúng thứ WO này tồn tại để không có.
      const offenders = readAll()
        .filter((f) => f.file !== "chat-access.service.ts")
        .map((f) => ({ file: f.file, src: stripComments(f.src) }))
        .filter(
          (f) =>
            /isNull\(\s*chatRooms\.deletedAt\s*\)/.test(f.src) &&
            /isNull\(\s*chatRoomMembers\.leftAt\s*\)/.test(f.src) &&
            /eq\(\s*chatRoomMembers\.userId\s*,\s*(actorUserId|actor\.id)\s*\)/.test(f.src),
        )
        .map((f) => f.file);
      expect(offenders).toEqual([]);
    });

    it("KHÔNG cờ/tham số nào cho phép bỏ qua membership (đường đọc-vượt là WO RIÊNG BE-7)", () => {
      const forbidden = /isOversight|skipMembership|bypassMember|allowNonMember|asAdminOverride/i;
      const hits = readAll()
        .filter((f) => forbidden.test(stripComments(f.src)))
        .map((f) => f.file);
      expect(hits, "cửa sau bỏ qua membership trong module CHAT").toEqual([]);
    });

    it("route `/chat/oversight/*` chỉ sống ở ĐÚNG MỘT controller riêng (không lẫn vào đường đọc thường)", () => {
      // Bản đầu (trước `S7-CHAT-BE-7`) khẳng định "0 route oversight trong module" — đúng khi đường
      // đọc-vượt chưa được thi công. Nay CHAT-DEC-004 đã có code, luật thật là chặt HƠN chứ không lỏng
      // hơn: các route đó phải nằm gọn trong `chat-oversight.controller.ts`. Một route oversight xuất
      // hiện ở `chat-rooms.controller.ts`/`chat-messages.controller.ts` là mất tính chất "đường đọc
      // thường gọi `assertMember` vô điều kiện" (API-13 §5.3 ràng buộc 1).
      const OVERSIGHT_CONTROLLER = "chat-oversight.controller.ts";
      const withOversightRoutes = readAll()
        .map((f) => ({ file: f.file, src: stripComments(f.src) }))
        .filter((f) => /@(Get|Post|Patch|Delete|Put)\(["'`][^"'`]*oversight/i.test(f.src))
        .map((f) => f.file);
      expect(withOversightRoutes).toEqual([OVERSIGHT_CONTROLLER]);

      // Và controller đó CHỈ ĐỌC — không biến thể ghi (ràng buộc 4). Nếu ca trên trở thành `[]` vì file
      // bị xoá thì `toEqual([OVERSIGHT_CONTROLLER])` đã đỏ trước, nên đây là vế bổ sung chứ không lưới đơn.
      const controllerSrc = stripComments(
        readAll().find((f) => f.file === OVERSIGHT_CONTROLLER)?.src ?? "",
      );
      expect(controllerSrc).not.toMatch(/@(Post|Patch|Delete|Put)\(/);
    });
  });
});
