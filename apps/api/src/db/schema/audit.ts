import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";

/**
 * audit_logs — append-only (BẤT BIẾN #2). DDL/RLS/grant ở migration 0003. app role chỉ INSERT/SELECT
 * (không UPDATE/DELETE). Cột chốt theo plan G2-4. KHÔNG ghi secret/hash vào before/after (bất biến #3).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_company_object_idx").on(t.companyId, t.objectType, t.objectId)],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

/** object_type cho phép (đồng bộ CHECK ở 0003). Mở rộng = thêm ở cả hai nơi. */
export const AUDIT_OBJECT_TYPES = ["company", "user", "auth", "outbox_event"] as const;
export type AuditObjectType = (typeof AUDIT_OBJECT_TYPES)[number];
