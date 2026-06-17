import { Injectable } from "@nestjs/common";
import type {
  EffectiveEntitlementsDto,
  FeatureFlagDto,
  SetFeatureFlagRequest,
  SetUsageLimitRequest,
  UsageLimitDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { SaasRepository } from "../saas/saas.repository";
import { SubscriptionService } from "../saas/subscription.service";
import { OperatorActionAuditService } from "./operator-action-audit.service";

type RequestUser = { id: string; companyId: string };

/**
 * PlatformEntitlementsService (AC-2, CROWN) — operator (platform-admin) đặt/xem feature-flag + usage-limit
 * + entitlement viewer cho 1 công ty BẤT KỲ (cross-tenant). Mirror ModuleRegistryService (AC-7):
 *
 *  - setFeatureFlag/setUsageLimit MỞ withTenant(target) tx ATOMIC → gọi SaasRepository.upsert*Override
 *    + audit.record(feature_flag/usage_limit) + recordOperatorAction CÙNG tx (rollback-safe). KHÔNG đi qua
 *    SubscriptionService write-path (nó tự mở withTenant(companyId) ⇒ recordOperatorAction sẽ KHÔNG cùng tx
 *    + nguy cơ nested-tx). KHÔNG nested-withTenant.
 *  - getEntitlements/getFeatureFlags/getUsageLimits delegate SubscriptionService.getEffectiveEntitlements(target)
 *    (read-path SẴN CÓ, tự withTenant(target)) — viewer.
 *
 * CROSS-TENANT: mọi write/read chạy trong withTenant(target) ⇒ GUC app.current_company_id=target ép RLS
 * (ADR-0019 — KHÔNG escape-hatch, escape-hatch chỉ bảng companies). Audit company_id = target (GUC default).
 */
@Injectable()
export class PlatformEntitlementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly saasRepo: SaasRepository,
    private readonly audit: AuditService,
    private readonly operatorAudit: OperatorActionAuditService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /** Đặt override bật/tắt 1 feature cho target (cross-tenant, atomic + audit + operator-audit). */
  async setFeatureFlag(
    operator: RequestUser,
    targetCompanyId: string,
    dto: SetFeatureFlagRequest,
  ): Promise<FeatureFlagDto> {
    await this.db.withTenant(targetCompanyId, async (tx) => {
      await this.saasRepo.upsertFeatureOverride(tx, {
        companyId: targetCompanyId,
        featureKey: dto.featureKey,
        enabled: dto.enabled,
      });
      await this.audit.record(tx, {
        action: "FeatureFlagSet",
        objectType: "feature_flag",
        objectId: targetCompanyId,
        actorUserId: operator.id,
        after: { featureKey: dto.featureKey, enabled: dto.enabled },
      });
      await this.operatorAudit.recordOperatorAction(tx, {
        operatorId: operator.id,
        targetTenantId: targetCompanyId,
        action: "operator.feature_flag_set",
        after: { featureKey: dto.featureKey, enabled: dto.enabled },
      });
    });
    return { featureKey: dto.featureKey, enabled: dto.enabled, source: "override" };
  }

  /** Đặt override hạn mức 1 metric cho target (cross-tenant, atomic + audit + operator-audit). */
  async setUsageLimit(
    operator: RequestUser,
    targetCompanyId: string,
    dto: SetUsageLimitRequest,
  ): Promise<UsageLimitDto> {
    await this.db.withTenant(targetCompanyId, async (tx) => {
      await this.saasRepo.upsertLimitOverride(tx, {
        companyId: targetCompanyId,
        metricKey: dto.metricKey,
        limitValue: dto.limitValue,
      });
      await this.audit.record(tx, {
        action: "UsageLimitSet",
        objectType: "usage_limit",
        objectId: targetCompanyId,
        actorUserId: operator.id,
        after: { metricKey: dto.metricKey, limitValue: dto.limitValue },
      });
      await this.operatorAudit.recordOperatorAction(tx, {
        operatorId: operator.id,
        targetTenantId: targetCompanyId,
        action: "operator.usage_limit_set",
        after: { metricKey: dto.metricKey, limitValue: dto.limitValue },
      });
    });
    // Re-derive effective limit (kèm `used` từ counter) sau khi ghi — viewer phản ánh đúng.
    const entitlements = await this.subscriptions.getEffectiveEntitlements(targetCompanyId);
    const effective = entitlements.limits.find((l) => l.metricKey === dto.metricKey);
    return (
      effective ?? {
        metricKey: dto.metricKey,
        limit: dto.limitValue,
        used: 0,
        source: "override",
        period: entitlements.limits[0]?.period ?? "lifetime",
      }
    );
  }

  /** Entitlement HIỆU LỰC (gói + override) cho target — viewer. */
  getEntitlements(targetCompanyId: string): Promise<EffectiveEntitlementsDto> {
    return this.subscriptions.getEffectiveEntitlements(targetCompanyId);
  }

  /** Feature-flag hiệu lực (project từ entitlements). */
  async getFeatureFlags(targetCompanyId: string): Promise<FeatureFlagDto[]> {
    const entitlements = await this.subscriptions.getEffectiveEntitlements(targetCompanyId);
    return entitlements.features;
  }

  /** Usage-limit hiệu lực (project từ entitlements). */
  async getUsageLimits(targetCompanyId: string): Promise<UsageLimitDto[]> {
    const entitlements = await this.subscriptions.getEffectiveEntitlements(targetCompanyId);
    return entitlements.limits;
  }
}
