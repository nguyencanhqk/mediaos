import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { channels, projects } from "./media";
import { orgUnits } from "./org";
import { users } from "./users";

// ─── notifications ────────────────────────────────────────────────────────────

export type NotificationType =
  | "task_assigned"
  | "task_submitted"
  | "approval_requested"
  | "approved"
  | "revision_requested"
  | "mentioned"
  | "general"
  // G10-3 / G10-4
  | "chat_message"
  | "meeting_invited"
  | "meeting_action_assigned";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("general"),
    refId: uuid("ref_id"),
    refType: text("ref_type"),
    body: text("body").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_company_id_idx").on(t.companyId),
    index("notifications_user_id_idx").on(t.userId),
    index("notifications_user_unread_idx").on(t.userId, t.isRead),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

// ─── chat_rooms ──────────────────────────────────────────────────────────────
// G10-1: mở rộng room_type + auto-room (channel/org_unit) + direct DM dedup (direct_key).

export type ChatRoomType = "project" | "direct" | "group" | "channel" | "department";

export const chatRooms = pgTable(
  "chat_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    refId: uuid("ref_id").references(() => projects.id, { onDelete: "set null" }),
    // G10-2 auto-room: 1 channel/org_unit ↔ 1 room (unique partial idx bên dưới).
    channelId: uuid("channel_id").references(() => channels.id, { onDelete: "set null" }),
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    // G10-1 DM 1-1: direct_key = 2 userId (sort asc) join ":" → dedup idempotent phòng direct.
    directKey: text("direct_key"),
    roomType: text("room_type").notNull().default("project"),
    name: text("name").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_rooms_company_id_idx").on(t.companyId),
    index("chat_rooms_ref_id_idx").on(t.refId),
    uniqueIndex("chat_rooms_project_uq")
      .on(t.companyId, t.refId)
      .where(sql`ref_id IS NOT NULL`),
    uniqueIndex("chat_rooms_channel_uq")
      .on(t.companyId, t.channelId)
      .where(sql`channel_id IS NOT NULL`),
    uniqueIndex("chat_rooms_org_unit_uq")
      .on(t.companyId, t.orgUnitId)
      .where(sql`org_unit_id IS NOT NULL`),
    uniqueIndex("chat_rooms_direct_uq")
      .on(t.companyId, t.directKey)
      .where(sql`direct_key IS NOT NULL`),
  ],
);

export type ChatRoom = typeof chatRooms.$inferSelect;
export type NewChatRoom = typeof chatRooms.$inferInsert;

// ─── chat_room_members ───────────────────────────────────────────────────────

export type ChatMemberRole = "member" | "admin";

export const chatRoomMembers = pgTable(
  "chat_room_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // G10-1: phân quyền trong phòng (admin thêm/xoá member); last_read_at cho unread badge.
    role: text("role").notNull().default("member"),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_room_members_room_id_idx").on(t.roomId),
    index("chat_room_members_user_id_idx").on(t.userId),
    uniqueIndex("chat_room_members_room_user_uq").on(t.roomId, t.userId),
  ],
);

export type ChatRoomMember = typeof chatRoomMembers.$inferSelect;
export type NewChatRoomMember = typeof chatRoomMembers.$inferInsert;

// ─── chat_messages ───────────────────────────────────────────────────────────
// Append-only cho body/sender (BẤT BIẾN #2). G10-1 chỉ cấp UPDATE 2 cột (pinned_at, pinned_by)
// qua column-level GRANT — KHÔNG sửa được body/sender. seq = thứ tự tổng ổn định trong room.

export type ChatMessageType = "text" | "file";

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    messageType: text("message_type").notNull().default("text"),
    fileUrl: text("file_url"),
    fileName: text("file_name"),
    mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    pinnedBy: uuid("pinned_by").references(() => users.id, { onDelete: "set null" }),
    seq: bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_messages_room_id_idx").on(t.roomId),
    index("chat_messages_company_id_idx").on(t.companyId),
    index("chat_messages_room_seq_idx").on(t.roomId, t.seq),
    index("chat_messages_pinned_idx")
      .on(t.roomId, t.pinnedAt)
      .where(sql`pinned_at IS NOT NULL`),
  ],
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
