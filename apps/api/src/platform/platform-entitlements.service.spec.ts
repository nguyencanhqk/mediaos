import { describe, expect, it, vi } from "vitest";
import type { DatabaseService, TenantTx } from "../db/db.service";
import type { SaasRepository } from "../saas/saas.repository";
import type { SubscriptionService } from "../saas/subscription.service";
import type { AuditService } from "../events/audit.service";
import type { OperatorActionAuditService } from "./operator-action-audit.service";
import { PlatformEntitlementsService } from "./platform-entitlements.service";

const OPERATOR = { id: "op-1", companyId: "home-co" };
const TARGET = "target-tenant-A";

/**
 * AC-2 PlatformEntitlementsService unit — mock DB/repo/audit để chứng minh:
 *  (a) setFeatureFlag gọi upsertFeatureOverride + audit.record(feature_flag) + recordOperatorAction CÙNG 1
 *      callback withTenant(target) (KHÔNG nested withTenant, KHÔNG đi qua SubscriptionService write-path);
 *  (b) setUsageLimit gọi upsertLimitOverride + audit.record(usage_limit) + recordOperatorAction CÙNG tx;
 *  (c) tx rollback ⇒ KHÔNG còn override & KHÔNG còn audit (atomic, rollback-safe);
 *  (d) getEntitlements delegate SubscriptionService.getEffectiveEntitlements(target).
 */
