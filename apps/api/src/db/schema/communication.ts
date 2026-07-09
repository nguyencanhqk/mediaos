import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
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
    // ── S4-NOTI-DB-1 (DB-07 §7.3, mig 0479) ALTER-ADD additive — MỌI cột NULLABLE, GIỮ cột legacy trên.
    // FK event_id/template_id/recipient_employee_id = uuid TRẦN (FK ép ở migration 0479) tránh import vòng
    // communication ↔ noti/employees. recipient_user_id/*_by → users (đã import).
    recipientUserId: uuid("recipient_user_id").references(() => users.id, { onDelete: "cascade" }),
    recipientEmployeeId: uuid("recipient_employee_id"),
    eventId: uuid("event_id"),
    templateId: uuid("template_id"),
    moduleCode: varchar("module_code", { length: 50 }),
    eventCode: varchar("event_code", { length: 100 }),
    notificationType: varchar("notification_type", { length: 50 }),
    priority: varchar("priority", { length: 50 }),
    status: varchar("status", { length: 50 }),
    title: varchar("title", { length: 255 }),
    shortBody: varchar("short_body", { length: 500 }),
    sourceEntityType: varchar("source_entity_type", { length: 100 }),
    sourceEntityId: uuid("source_entity_id"),
    sourceEntityCode: varchar("source_entity_code", { length: 100 }),
    targetModule: varchar("target_module", { length: 50 }),
    targetType: varchar("target_type", { length: 100 }),
    targetId: uuid("target_id"),
    targetUrl: varchar("target_url", { length: 500 }),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    dedupeKey: varchar("dedupe_key", { length: 255 }),
    batchKey: varchar("batch_key", { length: 255 }),
    correlationId: varchar("correlation_id", { length: 100 }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("notifications_company_id_idx").on(t.companyId),
    index("notifications_user_id_idx").on(t.userId),
    index("notifications_user_unread_idx").on(t.userId, t.isRead),
    // G16-2 perf (migration 0220): per-user inbox list orders by created_at DESC; this
    // index lets the planner skip the sort and avoids the company_id heap filter.
    // (countUnread stays on notifications_user_unread_idx — already optimal.)
    index("notifications_company_user_created_idx").on(t.companyId, t.userId, t.createdAt.desc()),
    // ── S4-NOTI-DB-1 (mig 0479) NOTI index/uq trên cột mới — parity migration ──
    index("idx_notifications_unread")
      .on(t.companyId, t.recipientUserId)
      .where(sql`status = 'Unread'`),
    index("idx_notifications_recipient_list")
      .on(t.companyId, t.recipientUserId, t.createdAt.desc())
      .where(sql`deleted_at IS NULL`),
    index("idx_notifications_recipient_status_created")
      .on(t.companyId, t.recipientUserId, t.status, t.createdAt.desc())
      .where(sql`deleted_at IS NULL`),
    index("idx_notifications_source_entity")
      .on(t.companyId, t.sourceEntityType, t.sourceEntityId)
      .where(sql`deleted_at IS NULL`),
    index("idx_notifications_batch_key")
      .on(t.companyId, t.batchKey)
      .where(sql`batch_key IS NOT NULL AND deleted_at IS NULL`),
    uniqueIndex("uq_notifications_dedupe_active")
      .on(t.companyId, t.recipientUserId, t.eventCode, t.dedupeKey)
      .where(sql`dedupe_key IS NOT NULL AND deleted_at IS NULL`),
    check(
      "chk_notifications_status",
      sql`status IS NULL OR status IN ('Unread','Read','Hidden','Archived','Deleted','Failed')`,
    ),
    check(
      "chk_notifications_module_code",
      sql`module_code IS NULL OR module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM')`,
    ),
    check(
      "chk_notifications_notification_type",
      sql`notification_type IS NULL OR notification_type IN ('System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder','Warning','Error')`,
    ),
    check(
      "chk_notifications_priority",
      sql`priority IS NULL OR priority IN ('Low','Normal','High','Urgent','Critical')`,
    ),
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

// ─── notification_rules ───────────────────────────────────────────────────────
// G10-2: quy tắc phát notification theo loại sự kiện (company-level config).
// append-only (BẤT BIẾN #2) — app role chỉ INSERT/SELECT, không UPDATE/DELETE.

export const notificationRules = pgTable(
  "notification_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    notificationType: text("notification_type").notNull(),
    /** true = tự động phát notification khi sự kiện xảy ra (company-wide default). */
    enabled: boolean("enabled").notNull().default(true),
    /** true = notification loại này bắt buộc — user KHÔNG được opt-out (NOTI-002). */
    mandatory: boolean("mandatory").notNull().default(false),
    /** Metadata mở rộng (vd: template body, cooldown ms). */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_rules_company_idx").on(t.companyId),
    uniqueIndex("notification_rules_company_type_uq").on(t.companyId, t.notificationType),
  ],
);

export type NotificationRule = typeof notificationRules.$inferSelect;
export type NewNotificationRule = typeof notificationRules.$inferInsert;

// ─── notification_preferences ─────────────────────────────────────────────────
// G10-2: ưu tiên user-level (ghi đè rule company-level). RLS + FORCE.

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notificationType: text("notification_type").notNull(),
    /** true = nhận notification loại này; false = tắt. */
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_preferences_user_idx").on(t.companyId, t.userId),
    uniqueIndex("notification_preferences_user_type_uq").on(
      t.companyId,
      t.userId,
      t.notificationType,
    ),
  ],
);

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;

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
