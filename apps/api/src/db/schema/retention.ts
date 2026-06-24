import { sql } from "drizzle-orm";
import {
  boolean,
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
import { companies } from "./companies";
import { users } from "./users";

/**
 * FOUNDATION-DB-5 — data_retention_policies (DB-08 §8.11). DDL/RLS/grant ở migration 0435. Inference dưới
 * đây PARITY với migration (drizzle KHÔNG mô tả RLS/grant/partial-index — migration là nguồn sự thật).
 *
 * `company_id` NULLABLE (DB-08 §5.3): NULL = global default policy; NOT NULL = override theo công ty. RLS
 * policy (mẫu 0434 nullable-tenant): USING (company_id = current_setting OR company_id IS NULL),
 * WITH CHECK (company_id = current_setting) — tenant ĐỌC policy mình + global; app role CHỈ ghi policy
 * tenant mình, KHÔNG ghi global (company_id NULL) → KHÔNG rò chéo tenant.
 *
 * Config mutable + soft-delete (deleted_at). App SELECT/INSERT/UPDATE; KHÔNG DELETE (BẤT BIẾN #2).
 * cleanup_action ∈ None/Archive/Delete/Anonymize · retention_days >= 0 (CHECK ở migration). uq
 * (company_id, module_code, entity_type) WHERE deleted_at IS NULL AND is_enabled (partial — chỉ ở SQL).
 */
export const dataRetentionPolicies = pgTable(
  "data_retention_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULLABLE: global default = NULL (mẫu 0434 — KHÔNG .notNull(), KHÔNG default current_setting).
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    moduleCode: varchar("module_code", { length: 50 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    retentionDays: integer("retention_days").notNull(),
    archiveAfterDays: integer("archive_after_days"),
    deleteAfterDays: integer("delete_after_days"),
    cleanupAction: varchar("cleanup_action", { length: 50 }).notNull().default("None"),
    isLegalHoldSupported: boolean("is_legal_hold_supported").notNull().default(false),
    isEnabled: boolean("is_enabled").notNull().default(false),
    description: text("description"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    // Partial unique index (WHERE + COALESCE company_id) chỉ ở migration SQL — drizzle parity index thường.
    uniqueIndex("uq_data_retention_company_module_entity_active")
      .on(t.companyId, t.moduleCode, t.entityType)
      .where(sql`deleted_at IS NULL AND is_enabled = true`),
    index("idx_data_retention_module_entity")
      .on(t.moduleCode, t.entityType, t.isEnabled)
      .where(sql`deleted_at IS NULL`),
    index("data_retention_policies_company_id_idx").on(t.companyId),
  ],
);

export type DataRetentionPolicy = typeof dataRetentionPolicies.$inferSelect;
export type NewDataRetentionPolicy = typeof dataRetentionPolicies.$inferInsert;
