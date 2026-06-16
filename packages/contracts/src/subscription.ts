import { z } from "zod";

/**
 * G16-3 SaaS prep — subscription / feature-flag / usage-limit DTOs (KIẾN TRÚC, KHÔNG billing thật).
 *
 * Catalog plan toàn cục (immutable runtime). Per-company: subscription (1 gói), feature-flag override,
 * usage-limit override + counter. Effective flag/limit = override per-company ?? entitlement của gói.
 */

export const subscriptionStatusEnum = z.enum(["active", "trialing", "past_due", "canceled"]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusEnum>;

export const planEntitlementKindEnum = z.enum(["feature", "limit"]);
export type PlanEntitlementKind = z.infer<typeof planEntitlementKindEnum>;

/** DTO 1 gói (catalog). */
export const planSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type PlanSummaryDto = z.infer<typeof planSummarySchema>;

/** DTO subscription của 1 công ty. */
export const companySubscriptionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  planId: z.string().uuid(),
  planCode: z.string(),
  status: subscriptionStatusEnum,
  currentPeriodEnd: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type CompanySubscriptionDto = z.infer<typeof companySubscriptionSchema>;

/** PUT /subscription (company-admin self) hoặc platform set CHÉO tenant — đặt gói. */
export const setSubscriptionSchema = z.object({
  planCode: z.string().min(1).max(64),
  status: subscriptionStatusEnum.optional(),
  currentPeriodEnd: z.string().datetime().nullable().optional(),
});
export type SetSubscriptionRequest = z.infer<typeof setSubscriptionSchema>;

/** Nguồn của 1 feature-flag hiệu lực: 'plan' (entitlement gói) | 'override' (đặt per-company). */
export const featureFlagSourceEnum = z.enum(["plan", "override"]);
export type FeatureFlagSource = z.infer<typeof featureFlagSourceEnum>;

/** DTO 1 feature-flag hiệu lực. */
export const featureFlagSchema = z.object({
  featureKey: z.string(),
  enabled: z.boolean(),
  source: featureFlagSourceEnum,
});
export type FeatureFlagDto = z.infer<typeof featureFlagSchema>;

/** PUT /subscription/feature-flags — đặt override bật/tắt 1 feature cho công ty. */
export const setFeatureFlagSchema = z.object({
  featureKey: z.string().min(1).max(120),
  enabled: z.boolean(),
});
export type SetFeatureFlagRequest = z.infer<typeof setFeatureFlagSchema>;

/** DTO hạn mức 1 metric hiệu lực + mức dùng hiện tại. */
export const usageLimitSchema = z.object({
  metricKey: z.string(),
  limit: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  source: featureFlagSourceEnum,
  period: z.string(),
});
export type UsageLimitDto = z.infer<typeof usageLimitSchema>;

/** PUT /subscription/usage-limits — đặt override hạn mức 1 metric. */
export const setUsageLimitSchema = z.object({
  metricKey: z.string().min(1).max(120),
  limitValue: z.number().int().nonnegative(),
});
export type SetUsageLimitRequest = z.infer<typeof setUsageLimitSchema>;

/** Tổng hợp entitlement hiệu lực của công ty (gói + override) — cho FE/PermissionGate-feature. */
export const effectiveEntitlementsSchema = z.object({
  planCode: z.string(),
  features: z.array(featureFlagSchema),
  limits: z.array(usageLimitSchema),
});
export type EffectiveEntitlementsDto = z.infer<typeof effectiveEntitlementsSchema>;
