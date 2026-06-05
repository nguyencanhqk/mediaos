import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";

/**
 * outbox_events — transactional outbox (ADR-0009). Ghi CÙNG tx nghiệp vụ ⇒ "ghi nghiệp vụ thành công
 * ⟺ event được phát". Worker đọc qua directPool, claim FOR UPDATE SKIP LOCKED. DDL/RLS ở 0003.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("outbox_events_claim_idx").on(t.status, t.availableAt)],
);

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;

export const OUTBOX_STATUSES = ["pending", "processing", "done", "failed"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** processed_events — idempotency theo (consumer_name, event_id). Bảng hạ tầng worker (không RLS). */
export const processedEvents = pgTable(
  "processed_events",
  {
    consumerName: text("consumer_name").notNull(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => outboxEvents.id),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumerName, t.eventId] })],
);

/** dead_letter_events — event chết; row chưa resolved ⇒ alert (G2-4). */
export const deadLetterEvents = pgTable(
  "dead_letter_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => outboxEvents.id),
    consumerName: text("consumer_name").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    error: text("error").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("dead_letter_unresolved_idx").on(t.resolvedAt).where(sql`resolved_at IS NULL`),
    unique("dead_letter_event_consumer_uq").on(t.eventId, t.consumerName),
  ],
);

export type DeadLetterEvent = typeof deadLetterEvents.$inferSelect;
