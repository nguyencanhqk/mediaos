import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { SaasRepository } from "../../src/saas/saas.repository";
import { FeatureFlagService } from "../../src/saas/feature-flag.service";
import { UsageLimitService } from "../../src/saas/usage-limit.service";
import { SubscriptionService } from "../../src/saas/subscription.service";
import { REQUIRE_FEATURE, ENFORCE_USAGE_LIMIT } from "../../src/saas/decorators";
import {
  FEATURE_NOT_ENABLED,
  USAGE_LIMIT_EXCEEDED,
  FeatureFlagEnforcementGuard,
  UsageLimitEnforcementGuard,
} from "../../src/saas/enforcement.guards";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

// ── stub ExecutionContext + Reflector cho guard unit test (không DB) ────────────
function makeCtx(companyId: string): ExecutionContext {
  return {
    getType: () => "http",
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: { id: "u", companyId } }) }),
  } as unknown as ExecutionContext;
}
function reflectorReturning(map: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => map[key],
  } as unknown as Reflector;
}
async function captureForbidden(fn: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ForbiddenException);
    return (err as ForbiddenException).getResponse() as Record<string, unknown>;
  }
  throw new Error("expected ForbiddenException");
}

describe.skipIf(!hasDb)("G16-3 SaaS enforcement (feature-flag + usage-limit)", () => {
  const direct = directPool();
  let B: SeededTenant;
  let actor: { id: string; companyId: string };
  let db: DatabaseService;
  let featureFlags: FeatureFlagService;
  let usage: UsageLimitService;
  let subs: SubscriptionService;

  beforeAll(async () => {
    B = await seedCompany(direct, "saasB");
    const user = await seedUser(direct, B.companyId, `saas-${randomUUID().slice(0, 8)}@b.test`);
    actor = { id: user, companyId: B.companyId };

    db = new DatabaseService();
    const audit = new AuditService();
    const repo = new SaasRepository();
    featureFlags = new FeatureFlagService(db, repo);
    usage = new UsageLimitService(db, repo);
    subs = new SubscriptionService(db, repo, audit);

    // Gói free: advanced_analytics=false (entitlement seed 0231).
    await subs.setSubscription(actor, B.companyId, { planCode: "free" });
  });

  afterAll(async () => {
    await cleanupTenants(direct, [B.companyId]);
    await direct.end();
  });

  it("feature resolution: plan entitlement, override wins", async () => {
    // free plan → advanced_analytics OFF.
    expect(await featureFlags.isEnabled(B.companyId, "advanced_analytics")).toBe(false);
    // override ON → wins.
    await subs.setFeatureFlag(actor, B.companyId, { featureKey: "advanced_analytics", enabled: true });
    expect(await featureFlags.isEnabled(B.companyId, "advanced_analytics")).toBe(true);
  });

  it("usage limit: override limit + counter enforcement", async () => {
    const metric = `m-${randomUUID().slice(0, 8)}`;
    await subs.setUsageLimit(actor, B.companyId, { metricKey: metric, limitValue: 2 });

    expect((await usage.canConsume(B.companyId, metric, 1)).allowed).toBe(true);
    await usage.increment(B.companyId, metric, 1);
    await usage.increment(B.companyId, metric, 1);
    // used=2, limit=2 → consuming 1 more would exceed.
    const check = await usage.canConsume(B.companyId, metric, 1);
    expect(check.allowed).toBe(false);
    expect(check.used).toBe(2);
    expect(check.limit).toBe(2);
  });

  it("no limit defined → unlimited (allow)", async () => {
    const check = await usage.canConsume(B.companyId, `undef-${randomUUID().slice(0, 8)}`, 999);
    expect(check.allowed).toBe(true);
    expect(check.limit).toBeNull();
  });

  it("FeatureFlagEnforcementGuard DENIES with FEATURE_NOT_ENABLED when feature off", async () => {
    const guard = new FeatureFlagEnforcementGuard(
      reflectorReturning({ [REQUIRE_FEATURE]: "custom_workflows" }),
      featureFlags,
    );
    const body = await captureForbidden(() => guard.canActivate(makeCtx(B.companyId)));
    expect(body.code).toBe(FEATURE_NOT_ENABLED);
  });

  it("FeatureFlagEnforcementGuard is no-op when route declares no feature", async () => {
    const guard = new FeatureFlagEnforcementGuard(reflectorReturning({}), featureFlags);
    expect(await guard.canActivate(makeCtx(B.companyId))).toBe(true);
  });

  it("UsageLimitEnforcementGuard DENIES with USAGE_LIMIT_EXCEEDED at limit", async () => {
    const metric = `g-${randomUUID().slice(0, 8)}`;
    await subs.setUsageLimit(actor, B.companyId, { metricKey: metric, limitValue: 0 });
    const guard = new UsageLimitEnforcementGuard(
      reflectorReturning({ [ENFORCE_USAGE_LIMIT]: { metric, cost: 1 } }),
      usage,
    );
    const body = await captureForbidden(() => guard.canActivate(makeCtx(B.companyId)));
    expect(body.code).toBe(USAGE_LIMIT_EXCEEDED);
  });

  it("non-active subscription (canceled) grants no plan features (fail-closed status gate)", async () => {
    // pro plan: custom_workflows=true (no per-company override on this key for B).
    await subs.setSubscription(actor, B.companyId, { planCode: "pro", status: "active" });
    expect(await featureFlags.isEnabled(B.companyId, "custom_workflows")).toBe(true);
    // Canceled → plan entitlement no longer granted.
    await subs.setSubscription(actor, B.companyId, { planCode: "pro", status: "canceled" });
    expect(await featureFlags.isEnabled(B.companyId, "custom_workflows")).toBe(false);
  });
});
