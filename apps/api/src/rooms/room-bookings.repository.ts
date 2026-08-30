import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import {
  roomBookingAttendees,
  roomBookings,
  type NewRoomBooking,
  type RoomBooking,
  type RoomBookingStatus,
} from "../db/schema/rooms";

/** Hàng lượt + vế phòng (JOIN KHÔNG lọc `deleted_at`/`is_active` — lịch sử vẫn hiện, SPEC-14 §12). */
export interface RoomBookingRow {
  id: string;
  roomId: string;
  roomName: string;
  roomLocation: string | null;
  roomCapacity: number;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  organizerUserId: string;
  bookedByUserId: string | null;
  status: RoomBookingStatus;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: Date;
}

export interface MyRoomBookingRow extends RoomBookingRow {
  myRole: "organizer" | "attendee";
}

export interface BookingWindowFilter {
  from: Date;
  to: Date;
  status: RoomBookingStatus | "all";
  roomIds?: readonly string[];
  organizerUserId?: string;
}

export interface OverlapRow {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  organizerUserId: string;
}

export interface BookingStatusRow {
  id: string;
  status: RoomBookingStatus;
  endsAt: Date;
  organizerUserId: string;
  startsAt: Date;
}

export interface ReminderRow {
  id: string;
  title: string;
  startsAt: Date;
  roomName: string;
}

/** Cột chọn dùng chung (raw SQL — alias `b` + `r`). */
const BOOKING_COLUMNS = sql`
  b.id, b.room_id as "roomId", r.name as "roomName", r.location as "roomLocation", r.capacity as "roomCapacity",
  b.title, b.description, b.starts_at as "startsAt", b.ends_at as "endsAt",
  b.organizer_user_id as "organizerUserId", b.booked_by_user_id as "bookedByUserId", b.status,
  b.cancelled_at as "cancelledAt", b.cancelled_by as "cancelledBy", b.cancel_reason as "cancelReason",
  b.created_at as "createdAt"`;

/**
 * S11-ROOM-BE-1 — RoomBookingsRepository: `room_bookings` (SỔ) + `room_booking_attendees` (SỔ) — DB-16 §6.2/§6.3.
 * Chạy TRONG `withTenant` do service mở; `company_id` ở MỌI câu kể cả bảng JOIN (BẤT BIẾN #1).
 *
 * BẤT BIẾN #2: KHÔNG DELETE; UPDATE duy nhất = `cancelTx` — MỘT câu đủ 6 cột trong allowlist column-grant 0552
 * (`status · cancelled_at · cancelled_by · cancel_reason · updated_at · updated_by`) thoả `chk_room_bookings_cancel_pair`
 * và `WHERE status='Confirmed' AND ends_at > now()` (FSM §13.1 atomic — không SELECT-rồi-UPDATE). `booked_by_user_id`
 * không bao giờ UPDATE. Attendees cố định lúc đặt (chỉ INSERT).
 *
 * Chống trùng: `findOverlapsTx` (kiểm-trước, 409 có nội dung) — chốt cuối là EXCLUDE `room_bookings_no_overlap_excl`
 * (23P01 bắt ở service qua `isOverlapExclusion`). Overlap = `tstzrange(starts_at, ends_at, '[)') &&` (nửa mở).
 */
@Injectable()
export class RoomBookingsRepository {
  async insertTx(tx: TenantTx, values: NewRoomBooking): Promise<RoomBooking> {
    const [row] = await tx.insert(roomBookings).values(values).returning();
    return row;
  }

  async insertAttendeesTx(
    tx: TenantTx,
    companyId: string,
    bookingId: string,
    userIds: readonly string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    await tx
      .insert(roomBookingAttendees)
      .values(userIds.map((userId) => ({ companyId, bookingId, userId })));
  }

