/**
 * S11-ROOM-BE-1 — deny-path + cross-tenant + data-scope Own/Company của module ROOM
 * (SPEC-14 §11/§13.3/§13.6 · API-15 §5.1/§7.4 · plan `docs/plans/S11-ROOM-BE-1.md` §7.1).
 *
 * Đường THẬT: JwtAuthGuard → PermissionGuard → controller → service (data-scope ép Ở SERVICE, KHÔNG RLS) →
 * repository (withTenant + company_id) → RLS/FORCE. KHÔNG mock permission, KHÔNG super-admin (tautology —
 * memory `superadmin-not-a-canonical-role`).
 *
 * QUY ƯỚC MÃ LỖI ROOM (KHÁC ASSET — lịch là dữ liệu CÔNG KHAI trong company, SPEC-14 §11):
 *   · thiếu cặp quyền HOÀN TOÀN (PermissionGuard chặn trước service)  ⇒ 403 `AUTH-ERR-FORBIDDEN`
 *   · có cặp nhưng NGOÀI scope GHI (`book`/`cancel`)                  ⇒ 403 (`ROOM-ERR-010` / `AUTH-ERR-SCOPE-DENIED`)
 *   · chéo tenant (mọi route, kể cả actor @Company)                   ⇒ 404 `ROOM-ERR-NOT-FOUND`
 *
 * Mỗi ca DENY có ca ALLOW đối chứng (memory `deny-cases-vacuous-without-allow-case`).
 * GATE CỨNG `hasDb && LANE_DB` — chỉ chạy trên DB cô lập lane (memory `integration-test-lane-db-gate`).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseRoomConflictsDetail } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
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
const LOGIN_PW = loginPasswordFixture("s11room1");

type Scope = "Own" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

/** SPEC-14 §11 — office-admin: `access`@Own, 4 cặp còn lại @Company. */
const ROOM_OFFICE_ADMIN: PairGrant[] = [
  ["access", "room", "Own"],
  ["view", "room", "Company"],
  ["book", "room", "Company"],
  ["cancel", "room-booking", "Company"],
  ["manage", "room", "Company"],
];
/** employee/manager/hr: `access`@Own, `view`@Company, `book`@Own, `cancel`@Own. */
const ROOM_EMPLOYEE: PairGrant[] = [
  ["access", "room", "Own"],
  ["view", "room", "Company"],
  ["book", "room", "Own"],
  ["cancel", "room-booking", "Own"],
];
/** Chỉ xem lịch — KHÔNG đặt/huỷ. */
const ROOM_VIEW_ONLY: PairGrant[] = [
  ["access", "room", "Own"],
  ["view", "room", "Company"],
];
/** Role tuỳ biến: `book`/`cancel` mà KHÔNG `view` — nhánh fail-closed của điểm chiếu danh tính (gate H1). */
const ROOM_BOOK_NO_VIEW: PairGrant[] = [
  ["access", "room", "Own"],
  ["book", "room", "Own"],
  ["cancel", "room-booking", "Own"],
];
/** Role tuỳ biến: `view` ở scope Own — đường đọc phải TỪ CHỐI (gate M4, SPEC-14 §13.6). */
const ROOM_VIEW_OWN: PairGrant[] = [
  ["access", "room", "Own"],
  ["view", "room", "Own"],
];
/** `np` KHÔNG có cặp nào — kể cả `access` (SPEC-14 §11 ghi chú "NONE"). */

type ErrDetail = { field: string; message: string; rule?: string };

function kindOf(res: request.Response): string | undefined {
  const details = res.body?.error?.details as ErrDetail[] | undefined;
  return details?.find((d) => d.field === "kind")?.message;
}

