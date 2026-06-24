import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { companySettings, systemSettings } from "../../db/schema/settings";

/**
 * S1-FND-SETTING-1 — persistence cho settings.
 *
 * BẤT BIẾN #1: company_settings ĐỌC/GHI qua db.withTenant (RLS ép cô lập tenant ở DB). system_settings là
 * GLOBAL no-RLS (không cột tenant) — đọc trong cùng tx vô hại (không có policy keyed company_id).
 *
 * KHÔNG N+1: resolveMany đọc CẢ tập key trong ĐÚNG 1 query/bảng (inArray) — tối đa 2 query cho mọi số key.
 */
@Injectable()
export class SettingRepository {
  constructor(private readonly db: DatabaseService) {}

  /** company_settings Active, chưa soft-delete, theo keys[]. Batch 1 query (inArray). Trả [] khi keys rỗng. */
  findCompanyByKeysTx(keys: string[], tx: TenantTx) {
    if (keys.length === 0) return Promise.resolve([] as (typeof companySettings.$inferSelect)[]);
    return tx
      .select()
      .from(companySettings)
      .where(
        and(
          inArray(companySettings.settingKey, keys),
          eq(companySettings.status, "Active"),
          isNull(companySettings.deletedAt),
        ),
      );
  }

  /** system_settings Active theo keys[]. Batch 1 query. Trả [] khi keys rỗng. */
  findSystemByKeysTx(keys: string[], tx: TenantTx) {
    if (keys.length === 0) return Promise.resolve([] as (typeof systemSettings.$inferSelect)[]);
    return tx
      .select()
      .from(systemSettings)
      .where(and(inArray(systemSettings.settingKey, keys), eq(systemSettings.status, "Active")));
  }

  /** company_settings Active theo filter category/module (cho /public + resolve-by-category). Batch 1 query. */
  findCompanyByFilterTx(filter: { category?: string; moduleCode?: string }, tx: TenantTx) {
    const conds = [eq(companySettings.status, "Active"), isNull(companySettings.deletedAt)];
    if (filter.category) conds.push(eq(companySettings.category, filter.category));
    if (filter.moduleCode) conds.push(eq(companySettings.moduleCode, filter.moduleCode));
    return tx
      .select()
      .from(companySettings)
      .where(and(...conds));
  }

  /** system_settings Active theo filter category/module. Batch 1 query. */
  findSystemByFilterTx(filter: { category?: string; moduleCode?: string }, tx: TenantTx) {
    const conds = [eq(systemSettings.status, "Active")];
    if (filter.category) conds.push(eq(systemSettings.category, filter.category));
    if (filter.moduleCode) conds.push(eq(systemSettings.moduleCode, filter.moduleCode));
    return tx
      .select()
      .from(systemSettings)
      .where(and(...conds));
  }

  /** Đọc 1 company_setting Active của tenant theo key (cho PATCH: lấy old + xác định insert/update). */
  findOneCompanyTx(companyId: string, key: string, tx: TenantTx) {
    return tx
      .select()
      .from(companySettings)
      .where(
        and(
          eq(companySettings.companyId, companyId),
          eq(companySettings.settingKey, key),
          eq(companySettings.status, "Active"),
          isNull(companySettings.deletedAt),
        ),
      )
      .limit(1);
  }

  /** Đọc 1 system_setting Active theo key (fallback metadata cho upsert khi company chưa có override). */
  findOneSystemTx(key: string, tx: TenantTx) {
    return tx
      .select()
      .from(systemSettings)
      .where(and(eq(systemSettings.settingKey, key), eq(systemSettings.status, "Active")))
      .limit(1);
  }

  insertCompanyTx(companyId: string, data: typeof companySettings.$inferInsert, tx: TenantTx) {
    return tx
      .insert(companySettings)
      .values({ ...data, companyId })
      .returning();
  }

  updateCompanyTx(
    companyId: string,
    id: string,
    data: Partial<typeof companySettings.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(companySettings)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(companySettings.companyId, companyId),
          eq(companySettings.id, id),
          isNull(companySettings.deletedAt),
        ),
      )
      .returning();
  }
}