  /** Lượt `Confirmed` của phòng giao `[s, e)` (ORDER BY starts_at) — SPEC-14 §13.2 bước 6. */
  async findOverlapsTx(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<OverlapRow[]> {
    const res = await tx.execute(sql`
      select b.id, b.title, b.starts_at as "startsAt", b.ends_at as "endsAt", b.organizer_user_id as "organizerUserId"
        from room_bookings b
       where b.company_id = ${companyId} and b.room_id = ${roomId} and b.status = 'Confirmed'
         and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(${startsAt}::timestamptz, ${endsAt}::timestamptz, '[)')
       order by b.starts_at asc
    `);
    return res.rows as unknown as OverlapRow[];
  }

  /** Lượt `Confirmed` của phòng giao `[s, s + 1 ngày)` — nguồn cho `nextFreeFrom` (SPEC-14 §13.2). */
  async findDayBookingsTx(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
    const res = await tx.execute(sql`
      select b.starts_at as "startsAt", b.ends_at as "endsAt"
        from room_bookings b
       where b.company_id = ${companyId} and b.room_id = ${roomId} and b.status = 'Confirmed'
         and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(${dayStart}::timestamptz, ${dayEnd}::timestamptz, '[)')
       order by b.starts_at asc
    `);
    return res.rows as unknown as Array<{ startsAt: Date; endsAt: Date }>;
  }

  async findDetailTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<RoomBookingRow | undefined> {
    const res = await tx.execute(sql`
      select ${BOOKING_COLUMNS}
        from room_bookings b
        join meeting_rooms r on r.id = b.room_id and r.company_id = ${companyId}
       where b.company_id = ${companyId} and b.id = ${id}
       limit 1
    `);
    return (res.rows as unknown as RoomBookingRow[])[0];
  }

  /** `{status, ends_at, organizer}` để chọn 403-scope / kind ROOM-ERR-005 (huỷ). */
  async findStatusTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<BookingStatusRow | undefined> {
    const res = await tx.execute(sql`
      select b.id, b.status, b.ends_at as "endsAt", b.starts_at as "startsAt", b.organizer_user_id as "organizerUserId"
        from room_bookings b
       where b.company_id = ${companyId} and b.id = ${id}
       limit 1
    `);
    return (res.rows as unknown as BookingStatusRow[])[0];
  }

  /** Người tham dự của nhiều lượt (MỘT câu `= ANY`) — `bookingId → userId[]` theo thứ tự chèn. */
  async attendeesByBookingIdsTx(
    tx: TenantTx,
    companyId: string,
    bookingIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (bookingIds.length === 0) return out;
    const res = await tx.execute(sql`
      select a.booking_id as "bookingId", a.user_id as "userId"
        from room_booking_attendees a
       where a.company_id = ${companyId} and a.booking_id = any(${sql.param([...bookingIds])}::uuid[])
       order by a.created_at asc, a.id asc
    `);
    for (const r of res.rows as unknown as Array<{ bookingId: string; userId: string }>) {
      const list = out.get(r.bookingId) ?? [];
      list.push(r.userId);
      out.set(r.bookingId, list);
    }
    return out;
  }

  private statusCond(status: RoomBookingStatus | "all"): SQL {
    return status === "all" ? sql`true` : sql`b.status = ${status}`;
  }

  /** Lịch trong cửa sổ `[from, to)` (009/008): lượt giao cửa sổ, phẳng, ORDER BY starts_at, room. */
  async listWindowTx(
    tx: TenantTx,
    companyId: string,
    f: BookingWindowFilter,
  ): Promise<RoomBookingRow[]> {
    const roomCond =
      f.roomIds && f.roomIds.length > 0
        ? sql`b.room_id = any(${sql.param([...f.roomIds])}::uuid[])`
        : sql`true`;
    const orgCond = f.organizerUserId ? sql`b.organizer_user_id = ${f.organizerUserId}` : sql`true`;
    const res = await tx.execute(sql`
      select ${BOOKING_COLUMNS}
        from room_bookings b
        join meeting_rooms r on r.id = b.room_id and r.company_id = ${companyId}
       where b.company_id = ${companyId}
         and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(${f.from}::timestamptz, ${f.to}::timestamptz, '[)')
         and ${this.statusCond(f.status)} and ${roomCond} and ${orgCond}
       order by b.starts_at asc, r.sort_order asc, r.name asc, b.id asc
    `);
    return res.rows as unknown as RoomBookingRow[];
  }

  /**
   * `/me/room-bookings` (013): BỘ LỌC `organizer = me OR EXISTS attendee = me` bằng EXISTS (KHÔNG JOIN attendees —
   * tránh nhân bản hàng). `role` thu hẹp vế; `myRole` tính trong câu (organizer thắng nếu cả hai — organizer KHÔNG
   * nằm trong attendees theo §12 nhưng phòng hờ dữ liệu bẩn).
   */
  async listMineTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    f: { from: Date; to: Date; role: "organizer" | "attendee" | "all"; includeCancelled: boolean },
  ): Promise<MyRoomBookingRow[]> {
    const isOrganizer = sql`b.organizer_user_id = ${userId}`;
    const isAttendee = sql`exists (
      select 1 from room_booking_attendees a
       where a.company_id = ${companyId} and a.booking_id = b.id and a.user_id = ${userId})`;
    const roleCond =
      f.role === "organizer"
        ? isOrganizer
        : f.role === "attendee"
          ? isAttendee
          : sql`(${isOrganizer} or ${isAttendee})`;
    const statusCond = f.includeCancelled ? sql`true` : sql`b.status = 'Confirmed'`;
    const res = await tx.execute(sql`
      select ${BOOKING_COLUMNS},
             case when ${isOrganizer} then 'organizer' else 'attendee' end as "myRole"
        from room_bookings b
        join meeting_rooms r on r.id = b.room_id and r.company_id = ${companyId}
       where b.company_id = ${companyId}
         and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(${f.from}::timestamptz, ${f.to}::timestamptz, '[)')
         and ${statusCond} and ${roleCond}
       order by b.starts_at asc, b.id asc
    `);
    return res.rows as unknown as MyRoomBookingRow[];
  }

