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
import { notifications } from "./communication";
import { users } from "./users";

/**
 * NOTI Core (DB-07 §7.1–7.4) — 3 bảng MỚI. DDL/RLS+FORCE/policy/grant/partial-index ở migration 0479.
 * Inference dưới đây PARITY với migration (drizzle KHÔNG mô tả RLS/grant/partial-index — migration là chuẩn).
 *
 * company_id (DB-07 §4.3):
 *   • notification_events / notification_templates — NULLABLE: NULL = catalog GLOBAL dùng chung; NOT NULL =
 *     company override. RLS policy nullable-tenant (mẫu 0434 sequences/holidays): USING (company_id=GUC OR
 *     IS NULL), WITH CHECK (company_id=GUC). App GRANT SELECT-only (write company-override → S4-NOTI-BE-3).
 *   • notification_delivery_logs — NOT NULL: policy literal-GUC chuẩn. APPEND-ONLY (BẤT BIẾN #2): app GRANT
 *     SELECT,INSERT — KHÔNG UPDATE/DELETE. Retry = INSERT hàng attempt_no MỚI (KHÔNG update in-place).
 */

// ─── notification_events (DB-07 §7.1) ─────────────────────────────────────────

export const notificationEvents = pgTable(
  "notification_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULLABLE: global event = NULL (KHÔNG .notNull(), KHÔNG default current_setting — mẫu 0434 sequences).
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    moduleCode: varchar("module_code", { length: 50 }).notNull(),
    eventCode: varchar("event_code", { length: 100 }).notNull(),
    eventName: varchar("event_name", { length: 255 }).notNull(),
    description: text("description"),
    notificationType: varchar("notification_type", { length: 50 }).notNull(),
    defaultPriority: varchar("default_priority", { length: 50 }).notNull().default("Normal"),
    defaultChannels: jsonb("default_channels").$type<string[]>().notNull().default(["IN_APP"]),
    recipientRuleConfig: jsonb("recipient_rule_config").$type<Record<string, unknown>>(),
    dedupeStrategy: varchar("dedupe_strategy", { length: 50 }).notNull().default("None"),
    dedupeWindowSeconds: integer("dedupe_window_seconds"),
    throttleConfig: jsonb("throttle_config").$type<Record<string, unknown>>(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    isSystemEvent: boolean("is_system_event").notNull().default(false),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_notification_events_global_code_active")
      .on(t.eventCode)
      .where(sql`company_id IS NULL AND deleted_at IS NULL`),
    uniqueIndex("uq_notification_events_company_code_active")
      .on(t.companyId, t.eventCode)
      .where(sql`company_id IS NOT NULL AND deleted_at IS NULL`),
    index("idx_notification_events_module")
      .on(t.moduleCode, t.isEnabled)
      .where(sql`deleted_at IS NULL`),
    index("idx_notification_events_company_module")
      .on(t.companyId, t.moduleCode, t.isEnabled)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_notification_events_module_code",
      sql`module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM')`,
    ),
    check(
      "chk_notification_events_type",
      sql`notification_type IN ('System','Account','HR','Attendance','Leave','Task','Project','Approval','Reminder','Warning','Error')`,
    ),
    check(
      "chk_notification_events_priority",
      sql`default_priority IN ('Low','Normal','High','Urgent','Critical')`,
    ),
    check(
      "chk_notification_events_dedupe_strategy",
      sql`dedupe_strategy IN ('None','DedupeKey','TimeWindow','EntityRecipient')`,
    ),
  ],
);

export type NotificationEvent = typeof notificationEvents.$inferSelect;
export type NewNotificationEvent = typeof notificationEvents.$inferInsert;

// ─── notification_templates (DB-07 §7.2) ──────────────────────────────────────

