import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * AC-7 module-registry — CATALOG TOÀN CỤC `system_modules` (no-RLS, mirror permissions/subscription_plans).
 *
 * Module = bundle các feature-key + metadata hiển thị (tên/icon/route/DAG phụ thuộc). KHÔNG company_id ⇒
 * tự loại khỏi rls-guards (KHÔNG vào rls-registry/cleanupTenants). KHÔNG store on/off thứ 3: trạng thái
 * bật/tắt per-tenant = `company_feature_flags` (saas.ts). App role SELECT-only; ghi qua migration (0330).
 *
 * DDL/grant/seed ở migration 0330. Drizzle inference dưới đây (parity check với migration).
 */
export const systemModules = pgTable(
  "system_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    route: text("route"),
    /** Bundle feature-key (trỏ plan_entitlements kind=feature). Bật module = bật mọi key này. */
    featureKeys: text("feature_keys").array().notNull().default([]),
    /** Module-key phụ thuộc (DAG). Bật module này yêu cầu các depends_on đã bật. */
    dependsOn: text("depends_on").array().notNull().default([]),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("system_modules_key_uq").on(t.key)],
);
export type SystemModule = typeof systemModules.$inferSelect;
