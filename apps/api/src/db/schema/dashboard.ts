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
import { roles } from "./permissions";
import { users } from "./users";

/**
 * DASH Core (DB-07 §8.1–8.3) — 3 bảng MỚI. DDL/RLS+FORCE/policy/grant/partial-index ở migration 0482.
 * Inference dưới đây PARITY với migration (drizzle KHÔNG mô tả RLS/grant/partial-index — migration là chuẩn).
 *
 * company_id (DB-07 §4.3):
 *   • dashboard_widgets — NULLABLE: NULL = catalog GLOBAL dùng chung; NOT NULL = custom widget company.
 *     RLS policy nullable-tenant (mẫu 0479 notification_events): USING (company_id=GUC OR IS NULL),
 *     WITH CHECK (company_id=GUC). App GRANT SELECT-only (write company-custom → S4-DASH-BE).
 *   • dashboard_widget_configs — NOT NULL: policy literal-GUC. App GRANT SELECT-only (config-update = DASH-BE).
 *   • dashboard_widget_cache — NOT NULL: policy literal-GUC. App GRANT SELECT,INSERT,UPDATE (runtime upsert +
 *     soft-delete invalidation) — KHÔNG DELETE (BẤT BIẾN #2). Cache CHỈ chứa data đã mask+trong-scope (ép
 *     ở service DASH-BE §9.7 step6, KHÔNG ở DDL). scope_reference_id polymorphic — KHÔNG FK (DB-07 §8.3).
 */

// ─── dashboard_widgets (DB-07 §8.1) ───────────────────────────────────────────

export const dashboardWidgets = pgTable(
  "dashboard_widgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULLABLE: global widget = NULL (KHÔNG .notNull(), KHÔNG default current_setting — mẫu 0479 events).
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    widgetCode: varchar("widget_code", { length: 100 }).notNull(),
    moduleCode: varchar("module_code", { length: 50 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    widgetType: varchar("widget_type", { length: 50 }).notNull(),
    requiredPermissionCode: varchar("required_permission_code", { length: 150 }).notNull(),
    defaultDataScope: varchar("default_data_scope", { length: 50 }).notNull(),
    dataSourceKey: varchar("data_source_key", { length: 150 }).notNull(),
    componentKey: varchar("component_key", { length: 150 }).notNull(),
    defaultRefreshSeconds: integer("default_refresh_seconds"),
    isCacheable: boolean("is_cacheable").notNull().default(true),
    defaultWidth: integer("default_width"),
    defaultHeight: integer("default_height"),
    defaultConfig: jsonb("default_config").$type<Record<string, unknown>>(),
    emptyStateConfig: jsonb("empty_state_config").$type<Record<string, unknown>>(),
    actionConfig: jsonb("action_config").$type<Record<string, unknown>>(),
    status: varchar("status", { length: 50 }).notNull().default("Active"),
    isSystemWidget: boolean("is_system_widget").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_dashboard_widgets_global_code_active")
      .on(t.widgetCode)
      .where(sql`company_id IS NULL AND deleted_at IS NULL`),
    uniqueIndex("uq_dashboard_widgets_company_code_active")
      .on(t.companyId, t.widgetCode)
      .where(sql`company_id IS NOT NULL AND deleted_at IS NULL`),
    index("idx_dashboard_widgets_module_status")
      .on(t.moduleCode, t.status, t.sortOrder)
      .where(sql`deleted_at IS NULL`),
    index("idx_dashboard_widgets_permission")
      .on(t.requiredPermissionCode)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_dashboard_widgets_module_code",
      sql`module_code IN ('AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM')`,
    ),
    check(
      "chk_dashboard_widgets_type",
      sql`widget_type IN ('Summary','List','Chart','Calendar','Action','Alert')`,
    ),
    check(
      "chk_dashboard_widgets_scope",
      sql`default_data_scope IN ('Own','Team','Department','Project','Company','System')`,
    ),
    check("chk_dashboard_widgets_status", sql`status IN ('Active','Inactive','Deprecated')`),
  ],
);

export type DashboardWidget = typeof dashboardWidgets.$inferSelect;
export type NewDashboardWidget = typeof dashboardWidgets.$inferInsert;

// ─── dashboard_widget_configs (DB-07 §8.2) ────────────────────────────────────

