import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";
import { users } from "./users";

/**
 * user_preferences (DB-08 §8.16 / SPEC-09 §15.2) — tùy chọn cá nhân theo user cho module ME
 * (tầng User trong precedence setting System → Company → User). DDL/RLS+FORCE/policy/grant/CHECK/UNIQUE
 * ở migration 0495. Inference dưới đây PARITY với migration (Drizzle KHÔNG mô tả RLS/grant/policy — migration
 * là chuẩn). KHÔNG db:generate (tránh sinh DROP schema media/finance cũ đang park).
 *
 * company_id NOT NULL (DB-08 §8.16, BẤT BIẾN #1): RLS ENABLE + FORCE + policy tenant_isolation literal-GUC
 *   (company_id = NULLIF(current_setting('app.current_company_id',true),'')::uuid) — mẫu 0479. Mọi truy vấn
 *   đi qua withTenant(companyId, fn). App GRANT SELECT,INSERT,UPDATE (upsert-config) — KHÔNG DELETE, KHÔNG
 *   soft-delete (config MUTABLE). worker GRANT SELECT.
 *
 * ⚠️ CROSS-USER KHÔNG DO RLS: policy chỉ cô lập TENANT (GUC app.current_company_id). Chống IDOR cross-user
 *   (đọc/ghi pref của user khác cùng company) ép ở ME-BE: WHERE user_id = token-resolved (SPEC-09 §14.4/§17.1).
 *
 * Cột override NULLABLE (NULL = kế thừa company/system default — §15.3/§5.9). UNIQUE(company_id, user_id) =
 * 1 bản ghi/user (upsert business key). favorite_modules/me_layout_config KHÔNG chứa secret (§8.16 rule 5).
 */
export const userPreferences = pgTable(
  "user_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NOT NULL + DEFAULT literal-GUC (khớp migration): app khỏi tự set, WITH CHECK vẫn chặn gán sai tenant.
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Cột override NULLABLE (NULL = kế thừa company/system default).
    locale: varchar("locale", { length: 20 }),
    timezone: varchar("timezone", { length: 64 }),
    theme: varchar("theme", { length: 20 }),
    dateFormat: varchar("date_format", { length: 30 }),
    timeFormat: varchar("time_format", { length: 10 }),
    defaultLanding: varchar("default_landing", { length: 120 }),
    density: varchar("density", { length: 20 }),
    favoriteModules: jsonb("favorite_modules").$type<string[]>(),
    meLayoutConfig: jsonb("me_layout_config").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_user_preferences_company_user").on(t.companyId, t.userId),
    check("chk_user_preferences_theme", sql`theme IS NULL OR theme IN ('system', 'light', 'dark')`),
    check(
      "chk_user_preferences_density",
      sql`density IS NULL OR density IN ('comfortable', 'compact')`,
    ),
    check(
      "chk_user_preferences_time_format",
      sql`time_format IS NULL OR time_format IN ('12h', '24h')`,
    ),
  ],
);

export type UserPreference = typeof userPreferences.$inferSelect;
export type NewUserPreference = typeof userPreferences.$inferInsert;
