/**
 * S11-ROOM-BE-1 — luật đặt phòng/huỷ/lịch (SPEC-14 §12/§13.2/§13.3/§13.4 · API-15 §6/§7.5 ·
 * plan `docs/plans/S11-ROOM-BE-1.md` §5/§7.1). Đơn tenant — cross-tenant đã cover ở `room-be1-scope.int-spec.ts`.
 *
 * Ba trục CHỐT của module (khác ASSET):
 *   1. Chống trùng HAI LỚP — kiểm-trước (409 có `conflicts[]`/`nextFreeFrom`) + EXCLUDE GIST chốt cuối
 *      (`23P01`, KHÔNG BAO GIỜ 500/25P02 — luật cứng §1.1.4: cấm try/catch quanh `insertTx` TRONG `withTenant`).
 *   2. FSM huỷ = MỘT câu UPDATE atomic; 0 hàng ⇒ đọc lại chọn kind (already-cancelled/already-ended).
 *   3. BẤT BIẾN #2: `room_bookings` chỉ UPDATE CẤP CỘT (status/cancelled_at/cancelled_by/cancel_reason/
 *      updated_at/updated_by) qua app role, KHÔNG DELETE — đo trực tiếp qua `appPool()` (42501/23514).
 *
 * GATE CỨNG `hasDb && LANE_DB`.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { IDEMPOTENCY_ERROR_CODES, parseRoomConflictsDetail } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { DatabaseService } from "../../src/db/db.service";
import { RoomBookingsRepository } from "../../src/rooms/room-bookings.repository";
import { isOverlapExclusion } from "../../src/rooms/rooms.errors";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { appPool, directPool, hasDb, withClient } from "../helpers/integration-db";
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
const LOGIN_PW = loginPasswordFixture("s11room2");

type Scope = "Own" | "Company";
type PairGrant = [action: string, resource: string, scope: Scope];

const ROOM_OFFICE_ADMIN: PairGrant[] = [
  ["access", "room", "Own"],
  ["view", "room", "Company"],
  ["book", "room", "Company"],
  ["cancel", "room-booking", "Company"],
  ["manage", "room", "Company"],
];
const ROOM_EMPLOYEE: PairGrant[] = [
  ["access", "room", "Own"],
  ["view", "room", "Company"],
  ["book", "room", "Own"],
  ["cancel", "room-booking", "Own"],
];

type ErrDetail = { field: string; message: string; rule?: string };

function kindOf(res: request.Response): string | undefined {
  const details = res.body?.error?.details as ErrDetail[] | undefined;
  return details?.find((d) => d.field === "kind")?.message;
}

describe.skipIf(!hasLaneDb)(
  "S11-ROOM-BE-1 đặt phòng — chống trùng · FSM huỷ · lịch/thống kê · idempotency · bất biến #2",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let oaUser = "";
    let e1User = "";
    let e2User = "";
    let e3User = "";
    let tOa = "";
    let tE1 = "";
    let tE2 = "";

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
      const roleId = await seedRole(direct, companyId, `roombk-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    let roomSeq = 0;
    async function newRoom(token: string, extra: Record<string, unknown> = {}): Promise<string> {
      roomSeq += 1;
      const { name: providedName, ...rest } = extra;
      const name = (providedName as string | undefined) ?? `R-${Date.now()}-${roomSeq}`;
      const res = await post(token, "/rooms").send({ name, capacity: 10, ...rest });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.data.id as string;
    }

    /** Slot tương lai — offset (phút) tính từ `now`, thời lượng (phút). ISO CÓ offset (`toISOString`). */
    function slot(offsetMin: number, durMin: number): { startsAt: string; endsAt: string } {
      const start = new Date(Date.now() + offsetMin * 60_000);
      const end = new Date(start.getTime() + durMin * 60_000);
      return { startsAt: start.toISOString(), endsAt: end.toISOString() };
    }

    async function book(
      token: string,
      roomId: string,
      s: { startsAt: string; endsAt: string },
      extra: Record<string, unknown> = {},
    ): Promise<request.Response> {
      return post(token, "/room-bookings").send({ roomId, title: "Họp", ...s, ...extra });
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
      A = await seedCompany(direct, "room2a");
      companyIds.push(A.companyId);

      const mk = (name: string) => seedUser(direct, A.companyId, `${name}@${A.slug}.test`, hash);
      oaUser = await mk("oa");
      e1User = await mk("e1");
      e2User = await mk("e2");
      e3User = await mk("e3");
      await direct.query("UPDATE users SET full_name = $2 WHERE id = $1", [
        e1User,
        "Nhân viên Một",
      ]);

      await grantPairs(A.companyId, oaUser, "oa", ROOM_OFFICE_ADMIN);
      await grantPairs(A.companyId, e1User, "e1", ROOM_EMPLOYEE);
      await grantPairs(A.companyId, e2User, "e2", ROOM_EMPLOYEE);
      await grantPairs(A.companyId, e3User, "e3", ROOM_EMPLOYEE);

      tOa = await login(A.slug, `oa@${A.slug}.test`);
      tE1 = await login(A.slug, `e1@${A.slug}.test`);
      tE2 = await login(A.slug, `e2@${A.slug}.test`);
    }, 120_000);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── ROOM-ERR-002 — khung giờ, thứ tự kiểm cố định (SPEC-14 §13.2 bước 1) ────

    describe("ROOM-ERR-002 — khung giờ không hợp lệ, thứ tự kiểm cố định", () => {
      it("end-before-start THẮNG in-past khi cả hai đều vi phạm", async () => {
        const roomId = await newRoom(tOa);
        const start = new Date(Date.now() - 10 * 60_000);
        const end = new Date(Date.now() - 20 * 60_000); // trước cả start
        const res = await book(tE1, roomId, {
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(res.body.error.code).toBe("ROOM-ERR-002");
        expect(kindOf(res)).toBe("end-before-start");
      });

      it("in-past (startsAt < now − 5′)", async () => {
        const roomId = await newRoom(tOa);
        const start = new Date(Date.now() - 10 * 60_000);
        const end = new Date(Date.now() + 20 * 60_000);
        const res = await book(tE1, roomId, {
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(kindOf(res)).toBe("in-past");
      });

      it("too-short (< 15 phút)", async () => {
        const roomId = await newRoom(tOa);
        const res = await book(tE1, roomId, slot(120, 10));
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(kindOf(res)).toBe("too-short");
      });

      it("too-long (> 8 giờ)", async () => {
        const roomId = await newRoom(tOa);
        const res = await book(tE1, roomId, slot(120, 9 * 60));
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(kindOf(res)).toBe("too-long");
      });

      it("too-far (startsAt > now + 90 ngày)", async () => {
        const roomId = await newRoom(tOa);
        const start = new Date(Date.now() + 91 * 24 * 3600_000);
        const end = new Date(start.getTime() + 30 * 60_000);
        const res = await book(tE1, roomId, {
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(kindOf(res)).toBe("too-far");
      });
    });

    // ── ROOM-ERR-004 — phòng không nhận đặt ─────────────────────────────────────

    describe("ROOM-ERR-004 — phòng không nhận đặt", () => {
      it("room-inactive: phòng is_active=false ⇒ 409", async () => {
        const roomId = await newRoom(tOa);
        const p = await patch(tOa, `/rooms/${roomId}`).send({ isActive: false });
        expect(p.status, JSON.stringify(p.body)).toBe(200);
        const res = await book(tE1, roomId, slot(120, 30));
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error.code).toBe("ROOM-ERR-004");
        expect(kindOf(res)).toBe("room-inactive");
      });

      it("approval-not-supported: phòng requiresApproval=true ⇒ 409", async () => {
        const roomId = await newRoom(tOa, { requiresApproval: true });
        const res = await book(tE1, roomId, slot(150, 30));
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(kindOf(res)).toBe("approval-not-supported");
      });
    });

    // ── ROOM-ERR-006 — người tham dự không hợp lệ ───────────────────────────────

    describe("ROOM-ERR-006 — người tham dự không hợp lệ", () => {
      it("attendee-not-found (uuid không thuộc company)", async () => {
        const roomId = await newRoom(tOa);
        const res = await book(tE1, roomId, slot(120, 30), { attendeeUserIds: [randomUUID()] });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(kindOf(res)).toBe("attendee-not-found");
      });

      it("attendee-inactive (users.status ≠ active)", async () => {
        const roomId = await newRoom(tOa);
        // `users_status_chk` = active|invited|suspended|locked — 'suspended' là giá trị ≠ active hợp lệ.
        await direct.query("UPDATE users SET status='suspended' WHERE id=$1", [e3User]);
        const res = await book(tE1, roomId, slot(140, 30), { attendeeUserIds: [e3User] });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(kindOf(res)).toBe("attendee-inactive");
        await direct.query("UPDATE users SET status='active' WHERE id=$1", [e3User]);
      });

      it("attendee-duplicate (trùng trong danh sách)", async () => {
        const roomId = await newRoom(tOa);
        const res = await book(tE1, roomId, slot(160, 30), {
          attendeeUserIds: [e2User, e2User],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(kindOf(res)).toBe("attendee-duplicate");
      });

      it("attendee-duplicate (danh sách chứa chính organizer)", async () => {
        const roomId = await newRoom(tOa);
        const res = await book(tE1, roomId, slot(180, 30), { attendeeUserIds: [e1User] });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(kindOf(res)).toBe("attendee-duplicate");
      });
    });

    // ── ROOM-ERR-007 — vượt sức chứa ─────────────────────────────────────────────

    describe("ROOM-ERR-007 — vượt sức chứa", () => {
      it("capacity=2 + 2 attendee (headcount=3) ⇒ 422 kèm capacity/headcount", async () => {
        const roomId = await newRoom(tOa, { capacity: 2 });
        const res = await book(tE1, roomId, slot(120, 30), {
          attendeeUserIds: [e2User, e3User],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(res.body.error.code).toBe("ROOM-ERR-007");
        const details = res.body.error.details as ErrDetail[];
        expect(details.find((d) => d.field === "capacity")?.message).toBe("2");
        expect(details.find((d) => d.field === "headcount")?.message).toBe("3");
      });

      it("ALLOW đối chứng: headcount = capacity vừa khít ⇒ 201", async () => {
        const roomId = await newRoom(tOa, { capacity: 2 });
        const res = await book(tE1, roomId, slot(140, 30), { attendeeUserIds: [e2User] });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
      });
    });

    // ── ROOM-ERR-001 — trùng lịch: kiểm-trước + EXCLUDE chốt cuối ───────────────

    describe("ROOM-ERR-001 — trùng lịch (kiểm-trước 409 có nội dung + EXCLUDE chốt cuối)", () => {
      it("lượt B giao lượt A ⇒ 409 kèm conflicts[] (organizerName có tên — B1) + nextFreeFrom", async () => {
        const roomId = await newRoom(tOa);
        const a = await book(tE1, roomId, slot(600, 60));
        expect(a.status, JSON.stringify(a.body)).toBe(201);
        const aStart = new Date(a.body.data.startsAt as string);
        const aEnd = new Date(a.body.data.endsAt as string);
        const bSlot = {
          startsAt: new Date(aStart.getTime() + 30 * 60_000).toISOString(),
          endsAt: new Date(aEnd.getTime() + 30 * 60_000).toISOString(),
        };
        const b = await book(tE2, roomId, bSlot);
        expect(b.status, JSON.stringify(b.body)).toBe(409);
        expect(b.body.error.code).toBe("ROOM-ERR-001");

        const parsed = parseRoomConflictsDetail(b.body.error.details as ErrDetail[]);
        expect(parsed, JSON.stringify(b.body.error.details)).not.toBeNull();
        expect(parsed?.conflicts[0]?.bookingId).toBe(a.body.data.id);
        // employee book@Own vẫn thấy tên vì căn cứ chiếu danh tính là scope ĐỌC, không phải cặp ghi (B1).
        expect(parsed?.conflicts[0]?.organizerName).toBe("Nhân viên Một");
        expect(parsed?.nextFreeFrom).toBe(a.body.data.endsAt);
      });

      it("biên nửa mở: [10:00,11:00) và [11:00,12:00) liền kề ⇒ cả hai 201", async () => {
        const roomId = await newRoom(tOa);
        const r1 = await book(tE1, roomId, slot(700, 60));
        expect(r1.status, JSON.stringify(r1.body)).toBe(201);
        const r1End = new Date(r1.body.data.endsAt as string);
        const s2 = {
          startsAt: r1.body.data.endsAt as string,
          endsAt: new Date(r1End.getTime() + 60 * 60_000).toISOString(),
        };
        const r2 = await book(tE2, roomId, s2);
        expect(r2.status, JSON.stringify(r2.body)).toBe(201);
      });

      it("RACE: 2 POST cùng slot cùng phòng bởi 2 user khác nhau ⇒ [201,409]; count(Confirmed)=1", async () => {
        const roomId = await newRoom(tOa);
        const s = slot(900, 60);
        const [r1, r2] = await Promise.all([book(tE1, roomId, s), book(tE2, roomId, { ...s })]);
        const statuses = [r1.status, r2.status].sort((x, y) => x - y);
        expect(statuses, JSON.stringify([r1.body, r2.body])).toEqual([201, 409]);
        const cnt = await direct.query(
          "SELECT count(*)::int AS n FROM room_bookings WHERE room_id=$1 AND status='Confirmed'",
          [roomId],
        );
        expect(cnt.rows[0].n).toBe(1);
      });

      it("nhánh EXCLUDE QUA SERVICE: làm mù findOverlapsTx một lần ⇒ INSERT vi phạm 23P01 ⇒ 409 ROOM-ERR-001 (không 500/25P02)", async () => {
        const roomId = await newRoom(tOa);
        const s = slot(3000, 60);
        const first = await book(tE1, roomId, s);
        expect(first.status, JSON.stringify(first.body)).toBe(201);
        const repo = app.get(RoomBookingsRepository);
        const spy = vi.spyOn(repo, "findOverlapsTx").mockResolvedValueOnce([]);
        try {
          const res = await book(tE2, roomId, s);
          expect(res.status, JSON.stringify(res.body)).toBe(409);
          expect(res.body.error.code).toBe("ROOM-ERR-001");
          const parsed = parseRoomConflictsDetail(res.body.error.details);
          expect(parsed?.malformed).toBeUndefined();
          expect(parsed?.conflicts.map((c) => c.bookingId)).toContain(first.body.data.id);
          // kiểm-trước bị mù đúng 1 lần ⇒ tx thứ hai (SELECT lại) dùng bản thật.
          expect(spy).toHaveBeenCalledTimes(2);
        } finally {
          spy.mockRestore();
        }
        const n = await direct.query(
          "SELECT count(*)::int AS n FROM room_bookings WHERE room_id=$1 AND status='Confirmed'",
          [roomId],
        );
        expect(n.rows[0].n).toBe(1);
      });

      it("23P01 THẬT: insertTx trực tiếp giao lượt Confirmed đã có ⇒ isOverlapExclusion(err) === true, KHÔNG 500/25P02", async () => {
        const roomId = await newRoom(tOa);
        const s = slot(1000, 60);
        const existing = await book(tE1, roomId, s);
        expect(existing.status, JSON.stringify(existing.body)).toBe(201);

        const db = app.get(DatabaseService);
        const repo = app.get(RoomBookingsRepository);
        const existingStart = new Date(existing.body.data.startsAt as string);
        const overlapStart = new Date(existingStart.getTime() + 15 * 60_000);
        const overlapEnd = new Date(overlapStart.getTime() + 30 * 60_000);

        await expect(
          db.withTenant(A.companyId, (tx) =>
            repo.insertTx(tx, {
              companyId: A.companyId,
              roomId,
              title: "va chạm trực tiếp",
              startsAt: overlapStart,
              endsAt: overlapEnd,
              organizerUserId: e1User,
              bookedByUserId: e1User,
            }),
          ),
        ).rejects.toSatisfy((err: unknown) => isOverlapExclusion(err));
      });
    });

    // ── ROOM-ERR-005 — huỷ không hợp lệ (FSM) ───────────────────────────────────

    describe("ROOM-ERR-005 — huỷ không hợp lệ (FSM 2 trạng thái)", () => {
      it("already-cancelled: huỷ 2 lần", async () => {
        const roomId = await newRoom(tOa);
        const b = await book(tE1, roomId, slot(120, 30));
        expect(b.status, JSON.stringify(b.body)).toBe(201);
        const c1 = await post(tE1, `/room-bookings/${b.body.data.id}/cancel`).send({});
        expect(c1.status, JSON.stringify(c1.body)).toBe(200);
        const c2 = await post(tE1, `/room-bookings/${b.body.data.id}/cancel`).send({});
        expect(c2.status, JSON.stringify(c2.body)).toBe(409);
        expect(c2.body.error.code).toBe("ROOM-ERR-005");
        expect(kindOf(c2)).toBe("already-cancelled");
      });

      it("already-ended: lượt QUÁ KHỨ (chèn thẳng bằng direct, superuser bypass RLS) ⇒ huỷ 409; isCompleted=true", async () => {
        const roomId = await newRoom(tOa);
        const past = new Date(Date.now() - 3 * 3600_000);
        const pastEnd = new Date(past.getTime() + 30 * 60_000);
        const ins = await direct.query(
          `INSERT INTO room_bookings (company_id, room_id, title, starts_at, ends_at, organizer_user_id, booked_by_user_id)
           VALUES ($1,$2,'lịch sử',$3,$4,$5,$5) RETURNING id`,
          [A.companyId, roomId, past, pastEnd, e1User],
        );
        const bookingId = ins.rows[0].id as string;
        const res = await post(tE1, `/room-bookings/${bookingId}/cancel`).send({});
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(kindOf(res)).toBe("already-ended");
        const detail = await get(tOa, `/room-bookings/${bookingId}`);
        expect(detail.body.data.isCompleted).toBe(true);
      });

      it("huỷ lượt ĐANG DIỄN RA (startsAt trong dung sai 5′ quá khứ) ⇒ 200", async () => {
        const roomId = await newRoom(tOa);
        const start = new Date(Date.now() - 2 * 60_000);
        const end = new Date(start.getTime() + 30 * 60_000);
        const b = await book(tE1, roomId, {
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
        });
        expect(b.status, JSON.stringify(b.body)).toBe(201);
        const res = await post(tE1, `/room-bookings/${b.body.data.id}/cancel`).send({});
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });

      it("RACE: 2 huỷ song song cùng lượt ⇒ [200,409] already-cancelled", async () => {
        const roomId = await newRoom(tOa);
        const b = await book(tE1, roomId, slot(200, 30));
        expect(b.status, JSON.stringify(b.body)).toBe(201);
        const [r1, r2] = await Promise.all([
          post(tE1, `/room-bookings/${b.body.data.id}/cancel`).send({}),
          post(tOa, `/room-bookings/${b.body.data.id}/cancel`).send({}),
        ]);
        const statuses = [r1.status, r2.status].sort((x, y) => x - y);
        expect(statuses, JSON.stringify([r1.body, r2.body])).toEqual([200, 409]);
        const loser = r1.status === 409 ? r1 : r2;
        expect(kindOf(loser)).toBe("already-cancelled");
      });
    });

    // ── ROOM-ERR-008 — phòng còn lịch ────────────────────────────────────────────

    describe("ROOM-ERR-008 — phòng còn lịch sắp tới", () => {
      it("PATCH isActive=false / DELETE khi còn lượt tương lai ⇒ 409 upcomingCount; sau huỷ ⇒ OK", async () => {
        const roomId = await newRoom(tOa);
        const b = await book(tE1, roomId, slot(300, 30));
        expect(b.status, JSON.stringify(b.body)).toBe(201);

        const p = await patch(tOa, `/rooms/${roomId}`).send({ isActive: false });
        expect(p.status, JSON.stringify(p.body)).toBe(409);
        expect(p.body.error.code).toBe("ROOM-ERR-008");
        const details = p.body.error.details as ErrDetail[];
        expect(details.find((d) => d.field === "upcomingCount")?.message).toBe("1");

        const d = await del(tOa, `/rooms/${roomId}`);
        expect(d.status, JSON.stringify(d.body)).toBe(409);

        await post(tE1, `/room-bookings/${b.body.data.id}/cancel`).send({});
        const p2 = await patch(tOa, `/rooms/${roomId}`).send({ isActive: false });
        expect(p2.status, JSON.stringify(p2.body)).toBe(200);
      });

      it("phòng chỉ có lượt QUÁ KHỨ ⇒ vô hiệu/xoá được ngay (0 upcoming)", async () => {
        const roomId = await newRoom(tOa);
        const past = new Date(Date.now() - 5 * 3600_000);
        const pastEnd = new Date(past.getTime() + 30 * 60_000);
        await direct.query(
          `INSERT INTO room_bookings (company_id, room_id, title, starts_at, ends_at, organizer_user_id, booked_by_user_id)
           VALUES ($1,$2,'cu',$3,$4,$5,$5)`,
          [A.companyId, roomId, past, pastEnd, e1User],
        );
        const res = await del(tOa, `/rooms/${roomId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(204);
      });
    });

    // ── ROOM-ERR-009 — tên phòng trùng ───────────────────────────────────────────

    describe("ROOM-ERR-009 — tên phòng trùng", () => {
      it("PATCH /rooms/:id body rỗng ⇒ 400 (không UPDATE giả, không audit giả); khoá lạ ⇒ 400 (.strict())", async () => {
        const roomId = await newRoom(tOa);
        expect((await patch(tOa, `/rooms/${roomId}`).send({})).status).toBe(400);
        expect((await patch(tOa, `/rooms/${roomId}`).send({ deletedAt: null })).status).toBe(400);
        expect((await patch(tOa, `/rooms/${roomId}`).send({ location: "Tầng 9" })).status).toBe(
          200,
        );
      });

      it("case-insensitive trùng tên ⇒ 409; xoá mềm rồi dùng lại tên ⇒ 201", async () => {
        const name = `Phòng Trùng ${Date.now()}`;
        const r1 = await post(tOa, "/rooms").send({ name, capacity: 4 });
        expect(r1.status, JSON.stringify(r1.body)).toBe(201);
        const r2 = await post(tOa, "/rooms").send({ name: name.toUpperCase(), capacity: 4 });
        expect(r2.status, JSON.stringify(r2.body)).toBe(409);
        expect(r2.body.error.code).toBe("ROOM-ERR-009");
        expect(kindOf(r2)).toBe("name-taken");

        const del1 = await del(tOa, `/rooms/${r1.body.data.id}`);
        expect(del1.status, JSON.stringify(del1.body)).toBe(204);
        const r3 = await post(tOa, "/rooms").send({ name, capacity: 4 });
        expect(r3.status, JSON.stringify(r3.body)).toBe(201);
      });
    });

    // ── GET /rooms/availability ──────────────────────────────────────────────────

    describe("GET /rooms/availability — lọc + luật giờ RIÊNG (chỉ end-before-start/too-long)", () => {
      it("lọc capacityMin/equipment; loại inactive/requiresApproval/bận; in-past không áp; >8h ⇒ 422", async () => {
        const suffix = Date.now();
        const good = await newRoom(tOa, {
          name: `Avail-good-${suffix}`,
          capacity: 8,
          equipment: ["TV", "Bảng"],
        });
        const smallCap = await newRoom(tOa, { name: `Avail-small-${suffix}`, capacity: 2 });
        const noEquip = await newRoom(tOa, { name: `Avail-noequip-${suffix}`, capacity: 8 });
        const inactive = await newRoom(tOa, {
          name: `Avail-inactive-${suffix}`,
          capacity: 8,
          equipment: ["TV", "Bảng"],
        });
        await patch(tOa, `/rooms/${inactive}`).send({ isActive: false });
        const approval = await newRoom(tOa, {
          name: `Avail-approval-${suffix}`,
          capacity: 8,
          equipment: ["TV", "Bảng"],
          requiresApproval: true,
        });
        const busy = await newRoom(tOa, {
          name: `Avail-busy-${suffix}`,
          capacity: 8,
          equipment: ["TV", "Bảng"],
        });

        const s = slot(2000, 60);
        const busyBooking = await book(tE1, busy, s);
        expect(busyBooking.status, JSON.stringify(busyBooking.body)).toBe(201);

        const res = await get(tOa, "/rooms/availability").query({
          from: s.startsAt,
          to: s.endsAt,
          capacityMin: 6,
          equipment: ["TV", "Bảng"],
        });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const ids = (res.body.data as Array<{ id: string }>).map((x) => x.id);
        expect(ids).toContain(good);
        expect(ids).not.toContain(smallCap);
        expect(ids).not.toContain(noEquip);
        expect(ids).not.toContain(inactive);
        expect(ids).not.toContain(approval);
        expect(ids).not.toContain(busy);

        // in-past KHÔNG áp cho availability (tra cứu, không phải đặt — SPEC-14 §13.4).
        const past = new Date(Date.now() - 3600_000).toISOString();
        // cửa sổ 1h hoàn toàn trong quá khứ (≤ 8h — luật too-long vẫn áp cho availability).
        const pastRes = await get(tOa, "/rooms/availability").query({
          from: past,
          to: new Date().toISOString(),
        });
        expect(pastRes.status, JSON.stringify(pastRes.body)).toBe(200);

        // > 8h ⇒ 422 too-long.
        const longTo = new Date(new Date(s.startsAt).getTime() + 9 * 3600_000).toISOString();
        const longRes = await get(tOa, "/rooms/availability").query({
          from: s.startsAt,
          to: longTo,
        });
        expect(longRes.status, JSON.stringify(longRes.body)).toBe(422);
        expect(kindOf(longRes)).toBe("too-long");
      });
    });

    // ── GET /rooms/usage-summary ──────────────────────────────────────────────────

    describe("GET /rooms/usage-summary", () => {
      it("bookingsCount/hoursBooked/cancelledCount là number; cancelledCount phản ánh lượt đã huỷ", async () => {
        const roomId = await newRoom(tOa, { name: `Usage-${Date.now()}` });
        const b1 = await book(tE1, roomId, slot(3000, 60));
        expect(b1.status, JSON.stringify(b1.body)).toBe(201);
        const b2 = await book(tE2, roomId, slot(3200, 30));
        expect(b2.status, JSON.stringify(b2.body)).toBe(201);
        await post(tE2, `/room-bookings/${b2.body.data.id}/cancel`).send({});

        const from = new Date().toISOString();
        const to = new Date(Date.now() + 200 * 24 * 3600_000).toISOString();
        const res = await get(tOa, "/rooms/usage-summary").query({ from, to });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const row = (res.body.data as Array<Record<string, unknown>>).find(
          (r) => r.roomId === roomId,
        );
        expect(row, JSON.stringify(res.body.data)).toBeDefined();
        expect(typeof row?.bookingsCount).toBe("number");
        expect(typeof row?.hoursBooked).toBe("number");
        expect(typeof row?.cancelledCount).toBe("number");
        expect(row?.cancelledCount as number).toBeGreaterThanOrEqual(1);
      });

      it("phòng đã xoá mềm vẫn hiện trong usage-summary nếu có lượt trong cửa sổ", async () => {
        const roomId = await newRoom(tOa, { name: `Usage-deleted-${Date.now()}` });
        const past = new Date(Date.now() - 5 * 3600_000);
        const pastEnd = new Date(past.getTime() + 90 * 60_000);
        await direct.query(
          `INSERT INTO room_bookings (company_id, room_id, title, starts_at, ends_at, organizer_user_id, booked_by_user_id)
           VALUES ($1,$2,'du lieu cu',$3,$4,$5,$5)`,
          [A.companyId, roomId, past, pastEnd, e1User],
        );
        const del1 = await del(tOa, `/rooms/${roomId}`);
        expect(del1.status, JSON.stringify(del1.body)).toBe(204);

        const from = new Date(Date.now() - 24 * 3600_000).toISOString();
        const to = new Date(Date.now() + 24 * 3600_000).toISOString();
        const res = await get(tOa, "/rooms/usage-summary").query({ from, to });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const row = (res.body.data as Array<Record<string, unknown>>).find(
          (r) => r.roomId === roomId,
        );
        expect(row, JSON.stringify(res.body.data)).toBeDefined();
        expect(row?.bookingsCount).toBe(1);
        expect(row?.hoursBooked).toBe(1.5);
      });

      it("cửa sổ > 366 ngày ⇒ 422 range-too-wide", async () => {
        const from = new Date().toISOString();
        const to = new Date(Date.now() + 400 * 24 * 3600_000).toISOString();
        const res = await get(tOa, "/rooms/usage-summary").query({ from, to });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(kindOf(res)).toBe("range-too-wide");
      });
    });

    // ── Lịch: status filter mặc định Confirmed / all; cửa sổ ≤ 31 ngày ─────────

    describe("Lịch — status mặc định Confirmed, status=all gồm Cancelled; cửa sổ ≤ 31 ngày", () => {
      it("GET /rooms/:id/bookings", async () => {
        const roomId = await newRoom(tOa, { name: `Status-room-${Date.now()}` });
        const b1 = await book(tE1, roomId, slot(4000, 30));
        expect(b1.status, JSON.stringify(b1.body)).toBe(201);
        const b2 = await book(tE2, roomId, slot(4100, 30));
        expect(b2.status, JSON.stringify(b2.body)).toBe(201);
        await post(tE2, `/room-bookings/${b2.body.data.id}/cancel`).send({});

        const from = new Date().toISOString();
        const to = new Date(Date.now() + 10 * 24 * 3600_000).toISOString();
        const def = await get(tOa, `/rooms/${roomId}/bookings`).query({ from, to });
        expect(def.status, JSON.stringify(def.body)).toBe(200);
        let ids = (def.body.data as Array<{ id: string }>).map((x) => x.id);
        expect(ids).toContain(b1.body.data.id);
        expect(ids).not.toContain(b2.body.data.id);

        const all = await get(tOa, `/rooms/${roomId}/bookings`).query({ from, to, status: "all" });
        ids = (all.body.data as Array<{ id: string }>).map((x) => x.id);
        expect(ids).toContain(b1.body.data.id);
        expect(ids).toContain(b2.body.data.id);
      });

      it("GET /room-bookings", async () => {
        const roomId = await newRoom(tOa, { name: `Status-flat-${Date.now()}` });
        const b1 = await book(tE1, roomId, slot(4300, 30));
        expect(b1.status, JSON.stringify(b1.body)).toBe(201);
        const b2 = await book(tE2, roomId, slot(4400, 30));
        expect(b2.status, JSON.stringify(b2.body)).toBe(201);
        await post(tE2, `/room-bookings/${b2.body.data.id}/cancel`).send({});

        const from = new Date().toISOString();
        const to = new Date(Date.now() + 10 * 24 * 3600_000).toISOString();
        const def = await get(tOa, "/room-bookings").query({ from, to, roomId });
        let ids = (def.body.data as Array<{ id: string }>).map((x) => x.id);
        expect(ids).toContain(b1.body.data.id);
        expect(ids).not.toContain(b2.body.data.id);

        const all = await get(tOa, "/room-bookings").query({ from, to, roomId, status: "all" });
        ids = (all.body.data as Array<{ id: string }>).map((x) => x.id);
        expect(ids).toContain(b1.body.data.id);
        expect(ids).toContain(b2.body.data.id);
      });

      it("cửa sổ > 31 ngày ⇒ 422 range-too-wide (GET /room-bookings)", async () => {
        const from = new Date().toISOString();
        const to = new Date(Date.now() + 32 * 24 * 3600_000).toISOString();
        const res = await get(tOa, "/room-bookings").query({ from, to });
        expect(res.status, JSON.stringify(res.body)).toBe(422);
        expect(kindOf(res)).toBe("range-too-wide");
      });
    });

    // ── /me/room-bookings — date theo TZ công ty, role, includeCancelled ────────

    describe("GET /me/room-bookings — date theo companies.timezone, role, includeCancelled", () => {
      function vnDateOf(d: Date): string {
        return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);
      }

      it("date=D có lượt 00:30+07:00 ngày D; date=D-1 không có (companies.timezone mặc định Asia/Ho_Chi_Minh)", async () => {
        const base = new Date(Date.now() + 3 * 24 * 3600_000);
        const D = vnDateOf(base);
        const Dprev = vnDateOf(new Date(base.getTime() - 24 * 3600_000));
        const roomId = await newRoom(tOa, { name: `TZ-${Date.now()}` });
        const b = await book(tE1, roomId, {
          startsAt: `${D}T00:30:00+07:00`,
          endsAt: `${D}T01:00:00+07:00`,
        });
        expect(b.status, JSON.stringify(b.body)).toBe(201);

        const resD = await get(tE1, "/me/room-bookings").query({ date: D });
        expect(resD.status, JSON.stringify(resD.body)).toBe(200);
        expect((resD.body.data as Array<{ id: string }>).map((x) => x.id)).toContain(
          b.body.data.id,
        );

        const resPrev = await get(tE1, "/me/room-bookings").query({ date: Dprev });
        expect(resPrev.status, JSON.stringify(resPrev.body)).toBe(200);
        expect((resPrev.body.data as Array<{ id: string }>).map((x) => x.id)).not.toContain(
          b.body.data.id,
        );
      });

      it("role=organizer/attendee lọc đúng vế; mặc định KHÔNG gồm đã huỷ, includeCancelled=true có", async () => {
        const roomId = await newRoom(tOa, { name: `Role-${Date.now()}` });
        const organizerBooking = await book(tE1, roomId, slot(5000, 30), {
          attendeeUserIds: [e2User],
        });
        expect(organizerBooking.status, JSON.stringify(organizerBooking.body)).toBe(201);
        const attendeeBooking = await book(tE2, roomId, slot(5100, 30), {
          attendeeUserIds: [e1User],
        });
        expect(attendeeBooking.status, JSON.stringify(attendeeBooking.body)).toBe(201);
        await post(tE2, `/room-bookings/${attendeeBooking.body.data.id}/cancel`).send({});

        const from = new Date().toISOString();
        const to = new Date(Date.now() + 10 * 24 * 3600_000).toISOString();

        const asOrganizer = await get(tE1, "/me/room-bookings").query({
          from,
          to,
          role: "organizer",
        });
        let ids = (asOrganizer.body.data as Array<{ id: string }>).map((x) => x.id);
        expect(ids).toContain(organizerBooking.body.data.id);
        expect(ids).not.toContain(attendeeBooking.body.data.id);

        const withoutCancelled = await get(tE1, "/me/room-bookings").query({
          from,
          to,
          role: "attendee",
        });
        ids = (withoutCancelled.body.data as Array<{ id: string }>).map((x) => x.id);
        expect(ids).not.toContain(attendeeBooking.body.data.id);

        const withCancelled = await get(tE1, "/me/room-bookings").query({
          from,
          to,
          role: "attendee",
          includeCancelled: true,
        });
        ids = (withCancelled.body.data as Array<{ id: string }>).map((x) => x.id);
        expect(ids).toContain(attendeeBooking.body.data.id);
        expect(ids).not.toContain(organizerBooking.body.data.id);
      });

      it("thiếu cả date lẫn from/to ⇒ 400; date + from/to cùng lúc ⇒ 400", async () => {
        const missing = await get(tE1, "/me/room-bookings");
        expect(missing.status, JSON.stringify(missing.body)).toBe(400);
        const both = await get(tE1, "/me/room-bookings").query({
          date: "2026-09-02",
          from: new Date().toISOString(),
          to: new Date(Date.now() + 3600_000).toISOString(),
        });
        expect(both.status, JSON.stringify(both.body)).toBe(400);
      });
    });

    // ── audit_logs — mutation phòng + lượt đặt (BẤT BIẾN #2 append-only) ───────

    describe("audit_logs — mọi mutation có vết (SPEC-14 §12 cuối)", () => {
      it("tạo/sửa/vô hiệu/xoá phòng ⇒ object_type='meeting_room' đúng action", async () => {
        const name = `Audit-room-${Date.now()}`;
        const created = await post(tOa, "/rooms").send({ name, capacity: 4 });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const roomId = created.body.data.id as string;
        await patch(tOa, `/rooms/${roomId}`).send({ location: "Tầng 5" });
        await patch(tOa, `/rooms/${roomId}`).send({ isActive: false });
        await del(tOa, `/rooms/${roomId}`);

        const rows = await direct.query(
          `SELECT action FROM audit_logs
             WHERE company_id=$1 AND object_type='meeting_room' AND object_id=$2 ORDER BY created_at`,
          [A.companyId, roomId],
        );
        const actions = rows.rows.map((r) => r.action as string);
        expect(actions, JSON.stringify(actions)).toContain("create");
        expect(actions).toContain("update");
        expect(actions).toContain("deactivate");
        expect(actions).toContain("delete");
      });

      it("đặt/huỷ ⇒ object_type='room_booking' action book/cancel", async () => {
        const roomId = await newRoom(tOa, { name: `Audit-booking-${Date.now()}` });
        const b = await book(tE1, roomId, slot(6000, 30));
        expect(b.status, JSON.stringify(b.body)).toBe(201);
        await post(tE1, `/room-bookings/${b.body.data.id}/cancel`).send({});
        const rows = await direct.query(
          `SELECT action FROM audit_logs
             WHERE company_id=$1 AND object_type='room_booking' AND object_id=$2 ORDER BY created_at`,
          [A.companyId, b.body.data.id],
        );
        const actions = rows.rows.map((r) => r.action as string);
        expect(actions, JSON.stringify(actions)).toContain("book");
        expect(actions).toContain("cancel");
      });
    });

    // ── Idempotency-Key trên POST /room-bookings (API-15 §6.9/§7.5) ─────────────

    describe("Idempotency-Key — POST /room-bookings", () => {
      it("cùng key + cùng payload ⇒ replay (cùng id + header + 1 hàng); cùng key khác payload ⇒ 409 KEY_REUSED", async () => {
        const roomId = await newRoom(tOa, { name: `Idem-${Date.now()}` });
        const s = slot(7000, 30);
        const key = `room-idem-${roomId}`;
        const r1 = await post(tE1, "/room-bookings")
          .set("Idempotency-Key", key)
          .send({ roomId, title: "Idem", ...s });
        expect(r1.status, JSON.stringify(r1.body)).toBe(201);
        expect(r1.headers["idempotency-replayed"]).toBeUndefined();

        const r2 = await post(tE1, "/room-bookings")
          .set("Idempotency-Key", key)
          .send({ roomId, title: "Idem", ...s });
        expect(r2.status, JSON.stringify(r2.body)).toBe(201);
        expect(r2.headers["idempotency-replayed"]).toBe("true");
        expect(r2.body.data.id).toBe(r1.body.data.id);

        const cnt = await direct.query("SELECT count(*)::int AS n FROM room_bookings WHERE id=$1", [
          r1.body.data.id,
        ]);
        expect(cnt.rows[0].n).toBe(1);

        const reused = await post(tE1, "/room-bookings")
          .set("Idempotency-Key", key)
          .send({ roomId, title: "Payload khác", ...s });
        expect(reused.status, JSON.stringify(reused.body)).toBe(409);
        expect(reused.body.error.code).toBe(IDEMPOTENCY_ERROR_CODES.KEY_REUSED);
      });

      it("huỷ rồi đặt lại với key MỚI ⇒ lượt mới (không bị chặn bởi phát-lại của key cũ)", async () => {
        const roomId = await newRoom(tOa, { name: `Idem-rebook-${Date.now()}` });
        const s = slot(7200, 30);
        const keyA = `room-idem-a-${roomId}`;
        const first = await post(tE1, "/room-bookings")
          .set("Idempotency-Key", keyA)
          .send({ roomId, title: "lần 1", ...s });
        expect(first.status, JSON.stringify(first.body)).toBe(201);
        await post(tE1, `/room-bookings/${first.body.data.id}/cancel`).send({});

        const keyB = `room-idem-b-${roomId}`;
        const second = await post(tE1, "/room-bookings")
          .set("Idempotency-Key", keyB)
          .send({ roomId, title: "lần 2", ...s });
        expect(second.status, JSON.stringify(second.body)).toBe(201);
        expect(second.body.data.id).not.toBe(first.body.data.id);
      });
    });

    // ── BẤT BIẾN #2 — room_bookings chỉ UPDATE cấp cột allowlist qua app role ──

    describe("BẤT BIẾN #2 — room_bookings KHÔNG DELETE, KHÔNG UPDATE ngoài allowlist (42501/23514)", () => {
      it("UPDATE title / DELETE ⇒ 42501; UPDATE status='Cancelled' thiếu cancelled_at ⇒ 23514 chk_room_bookings_cancel_pair", async () => {
        const roomId = await newRoom(tOa, { name: `Invariant-${Date.now()}` });
        const b = await book(tE1, roomId, slot(8000, 30));
        expect(b.status, JSON.stringify(b.body)).toBe(201);
        const id = b.body.data.id as string;

        const pool = appPool();
        try {
          await withClient(pool, async (c) => {
            await c.query("BEGIN");
            await c.query("SELECT set_config('app.current_company_id',$1,true)", [A.companyId]);
            await expect(
              c.query("UPDATE room_bookings SET title=$2 WHERE id=$1", [id, "hack"]),
            ).rejects.toMatchObject({ code: "42501" });
            await c.query("ROLLBACK");
          });
          await withClient(pool, async (c) => {
            await c.query("BEGIN");
            await c.query("SELECT set_config('app.current_company_id',$1,true)", [A.companyId]);
            await expect(
              c.query("DELETE FROM room_bookings WHERE id=$1", [id]),
            ).rejects.toMatchObject({ code: "42501" });
            await c.query("ROLLBACK");
          });
          await withClient(pool, async (c) => {
            await c.query("BEGIN");
            await c.query("SELECT set_config('app.current_company_id',$1,true)", [A.companyId]);
            await expect(
              c.query("UPDATE room_bookings SET status='Cancelled' WHERE id=$1", [id]),
            ).rejects.toMatchObject({ code: "23514", constraint: "chk_room_bookings_cancel_pair" });
            await c.query("ROLLBACK");
          });
        } finally {
          await pool.end();
        }
      });
    });
  },
);
