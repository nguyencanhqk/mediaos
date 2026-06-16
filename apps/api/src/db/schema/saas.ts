import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { currentCompanyDefault } from "./_helpers";
import { companies } from "./companies";

/**
 * G16-3 SaaS scaffold — subscription / feature-flag / usage-limit (KIẾN TRÚC, KHÔNG billing thật).
 * DDL/RLS/grant/seed ở migration 0231. Drizzle inference dưới đây (parity check với migration).
 *
 * HAI tầng dữ liệu:
 *  - CATALOG TOÀN CỤC (subscription_plans, plan_entitlements): KHÔNG company_id, KHÔNG RLS — mirror
 *    `permissions` (0005): app role SELECT-only, ghi qua migration (immutable lúc runtime trong scaffold).
 *  - PER-COMPANY (company_subscriptions, company_feature_flags, company_usage_limits,
 *    company_usage_counters): company_id NOT NULL + FORCE RLS keyed app.current_company_id (BẤT BIẾN #1).
 */

/** Gói dịch vụ (free/pro/enterprise…). Catalog toàn cục, seed migration. */
export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("subscription_plans_code_uq").on(t.code)],
);
export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;

/**
 * Quyền-lợi theo gói: feature (bool) hoặc limit (số). Effective flag/limit per-company = override
 * (company_feature_flags / company_usage_limits) ?? entitlement của gói công ty đang dùng.
 */
export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: "cascade" }),
    entitlementKey: text("entitlement_key").notNull(),
    // 'feature' → boolValue có nghĩa; 'limit' → limitValue có nghĩa.
    kind: text("kind").notNull(),
    boolValue: boolean("bool_value"),
    limitValue: bigint("limit_value", { mode: "number" }),
  },
  (t) => [uniqueIndex("plan_entitlements_plan_key_uq").on(t.planId, t.entitlementKey)],
);
export type PlanEntitlement = typeof planEntitlements.$inferSelect;

/** Gói công ty đang dùng (1 active/công ty). RLS theo company_id. */
export const companySubscriptions = pgTable(
  "company_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    status: text("status").notNull().default("active"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("company_subscriptions_company_idx").on(t.companyId),
    // 1 subscription active/công ty (partial unique trên non-deleted) — parity với migration 0231.
    uniqueIndex("company_subscriptions_company_active_uq")
      .on(t.companyId)
      .where(sql`deleted_at IS NULL`),
  ],
);
export type CompanySubscription = typeof companySubscriptions.$inferSelect;

/** Override feature-flag per-company (bật/tắt tường minh, thắng entitlement của gói). RLS company_id. */
export const companyFeatureFlags = pgTable(
  "company_feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    featureKey: text("feature_key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("company_feature_flags_company_key_uq").on(t.companyId, t.featureKey)],
);
export type CompanyFeatureFlag = typeof companyFeatureFlags.$inferSelect;

/** Override hạn mức per-company (thắng limit của gói). RLS company_id. */
export const companyUsageLimits = pgTable(
  "company_usage_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(),
    limitValue: bigint("limit_value", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("company_usage_limits_company_metric_uq").on(t.companyId, t.metricKey)],
);
export type CompanyUsageLimit = typeof companyUsageLimits.$inferSelect;

/**
 * Bộ đếm sử dụng per-company theo metric + kỳ (period). Đây là BỘ ĐẾM (mutable UPDATE used_count) —
 * KHÔNG phải sổ cái append-only, nên app role có UPDATE. RLS company_id.
 */
export const companyUsageCounters = pgTable(
  "company_usage_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .default(currentCompanyDefault)
      .references(() => companies.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(),
    // 'lifetime' hoặc 'YYYY-MM' — gom đếm theo kỳ. Reset = kỳ mới (KHÔNG xoá lịch sử).
    period: text("period").notNull().default("lifetime"),
    usedCount: bigint("used_count", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("company_usage_counters_company_metric_period_uq").on(
      t.companyId,
      t.metricKey,
      t.period,
    ),
  ],
);
export type CompanyUsageCounter = typeof companyUsageCounters.$inferSelect;

/** kind hợp lệ cho plan_entitlements. */
export const PLAN_ENTITLEMENT_KINDS = ["feature", "limit"] as const;
export type PlanEntitlementKind = (typeof PLAN_ENTITLEMENT_KINDS)[number];

/** status hợp lệ cho company_subscriptions. */
export const SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
