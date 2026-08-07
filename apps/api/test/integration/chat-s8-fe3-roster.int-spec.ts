/**
 * S8-CHAT-UX-FE-3 — **ROSTER** phòng trên đường THẬT (`CHAT-API-007a` · `CHAT-DEC-019`).
 *
 * Phủ bốn mệnh đề mà unit test KHÔNG chứng minh nổi vì chúng nói về SQL thật + pipeline guard:
 *
 *   • **Người ĐÃ RỜI vẫn có trong roster** (kèm `leftAt`) — `listRosterMembers` là hàm DUY NHẤT của repo
 *     cố ý không lọc `left_at IS NULL`. Unit test chỉ chứng minh service map đúng thứ repo trả về; chỉ
 *     câu SQL thật mới chứng minh repo trả về họ.
 *   • **`GET /chat/rooms/:id` vẫn ACTIVE-ONLY** — hai đường, hai ngữ nghĩa. Nếu ai đó "hợp nhất" hai
 *     đường cho gọn thì bộ lọc "đã ở trong phòng" của hộp thêm thành viên sẽ coi người đã rời là thành
 *     viên và **không thêm lại được vào phòng**. Hai vế nằm trong CÙNG một ca, cạnh nhau.
 *   • **Roster KHÔNG nhân bản thành viên** — join `employee_profiles` bắt buộc `deleted_at IS NULL` vì
 *     unique index `employee_profiles_company_user_active_uq` là PARTIAL. Ca dưới dựng đúng tình huống
 *     đó (một hồ sơ đã xoá mềm + một hồ sơ sống của CÙNG user) — trên DB thật, không mock.
 *   • **deny-path**: người ngoài phòng ⇒ 404 mang mã `CHAT-ERR-001`, và phòng-lạ trả phản hồi GIỐNG HỆT.
 *
 * ⚠️ **CHỐNG XANH-GIẢ.** 404 của "route chưa tồn tại" trông y hệt 404 của CHAT-ERR-001 ⇒ ca deny-path
 * assert **mã lỗi trong thân**, không chỉ status.
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
const LOGIN_PW = "Passw0rd!s8fe3roster";
const UNKNOWN_ROOM = "00000000-0000-4000-8000-0000000000fd";

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

interface RosterMember {
  userId: string;
  userName: string | null;
  leftAt: string | null;
  avatarUrl: string | null;
  isOnline?: boolean;
}

describe.skipIf(!hasLaneDb)("S8-CHAT-UX-FE-3 — roster phòng (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];

  let uOwner = "";
  let uMate = "";
  let uGone = "";
  let uOutsider = "";
  let tOwner = "";
  let tOutsider = "";
  let roomId = "";

  async function grantPairs(userId: string, label: string): Promise<void> {
    const roleId = await seedRole(direct, A.companyId, `s8fe3-${label}-${userId.slice(0, 8)}`);
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
  const authGet = (t: string, u: string) => srv().get(u).set("Authorization", `Bearer ${t}`);

  async function roster(token = tOwner): Promise<RosterMember[]> {
    const res = await authGet(token, `/chat/rooms/${roomId}/members`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data as RosterMember[];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "s8fe3roster");
    companyIds.push(A.companyId);

    const mk = (n: string) => seedUser(direct, A.companyId, `${n}@${A.slug}.test`, hash);
    uOwner = await mk("owner");
    uMate = await mk("mate");
    uGone = await mk("gone");
    uOutsider = await mk("outsider");

    // `seedUser` KHÔNG đặt `full_name`. Phải đặt tay, nếu không ca "người đã rời GIỮ NGUYÊN tên" đo
    // một `null` có sẵn từ fixture chứ không đo cái join của roster — nó sẽ đỏ vì lý do sai, hoặc (tệ
    // hơn) xanh oan nếu ai đó nới assert thành `toBeDefined()`.
    await direct.query(`UPDATE users SET full_name = 'Người đã rời' WHERE id = $1`, [uGone]);
    await direct.query(`UPDATE users SET full_name = 'Chủ phòng' WHERE id = $1`, [uOwner]);

    for (const [id, label] of [
      [uOwner, "owner"],
      [uMate, "mate"],
      [uGone, "gone"],
      // Người ngoài có ĐỦ cặp quyền — chỉ KHÔNG phải thành viên. Đó là điều làm ca 404 có nghĩa: nó
      // chứng minh MEMBERSHIP là hàng rào, không phải cặp quyền đang chặn.
      [uOutsider, "outsider"],
    ] as const) {
      await grantPairs(id, label);
    }

    tOwner = await login(`owner@${A.slug}.test`);
    tOutsider = await login(`outsider@${A.slug}.test`);

    const created = await srv()
      .post("/chat/rooms")
      .set("Authorization", `Bearer ${tOwner}`)
      .send({ name: "Phòng roster", memberUserIds: [uMate, uGone] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    roomId = created.body.data.id as string;

    // `uGone` RỜI phòng — đây là chủ thể của CHAT-DEC-019. Đi qua đường thật (`DELETE .../members/:id`)
    // chứ không UPDATE tay: đường thật là thứ đặt `left_at`, và nếu nó đổi thì ca này phải đổi theo.
    const removed = await srv()
      .delete(`/chat/rooms/${roomId}/members/${uGone}`)
      .set("Authorization", `Bearer ${tOwner}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);

    // Hai hồ sơ nhân viên cho CÙNG `uMate`: một đã xoá mềm + một đang sống. Unique index
    // `employee_profiles_company_user_active_uq` là PARTIAL (`WHERE deleted_at IS NULL`) nên trạng thái
    // này HỢP LỆ ở DB — và nó là đúng thứ làm join roster nhân bản nếu thiếu `deleted_at IS NULL`.
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, deleted_at) VALUES ($1, $2, now())`,
      [A.companyId, uMate],
    );
    await direct.query(`INSERT INTO employee_profiles (company_id, user_id) VALUES ($1, $2)`, [
      A.companyId,
      uMate,
    ]);
  }, 180_000);

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.close();
  });

  // ── deny-path (RED trước) ───────────────────────────────────────────────────

  it("người NGOÀI phòng ⇒ 404 CHAT-ERR-001 (không phải 403 — không dò được sự tồn tại)", async () => {
    const res = await authGet(tOutsider, `/chat/rooms/${roomId}/members`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toContain("CHAT-ERR-001");
  });

  it("phòng KHÔNG tồn tại trả phản hồi GIỐNG HỆT phòng-không-thuộc-về-mình", async () => {
    const unknown = await authGet(tOwner, `/chat/rooms/${UNKNOWN_ROOM}/members`);
    const foreign = await authGet(tOutsider, `/chat/rooms/${roomId}/members`);
    expect(unknown.status).toBe(foreign.status);
    expect(unknown.body.error?.code ?? unknown.body.code).toBe(
      foreign.body.error?.code ?? foreign.body.code,
    );
  });

  // ── CHAT-DEC-019 — người đã rời VẪN trong roster ────────────────────────────

  it("roster GỒM người đã rời, kèm `leftAt` khác null và GIỮ NGUYÊN tên", async () => {
    const members = await roster();
    const gone = members.find((m) => m.userId === uGone);
    expect(gone, "người đã rời phải có trong roster (CHAT-DEC-019)").toBeDefined();
    expect(gone?.leftAt).not.toBeNull();
    // Mất tên ⇒ mọi tin CŨ của họ hiện "Người dùng không xác định". So GIÁ TRỊ CỤ THỂ, không
    // `toBeTruthy()`: assert lỏng ở đây sẽ xanh với bất kỳ chuỗi nào, kể cả `userId` bị trả nhầm.
    expect(gone?.userName).toBe("Người đã rời");

    const active = members.filter((m) => m.leftAt === null).map((m) => m.userId);
    expect(active.sort()).toEqual([uOwner, uMate].sort());
  });

  it("`GET /chat/rooms/:id` (detail) VẪN chỉ trả thành viên ĐANG hoạt động", async () => {
    const res = await authGet(tOwner, `/chat/rooms/${roomId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.data.members as Array<{ userId: string }>).map((m) => m.userId);
    // Vế QUYẾT ĐỊNH: người đã rời KHÔNG được lọt vào đây, nếu không hộp "thêm thành viên" coi họ là
    // thành viên và chặn thêm lại — im lặng, không lý do.
    expect(ids).not.toContain(uGone);
    expect(ids.sort()).toEqual([uOwner, uMate].sort());
  });

  // ── join employee_profiles KHÔNG nhân bản ───────────────────────────────────

  it("user có hồ sơ nhân viên ĐÃ XOÁ MỀM + hồ sơ sống ⇒ roster vẫn ĐÚNG 1 hàng cho người đó", async () => {
    // Kiểm tiền đề trước, nếu không ca này có thể xanh vì dữ liệu không dựng được (xanh-giả).
    const profiles = await direct.query(
      `SELECT count(*)::int AS n FROM employee_profiles WHERE company_id = $1 AND user_id = $2`,
      [A.companyId, uMate],
    );
    expect(profiles.rows[0].n, "tiền đề: phải có 2 hồ sơ cho uMate").toBe(2);

    const members = await roster();
    expect(members.filter((m) => m.userId === uMate)).toHaveLength(1);
    // Và roster tổng vẫn đúng 3 người (2 active + 1 đã rời), không nở ra vì join.
    expect(members).toHaveLength(3);
  });

  // ── hình dạng DTO ───────────────────────────────────────────────────────────

  it("`isOnline` LUÔN là boolean và `avatarUrl` KHÔNG BAO GIỜ là giá trị thô", async () => {
    const members = await roster();
    for (const m of members) {
      expect(typeof m.isOnline, `isOnline của ${m.userId}`).toBe("boolean");
      // Chưa ai đặt avatar ⇒ null. Quan trọng hơn: nếu một ngày cột `avatar_url` thô lọt ra thì nó là
      // một UUID trần chứ không phải URL — assert này bắt đúng ca đó.
      if (m.avatarUrl !== null) {
        expect(m.avatarUrl).toMatch(/^https?:\/\//);
      }
    }
  });
});