export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => notificationEvents.id, { onDelete: "cascade" }),
    templateCode: varchar("template_code", { length: 100 }).notNull(),
    channel: varchar("channel", { length: 50 }).notNull().default("IN_APP"),
    locale: varchar("locale", { length: 20 }).notNull().default("vi-VN"),
    titleTemplate: varchar("title_template", { length: 255 }).notNull(),
    bodyTemplate: text("body_template").notNull(),
    shortBodyTemplate: varchar("short_body_template", { length: 500 }),
    actionLabelTemplate: varchar("action_label_template", { length: 100 }),
    targetUrlTemplate: varchar("target_url_template", { length: 500 }),
    variablesSchema: jsonb("variables_schema").$type<Record<string, unknown>>(),
    samplePayload: jsonb("sample_payload").$type<Record<string, unknown>>(),
    version: integer("version").notNull().default(1),
    status: varchar("status", { length: 50 }).notNull().default("Draft"),
    isDefault: boolean("is_default").notNull().default(false),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_notification_templates_global_code_active")
      .on(t.templateCode)
      .where(sql`company_id IS NULL AND deleted_at IS NULL`),
    uniqueIndex("uq_notification_templates_company_code_active")
      .on(t.companyId, t.templateCode)
      .where(sql`company_id IS NOT NULL AND deleted_at IS NULL`),
    index("idx_notification_templates_event_channel_locale")
      .on(t.eventId, t.channel, t.locale, t.status)
      .where(sql`deleted_at IS NULL`),
    index("idx_notification_templates_company_event")
      .on(t.companyId, t.eventId, t.channel, t.locale, t.status)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_notification_templates_channel",
      sql`channel IN ('IN_APP','EMAIL','PUSH','REALTIME','INTEGRATION')`,
    ),
    check(
      "chk_notification_templates_status",
      sql`status IN ('Draft','Active','Inactive','Archived')`,
    ),
    check(
      "chk_notification_templates_effective_range",
      sql`effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from`,
    ),
  ],
);

export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
export type NewNotificationTemplate = typeof notificationTemplates.$inferInsert;

// ─── notification_delivery_logs (DB-07 §7.4 — APPEND-ONLY) ────────────────────
// company_id NOT NULL. KHÔNG deleted_at (append-only). App GRANT SELECT,INSERT (migration 0479) —
// KHÔNG UPDATE/DELETE. `updated_at` tồn tại theo DB-07 nhưng app KHÔNG update (retry = hàng attempt_no mới).

export const notificationDeliveryLogs = pgTable(
  "notification_delivery_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: varchar("channel", { length: 50 }).notNull(),
    provider: varchar("provider", { length: 100 }),
    deliveryStatus: varchar("delivery_status", { length: 50 }).notNull().default("Pending"),
    attemptNo: integer("attempt_no").notNull().default(1),
    maxAttempts: integer("max_attempts").notNull().default(1),
    requestPayload: jsonb("request_payload").$type<Record<string, unknown>>(),
    responsePayload: jsonb("response_payload").$type<Record<string, unknown>>(),
    externalMessageId: varchar("external_message_id", { length: 255 }),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_notification_delivery_logs_notification").on(t.notificationId, t.channel),
    index("idx_notification_delivery_logs_company_status_retry").on(
      t.companyId,
      t.deliveryStatus,
      t.nextRetryAt,
    ),
    index("idx_notification_delivery_logs_recipient_created").on(
      t.companyId,
      t.recipientUserId,
      t.createdAt.desc(),
    ),
    index("idx_notification_delivery_logs_channel_status").on(
      t.companyId,
      t.channel,
      t.deliveryStatus,
      t.createdAt.desc(),
    ),
    check(
      "chk_notification_delivery_logs_channel",
      sql`channel IN ('IN_APP','EMAIL','PUSH','REALTIME','INTEGRATION')`,
    ),
    check(
      "chk_notification_delivery_logs_status",
      sql`delivery_status IN ('Pending','Sent','Delivered','Failed','Skipped','Cancelled')`,
    ),
    check(
      "chk_notification_delivery_logs_attempt",
      sql`attempt_no >= 1 AND max_attempts >= attempt_no`,
    ),
  ],
);

export type NotificationDeliveryLog = typeof notificationDeliveryLogs.$inferSelect;
export type NewNotificationDeliveryLog = typeof notificationDeliveryLogs.$inferInsert;
