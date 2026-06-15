import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";

// ─── meeting_rooms ────────────────────────────────────────────────────────────
// Phòng họp vật lý hoặc ảo trong công ty. RLS + FORCE (tenant-iso). Soft-delete.

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
    capacity: integer("capacity"),
    isVirtual: boolean("is_virtual").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("meeting_rooms_company_idx").on(t.companyId),
    index("meeting_rooms_active_idx")
      .on(t.companyId)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type MeetingRoom = typeof meetingRooms.$inferSelect;
export type NewMeetingRoom = typeof meetingRooms.$inferInsert;

// ─── meetings ─────────────────────────────────────────────────────────────────
// Cuộc họp. Double-booking guard qua EXCLUDE GIST ở DB. Soft-delete bằng deleted_at.

export type MeetingStatus = "scheduled" | "cancelled" | "completed";

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    meetingRoomId: uuid("meeting_room_id").references(() => meetingRooms.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("scheduled"),
    agenda: jsonb("agenda").$type<unknown[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("meetings_company_idx").on(t.companyId),
    index("meetings_organizer_idx").on(t.companyId, t.organizerId),
    index("meetings_starts_at_idx").on(t.companyId, t.startsAt),
  ],
);

export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;

// ─── meeting_attendees ────────────────────────────────────────────────────────
// Danh sách người tham dự. RLS tenant-scoped.

export type MeetingRsvp = "pending" | "accepted" | "declined";

export const meetingAttendees = pgTable(
  "meeting_attendees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rsvp: text("rsvp").notNull().default("pending"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("meeting_attendees_meeting_idx").on(t.meetingId),
    index("meeting_attendees_user_idx").on(t.companyId, t.userId),
    uniqueIndex("meeting_attendees_uq").on(t.meetingId, t.userId),
  ],
);

export type MeetingAttendee = typeof meetingAttendees.$inferSelect;
export type NewMeetingAttendee = typeof meetingAttendees.$inferInsert;

// ─── meeting_notes (G10-4 biên bản) ─────────────────────────────────────────────
// Biên bản cuộc họp. UPDATE được (sửa nội dung kèm audit). KHÔNG hard-delete (app role không
// có DELETE grant — bất biến #2). RLS + FORCE tenant-iso.

export const meetingNotes = pgTable(
  "meeting_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("meeting_notes_meeting_idx").on(t.meetingId),
    index("meeting_notes_company_idx").on(t.companyId),
  ],
);

export type MeetingNote = typeof meetingNotes.$inferSelect;
export type NewMeetingNote = typeof meetingNotes.$inferInsert;

// ─── meeting_tasks (G10-4 link meeting↔task) ────────────────────────────────────
// CHỈ là bảng liên kết: cuộc họp ↔ action-item trong Task Hub G9 (`tasks`, task_type='meeting_action').
// Bản thân task sống ở `tasks` (BẤT BIẾN #4 — KHÔNG bảng task riêng). Unique (meeting_id, task_id).

export const meetingTasks = pgTable(
  "meeting_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("meeting_tasks_meeting_idx").on(t.meetingId),
    index("meeting_tasks_company_idx").on(t.companyId),
    uniqueIndex("meeting_tasks_uq").on(t.meetingId, t.taskId),
  ],
);

export type MeetingTask = typeof meetingTasks.$inferSelect;
export type NewMeetingTask = typeof meetingTasks.$inferInsert;
