import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type {
  CompanySubscriptionDto,
  EffectiveEntitlementsDto,
  FeatureFlagDto,
  SetFeatureFlagRequest,
  SetSubscriptionRequest,
  SetUsageLimitRequest,
  UsageLimitDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { SaasRepository } from "./saas.repository";
import { USAGE_PERIOD } from "./usage-limit.service";

type RequestUser = { id: string; companyId: string };

/**
 * SubscriptionService (G16-3) — đọc/đặt subscription + feature-flag/usage-limit override. Dùng cả cho
 * SELF-SERVICE (company-admin, companyId = của mình) lẫn PLATFORM cross-tenant (companyId = công ty đích,
 * chạy withTenant(targetId)). Mọi mutation audit cùng tx (company_subscription/feature_flag/usage_limit).
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SaasRepository,
    private readonly audit: AuditService,
  ) {}

  async getSubscription(companyId: string): Promise<CompanySubscriptionDto | null> {
    const sub = await this.db.withTenant(companyId, (tx) =>
      this.repo.findActiveSubscription(tx, companyId),
    );
    if (!sub) return null;
    return {
      id: sub.id,
      companyId,
      planId: sub.planId,
      planCode: sub.planCode,
      status: sub.status as CompanySubscriptionDto["status"],
      currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
      createdAt: sub.createdAt.toISOString(),
      updatedAt: sub.updatedAt.toISOString(),
    };
  }

  async setSubscription(
    actor: RequestUser,
    companyId: string,
    dto: SetSubscriptionRequest,
  ): Promise<CompanySubscriptionDto> {
    return this.db.withTenant(companyId, async (tx) => {
      const plan = await this.repo.findPlanByCode(tx, dto.planCode);
      if (!plan) {
        throw new BadRequestException(`Unknown plan: ${dto.planCode}`);
      }
      const periodEnd = dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : null;
      const status = dto.status ?? "active";
      const existing = await this.repo.findActiveSubscription(tx, companyId);
      if (existing) {
        await this.repo.updateSubscription(tx, existing.id, {
          planId: plan.id,
          status,
          currentPeriodEnd: periodEnd,
        });
      } else {
        await this.repo.insertSubscription(tx, {
          companyId,
          planId: plan.id,
          status,
          currentPeriodEnd: periodEnd,
        });
      }
      await this.audit.record(tx, {
        action: existing ? "SubscriptionUpdated" : "SubscriptionCreated",
        objectType: "company_subscription",
        objectId: companyId,
        actorUserId: actor.id,
        before: existing ? { planId: existing.planId, status: existing.status } : null,
        after: { planCode: dto.planCode, status },
      });
      const fresh = await this.repo.findActiveSubscription(tx, companyId);
      if (!fresh) throw new Error("subscription missing after upsert");
      return {
        id: fresh.id,
        companyId,
        planId: fresh.planId,
        planCode: fresh.planCode,
        status: fresh.status as CompanySubscriptionDto["status"],
        currentPeriodEnd: fresh.currentPeriodEnd ? fresh.currentPeriodEnd.toISOString() : null,
        createdAt: fresh.createdAt.toISOString(),
        updatedAt: fresh.updatedAt.toISOString(),
      };
    });
  }

  async setFeatureFlag(
    actor: RequestUser,
    companyId: string,
    dto: SetFeatureFlagRequest,
  ): Promise<FeatureFlagDto> {
    return this.db.withTenant(companyId, async (tx) => {
      await this.repo.upsertFeatureOverride(tx, {
        companyId,
        featureKey: dto.featureKey,
        enabled: dto.enabled,
      });
      await this.audit.record(tx, {
        action: "FeatureFlagSet",
        objectType: "feature_flag",
        objectId: companyId,
        actorUserId: actor.id,
        after: { featureKey: dto.featureKey, enabled: dto.enabled },
      });
      return { featureKey: dto.featureKey, enabled: dto.enabled, source: "override" };
    });
  }

  async setUsageLimit(
    actor: RequestUser,
    companyId: string,
    dto: SetUsageLimitRequest,
  ): Promise<UsageLimitDto> {
    return this.db.withTenant(companyId, async (tx) => {
      await this.repo.upsertLimitOverride(tx, {
        companyId,
        metricKey: dto.metricKey,
        limitValue: dto.limitValue,
      });
      await this.audit.record(tx, {
        action: "UsageLimitSet",
        objectType: "usage_limit",
        objectId: companyId,
        actorUserId: actor.id,
        after: { metricKey: dto.metricKey, limitValue: dto.limitValue },
      });
      const counter = await this.repo.findCounter(tx, companyId, dto.metricKey, USAGE_PERIOD);
      return {
        metricKey: dto.metricKey,
        limit: dto.limitValue,
        used: counter?.usedCount ?? 0,
        source: "override",
        period: USAGE_PERIOD,
      };
    });
  }

  /**
   * Gán gói TRONG tx đã có (caller đang ở withTenant(companyId)) — dùng bởi createCompany để tạo công ty
   * + provision + gán gói + audit CÙNG 1 tx (KHÔNG nested withTenant). Công ty mới ⇒ luôn INSERT.
   */
  async assignPlanInTx(
    tx: TenantTx,
    actorUserId: string | null,
    companyId: string,
    planCode: string,
  ): Promise<void> {
    const plan = await this.repo.findPlanByCode(tx, planCode);
    if (!plan) {
      throw new BadRequestException(`Unknown plan: ${planCode}`);
    }
    const existing = await this.repo.findActiveSubscription(tx, companyId);
    if (existing) {
      await this.repo.updateSubscription(tx, existing.id, {
        planId: plan.id,
        status: "active",
        currentPeriodEnd: null,
      });
    } else {
      await this.repo.insertSubscription(tx, {
        companyId,
        planId: plan.id,
        status: "active",
        currentPeriodEnd: null,
      });
    }
    await this.audit.record(tx, {
      action: "SubscriptionCreated",
      objectType: "company_subscription",
      objectId: companyId,
      actorUserId: actorUserId ?? undefined,
      after: { planCode, status: "active" },
    });
  }

  /** Entitlement HIỆU LỰC (gói + override) — cho FE feature-gate. */
  async getEffectiveEntitlements(companyId: string): Promise<EffectiveEntitlementsDto> {
    return this.db.withTenant(companyId, async (tx) => {
      const sub = await this.repo.findActiveSubscription(tx, companyId);
      if (!sub) {
        return { planCode: "", features: [], limits: [] };
      }
      // Features: gói trước, override thắng.
      const featureMap = new Map<string, FeatureFlagDto>();
      for (const e of await this.repo.listPlanEntitlements(tx, sub.planId, "feature")) {
        featureMap.set(e.entitlementKey, {
          featureKey: e.entitlementKey,
          enabled: e.boolValue ?? false,
          source: "plan",
        });
      }
      for (const o of await this.repo.listFeatureOverrides(tx, companyId)) {
        featureMap.set(o.featureKey, {
          featureKey: o.featureKey,
          enabled: o.enabled,
          source: "override",
        });
      }
      // Limits: gói trước, override thắng; kèm used từ counter.
      const limitMap = new Map<string, { limit: number; source: "plan" | "override" }>();
      for (const e of await this.repo.listPlanEntitlements(tx, sub.planId, "limit")) {
        if (e.limitValue !== null) {
          limitMap.set(e.entitlementKey, { limit: e.limitValue, source: "plan" });
        }
      }
      for (const o of await this.repo.listLimitOverrides(tx, companyId)) {
        limitMap.set(o.metricKey, { limit: o.limitValue, source: "override" });
      }
      const limits: UsageLimitDto[] = [];
      for (const [metricKey, { limit, source }] of limitMap) {
        const counter = await this.repo.findCounter(tx, companyId, metricKey, USAGE_PERIOD);
        limits.push({
          metricKey,
          limit,
          used: counter?.usedCount ?? 0,
          source,
          period: USAGE_PERIOD,
        });
      }
      return {
        planCode: sub.planCode,
        features: [...featureMap.values()],
        limits,
      };
    });
  }
}
