import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";

/**
 * ROOM (DB-16 §6 / SPEC-14) — 3 bảng module quản lý phòng họp. Thay `schema/meeting.ts` (hub G10: 4 bảng
 * `meetings`/`meeting_attendees`/`meeting_notes`/`meeting_tasks` đã DROP ở mig 0553 — ROOM-DEC-001).
 * DDL/ALTER/RLS+FORCE/policy/grant/composite tenant FK/EXCLUDE/partial-index ở migration 0552 (seed role/quyền/
 * audit 0554 · NOTI 0555). Inference dưới đây PARITY với migration — Drizzle KHÔNG mô tả RLS/grant/policy/composite
 * FK/EXCLUDE; migration là chuẩn. KHÔNG db:generate.
 *
 * company_id NOT NULL (BẤT BIẾN #1): RLS ENABLE + FORCE + policy literal-GUC (meeting_rooms giữ `meeting_rooms_tenant`
 *   0052; 2 bảng mới `tenant_isolation` USING + WITH CHECK). Mọi query qua withTenant(companyId, fn). MỌI FK chéo bảng
 *   nghiệp vụ là COMPOSITE `(company_id, col) → parent(company_id, id)` ở SQL (KI-046 — FK Postgres không áp RLS);
 *   `.references()` một cột dưới đây CHỈ để suy kiểu (riêng meeting_rooms.created_by thật sự còn FK một cột 0052,
 *   đã được 0535 phủ composite).
 *
 * BẤT BIẾN #2: `room_bookings` là SỔ — app role SELECT/INSERT + UPDATE CẤP CỘT (status · cancelled_at · cancelled_by ·
 *   cancel_reason · updated_at · updated_by), KHÔNG DELETE, KHÔNG deleted_at (huỷ là trạng thái). `room_booking_attendees`
 *   chỉ SELECT/INSERT (người tham dự cố định lúc đặt). `meeting_rooms` soft-delete = UPDATE, KHÔNG DELETE.
 *
 * CHỐT CUỐI chống trùng lịch = EXCLUDE `room_bookings_no_overlap_excl` (company_id, room_id, tstzrange [starts_at,
 *   ends_at)) WHERE status = 'Confirmed' — vi phạm ném 23P01 (drizzle giấu mã PG trong `cause`), service map về 409.
 */

// ─── meeting_rooms — TÁI DỤNG (cột sau ALTER 0552) ─────────────────────────────────────────────
export const meetingRooms = pgTable(
  "meeting_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    location: text("location"),
    // CHECK chk_meeting_rooms_capacity (> 0); NOT NULL từ 0552.
    capacity: integer("capacity").notNull(),
    // mảng chuỗi tự do (TV · Bảng trắng…), ≤ 20 mục / 1–40 ký tự — kiểm ở service (contracts roomEquipmentSchema).
    equipment: text("equipment")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    description: text("description"),
    // v1: true ⇒ từ chối đặt (SPEC-14 §3.3 — không có luồng duyệt).
    requiresApproval: boolean("requires_approval").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("meeting_rooms_company_idx").on(t.companyId),
    // Tên phòng unique theo company KHÔNG phân biệt hoa/thường trên hàng còn sống (DB-16 §6.1).
    uniqueIndex("uq_meeting_rooms_company_name_active")
      .on(t.companyId, sql`lower(${t.name})`)
      .where(sql`deleted_at IS NULL`),
    index("idx_meeting_rooms_company_active")
      .on(t.companyId, t.isActive, t.sortOrder)
      .where(sql`deleted_at IS NULL`),
    check("chk_meeting_rooms_capacity", sql`capacity > 0`),
  ],
);

export type MeetingRoom = typeof meetingRooms.$inferSelect;
export type NewMeetingRoom = typeof meetingRooms.$inferInsert;

// ─── room_bookings — SỔ lượt đặt phòng (FSM 2 trạng thái, Completed dẫn xuất) ─────────────────
/** SPEC-01 §17.10 — mirror `chk_room_bookings_status`; nguồn DTO = packages/contracts room.ts. */
export type RoomBookingStatus = "Confirmed" | "Cancelled";

export const roomBookings = pgTable(
  "room_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    // NOT NULL (khác meetings.meeting_room_id di sản) — composite FK NO ACTION.
    roomId: uuid("room_id")
      .notNull()
      .references(() => meetingRooms.id),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    // CHECK chk_room_bookings_time_order (> starts_at); thời lượng 15′–8h kiểm ở service (ROOM-ERR-002).
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // người chủ trì — composite FK NO ACTION.
    organizerUserId: uuid("organizer_user_id")
      .notNull()
      .references(() => users.id),
    // người thao tác (≠ organizer khi Office Admin đặt hộ) — composite NO ACTION: cột KHÔNG nằm trong allowlist
    // UPDATE (dấu vết đặt hộ là dữ liệu sổ; RI action SET NULL chạy ở tầng owner sẽ ghi đè nó — plan D9).
    bookedByUserId: uuid("booked_by_user_id").references(() => users.id),
    status: varchar("status", { length: 20 })
      .$type<RoomBookingStatus>()
      .notNull()
      .default("Confirmed"),
    // Cancelled ⇔ cancelled_at NOT NULL (chk_room_bookings_cancel_pair) — huỷ = MỘT câu UPDATE đủ cột.
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_room_bookings_company_start").on(t.companyId, t.startsAt),
    index("idx_room_bookings_room_start")
      .on(t.companyId, t.roomId, t.startsAt)
      .where(sql`status = 'Confirmed'`),
    index("idx_room_bookings_organizer").on(
      t.companyId,
      t.organizerUserId,
      sql`${t.startsAt} DESC`,
    ),
    check("chk_room_bookings_status", sql`status IN ('Confirmed', 'Cancelled')`),
    check("chk_room_bookings_time_order", sql`ends_at > starts_at`),
    check(
      "chk_room_bookings_cancel_pair",
      sql`(status = 'Confirmed' AND cancelled_at IS NULL) OR (status = 'Cancelled' AND cancelled_at IS NOT NULL)`,
    ),
    // EXCLUDE room_bookings_no_overlap_excl (gist) chỉ ở SQL — Drizzle không mô tả được.
  ],
);

export type RoomBooking = typeof roomBookings.$inferSelect;
export type NewRoomBooking = typeof roomBookings.$inferInsert;

// ─── room_booking_attendees — SỔ người tham dự (cố định lúc đặt; organizer KHÔNG nằm ở đây) ────
export const roomBookingAttendees = pgTable(
  "room_booking_attendees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => roomBookings.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_room_booking_attendees_booking_user").on(t.companyId, t.bookingId, t.userId),
    index("idx_room_booking_attendees_user").on(t.companyId, t.userId, t.bookingId),
  ],
);

export type RoomBookingAttendee = typeof roomBookingAttendees.$inferSelect;
export type NewRoomBookingAttendee = typeof roomBookingAttendees.$inferInsert;