  /**
   * Huỷ = MỘT câu UPDATE atomic (SPEC-14 §13.3 · DB-16 §6.2): đủ 6 cột allowlist, `WHERE status='Confirmed' AND
   * ends_at > now()`. 0 hàng ⇒ caller đọc lại `findStatusTx` để chọn kind ROOM-ERR-005 (hoặc 404).
   */
  async cancelTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    actorUserId: string,
    reason: string | null,
  ): Promise<RoomBooking | undefined> {
    const res = await tx.execute(sql`
      update room_bookings
         set status = 'Cancelled', cancelled_at = now(), cancelled_by = ${actorUserId},
             cancel_reason = ${reason}, updated_at = now(), updated_by = ${actorUserId}
       where company_id = ${companyId} and id = ${id} and status = 'Confirmed' and ends_at > now()
       returning id, company_id as "companyId", room_id as "roomId", title, description, starts_at as "startsAt",
                 ends_at as "endsAt", organizer_user_id as "organizerUserId", booked_by_user_id as "bookedByUserId",
                 status, cancelled_at as "cancelledAt", cancelled_by as "cancelledBy", cancel_reason as "cancelReason",
                 created_at as "createdAt", updated_at as "updatedAt", updated_by as "updatedBy"
    `);
    return (res.rows as unknown as RoomBooking[])[0];
  }

  /**
   * Job nhắc (ROOM-DEC-004): lượt `Confirmed` có `starts_at ∈ (now, now + 15′]` — index `idx_room_bookings_room_start`
   * không khớp tiền tố (cột 2 là room_id) ⇒ dùng `idx_room_bookings_company_start (company_id, starts_at)`. LIMIT
   * chống unbounded read (mỗi nhịp 60s; dedupe (booking, startsAt) ở NOTI).
   */
  async findRemindersTx(
    tx: TenantTx,
    companyId: string,
    windowMinutes: number,
    limit: number,
  ): Promise<ReminderRow[]> {
    const res = await tx.execute(sql`
      select b.id, b.title, b.starts_at as "startsAt", r.name as "roomName"
        from room_bookings b
        join meeting_rooms r on r.id = b.room_id and r.company_id = ${companyId}
       where b.company_id = ${companyId} and b.status = 'Confirmed'
         and b.starts_at > now() and b.starts_at <= now() + make_interval(mins => ${windowMinutes}::int)
       order by b.starts_at asc, b.id asc
       limit ${limit}
    `);
    return res.rows as unknown as ReminderRow[];
  }
}
