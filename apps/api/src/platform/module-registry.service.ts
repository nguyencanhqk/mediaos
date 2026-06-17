import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  ListModulesQuery,
  SystemModuleDto,
  TenantModuleStateDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { FeatureFlagService } from "../saas/feature-flag.service";
import { SaasRepository } from "../saas/saas.repository";
import type { SystemModule } from "../db/schema";
import { ModuleRegistryRepository } from "./module-registry.repository";
import { OperatorActionAuditService } from "./operator-action-audit.service";

type RequestUser = { id: string; companyId: string };

export interface ModuleCatalogResult {
  items: SystemModuleDto[];
  total: number;
  page: number;
  limit: number;
}

function toDto(row: SystemModule): SystemModuleDto {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    icon: row.icon,
    route: row.route,
    featureKeys: row.featureKeys,
    dependsOn: row.dependsOn,
    displayOrder: row.displayOrder,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * ModuleRegistryService (AC-7, CROWN — lớp module TRÊN feature-flag G16-3).
 *
 * - listCatalog: catalog GLOBAL (paginate). Không cross-tenant — đọc trong withTenant(operator.companyId).
 * - getTenantModules(target): withTenant(target) → mỗi module effective = AND(FeatureFlagService.isEnabled
 *   cho TỪNG feature_key). Đọc TỪ feature-flag, KHÔNG bảng song song (BẤT BIẾN AC-7).
 * - setModuleEnabled(operator, target, key, enabled): withTenant(target) tx ATOMIC →
 *     (1) validate module tồn tại (404); (2) DAG: bật module yêu cầu depends_on đã bật (4xx nếu chưa);
 *     (3) set TỪNG feature_key qua SaasRepository.upsertFeatureOverride (company_feature_flags — KHÔNG store
 *         on/off thứ 3); (4) recordOperatorAction CÙNG tx (rollback-safe; audit company_id = target).
 */
@Injectable()
export class ModuleRegistryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ModuleRegistryRepository,
    private readonly saasRepo: SaasRepository,
    private readonly featureFlags: FeatureFlagService,
    private readonly operatorAudit: OperatorActionAuditService,
  ) {}

  async listCatalog(operatorCompanyId: string, query: ListModulesQuery): Promise<ModuleCatalogResult> {
    const offset = (query.page - 1) * query.limit;
    return this.db.withTenant(operatorCompanyId, async (tx) => {
      const { items, total } = await this.repo.listModules(tx, {
        search: query.search,
        limit: query.limit,
        offset,
      });
      return { items: items.map(toDto), total, page: query.page, limit: query.limit };
    });
  }

  /** Catalog + trạng thái HIỆU LỰC cho 1 tenant (đọc từ FeatureFlagService — KHÔNG bảng song song). */
  async getTenantModules(targetCompanyId: string): Promise<TenantModuleStateDto[]> {
    const modules = await this.db.withTenant(targetCompanyId, (tx) =>
      this.repo.listAllActive(tx),
    );
    const states = await Promise.all(
      modules.map(async (m) => ({
        ...toDto(m),
        enabled: await this.isModuleEnabled(targetCompanyId, m),
      })),
    );
    return states;
  }

  /** Module enabled = AND(isEnabled mọi feature_key). Module rỗng feature_keys ⇒ false (fail-closed). */
  private async isModuleEnabled(companyId: string, m: SystemModule): Promise<boolean> {
    if (m.featureKeys.length === 0) return false;
    const flags = await Promise.all(
      m.featureKeys.map((fk) => this.featureFlags.isEnabled(companyId, fk)),
    );
    return flags.every((f) => f === true);
  }

  async setModuleEnabled(
    operator: RequestUser,
    targetCompanyId: string,
    moduleKey: string,
    enabled: boolean,
  ): Promise<TenantModuleStateDto> {
    // 1) module tồn tại? (catalog đọc trong context target — global no-RLS).
    const module = await this.db.withTenant(targetCompanyId, (tx) =>
      this.repo.findByKey(tx, moduleKey),
    );
    if (!module) throw new NotFoundException(`Module not found: ${moduleKey}`);

    // 2) DAG: bật module yêu cầu MỌI depends_on đã bật (đọc effective state TRƯỚC tx ghi).
    if (enabled && module.dependsOn.length > 0) {
      await this.assertDependenciesEnabled(targetCompanyId, module.dependsOn);
    }

    const before = await this.isModuleEnabled(targetCompanyId, module);

    // 3+4) ATOMIC trong withTenant(target) tx: set TỪNG feature_key + audit CÙNG tx (rollback-safe).
    await this.db.withTenant(targetCompanyId, async (tx) => {
      for (const featureKey of module.featureKeys) {
        await this.saasRepo.upsertFeatureOverride(tx, {
          companyId: targetCompanyId,
          featureKey,
          enabled,
        });
      }
      // object_id = target company (uuid). moduleKey là KEY chuỗi (KHÔNG uuid) ⇒ ghi vào before/after
      // payload (jsonb), KHÔNG vào cột object_id (uuid). Forensic: operator → tenant → module + enabled.
      await this.operatorAudit.recordOperatorAction(tx, {
        operatorId: operator.id,
        targetTenantId: targetCompanyId,
        action: "operator.module_toggled",
        before: { moduleKey, enabled: before },
        after: { moduleKey, enabled },
      });
    });

    return { ...toDto(module), enabled };
  }

  /** Mỗi dependency module phải có MỌI feature_key đang bật; nếu không ⇒ 4xx (DAG, fail-closed). */
  private async assertDependenciesEnabled(companyId: string, dependsOn: string[]): Promise<void> {
    const depModules = await this.db.withTenant(companyId, async (tx) => {
      const rows = await Promise.all(dependsOn.map((key) => this.repo.findByKey(tx, key)));
      return rows;
    });

    for (let i = 0; i < dependsOn.length; i++) {
      const dep = depModules[i];
      if (!dep) {
        throw new BadRequestException(`Module phụ thuộc không tồn tại: ${dependsOn[i]}`);
      }
      const depEnabled = await this.isModuleEnabled(companyId, dep);
      if (!depEnabled) {
        throw new BadRequestException(
          `Phải bật module phụ thuộc trước: ${dep.key}`,
        );
      }
    }
  }
}
