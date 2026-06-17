import { Injectable } from "@nestjs/common";
import { asc, eq, ilike, or, sql } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { systemModules, type SystemModule } from "../db/schema";

export interface ListModulesFilter {
  search?: string;
  limit: number;
  offset: number;
}

/**
 * ModuleRegistryRepository (AC-7) — data-access cho catalog GLOBAL `system_modules` (no-RLS). Mọi method
 * nhận `tx` (đọc trong bất kỳ withTenant — catalog không phụ thuộc company_id). KHÔNG ghi (catalog
 * immutable lúc runtime; seed/đổi qua migration). Per-tenant on/off ở SaasRepository (company_feature_flags).
 */
@Injectable()
export class ModuleRegistryRepository {
  /** List catalog (paginate + optional search trên key/name). active TRƯỚC, theo display_order. */
  async listModules(
    tx: TenantTx,
    filter: ListModulesFilter,
  ): Promise<{ items: SystemModule[]; total: number }> {
    const where = filter.search
      ? or(ilike(systemModules.key, `%${filter.search}%`), ilike(systemModules.name, `%${filter.search}%`))
      : undefined;

    const items = await tx
      .select()
      .from(systemModules)
      .where(where)
      .orderBy(asc(systemModules.displayOrder), asc(systemModules.key))
      .limit(filter.limit)
      .offset(filter.offset);

    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(systemModules)
      .where(where);

    return { items, total: countRow?.count ?? 0 };
  }

  /** Toàn bộ catalog (không paginate) — dùng cho getTenantModules (effective state mọi module). */
  async listAllActive(tx: TenantTx): Promise<SystemModule[]> {
    return tx
      .select()
      .from(systemModules)
      .where(eq(systemModules.isActive, true))
      .orderBy(asc(systemModules.displayOrder), asc(systemModules.key));
  }

  async findByKey(tx: TenantTx, key: string): Promise<SystemModule | undefined> {
    const [row] = await tx
      .select()
      .from(systemModules)
      .where(eq(systemModules.key, key))
      .limit(1);
    return row;
  }
}
