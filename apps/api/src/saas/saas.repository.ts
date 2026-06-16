import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import {
  companyFeatureFlags,
  companySubscriptions,
  companyUsageCounters,
  companyUsageLimits,
  planEntitlements,
  subscriptionPlans,
} from "../db/schema";

/**
 * SaasRepository (G16-3) — data-access subscription/feature-flag/usage. Mọi method nhận `tx`
 * (withTenant(companyId)). Catalog (subscription_plans/plan_entitlements) no-RLS đọc trong bất kỳ tx.
 */
@Injectable()
export class SaasRepository {
  // ── plans (catalog) ───────────────────────────────────────────────────────────

  async findPlanByCode(tx: TenantTx, code: string): Promise<{ id: string; code: string } | undefined> {
    const [row] = await tx
      .select({ id: subscriptionPlans.id, code: subscriptionPlans.code })
      .from(subscriptionPlans)
      .where(and(eq(subscriptionPlans.code, code), isNull(subscriptionPlans.deletedAt)))
      .limit(1);
    return row;
  }

  async listPlans(tx: TenantTx): Promise<(typeof subscriptionPlans.$inferSelect)[]> {
    return tx.select().from(subscriptionPlans).where(isNull(subscriptionPlans.deletedAt));
  }

  /** Entitlement của gói theo key (feature hoặc limit). */
  async findPlanEntitlement(
    tx: TenantTx,
    planId: string,
    key: string,
  ): Promise<{ kind: string; boolValue: boolean | null; limitValue: number | null } | undefined> {
    const [row] = await tx
      .select({
        kind: planEntitlements.kind,
        boolValue: planEntitlements.boolValue,
        limitValue: planEntitlements.limitValue,
      })
      .from(planEntitlements)
      .where(and(eq(planEntitlements.planId, planId), eq(planEntitlements.entitlementKey, key)))
      .limit(1);
    return row;
  }

  async listPlanEntitlements(
    tx: TenantTx,
    planId: string,
    kind: "feature" | "limit",
  ): Promise<(typeof planEntitlements.$inferSelect)[]> {
    return tx
      .select()
      .from(planEntitlements)
      .where(and(eq(planEntitlements.planId, planId), eq(planEntitlements.kind, kind)));
  }

  // ── company subscription ──────────────────────────────────────────────────────

