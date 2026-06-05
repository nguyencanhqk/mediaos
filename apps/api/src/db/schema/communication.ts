import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { projects } from "./media";
import { users } from "./users";

// ─── notifications ────────────────────────────────────────────────────────────

export type NotificationType =
  | "task_assigned"
  | "task_submitted"
  | "approval_requested"
  | "approved"
  | "revision_requested"
  | "mentioned"
  | "general";

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

export type ChatRoomType = "project" | "direct";

export const chatRooms = pgTable(
  "chat_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    refId: uuid("ref_id").references(() => projects.id, { onDelete: "set null" }),
    roomType: text("room_type").notNull().default("project"),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_rooms_company_id_idx").on(t.companyId),
    index("chat_rooms_ref_id_idx").on(t.refId),
    uniqueIndex("chat_rooms_project_uq").on(t.companyId, t.refId),
  ],
);

export type ChatRoom = typeof chatRooms.$inferSelect;
export type NewChatRoom = typeof chatRooms.$inferInsert;

// ─── chat_room_members ───────────────────────────────────────────────────────

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
// Append-only: app role chỉ INSERT (bất biến #2 áp dụng cho message history).

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("chat_messages_room_id_idx").on(t.roomId),
    index("chat_messages_company_id_idx").on(t.companyId),
  ],
);

export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