describe.skipIf(!hasLaneDb)(
  "S11-ROOM-BE-1 scope Own/Company + cross-tenant + deny-path (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let oaUser = ""; // office-admin @A — 5 cặp
    let e1User = ""; // employee @A — book/cancel Own, CÓ employee_profiles
    let e2User = ""; // employee @A — book/cancel Own, KHÔNG có employee_profiles
    let voUser = ""; // view-only @A — chỉ view
    let bnUser = ""; // book/cancel KHÔNG view @A (gate H1)
    let vwUser = ""; // view@Own @A (gate M4)
    let cbUser = ""; // office-admin-tương-đương @B (cross-tenant)

    let tOa = "";
    let tE1 = "";
    let tE2 = "";
    let tVo = "";
    let tNp = "";
    let tBn = "";
    let tVw = "";
    let tCb = "";

    let rMain = ""; // phòng dùng chung cho các ca đọc/scope (không chạm chống-trùng — booking spec riêng lo)
    let rCrossB = ""; // phòng của B

    let slotCounter = 0;
    /** Slot tương lai KHÔNG BAO GIỜ trùng nhau trong cả file (offset tăng dần mỗi lần gọi). */
    function nextSlot(durMin = 60): { startsAt: string; endsAt: string } {
      const offsetMin = 180 + slotCounter * 120;
      slotCounter += 1;
      const start = new Date(Date.now() + offsetMin * 60_000);
      const end = new Date(start.getTime() + durMin * 60_000);
      return { startsAt: start.toISOString(), endsAt: end.toISOString() };
    }

    const http = () => request(app.getHttpServer());
    const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
    const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
    const patch = (t: string, u: string) => http().patch(u).set("Authorization", `Bearer ${t}`);
    const del = (t: string, u: string) => http().delete(u).set("Authorization", `Bearer ${t}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
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
      const roleId = await seedRole(direct, companyId, `room-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    async function seedEmp(companyId: string, userId: string, code: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, status, employee_code)
         VALUES ($1,$2,'active',$3) RETURNING id`,
        [companyId, userId, code],
      );
      return r.rows[0].id as string;
    }

    async function newRoom(
      token: string,
      name: string,
      extra: Record<string, unknown> = {},
    ): Promise<string> {
      const res = await post(token, "/rooms").send({ name, capacity: 10, ...extra });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    }

    async function bookRoom(
      token: string,
      roomId: string,
      extra: Record<string, unknown> = {},
    ): Promise<{ id: string; body: Record<string, unknown> }> {
      const slot = nextSlot();
      const res = await post(token, "/room-bookings").send({
        roomId,
        title: "Họp",
        ...slot,
        ...extra,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return { id: res.body.data.id as string, body: res.body.data };
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      await app.listen(0);

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "room1a");
      B = await seedCompany(direct, "room1b");
      companyIds.push(A.companyId, B.companyId);

      const mk = (name: string) => seedUser(direct, A.companyId, `${name}@${A.slug}.test`, hash);
      oaUser = await mk("oa");
      e1User = await mk("e1");
      e2User = await mk("e2");
      voUser = await mk("vo");
      await mk("np"); // KHÔNG cặp nào — chỉ cần token
      bnUser = await mk("bn");
      vwUser = await mk("vw");
      cbUser = await seedUser(direct, B.companyId, `cb@${B.slug}.test`, hash);
      await direct.query("UPDATE users SET full_name = $2 WHERE id = $1", [bnUser, "Người đặt BN"]);

      await direct.query("UPDATE users SET full_name = $2 WHERE id = $1", [e1User, "Nhân viên E1"]);
      await direct.query("UPDATE users SET full_name = $2 WHERE id = $1", [e2User, "Nhân viên E2"]);
      await direct.query("UPDATE users SET full_name = $2 WHERE id = $1", [
        oaUser,
        "Quản trị Văn phòng",
      ]);

      await seedEmp(A.companyId, e1User, "NV-E1");
      // e2 KHÔNG có employee_profiles — chứng minh vẫn có displayName, employeeCode=null (SPEC-14 §22e).

      await grantPairs(A.companyId, oaUser, "oa", ROOM_OFFICE_ADMIN);
      await grantPairs(A.companyId, e1User, "e1", ROOM_EMPLOYEE);
      await grantPairs(A.companyId, e2User, "e2", ROOM_EMPLOYEE);
      await grantPairs(A.companyId, voUser, "vo", ROOM_VIEW_ONLY);
      await grantPairs(A.companyId, bnUser, "bn", ROOM_BOOK_NO_VIEW);
      await grantPairs(A.companyId, vwUser, "vw", ROOM_VIEW_OWN);
      // npUser: KHÔNG grant gì cả.
      await grantPairs(B.companyId, cbUser, "cb", ROOM_OFFICE_ADMIN);

      tOa = await login(A.slug, `oa@${A.slug}.test`);
      tE1 = await login(A.slug, `e1@${A.slug}.test`);
      tE2 = await login(A.slug, `e2@${A.slug}.test`);
      tVo = await login(A.slug, `vo@${A.slug}.test`);
      tNp = await login(A.slug, `np@${A.slug}.test`);
      tBn = await login(A.slug, `bn@${A.slug}.test`);
      tVw = await login(A.slug, `vw@${A.slug}.test`);
      tCb = await login(B.slug, `cb@${B.slug}.test`);

      rMain = await newRoom(tOa, "Phòng Scope Main");
      rCrossB = await newRoom(tCb, "Phòng B Cross");
    }, 120_000);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── A. thiếu cặp quyền ⇒ 403 (mỗi DENY có ALLOW) ───────────────────────────

    describe("A. thiếu cặp quyền ⇒ 403 AUTH-ERR-FORBIDDEN; có cặp ⇒ qua", () => {
      it("view: np (0 cặp) GET /rooms ⇒ 403; oa (view@Company) ⇒ 200", async () => {
        const deny = await get(tNp, "/rooms");
        expect(deny.status, JSON.stringify(deny.body)).toBe(403);
        expect(deny.body.error.code).toBe("AUTH-ERR-FORBIDDEN");
        const allow = await get(tOa, "/rooms");
        expect(allow.status, JSON.stringify(allow.body)).toBe(200);
      });

      it("manage: e1 (không có manage) POST /rooms ⇒ 403; oa ⇒ 201", async () => {
        const deny = await post(tE1, "/rooms").send({ name: "X-manage-deny", capacity: 4 });
        expect(deny.status, JSON.stringify(deny.body)).toBe(403);
        expect(deny.body.error.code).toBe("AUTH-ERR-FORBIDDEN");
        await newRoom(tOa, `X-manage-allow-${Date.now()}`);
      });

      it("book: vo (không có book) POST /room-bookings ⇒ 403; e1 ⇒ 201", async () => {
        const slot = nextSlot();
        const deny = await post(tVo, "/room-bookings").send({ roomId: rMain, title: "x", ...slot });
        expect(deny.status, JSON.stringify(deny.body)).toBe(403);
        expect(deny.body.error.code).toBe("AUTH-ERR-FORBIDDEN");
        await bookRoom(tE1, rMain);
      });

      it("cancel: vo (không có cancel) POST /room-bookings/:id/cancel ⇒ 403; e1 huỷ lượt mình ⇒ 200", async () => {
        const booking = await bookRoom(tE1, rMain);
        const deny = await post(tVo, `/room-bookings/${booking.id}/cancel`).send({});
        expect(deny.status, JSON.stringify(deny.body)).toBe(403);
        expect(deny.body.error.code).toBe("AUTH-ERR-FORBIDDEN");
        const allow = await post(tE1, `/room-bookings/${booking.id}/cancel`).send({});
        expect(allow.status, JSON.stringify(allow.body)).toBe(200);
      });

      it("np hoàn toàn không có cặp nào ⇒ 403 cả GET /rooms và GET /me/room-bookings", async () => {
        expect((await get(tNp, "/rooms")).status).toBe(403);
        expect((await get(tNp, "/me/room-bookings?date=2026-09-02")).status).toBe(403);
      });
    });

    // ── B. Đặt hộ ROOM-ERR-010 + audit book (organizerUserId + bookedByUserId) ─

    describe("B. đặt hộ (ROOM-ERR-010) + audit book ghi cả organizer lẫn bookedBy", () => {
      it("book@Own (e1) gửi organizerUserId ≠ chính mình ⇒ 403 ROOM-ERR-010 book-on-behalf-denied", async () => {
        const slot = nextSlot();
        const res = await post(tE1, "/room-bookings").send({
          roomId: rMain,
          title: "hộ trái phép",
          ...slot,
          organizerUserId: e2User,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(res.body.error.code).toBe("ROOM-ERR-010");
        expect(kindOf(res)).toBe("book-on-behalf-denied");
      });

      it("book@Own (e1) organizerUserId = chính mình ⇒ 201 (honour vô hại)", async () => {
        const slot = nextSlot();
        const res = await post(tE1, "/room-bookings").send({
          roomId: rMain,
          title: "tự đặt",
          ...slot,
          organizerUserId: e1User,
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.organizer.userId).toBe(e1User);
      });

      it("book@Company (oa) đặt hộ e1, attendee e2 ⇒ 201; bookedBy ≠ organizer; audit.after có cả hai id", async () => {
        const slot = nextSlot();
        const res = await post(tOa, "/room-bookings").send({
          roomId: rMain,
          title: "đặt hộ",
          ...slot,
          organizerUserId: e1User,
          attendeeUserIds: [e2User],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.data.organizer.userId).toBe(e1User);
        expect(res.body.data.bookedBy.userId).toBe(oaUser);
        expect(res.body.data.organizer.userId).not.toBe(res.body.data.bookedBy.userId);

        const audit = await direct.query(
          `SELECT after FROM audit_logs
             WHERE company_id=$1 AND object_type='room_booking' AND action='book' AND object_id=$2`,
          [A.companyId, res.body.data.id],
        );
        expect(audit.rows.length, JSON.stringify(audit.rows)).toBeGreaterThanOrEqual(1);
        const after = audit.rows[0].after as Record<string, unknown>;
        expect(after.organizerUserId).toBe(e1User);
        expect(after.bookedByUserId).toBe(oaUser);
      });
    });

    // ── C. cancel@Own chỉ lượt mình; cancel@Company mọi lượt ────────────────────

    describe("C. cancel@Own chỉ lượt mình tổ chức; cancel@Company mọi lượt", () => {
      it("e1 huỷ lượt của e2 ⇒ 403 AUTH-ERR-SCOPE-DENIED; e2 huỷ lượt của chính mình ⇒ 200", async () => {
        const b = await bookRoom(tE2, rMain);
        const deny = await post(tE1, `/room-bookings/${b.id}/cancel`).send({});
        expect(deny.status, JSON.stringify(deny.body)).toBe(403);
        expect(deny.body.error.code).toBe("AUTH-ERR-SCOPE-DENIED");
        const allow = await post(tE2, `/room-bookings/${b.id}/cancel`).send({});
        expect(allow.status, JSON.stringify(allow.body)).toBe(200);
      });

      it("oa (cancel@Company) huỷ lượt của e1 ⇒ 200", async () => {
        const b = await bookRoom(tE1, rMain);
        const res = await post(tOa, `/room-bookings/${b.id}/cancel`).send({ reason: "đổi lịch" });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.status).toBe("Cancelled");
      });
    });

    // ── D. Chéo tenant ⇒ 404 mọi đường (kể cả actor @Company) ───────────────────

    describe("D. chéo tenant ⇒ 404 ROOM-ERR-NOT-FOUND mọi đường", () => {
      it("005/006/007/008/011/012 với id của A gọi bởi cb (B, @Company) ⇒ 404", async () => {
        const roomForDelete = await newRoom(tOa, `X-cross-del-${Date.now()}`);
        const bookingA = (await bookRoom(tE1, rMain)).id;

        expect((await get(tCb, `/rooms/${rMain}`)).status).toBe(404); // 005
        expect((await patch(tCb, `/rooms/${rMain}`).send({ name: "hack" })).status).toBe(404); // 006
        expect((await del(tCb, `/rooms/${roomForDelete}`)).status).toBe(404); // 007
        // 008 đòi from/to (thiếu ⇒ 400 Zod TRƯỚC khi tới service) — gửi cửa sổ hợp lệ để đo đúng 404 tenant.
        const w = nextSlot();
        expect(
          (await get(tCb, `/rooms/${rMain}/bookings?from=${w.startsAt}&to=${w.endsAt}`)).status,
        ).toBe(404); // 008
        expect((await get(tCb, `/room-bookings/${bookingA}`)).status).toBe(404); // 011
        const cancelRes = await post(tCb, `/room-bookings/${bookingA}/cancel`).send({});
        expect(cancelRes.status).toBe(404); // 012
        expect(cancelRes.body.error.code).toBe("ROOM-ERR-NOT-FOUND");
      });

      it("010: roomId của A trong body của cb (B) ⇒ 404", async () => {
        const slot = nextSlot();
        const res = await post(tCb, "/room-bookings").send({ roomId: rMain, title: "x", ...slot });
        expect(res.status, JSON.stringify(res.body)).toBe(404);
        expect(res.body.error.code).toBe("ROOM-ERR-NOT-FOUND");
      });

      it("010: attendeeUserIds chứa user của A (phòng thuộc B) ⇒ 422 ROOM-ERR-006 attendee-not-found", async () => {
        const slot = nextSlot();
        const res = await post(tCb, "/room-bookings").send({
          roomId: rCrossB,
          title: "x",
          ...slot,
          attendeeUserIds: [e1User],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(res.body.error.code).toBe("ROOM-ERR-006");
        expect(kindOf(res)).toBe("attendee-not-found");
      });

      it("ALLOW đối chứng: cb thấy phòng của chính B", async () => {
        expect((await get(tCb, `/rooms/${rCrossB}`)).status).toBe(200);
      });
    });

    // ── E. /me/room-bookings resolve user từ token — userId lạ bị bỏ qua ────────

    describe("E. /me/room-bookings — user luôn từ token (chống IDOR)", () => {
      it("e1 truyền ?userId=<e2> vẫn chỉ thấy lượt của chính mình", async () => {
        const b1 = await bookRoom(tE1, rMain);
        const from = new Date().toISOString();
        const to = new Date(Date.now() + 25 * 24 * 3600_000).toISOString();
        const res = await get(tE1, "/me/room-bookings").query({ userId: e2User, from, to });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const rows = res.body.data as Array<{
          id: string;
          organizer: { userId: string };
          attendees: Array<{ userId: string }>;
        }>;
        expect(rows.map((x) => x.id)).toContain(b1.id);
        for (const row of rows) {
          const isMine =
            row.organizer.userId === e1User || row.attendees.some((a) => a.userId === e1User);
          expect(isMine, JSON.stringify(row)).toBe(true);
        }
      });
    });

    // ── F. canCancel — server tính theo quyền + scope + thời gian ───────────────

    describe("F. canCancel — dẫn xuất ở server, FE không tự suy", () => {
      it("e1: true trên lượt mình, false trên lượt e2; oa: true cả hai; vo: false", async () => {
        const own = await bookRoom(tE1, rMain);
        const other = await bookRoom(tE2, rMain);

        expect((await get(tE1, `/room-bookings/${own.id}`)).body.data.canCancel).toBe(true);
        expect((await get(tE1, `/room-bookings/${other.id}`)).body.data.canCancel).toBe(false);
        expect((await get(tOa, `/room-bookings/${own.id}`)).body.data.canCancel).toBe(true);
        expect((await get(tOa, `/room-bookings/${other.id}`)).body.data.canCancel).toBe(true);
        expect((await get(tVo, `/room-bookings/${own.id}`)).body.data.canCancel).toBe(false);
      });
    });

    // ── G. :id không phải UUID ⇒ 400 (không rơi xuống DB thành 500) ─────────────

    describe("G. :id không phải UUID ⇒ 400", () => {
      it("GET /rooms/not-a-uuid ⇒ 400; POST /room-bookings/abc/cancel ⇒ 400", async () => {
        expect((await get(tOa, "/rooms/not-a-uuid")).status).toBe(400);
        expect((await post(tOa, "/room-bookings/abc/cancel").send({})).status).toBe(400);
      });
    });

    // ── H. tên người — displayName luôn có, employeeCode chỉ khi có hồ sơ ───────

    describe("H. chiếu tên người (căn cứ = view scope, KHÔNG phải cặp ghi — B1)", () => {
      it("e2 (không hồ sơ) vẫn có displayName + employeeCode=null; e1 (có hồ sơ) có employeeCode", async () => {
        const b = await bookRoom(tE2, rMain);
        const detail = await get(tOa, `/room-bookings/${b.id}`);
        expect(detail.status, JSON.stringify(detail.body)).toBe(200);
        expect(detail.body.data.organizer.displayName).toBe("Nhân viên E2");
        expect(detail.body.data.organizer.employeeCode).toBeNull();

        const withProfile = await bookRoom(tE1, rMain);
        const d2 = await get(tOa, `/room-bookings/${withProfile.id}`);
        expect(d2.body.data.organizer.employeeCode).toBe("NV-E1");
      });

      it("role bn (book/cancel, KHÔNG view) ⇒ FAIL-CLOSED: POST 201, organizer = chính mình có tên, attendee → displayName/employeeCode null; conflicts[] che organizerName + title", async () => {
        // ALLOW: đặt được (cặp gate `book` có).
        const own = await bookRoom(tBn, rMain, { attendeeUserIds: [e1User] });
        const dto = own.body as {
          organizer: { displayName: string | null; employeeCode: string | null };
          attendees: Array<{
            userId: string;
            displayName: string | null;
            employeeCode: string | null;
          }>;
          startsAt: string;
          endsAt: string;
        };
        expect(dto.organizer.displayName).toBe("Người đặt BN");
        expect(dto.attendees[0].userId).toBe(e1User);
        // DENY (danh tính người khác): e1 CÓ tên + CÓ mã NV-E1, nhưng bn không có `view` ⇒ cả hai về null.
        expect(dto.attendees[0].displayName).toBeNull();
        expect(dto.attendees[0].employeeCode).toBeNull();
        // Trùng lịch với chính lượt trên ⇒ 409 nhưng conflicts[] không lộ tên tổ chức/tiêu đề của người khác.
        const e1Own = await bookRoom(tE1, rMain);
        const clash = await post(tBn, "/room-bookings").send({
          roomId: rMain,
          title: "x",
          startsAt: (e1Own.body as { startsAt: string }).startsAt,
          endsAt: (e1Own.body as { endsAt: string }).endsAt,
        });
        expect(clash.status, JSON.stringify(clash.body)).toBe(409);
        const parsed = parseRoomConflictsDetail(clash.body.error.details);
        expect(parsed?.conflicts.map((c) => c.bookingId)).toContain(e1Own.id);
        for (const c of parsed?.conflicts ?? []) {
          expect(c.organizerName).toBeNull();
          expect(c.title).toBe("(đã có lịch)");
        }
        // ĐỐI CHỨNG: cùng câu hỏi, e2 (view@Company) thấy tên + tiêu đề thật.
        const clash2 = await post(tE2, "/room-bookings").send({
          roomId: rMain,
          title: "x",
          startsAt: (e1Own.body as { startsAt: string }).startsAt,
          endsAt: (e1Own.body as { endsAt: string }).endsAt,
        });
        expect(clash2.status).toBe(409);
        const c2 = parseRoomConflictsDetail(clash2.body.error.details)?.conflicts.find(
          (c) => c.bookingId === e1Own.id,
        );
        expect(c2?.organizerName).toBe("Nhân viên E1");
        expect(c2?.title).toBe("Họp");
        // Đường đọc: bn không có `view` ⇒ 403 guard (không phải 200 với tên bị che).
        expect((await get(tBn, `/room-bookings/${own.id}`)).status).toBe(403);
      });

      it("role vw (view@Own — hẹp hơn Company) ⇒ đường đọc TỪ CHỐI 403 AUTH-ERR-SCOPE-DENIED (fail-closed, không coi như Company)", async () => {
        const res = await get(tVw, "/rooms");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(res.body.error.code).toBe("AUTH-ERR-SCOPE-DENIED");
        expect((await get(tVw, "/me/room-bookings?date=2026-09-02")).status).toBe(403);
        // ĐỐI CHỨNG: vo (view@Company) ⇒ 200.
        expect((await get(tVo, "/rooms")).status).toBe(200);
      });

      it("attendee đã xoá mềm ⇒ 422 ROOM-ERR-006 attendee-not-found", async () => {
        const hash = await new PasswordService().hash(LOGIN_PW);
        const ghost = await seedUser(direct, A.companyId, `ghost@${A.slug}.test`, hash);
        await direct.query("UPDATE users SET deleted_at = now() WHERE id = $1", [ghost]);
        const slot = nextSlot();
        const res = await post(tE1, "/room-bookings").send({
          roomId: rMain,
          title: "x",
          ...slot,
          attendeeUserIds: [ghost],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(res.body.error.code).toBe("ROOM-ERR-006");
        expect(kindOf(res)).toBe("attendee-not-found");
      });
    });

    // ── I. DTO không mang email/số điện thoại (SPEC-14 §18) ─────────────────────

    describe("I. DTO người trong lượt — chỉ userId/displayName/employeeCode", () => {
      it("chi tiết lượt đặt không chứa 'email' ở bất kỳ đâu trong body", async () => {
        const b = await bookRoom(tE1, rMain, { attendeeUserIds: [e2User] });
        const res = await get(tOa, `/room-bookings/${b.id}`);
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toContain("email");
      });
    });

    // ── J. availability/usage-summary khai TRƯỚC :id — không bị nuốt ────────────

    describe("J. route tĩnh khai trước :id (bài học goals/tree)", () => {
      it("GET /rooms/availability và /rooms/usage-summary ⇒ 200 (không rơi vào 400 ParseUUID của :id)", async () => {
        const from = new Date(Date.now() + 24 * 3600_000).toISOString();
        const to = new Date(Date.now() + 25 * 3600_000).toISOString();
        const avail = await get(tOa, "/rooms/availability").query({ from, to });
        expect(avail.status, JSON.stringify(avail.body)).toBe(200);
        const usage = await get(tOa, "/rooms/usage-summary").query({ from, to });
        expect(usage.status, JSON.stringify(usage.body)).toBe(200);
      });
    });
  },
);
