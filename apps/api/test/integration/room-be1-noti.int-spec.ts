/**
 * S11-ROOM-BE-1 — NOTI (SPEC-14 §17 · plan `docs/plans/S11-ROOM-BE-1.md` §6/§7.1), đường THẬT:
 *   · đặt → outbox `room.booking.confirmed` (enqueue trong tx) → OutboxWorker → bridge
 *     (`room-noti-bridge.registrar`) → engine.intake → `notifications` cho organizer ∪ attendees TRỪ actor
 *     (`is_system_event=false` ⇒ engine tự loại `payload.actorUserId`);
 *   · huỷ → outbox `room.booking.cancelled` → `ROOM_BOOKING_CANCELLED`, cùng luật loại actor;
 *   · job `ROOM_BOOKING_REMINDER` (`@SystemJobHandler`, system event) quét lượt `Confirmed` có
 *     `starts_at ∈ (now, now+15′]`, phát cho organizer ∪ attendees KHÔNG loại ai (không có actor);
 *     dedupe `ROOM_BOOKING_REMINDER:{bookingId}:{startsAt ISO}` — chạy lại KHÔNG nhân đôi.
 *
 * Spec lái OutboxWorker ⇒ PHẢI giữ `acquireOutboxWorkerLock` (S7-QA-OUTBOXPROBE-1). GATE `hasDb && LANE_DB`.
 *
 * GIẢ ĐỊNH viết test lúc `notifications/room-*` CHƯA tồn tại (thi công song song — đã đối chiếu lại: `tsc --noEmit`
 * sạch sau khi implementation xong, không sửa thêm):
 *   · class job handler tên `RoomBookingReminderJobHandler`, export ở
 *     `apps/api/src/notifications/room-booking-reminder.job-handler.ts` (mirror `AssetMaintenanceDueJobHandler`).
 *   · `run({companyId})` trả `{total, success, failed, metadata?}` (hợp đồng `JobHandler` chung, KHÔNG riêng ROOM).
 *   · `notifications.source_entity_id` = bookingId cho CẢ BA event (mirror `intake({sourceEntityId: asset.id})`).
 *   · `dedupe_key` REMINDER dùng NGUYÊN VĂN `startsAt` trả về từ response tạo lượt (không tự tính lại ISO)
 *     để tránh lệch mili-giây giữa test và server.
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
import { OutboxWorker } from "../../src/events/outbox-worker";
import { RoomBookingReminderJobHandler } from "../../src/notifications/room-booking-reminder.job-handler";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { drainOutboxUntilSettled } from "../helpers/outbox-drain";
import {
  acquireOutboxWorkerLock,
  OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS,
  type OutboxWorkerLock,
} from "../helpers/outbox-worker-lock";
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
const LOGIN_PW = loginPasswordFixture("s11room3");

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

interface NotiRow {
  id: string;
  dedupeKey: string | null;
  sourceEntityId: string | null;
  title: string;
  body: string;
  payload: Record<string, unknown>;
}

describe.skipIf(!hasLaneDb)("S11-ROOM-BE-1 NOTI (outbox thật) + job nhắc lịch", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let outboxLock: OutboxWorkerLock | undefined;

  let oaUser = "";
  let e1User = "";
  let e2User = "";
  let e3User = "";
  let tOa = "";
  let tE1 = "";

  const http = () => request(app.getHttpServer());
  const post = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);

  const drain = () =>
    drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds });

  const notisOf = async (userId: string, eventCode: string): Promise<NotiRow[]> =>
    (
      await direct.query(
        `SELECT id, dedupe_key AS "dedupeKey", source_entity_id AS "sourceEntityId", payload, title, body
           FROM notifications
          WHERE company_id=$1 AND recipient_user_id=$2 AND event_code=$3 AND deleted_at IS NULL
          ORDER BY created_at`,
        [A.companyId, userId, eventCode],
      )
    ).rows as NotiRow[];

  const outboxOf = async (
    eventType: string,
  ): Promise<Array<{ id: string; status: string; payload: Record<string, unknown> }>> =>
    (
      await direct.query(
        "SELECT id, status, payload FROM outbox_events WHERE company_id=$1 AND event_type=$2 ORDER BY created_at",
        [A.companyId, eventType],
      )
    ).rows as Array<{ id: string; status: string; payload: Record<string, unknown> }>;

  async function login(slug: string, email: string): Promise<string> {
    const res = await http()
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
    const roleId = await seedRole(direct, companyId, `roomnoti-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  let roomSeq = 0;
  async function newRoom(token: string, name?: string): Promise<{ id: string; name: string }> {
    roomSeq += 1;
    const roomName = name ?? `Noti-room-${Date.now()}-${roomSeq}`;
    const res = await post(token, "/rooms").send({ name: roomName, capacity: 10 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { id: res.body.data.id as string, name: roomName };
  }

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
    return post(token, "/room-bookings").send({ roomId, title: "Họp NOTI", ...s, ...extra });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    direct = directPool();
    outboxLock = await acquireOutboxWorkerLock("room-be1-noti");

    const hash = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "room3a");
    companyIds.push(A.companyId);

    const mk = (name: string) => seedUser(direct, A.companyId, `${name}@${A.slug}.test`, hash);
    oaUser = await mk("oa");
    e1User = await mk("e1");
    e2User = await mk("e2");
    e3User = await mk("e3");

    await grantPairs(A.companyId, oaUser, "oa", ROOM_OFFICE_ADMIN);
    await grantPairs(A.companyId, e1User, "e1", ROOM_EMPLOYEE);
    await grantPairs(A.companyId, e2User, "e2", ROOM_EMPLOYEE);
    await grantPairs(A.companyId, e3User, "e3", ROOM_EMPLOYEE);

    tOa = await login(A.slug, `oa@${A.slug}.test`);
    tE1 = await login(A.slug, `e1@${A.slug}.test`);
  }, OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await outboxLock?.release();
    await direct?.end();
    await app?.close();
  });

  it("đặt (tự tổ chức, 2 attendee) → ROOM_BOOKING_CONFIRMED đúng 1 hàng/attendee, 0 cho organizer (actor); dedupe theo bookingId; drain lần 2 không nhân đôi", async () => {
    const room = await newRoom(tOa);
    const s = slot(60, 30);
    const b = await book(tE1, room.id, s, { attendeeUserIds: [e2User, e3User] });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    const bookingId = b.body.data.id as string;

    await drain();
    const forE2 = await notisOf(e2User, "ROOM_BOOKING_CONFIRMED");
    const forE3 = await notisOf(e3User, "ROOM_BOOKING_CONFIRMED");
    const forE1 = await notisOf(e1User, "ROOM_BOOKING_CONFIRMED");
    expect(forE2, JSON.stringify(forE2)).toHaveLength(1);
    expect(forE3).toHaveLength(1);
    expect(forE1, "actor (organizer=e1) KHÔNG tự nhận noti của lượt mình tạo").toHaveLength(0);

    expect(forE2[0].dedupeKey).toBe(`ROOM_BOOKING_CONFIRMED:${bookingId}`);
    expect(forE2[0].sourceEntityId).toBe(bookingId);
    expect(forE2[0].title).not.toContain("{");
    expect(forE2[0].body).not.toContain("{");
    expect(forE2[0].body).toContain(room.name);

    const ob = await outboxOf("room.booking.confirmed");
    expect(
      ob.filter((r) => (r.payload as { bookingId?: string }).bookingId === bookingId),
    ).toHaveLength(1);

    await drain();
    expect(await notisOf(e2User, "ROOM_BOOKING_CONFIRMED")).toHaveLength(1);
    expect(await notisOf(e3User, "ROOM_BOOKING_CONFIRMED")).toHaveLength(1);
  });

  it("tự đặt 0 attendee ⇒ 0 notification; outbox event vẫn kết thúc 'done' (KHÔNG dead-letter)", async () => {
    const room = await newRoom(tOa);
    const s = slot(80, 30);
    const b = await book(tE1, room.id, s);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    const bookingId = b.body.data.id as string;

    await drain();
    expect(await notisOf(e1User, "ROOM_BOOKING_CONFIRMED")).toHaveLength(0);

    const ob = await outboxOf("room.booking.confirmed");
    const mine = ob.find((r) => (r.payload as { bookingId?: string }).bookingId === bookingId);
    expect(mine, JSON.stringify(ob)).toBeDefined();
    expect(mine?.status, "0 recipient hợp lệ ⇒ engine skip, KHÔNG ném ⇒ event vẫn 'done'").toBe(
      "done",
    );
  });

  it("oa đặt hộ cho e1 (organizer), attendee e2 ⇒ e1 và e2 đều nhận CONFIRMED; oa (actor) không nhận", async () => {
    const room = await newRoom(tOa);
    const s = slot(100, 30);
    const b = await book(tOa, room.id, s, { organizerUserId: e1User, attendeeUserIds: [e2User] });
    expect(b.status, JSON.stringify(b.body)).toBe(201);

    await drain();
    // Lọc theo booking: e2 đã nhận 1 CONFIRMED ở ca đầu (attendee của lượt e1 tự đặt) — đếm toàn cục sẽ ra 2.
    const bookingId = b.body.data.id as string;
    const ofThis = (rows: NotiRow[]) => rows.filter((r) => r.sourceEntityId === bookingId);
    expect(ofThis(await notisOf(e1User, "ROOM_BOOKING_CONFIRMED"))).toHaveLength(1);
    expect(ofThis(await notisOf(e2User, "ROOM_BOOKING_CONFIRMED"))).toHaveLength(1);
    expect(await notisOf(oaUser, "ROOM_BOOKING_CONFIRMED")).toHaveLength(0);
  });

  it("huỷ bởi organizer (e1) ⇒ ROOM_BOOKING_CANCELLED cho attendee, KHÔNG cho e1 (actor)", async () => {
    const room = await newRoom(tOa);
    const s = slot(120, 30);
    const b = await book(tE1, room.id, s, { attendeeUserIds: [e2User] });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    const c = await post(tE1, `/room-bookings/${b.body.data.id}/cancel`).send({
      reason: "đổi lịch",
    });
    expect(c.status, JSON.stringify(c.body)).toBe(200);

    await drain();
    expect(await notisOf(e2User, "ROOM_BOOKING_CANCELLED")).toHaveLength(1);
    expect(await notisOf(e1User, "ROOM_BOOKING_CANCELLED")).toHaveLength(0);
  });

  it("job ROOM_BOOKING_REMINDER: lượt sau 10′ (30′) ⇒ 1 noti/organizer + 1/attendee; chạy lại không thêm; sau 20′ không nhắc; đã huỷ không nhắc", async () => {
    const handler = app.get(RoomBookingReminderJobHandler);

    const soonRoom = await newRoom(tOa);
    const soon = slot(10, 30);
    const bSoon = await book(tE1, soonRoom.id, soon, { attendeeUserIds: [e2User] });
    expect(bSoon.status, JSON.stringify(bSoon.body)).toBe(201);

    const lateRoom = await newRoom(tOa);
    const late = slot(20, 30);
    const bLate = await book(tE1, lateRoom.id, late, { attendeeUserIds: [e2User] });
    expect(bLate.status, JSON.stringify(bLate.body)).toBe(201);

    const cancelledRoom = await newRoom(tOa);
    const cancelledSlot = slot(12, 30);
    const bCancelled = await book(tE1, cancelledRoom.id, cancelledSlot, {
      attendeeUserIds: [e2User],
    });
    expect(bCancelled.status, JSON.stringify(bCancelled.body)).toBe(201);
    await post(tE1, `/room-bookings/${bCancelled.body.data.id}/cancel`).send({});

    const run1 = await handler.run({ companyId: A.companyId });
    expect(run1.total, JSON.stringify(run1)).toBeGreaterThanOrEqual(1);
    // Bộ đếm là cổng thật (gate L3): không lượt nào failed / không người nhận.
    expect(run1.failed, JSON.stringify(run1)).toBe(0);
    expect(run1.metadata?.noRecipient).toBe(0);

    const organizerNotis = await notisOf(e1User, "ROOM_BOOKING_REMINDER");
    const attendeeNotis = await notisOf(e2User, "ROOM_BOOKING_REMINDER");
    const bookingId = bSoon.body.data.id as string;
    const startsAt = bSoon.body.data.startsAt as string;

    const forSoonOrganizer = organizerNotis.filter((n) => n.sourceEntityId === bookingId);
    const forSoonAttendee = attendeeNotis.filter((n) => n.sourceEntityId === bookingId);
    expect(forSoonOrganizer, JSON.stringify(organizerNotis)).toHaveLength(1);
    expect(forSoonAttendee, JSON.stringify(attendeeNotis)).toHaveLength(1);
    expect(forSoonOrganizer[0].dedupeKey).toBe(`ROOM_BOOKING_REMINDER:${bookingId}:${startsAt}`);
    // `starts_at_local` — HH:mm dd/MM/yyyy theo companies.timezone (ROOM-DEC-004).
    expect(forSoonOrganizer[0].body).toMatch(/\d{2}:\d{2} \d{2}\/\d{2}\/\d{4}/);
    // Giờ render THEO companies.timezone (không tz mặc định câm — gate H2): đổi tz công ty sang Pacific/Kiritimati (+14)
    // rồi nhắc một lượt khác ⇒ giờ trong body khác giờ VN 7 tiếng.
    await direct.query("UPDATE companies SET timezone='Pacific/Kiritimati' WHERE id=$1", [
      A.companyId,
    ]);
    try {
      const kiriRoom = await newRoom(tOa);
      const kiri = slot(12, 30);
      const bKiri = await book(tE1, kiriRoom.id, kiri, {});
      expect(bKiri.status, JSON.stringify(bKiri.body)).toBe(201);
      const runK = await handler.run({ companyId: A.companyId });
      expect(runK.failed, JSON.stringify(runK)).toBe(0);
      const kiriNotis = (await notisOf(e1User, "ROOM_BOOKING_REMINDER")).filter(
        (r) => r.sourceEntityId === (bKiri.body.data.id as string),
      );
      expect(kiriNotis).toHaveLength(1);
      const fmt = (tz: string) =>
        new Intl.DateTimeFormat("en-GB", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(kiri.startsAt));
      expect(kiriNotis[0].body).toContain(fmt("Pacific/Kiritimati"));
      expect(kiriNotis[0].body).not.toContain(fmt("Asia/Ho_Chi_Minh"));
    } finally {
      await direct.query("UPDATE companies SET timezone='Asia/Ho_Chi_Minh' WHERE id=$1", [
        A.companyId,
      ]);
    }
    expect(forSoonOrganizer[0].body).not.toContain("{");

    // Lượt sau 20′ (ngoài cửa sổ (now, now+15′]) ⇒ KHÔNG nhắc.
    expect(organizerNotis.filter((n) => n.sourceEntityId === bLate.body.data.id)).toHaveLength(0);
    // Lượt đã huỷ ⇒ KHÔNG nhắc.
    expect(organizerNotis.filter((n) => n.sourceEntityId === bCancelled.body.data.id)).toHaveLength(
      0,
    );

    // Chạy lại — dedupe theo (bookingId, startsAt) ⇒ KHÔNG thêm hàng mới.
    await handler.run({ companyId: A.companyId });
    const organizerNotis2 = await notisOf(e1User, "ROOM_BOOKING_REMINDER");
    expect(organizerNotis2.filter((n) => n.sourceEntityId === bookingId)).toHaveLength(1);
  });
});
