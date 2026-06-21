import { sql } from "drizzle-orm";
import {
  boolean,
  index,
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
import { users } from "./users";

/**
 * FOUNDATION-DB-1 — settings (DB-08 §8.3/8.4). DDL/RLS/grant ở migration 0431. Inference dưới đây PARITY
 * với migration (drizzle KHÔNG mô tả RLS/grant — quy ước bằng comment + migration là nguồn sự thật).
 *
 * Precedence đọc cấu hình (BACKEND-11 §13.3): company_settings → system_settings → default hard-coded.
 *
 * value_type ∈ String/Number/Boolean/JSON/Array/SecretRef · status ∈ Active/Inactive (CHECK ở migration).
 */

/**
 * `system_settings` — cấu hình GLOBAL/default toàn hệ thống (DB-08 §8.3). KHÔNG company_id ⇒ no-RLS
 * (mirror system_modules/permissions). uq theo setting_key WHERE status='Active'. App SELECT/INSERT/UPDATE;
 * KHÔNG DELETE (soft via status='Inactive') — KHÔNG append-only (config mutable, không phải audit/snapshot).
 */
export const systemSettings = pgTable(
  "system_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    settingKey: varchar("setting_key", { length: 150 }).notNull(),
    settingValue: jsonb("setting_value").notNull(),
    valueType: varchar("value_type", { length: 50 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    moduleCode: varchar("module_code", { length: 50 }),
    description: text("description"),
    isPublic: boolean("is_public").notNull().default(false),
    isSensitive: boolean("is_sensitive").notNull().default(false),
    isEncrypted: boolean("is_encrypted").notNull().default(false),
    secretRef: varchar("secret_ref", { length: 255 }),
    validationSchema: jsonb("validation_schema"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    status: varchar("status", { length: 50 }).notNull().default("Active"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_system_settings_key_active")
      .on(t.settingKey)
      .where(sql`status = 'Active'`),
    index("idx_system_settings_category").on(t.category, t.moduleCode, t.status),
  ],
);

/**
 * `company_settings` — override cấu hình theo công ty (DB-08 §8.4). company_id NOT NULL + RLS ENABLE/FORCE +
 * policy tenant_isolation (migration 0431). Soft-delete (deleted_at). uq (company_id, setting_key) WHERE
 * deleted_at IS NULL AND status='Active'. App SELECT/INSERT/UPDATE; KHÔNG DELETE (soft-delete, BẤT BIẾN #2).
 */
export const companySettings = pgTable(
  "company_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    settingKey: varchar("setting_key", { length: 150 }).notNull(),
    settingValue: jsonb("setting_value").notNull(),
    valueType: varchar("value_type", { length: 50 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    moduleCode: varchar("module_code", { length: 50 }),
    description: text("description"),
    isPublic: boolean("is_public").notNull().default(false),
    isSensitive: boolean("is_sensitive").notNull().default(false),
    isEncrypted: boolean("is_encrypted").notNull().default(false),
    secretRef: varchar("secret_ref", { length: 255 }),
    validationSchema: jsonb("validation_schema"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
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
    uniqueIndex("uq_company_settings_key_active")
      .on(t.companyId, t.settingKey)
      .where(sql`deleted_at IS NULL AND status = 'Active'`),
    index("idx_company_settings_company_category")
      .on(t.companyId, t.category, t.moduleCode, t.status)
      .where(sql`deleted_at IS NULL`),
    index("company_settings_company_id_idx").on(t.companyId),
  ],
);

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;
export type CompanySetting = typeof companySettings.$inferSelect;
export type NewCompanySetting = typeof companySettings.$inferInsert;
