import { Injectable } from "@nestjs/common";
import type { FeatureFlagSource } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { SaasRepository } from "./saas.repository";

export interface FeatureResolution {
  enabled: boolean;
  source: FeatureFlagSource;
}

/**
 * FeatureFlagService (G16-3) — phân giải feature-flag HIỆU LỰC cho công ty:
 *   override per-company (company_feature_flags) THẮNG ?? entitlement của gói (plan_entitlements feature).
 * Không có gói + không override ⇒ feature TẮT (fail-closed: chưa cấp gói = chưa bật tính năng).
 */
@Injectable()
export class FeatureFlagService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SaasRepository,
  ) {}

  /** Dùng bởi enforcement guard (mở tx riêng). */
  async isEnabled(companyId: string, featureKey: string): Promise<boolean> {
    const res = await this.db.withTenant(companyId, (tx) =>
      this.resolveInTx(tx, companyId, featureKey),
    );
    return res.enabled;
  }

  async resolveInTx(
    tx: TenantTx,
    companyId: string,
    featureKey: string,
  ): Promise<FeatureResolution> {
    // Override per-company THẮNG (toggle tường minh, độc lập trạng thái gói).
    const override = await this.repo.findFeatureOverride(tx, companyId, featureKey);
    if (override) {
      return { enabled: override.enabled, source: "override" };
    }
    const sub = await this.repo.findActiveSubscription(tx, companyId);
    // Không gói HOẶC gói KHÔNG còn hiệu lực (past_due/canceled) ⇒ feature TẮT (fail-closed). Chỉ
    // active/trialing mới cấp entitlement của gói. (findActiveSubscription trả gói hiện tại bất kể status
    // để phục vụ upsert/hiển thị — gate hiệu lực ở ĐÂY, KHÔNG đổi query đó để khỏi vỡ đường upsert.)
    if (!sub || (sub.status !== "active" && sub.status !== "trialing")) {
      return { enabled: false, source: "plan" };
    }
    const ent = await this.repo.findPlanEntitlement(tx, sub.planId, featureKey);
    if (ent && ent.kind === "feature") {
      return { enabled: ent.boolValue ?? false, source: "plan" };
    }
    return { enabled: false, source: "plan" };
  }
}
