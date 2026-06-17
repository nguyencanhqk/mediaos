import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";

/** bytea — cột nhị phân (drizzle pg-core không export sẵn). node-postgres trả/nhận Buffer cho bytea. */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * AC-6 Webhooks (TENANT self-service). DDL/RLS/grant ở migration 0320. 3 bảng per-tenant FORCE-RLS:
 *   • webhook_endpoints — URL nhận webhook + HMAC secret (envelope-KMS, BẤT BIẾN #3). soft-delete.
 *   • webhook_event_subscriptions — endpoint đăng ký event_type nào (JOIN, KHÔNG array).
 *   • webhook_deliveries — log mỗi lần giao (APPEND-ONLY + UPDATE chỉ cột vòng đời).
 *
 * BẤT BIẾN #1: company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy tenant_isolation.
 * BẤT BIẾN #3: HMAC secret reversible → 7 cột envelope (secret_ciphertext/encrypted_dek/dek_key_version/
 *   kms_key_id/iv_nonce/auth_tag/enc_algo). KHÔNG cột plaintext. AAD = companyId‖endpoint_id (recordId=id).
 */

/** ── webhook_endpoints (MUTABLE: app UPDATE active/description/deleted_at; KHÔNG đổi secret/url qua app) ── */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    // ── 7 cột envelope HMAC secret (mirror platform_accounts / user_totp) ──
    secretCiphertext: bytea("secret_ciphertext").notNull(),
    encryptedDek: bytea("encrypted_dek").notNull(),
    dekKeyVersion: integer("dek_key_version").notNull(),
    kmsKeyId: text("kms_key_id").notNull(),
    ivNonce: bytea("iv_nonce").notNull(),
    authTag: bytea("auth_tag").notNull(),
    encAlgo: text("enc_algo").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_company_id_idx").on(t.companyId)],
);

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;

/** ── webhook_event_subscriptions (endpoint ↔ event_type, JOIN không array) ── */
export const webhookEventSubscriptions = pgTable(
  "webhook_event_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_event_subscriptions_company_id_idx").on(t.companyId),
    index("webhook_event_subscriptions_company_endpoint_idx").on(t.companyId, t.endpointId),
    uniqueIndex("webhook_event_subscriptions_uq").on(t.companyId, t.endpointId, t.eventType),
  ],
);

export type WebhookEventSubscription = typeof webhookEventSubscriptions.$inferSelect;
export type NewWebhookEventSubscription = typeof webhookEventSubscriptions.$inferInsert;

/** ── webhook_deliveries (log giao — APPEND-ONLY + UPDATE chỉ cột vòng đời) ── */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseCode: integer("response_code"),
    lastError: text("last_error"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_company_id_idx").on(t.companyId),
    index("webhook_deliveries_company_endpoint_idx").on(t.companyId, t.endpointId),
  ],
);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
