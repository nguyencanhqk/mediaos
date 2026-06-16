import { Injectable } from "@nestjs/common";
import type { FeatureFlagSource } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { SaasRepository } from "./saas.repository";

/** Kỳ đếm mặc định cho scaffold (gom theo vòng đời công ty). Reset = đổi sang kỳ mới. */
export const USAGE_PERIOD = "lifetime";

export interface UsageCheck {
  allowed: boolean;
  /** null = không có hạn mức (unlimited). */
  limit: number | null;
  used: number;
  source: FeatureFlagSource;
}

/**
 * UsageLimitService (G16-3) — hạn mức HIỆU LỰC + bộ đếm:
 *   override per-company (company_usage_limits) THẮNG ?? entitlement limit của gói. Không định nghĩa
 *   hạn mức nào ⇒ KHÔNG giới hạn (allow). canConsume = read-only check; increment = ghi đếm sau hành động.
 */
@Injectable()
export class UsageLimitService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SaasRepository,
  ) {}

  /** Kiểm tra trước khi tiêu dùng `cost` đơn vị metric (KHÔNG ghi). */
  async canConsume(companyId: string, metricKey: string, cost: number): Promise<UsageCheck> {
    return this.db.withTenant(companyId, async (tx) => {
      const { limit, source } = await this.effectiveLimitInTx(tx, companyId, metricKey);
      const counter = await this.repo.findCounter(tx, companyId, metricKey, USAGE_PERIOD);
      const used = counter?.usedCount ?? 0;
      if (limit === null) {
        return { allowed: true, limit: null, used, source };
      }
      return { allowed: used + cost <= limit, limit, used, source };
    });
  }

  /** Ghi tăng bộ đếm sau khi hành động thành công (atomically). */
  async increment(companyId: string, metricKey: string, cost: number): Promise<void> {
    await this.db.withTenant(companyId, (tx) =>
      this.repo.incrementCounter(tx, { companyId, metricKey, period: USAGE_PERIOD, cost }),
    );
  }

  async getUsage(companyId: string, metricKey: string): Promise<UsageCheck> {
    return this.canConsume(companyId, metricKey, 0);
  }

  async effectiveLimitInTx(
    tx: TenantTx,
    companyId: string,
    metricKey: string,
  ): Promise<{ limit: number | null; source: FeatureFlagSource }> {
    const override = await this.repo.findLimitOverride(tx, companyId, metricKey);
    if (override) {
      return { limit: override.limitValue, source: "override" };
    }
    const sub = await this.repo.findActiveSubscription(tx, companyId);
    if (!sub) {
      return { limit: null, source: "plan" };
    }
    const ent = await this.repo.findPlanEntitlement(tx, sub.planId, metricKey);
    if (ent && ent.kind === "limit") {
      return { limit: ent.limitValue, source: "plan" };
    }
    return { limit: null, source: "plan" };
  }
}
