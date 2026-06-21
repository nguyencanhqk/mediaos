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
 * FOUNDATION-DB-5 — modules + seed_batches + seed_items (DB-08 §8.2/8.12/8.13). DDL/RLS/grant/seed ở
 * migration 0435. Inference dưới đây PARITY với migration (drizzle KHÔNG mô tả RLS/grant/partial-index —
 * migration là nguồn sự thật).
 */

/**
 * `modules` — catalog module CHUẨN spec (DB-08 §8.2). KHÔNG company_id ⇒ no-RLS (mirror permissions /
 * system_settings). KHÁC `system_modules` (module-registry.ts / 0330 — SaaS feature-flag catalog). Seed
 * MVP active AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI; PAYROLL.. inactive. App SELECT/INSERT/UPDATE; KHÔNG DELETE
 * (soft via deleted_at — KHÔNG hard-delete module đã phát sinh permission/audit, §8.2 rule 4).
 */
export const modules = pgTable(
  "modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleCode: varchar("module_code", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    moduleGroup: varchar("module_group", { length: 100 }),
    version: varchar("version", { length: 50 }),
    isCore: boolean("is_core").notNull().default(false),
    isMvp: boolean("is_mvp").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    dependencies: jsonb("dependencies"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_modules_module_code_active")
      .on(t.moduleCode)
      .where(sql`deleted_at IS NULL`),
    index("idx_modules_group_active")
      .on(t.moduleGroup, t.isActive)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type Module = typeof modules.$inferSelect;
export type NewModule = typeof modules.$inferInsert;

/**
 * `seed_batches` — theo dõi batch seed idempotent (DB-08 §8.12). company_id NULLABLE (NULL = global seed,
 * NOT NULL = seed theo company). RLS policy nullable-tenant (mẫu 0434): USING (company_id = current_setting
 * OR company_id IS NULL), WITH CHECK (company_id = current_setting). Tracking mutable (status
 * Pending→Running→Success/Failed); app+worker SELECT/INSERT/UPDATE; KHÔNG DELETE (giữ lịch sử seed).
 * status ∈ Pending/Running/Success/Failed/Skipped/RolledBack (CHECK ở migration). uq (company_id, seed_key,
 * seed_version) — COALESCE company_id ở migration SQL (NULL global cũng 1 slot).
 */
export const seedBatches = pgTable(
  "seed_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULLABLE: global seed = NULL (mẫu 0434).
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    seedKey: varchar("seed_key", { length: 150 }).notNull(),
    seedVersion: varchar("seed_version", { length: 50 }).notNull(),
    environment: varchar("environment", { length: 50 }),
    description: text("description"),
    checksum: varchar("checksum", { length: 128 }),
    status: varchar("status", { length: 50 }).notNull().default("Pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    executedBy: uuid("executed_by").references(() => users.id, { onDelete: "set null" }),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Partial-COALESCE unique index chỉ ở migration SQL — drizzle parity bằng index thường.
    uniqueIndex("uq_seed_batches_key_version_company").on(t.companyId, t.seedKey, t.seedVersion),
    index("idx_seed_batches_status").on(t.status, t.createdAt),
    index("seed_batches_company_id_idx").on(t.companyId),
  ],
);

export type SeedBatch = typeof seedBatches.$inferSelect;
export type NewSeedBatch = typeof seedBatches.$inferInsert;

/**
 * `seed_items` — từng item trong batch (DB-08 §8.13). company_id NULLABLE (NULL = global, NOT NULL =
 * company). target_key = business key seed; checksum + status để idempotent. RLS policy nullable-tenant
 * (mẫu 0434). FK seed_batch_id → seed_batches (1 batch n item, ON DELETE CASCADE). Tracking mutable
 * (status Pending→Success/Failed); app+worker SELECT/INSERT/UPDATE; KHÔNG DELETE.
 * operation ∈ Insert/Update/Upsert/Delete/Skip · status ∈ Pending/Success/Failed/Skipped (CHECK ở migration).
 * uq (seed_batch_id, target_table, target_key) — idempotent theo business key.
 */
export const seedItems = pgTable(
  "seed_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seedBatchId: uuid("seed_batch_id")
      .notNull()
      .references(() => seedBatches.id, { onDelete: "cascade" }),
    // NULLABLE: global item = NULL.
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    targetTable: varchar("target_table", { length: 100 }).notNull(),
    targetKey: varchar("target_key", { length: 255 }).notNull(),
    operation: varchar("operation", { length: 50 }).notNull().default("Upsert"),
    payload: jsonb("payload"),
    checksum: varchar("checksum", { length: 128 }),
    status: varchar("status", { length: 50 }).notNull().default("Pending"),
    targetId: uuid("target_id"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_seed_items_batch_target").on(t.seedBatchId, t.targetTable, t.targetKey),
    index("idx_seed_items_target").on(t.targetTable, t.targetKey),
    index("seed_items_company_id_idx").on(t.companyId),
  ],
);

export type SeedItem = typeof seedItems.$inferSelect;
export type NewSeedItem = typeof seedItems.$inferInsert;