export const dashboardWidgetConfigs = pgTable(
  "dashboard_widget_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    widgetId: uuid("widget_id")
      .notNull()
      .references(() => dashboardWidgets.id, { onDelete: "cascade" }),
    dashboardType: varchar("dashboard_type", { length: 50 }).notNull(),
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    configScope: varchar("config_scope", { length: 50 }).notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    layoutX: integer("layout_x"),
    layoutY: integer("layout_y"),
    layoutWidth: integer("layout_width"),
    layoutHeight: integer("layout_height"),
    dataScopeOverride: varchar("data_scope_override", { length: 50 }),
    refreshSecondsOverride: integer("refresh_seconds_override"),
    config: jsonb("config").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_dashboard_widget_configs_company_dashboard")
      .on(t.companyId, t.dashboardType, t.isEnabled, t.sortOrder)
      .where(sql`deleted_at IS NULL`),
    index("idx_dashboard_widget_configs_role")
      .on(t.companyId, t.roleId, t.dashboardType, t.isEnabled)
      .where(sql`role_id IS NOT NULL AND deleted_at IS NULL`),
    index("idx_dashboard_widget_configs_user")
      .on(t.companyId, t.userId, t.dashboardType, t.isEnabled)
      .where(sql`user_id IS NOT NULL AND deleted_at IS NULL`),
    index("idx_dashboard_widget_configs_widget")
      .on(t.companyId, t.widgetId)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_dashboard_widget_configs_dashboard_type",
      sql`dashboard_type IN ('Employee','Manager','HR','Admin','System','Project')`,
    ),
    check("chk_dashboard_widget_configs_scope", sql`config_scope IN ('Company','Role','User')`),
    check(
      "chk_dashboard_widget_configs_data_scope_override",
      sql`data_scope_override IS NULL OR data_scope_override IN ('Own','Team','Department','Project','Company','System')`,
    ),
    check(
      "chk_dashboard_widget_configs_role_user_scope",
      sql`(config_scope = 'Company' AND role_id IS NULL AND user_id IS NULL)
        OR (config_scope = 'Role' AND role_id IS NOT NULL AND user_id IS NULL)
        OR (config_scope = 'User' AND user_id IS NOT NULL)`,
    ),
  ],
);

export type DashboardWidgetConfig = typeof dashboardWidgetConfigs.$inferSelect;
export type NewDashboardWidgetConfig = typeof dashboardWidgetConfigs.$inferInsert;

// ─── dashboard_widget_cache (DB-07 §8.3) ──────────────────────────────────────
// company_id NOT NULL. App GRANT SELECT,INSERT,UPDATE (runtime upsert + soft-delete invalidation) —
// KHÔNG DELETE (migration 0482). scope_reference_id polymorphic (employee/dept/project/company) — KHÔNG FK.

export const dashboardWidgetCache = pgTable(
  "dashboard_widget_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    widgetId: uuid("widget_id")
      .notNull()
      .references(() => dashboardWidgets.id, { onDelete: "cascade" }),
    dashboardType: varchar("dashboard_type", { length: 50 }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "cascade" }),
    cacheScope: varchar("cache_scope", { length: 50 }).notNull(),
    // Polymorphic ref (employee_id/department_id/project_id/company_id tùy cache_scope) — KHÔNG FK.
    scopeReferenceId: uuid("scope_reference_id"),
    cacheKey: varchar("cache_key", { length: 255 }).notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    dataHash: varchar("data_hash", { length: 255 }),
    status: varchar("status", { length: 50 }).notNull().default("Fresh"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    sourceVersion: varchar("source_version", { length: 100 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("uq_dashboard_widget_cache_key_active")
      .on(t.companyId, t.cacheKey)
      .where(sql`deleted_at IS NULL`),
    index("idx_dashboard_widget_cache_lookup")
      .on(t.companyId, t.widgetId, t.dashboardType, t.cacheScope, t.scopeReferenceId)
      .where(sql`deleted_at IS NULL`),
    index("idx_dashboard_widget_cache_user")
      .on(t.companyId, t.userId, t.widgetId)
      .where(sql`user_id IS NOT NULL AND deleted_at IS NULL`),
    index("idx_dashboard_widget_cache_expires")
      .on(t.companyId, t.status, t.expiresAt)
      .where(sql`deleted_at IS NULL`),
    index("idx_dashboard_widget_cache_scope_ref")
      .on(t.companyId, t.cacheScope, t.scopeReferenceId)
      .where(sql`deleted_at IS NULL`),
    check(
      "chk_dashboard_widget_cache_dashboard_type",
      sql`dashboard_type IN ('Employee','Manager','HR','Admin','System','Project')`,
    ),
    check(
      "chk_dashboard_widget_cache_scope",
      sql`cache_scope IN ('Own','Team','Department','Project','Company','System')`,
    ),
    check("chk_dashboard_widget_cache_status", sql`status IN ('Fresh','Stale','Expired','Error')`),
    check("chk_dashboard_widget_cache_time", sql`expires_at >= generated_at`),
  ],
);

export type DashboardWidgetCache = typeof dashboardWidgetCache.$inferSelect;
export type NewDashboardWidgetCache = typeof dashboardWidgetCache.$inferInsert;