  /** Subscription active của công ty (join plan để lấy code). undefined = chưa có gói. */
  async findActiveSubscription(
    tx: TenantTx,
    companyId: string,
  ): Promise<
    | {
        id: string;
        planId: string;
        planCode: string;
        status: string;
        currentPeriodEnd: Date | null;
        createdAt: Date;
        updatedAt: Date;
      }
    | undefined
  > {
    const [row] = await tx
      .select({
        id: companySubscriptions.id,
        planId: companySubscriptions.planId,
        planCode: subscriptionPlans.code,
        status: companySubscriptions.status,
        currentPeriodEnd: companySubscriptions.currentPeriodEnd,
        createdAt: companySubscriptions.createdAt,
        updatedAt: companySubscriptions.updatedAt,
      })
      .from(companySubscriptions)
      .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, companySubscriptions.planId))
      .where(
        and(eq(companySubscriptions.companyId, companyId), isNull(companySubscriptions.deletedAt)),
      )
      .limit(1);
    return row;
  }

  async insertSubscription(
    tx: TenantTx,
    data: {
      companyId: string;
      planId: string;
      status: string;
      currentPeriodEnd: Date | null;
    },
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(companySubscriptions)
      .values({
        companyId: data.companyId,
        planId: data.planId,
        status: data.status,
        currentPeriodEnd: data.currentPeriodEnd,
      })
      .returning({ id: companySubscriptions.id });
    if (!row) throw new Error("insertSubscription returned no row");
    return row;
  }

  async updateSubscription(
    tx: TenantTx,
    id: string,
    data: { planId: string; status: string; currentPeriodEnd: Date | null },
  ): Promise<void> {
    await tx
      .update(companySubscriptions)
      .set({
        planId: data.planId,
        status: data.status,
        currentPeriodEnd: data.currentPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(companySubscriptions.id, id));
  }

  // ── feature flags (override) ────────────────────────────────────────────────

  async findFeatureOverride(
    tx: TenantTx,
    companyId: string,
    featureKey: string,
  ): Promise<{ enabled: boolean } | undefined> {
    const [row] = await tx
      .select({ enabled: companyFeatureFlags.enabled })
      .from(companyFeatureFlags)
      .where(
        and(
          eq(companyFeatureFlags.companyId, companyId),
          eq(companyFeatureFlags.featureKey, featureKey),
        ),
      )
      .limit(1);
    return row;
  }

  async listFeatureOverrides(
    tx: TenantTx,
    companyId: string,
  ): Promise<(typeof companyFeatureFlags.$inferSelect)[]> {
    return tx
      .select()
      .from(companyFeatureFlags)
      .where(eq(companyFeatureFlags.companyId, companyId));
  }

  async upsertFeatureOverride(
    tx: TenantTx,
    data: { companyId: string; featureKey: string; enabled: boolean },
  ): Promise<void> {
    await tx
      .insert(companyFeatureFlags)
      .values({ companyId: data.companyId, featureKey: data.featureKey, enabled: data.enabled })
      .onConflictDoUpdate({
        target: [companyFeatureFlags.companyId, companyFeatureFlags.featureKey],
        set: { enabled: data.enabled, updatedAt: new Date() },
      });
  }

  // ── usage limits (override) ───────────────────────────────────────────────────

  async findLimitOverride(
    tx: TenantTx,
    companyId: string,
    metricKey: string,
  ): Promise<{ limitValue: number } | undefined> {
    const [row] = await tx
      .select({ limitValue: companyUsageLimits.limitValue })
      .from(companyUsageLimits)
      .where(
        and(
          eq(companyUsageLimits.companyId, companyId),
          eq(companyUsageLimits.metricKey, metricKey),
        ),
      )
      .limit(1);
    return row;
  }

  async listLimitOverrides(
    tx: TenantTx,
    companyId: string,
  ): Promise<(typeof companyUsageLimits.$inferSelect)[]> {
    return tx.select().from(companyUsageLimits).where(eq(companyUsageLimits.companyId, companyId));
  }

  async upsertLimitOverride(
    tx: TenantTx,
    data: { companyId: string; metricKey: string; limitValue: number },
  ): Promise<void> {
    await tx
      .insert(companyUsageLimits)
      .values({
        companyId: data.companyId,
        metricKey: data.metricKey,
        limitValue: data.limitValue,
      })
      .onConflictDoUpdate({
        target: [companyUsageLimits.companyId, companyUsageLimits.metricKey],
        set: { limitValue: data.limitValue, updatedAt: new Date() },
      });
  }

  // ── usage counters ────────────────────────────────────────────────────────────

  async findCounter(
    tx: TenantTx,
    companyId: string,
    metricKey: string,
    period: string,
  ): Promise<{ usedCount: number } | undefined> {
    const [row] = await tx
      .select({ usedCount: companyUsageCounters.usedCount })
      .from(companyUsageCounters)
      .where(
        and(
          eq(companyUsageCounters.companyId, companyId),
          eq(companyUsageCounters.metricKey, metricKey),
          eq(companyUsageCounters.period, period),
        ),
      )
      .limit(1);
    return row;
  }

  /** Tăng counter atomically (ON CONFLICT … DO UPDATE used_count = used_count + cost). */
  async incrementCounter(
    tx: TenantTx,
    data: { companyId: string; metricKey: string; period: string; cost: number },
  ): Promise<void> {
    await tx
      .insert(companyUsageCounters)
      .values({
        companyId: data.companyId,
        metricKey: data.metricKey,
        period: data.period,
        usedCount: data.cost,
      })
      .onConflictDoUpdate({
        target: [
          companyUsageCounters.companyId,
          companyUsageCounters.metricKey,
          companyUsageCounters.period,
        ],
        set: {
          usedCount: sql`${companyUsageCounters.usedCount} + ${data.cost}`,
          updatedAt: new Date(),
        },
      });
  }
}