describe("AC-2 PlatformEntitlementsService", () => {
  function makeService(opts: { failInTx?: boolean } = {}) {
    const { failInTx = false } = opts;

    const upsertFeatureCalls: Array<{ companyId: string; featureKey: string; enabled: boolean }> = [];
    const upsertLimitCalls: Array<{ companyId: string; metricKey: string; limitValue: number }> = [];
    const auditCalls: Array<{ objectType: string; after?: unknown }> = [];
    const operatorAuditCalls: Array<{ action: string; targetTenantId: string; after?: unknown }> = [];

    const saasRepo = {
      upsertFeatureOverride: vi.fn(
        async (_tx: TenantTx, d: { companyId: string; featureKey: string; enabled: boolean }) => {
          upsertFeatureCalls.push(d);
        },
      ),
      upsertLimitOverride: vi.fn(
        async (_tx: TenantTx, d: { companyId: string; metricKey: string; limitValue: number }) => {
          upsertLimitCalls.push(d);
        },
      ),
    } as unknown as SaasRepository;

    const audit = {
      record: vi.fn(async (_tx: TenantTx, e: { objectType: string; after?: unknown }) => {
        auditCalls.push(e);
      }),
    } as unknown as AuditService;

    const operatorAudit = {
      recordOperatorAction: vi.fn(
        async (_tx: TenantTx, e: { action: string; targetTenantId: string; after?: unknown }) => {
          operatorAuditCalls.push(e);
        },
      ),
    } as unknown as OperatorActionAuditService;

    const effective = {
      planCode: "pro",
      features: [{ featureKey: "f", enabled: true, source: "plan" as const }],
      limits: [],
    };
    const subscriptions = {
      getEffectiveEntitlements: vi.fn(async (_companyId: string) => effective),
    } as unknown as SubscriptionService;

    const txStub = {} as TenantTx;
    let nestedDepth = 0;
    let maxNestedDepth = 0;
    const db = {
      withTenant: vi.fn(async <T>(companyId: string, fn: (tx: TenantTx) => Promise<T>) => {
        if (companyId !== TARGET) throw new Error(`unexpected companyId ${companyId}`);
        nestedDepth += 1;
        maxNestedDepth = Math.max(maxNestedDepth, nestedDepth);
        try {
          const result = await fn(txStub);
          if (failInTx) {
            // rollback: side-effects trong tx bị hủy.
            upsertFeatureCalls.length = 0;
            upsertLimitCalls.length = 0;
            auditCalls.length = 0;
            operatorAuditCalls.length = 0;
            throw new Error("simulated tx rollback");
          }
          return result;
        } finally {
          nestedDepth -= 1;
        }
      }),
    } as unknown as DatabaseService;

    const svc = new PlatformEntitlementsService(db, saasRepo, audit, operatorAudit, subscriptions);
    return {
      svc,
      db,
      subscriptions,
      upsertFeatureCalls,
      upsertLimitCalls,
      auditCalls,
      operatorAuditCalls,
      getMaxNestedDepth: () => maxNestedDepth,
    };
  }

  describe("setFeatureFlag", () => {
    it("(a) upsertFeatureOverride + audit(feature_flag) + recordOperatorAction CÙNG withTenant(target), no nested", async () => {
      const { svc, db, upsertFeatureCalls, auditCalls, operatorAuditCalls, getMaxNestedDepth } =
        makeService();
      await svc.setFeatureFlag(OPERATOR, TARGET, { featureKey: "advanced_analytics", enabled: true });

      expect(db.withTenant).toHaveBeenCalledWith(TARGET, expect.any(Function));
      expect(db.withTenant).toHaveBeenCalledTimes(1);
      expect(getMaxNestedDepth()).toBe(1); // KHÔNG nested withTenant
      expect(upsertFeatureCalls).toEqual([
        { companyId: TARGET, featureKey: "advanced_analytics", enabled: true },
      ]);
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0].objectType).toBe("feature_flag");
      expect(operatorAuditCalls).toEqual([
        expect.objectContaining({
          action: "operator.feature_flag_set",
          targetTenantId: TARGET,
          after: { featureKey: "advanced_analytics", enabled: true },
        }),
      ]);
    });

    it("(c) tx rollback ⇒ KHÔNG còn override VÀ KHÔNG còn audit (atomic)", async () => {
      const { svc, upsertFeatureCalls, auditCalls, operatorAuditCalls } = makeService({
        failInTx: true,
      });
      await expect(
        svc.setFeatureFlag(OPERATOR, TARGET, { featureKey: "x", enabled: true }),
      ).rejects.toThrow();
      expect(upsertFeatureCalls).toHaveLength(0);
      expect(auditCalls).toHaveLength(0);
      expect(operatorAuditCalls).toHaveLength(0);
    });
  });

  describe("setUsageLimit", () => {
    it("(b) upsertLimitOverride + audit(usage_limit) + recordOperatorAction CÙNG withTenant(target), no nested", async () => {
      const { svc, db, upsertLimitCalls, auditCalls, operatorAuditCalls, getMaxNestedDepth } =
        makeService();
      await svc.setUsageLimit(OPERATOR, TARGET, { metricKey: "max_channels", limitValue: 10 });

      expect(db.withTenant).toHaveBeenCalledWith(TARGET, expect.any(Function));
      expect(db.withTenant).toHaveBeenCalledTimes(1);
      expect(getMaxNestedDepth()).toBe(1);
      expect(upsertLimitCalls).toEqual([
        { companyId: TARGET, metricKey: "max_channels", limitValue: 10 },
      ]);
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0].objectType).toBe("usage_limit");
      expect(operatorAuditCalls).toEqual([
        expect.objectContaining({
          action: "operator.usage_limit_set",
          targetTenantId: TARGET,
          after: { metricKey: "max_channels", limitValue: 10 },
        }),
      ]);
    });
  });

  describe("getEntitlements / getFeatureFlags / getUsageLimits", () => {
    it("(d) getEntitlements delegate SubscriptionService.getEffectiveEntitlements(target)", async () => {
      const { svc, subscriptions } = makeService();
      const res = await svc.getEntitlements(TARGET);
      expect(subscriptions.getEffectiveEntitlements).toHaveBeenCalledWith(TARGET);
      expect(res.planCode).toBe("pro");
    });

    it("(d2) getFeatureFlags trả features từ effective entitlements", async () => {
      const { svc, subscriptions } = makeService();
      const res = await svc.getFeatureFlags(TARGET);
      expect(subscriptions.getEffectiveEntitlements).toHaveBeenCalledWith(TARGET);
      expect(res).toEqual([{ featureKey: "f", enabled: true, source: "plan" }]);
    });

    it("(d3) getUsageLimits trả limits từ effective entitlements", async () => {
      const { svc, subscriptions } = makeService();
      const res = await svc.getUsageLimits(TARGET);
      expect(subscriptions.getEffectiveEntitlements).toHaveBeenCalledWith(TARGET);
      expect(res).toEqual([]);
    });
  });
});
