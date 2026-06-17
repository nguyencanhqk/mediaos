import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";

/**
 * AC-4 UI config (Admin Control Plane N3) — branding / navigation / i18n overrides per-tenant.
 * DDL/RLS/grant ở migration 0300. TENANT self-service (companyId từ JWT, KHÔNG cross-tenant operator).
 *
 * BẤT BIẾN #1: company_id NOT NULL DEFAULT current_setting + RLS ENABLE/FORCE + policy tenant_isolation.
 * BẤT BIẾN #2: KHÔNG hard-delete (branding upsert 1-row; navigation/i18n soft-delete deleted_at).
 * BẤT BIẾN #3: KHÔNG secret — chỉ metadata công khai (logo/màu/label/route/i18n) ⇒ is_sensitive=FALSE.
 */

/** tenant_branding — 1 row / tenant (UNIQUE company_id), upsert idempotent. */
export const tenantBranding = pgTable(
  "tenant_branding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    logoUrl: text("logo_url"),
    faviconUrl: text("favicon_url"),
    primaryColor: text("primary_color"),
    secondaryColor: text("secondary_color"),
    companyName: text("company_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tenant_branding_company_id_idx").on(t.companyId),
    unique("tenant_branding_company_uq").on(t.companyId),
  ],
);

export type TenantBranding = typeof tenantBranding.$inferSelect;
export type NewTenantBranding = typeof tenantBranding.$inferInsert;

/**
 * ui_navigation_config — item menu per-tenant. UNIQUE(company_id, key). moduleKey nullable (ẩn nếu module
 * tắt qua FeatureFlagService). isVisible=false ẩn cứng. deletedAt soft-delete (BẤT BIẾN #2).
 */
export const uiNavigationConfig = pgTable(
  "ui_navigation_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    route: text("route").notNull(),
    icon: text("icon"),
    parentKey: text("parent_key"),
    displayOrder: integer("display_order").notNull().default(0),
    moduleKey: text("module_key"),
    isVisible: boolean("is_visible").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("ui_navigation_config_company_id_idx").on(t.companyId),
    unique("ui_navigation_company_key_uq").on(t.companyId, t.key),
  ],
);

export type UiNavigationConfig = typeof uiNavigationConfig.$inferSelect;
export type NewUiNavigationConfig = typeof uiNavigationConfig.$inferInsert;

/** i18n_overrides — đè chuỗi dịch per-tenant. UNIQUE(company_id, locale, namespace, key). deletedAt soft. */
export const i18nOverrides = pgTable(
  "i18n_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    locale: text("locale").notNull(),
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("i18n_overrides_company_id_idx").on(t.companyId),
    unique("i18n_overrides_company_lnk_uq").on(t.companyId, t.locale, t.namespace, t.key),
  ],
);

export type I18nOverride = typeof i18nOverrides.$inferSelect;
export type NewI18nOverride = typeof i18nOverrides.$inferInsert;
