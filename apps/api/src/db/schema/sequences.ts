import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

/**
 * FOUNDATION-DB-4 — sequence_counters (DB-08 §8.9). DDL/RLS/grant ở migration 0434. Inference dưới đây
 * PARITY với migration (drizzle KHÔNG mô tả RLS/grant/partial-index — migration là nguồn sự thật).
 *
 * `company_id` NULLABLE (DB-08 §5.3): NULL = system/global sequence dùng chung; NOT NULL = counter theo
 * công ty. RLS policy (mẫu 0005 roles): USING (company_id = current_setting OR company_id IS NULL),
 * WITH CHECK (company_id = current_setting) — tenant ĐỌC counter mình + global; app role CHỈ ghi counter
 * tenant mình, KHÔNG ghi global (company_id NULL) → KHÔNG rò chéo tenant.
 *
 * Mutable counter + soft-delete (deleted_at). App SELECT/INSERT/UPDATE; KHÔNG DELETE (BẤT BIẾN #2).
 * SequenceService dùng SELECT ... FOR UPDATE trong tx (KHÔNG MAX(code)+1 — DB-08 §8.9 rule 1/2).
 *
 * scope_type ∈ System/Company/Department/Employee/Custom · reset_policy ∈ Never/Yearly/Monthly/Daily ·
 * status ∈ Active/Inactive (CHECK ở migration). uq (company_id, sequence_key, scope_type, scope_reference_id)
 * WHERE deleted_at IS NULL (partial — chỉ ở migration SQL).
 */
export const sequenceCounters = pgTable(
  "sequence_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULLABLE: system/global sequence = NULL (mẫu 0005 roles — KHÔNG .notNull(), KHÔNG default current_setting).
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    moduleCode: varchar("module_code", { length: 50 }).notNull(),
    sequenceKey: varchar("sequence_key", { length: 150 }).notNull(),
    scopeType: varchar("scope_type", { length: 50 }).notNull().default("Company"),
    scopeReferenceId: uuid("scope_reference_id"),
    prefix: varchar("prefix", { length: 100 }),
    suffix: varchar("suffix", { length: 100 }),
    currentValue: bigint("current_value", { mode: "bigint" }).notNull().default(0n),
    incrementBy: integer("increment_by").notNull().default(1),
    paddingLength: integer("padding_length").notNull().default(0),
    resetPolicy: varchar("reset_policy", { length: 50 }).notNull().default("Never"),
    resetFormat: varchar("reset_format", { length: 50 }),
    lastResetAt: timestamp("last_reset_at", { withTimezone: true }),
    lastGeneratedCode: varchar("last_generated_code", { length: 255 }),
    formatPattern: varchar("format_pattern", { length: 255 }),
    lockVersion: integer("lock_version").notNull().default(0),
    status: varchar("status", { length: 50 }).notNull().default("Active"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    // Partial unique index (WHERE + COALESCE) chỉ ở migration SQL — drizzle parity bằng index thường.
    uniqueIndex("uq_sequence_counters_company_key_scope_active")
      .on(t.companyId, t.sequenceKey, t.scopeType, t.scopeReferenceId)
      .where(sql`deleted_at IS NULL`),
    index("idx_sequence_counters_company_module")
      .on(t.companyId, t.moduleCode, t.status)
      .where(sql`deleted_at IS NULL`),
    // DB-09 §8.9 (mig 0472) — quét counter cần reset (job đầu năm/tháng/ngày). Predicate PascalCase
    // 'Yearly'/'Monthly'/'Daily' KHỚP CHECK chk_sequence_counters_reset_policy (0434) + seed DB-10.
    index("idx_sequence_counters_reset")
      .on(t.resetPolicy, t.lastResetAt)
      .where(sql`reset_policy IN ('Yearly', 'Monthly', 'Daily')`),
    index("sequence_counters_company_id_idx").on(t.companyId),
  ],
);

export type SequenceCounter = typeof sequenceCounters.$inferSelect;
export type NewSequenceCounter = typeof sequenceCounters.$inferInsert;
