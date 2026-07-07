import { Injectable } from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { modules, type Module } from "../../db/schema/seed-tracking";
import { companySettings } from "../../db/schema/settings";

/**
 * S1-FND-MODULE-1 — đọc catalog `modules` (mig 0435).
 *
 * `modules` là catalog GLOBAL no-RLS (KHÔNG cột company_id) — đọc qua db.withTransaction (KHÔNG set tenant
 * GUC) là ĐÚNG: không có policy keyed company_id để thoả; mirror cách đọc catalog `permissions` no-RLS. KHÔNG
 * dùng withTenant (vô nghĩa cho bảng không tenant — db.service §108).
 */
@Injectable()
export class ModuleCatalogRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Module đang active, chưa soft-delete, ORDER BY sort_order. App role có SELECT (grant mig 0435). */
  findActiveModules(): Promise<Module[]> {
    return this.db.withTransaction((tx) =>
      tx
        .select()
        .from(modules)
        .where(and(eq(modules.isActive, true), isNull(modules.deletedAt)))
        .orderBy(asc(modules.sortOrder)),
    );
  }

  /**
   * S2-FND-BE-1 (admin catalog) — TẤT CẢ module chưa soft-delete (KỂ CẢ inactive), ORDER BY sort_order.
   * KHÁC findActiveModules (my-apps): admin view thấy hết để quản trị bật/tắt. deleted_at IS NULL vẫn giữ.
   */
  findAllModules(): Promise<Module[]> {
    return this.db.withTransaction((tx) =>
      tx.select().from(modules).where(isNull(modules.deletedAt)).orderBy(asc(modules.sortOrder)),
    );
  }

  /** S2-FND-BE-1 — 1 module theo code (chưa soft-delete). Rỗng ⇒ service ném NotFound. */
  findByCode(code: string): Promise<Module[]> {
    return this.db.withTransaction((tx) =>
      tx
        .select()
        .from(modules)
        .where(and(eq(modules.moduleCode, code), isNull(modules.deletedAt)))
        .limit(1),
    );
  }

  // ─── S2-FND-BE-8 — bật/tắt module: ghi company_settings 'module.<code>.enabled' (TENANT-SCOPED) ─────
  // RIÊNG khỏi SettingRepository (KHÔNG export/mượn SettingService.updateCompanySetting). company_settings
  // RLS+FORCE keyed company_id ⇒ MỌI method PHẢI chạy TRONG withTenant(actor.companyId) của service (tx
  // truyền vào) — BẤT BIẾN #1. Soft-delete/status theo lược đồ (KHÔNG hard-delete — BẤT BIẾN #2).

  /** Đọc override 'module.<code>.enabled' Active (chưa soft-delete) của tenant (cho toggle: old + insert/update). */
  findModuleSettingTx(companyId: string, key: string, tx: TenantTx) {
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

  /** INSERT override 'module.<code>.enabled' MỚI (Boolean, category 'Module', non-sensitive). Trả hàng đã tạo. */
  insertModuleSettingTx(
    companyId: string,
    key: string,
    enabled: boolean,
    moduleCode: string,
    actorId: string,
    tx: TenantTx,
  ) {
    return tx
      .insert(companySettings)
      .values({
        companyId,
        settingKey: key,
        settingValue: enabled,
        valueType: "Boolean",
        category: "Module",
        moduleCode,
        isPublic: true,
        isSensitive: false,
        isEncrypted: false,
        status: "Active",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();
  }

  /** UPDATE override đã có (đổi cờ bật/tắt). updatedAt/updatedBy tự set. Trả hàng sau update. */
  updateModuleSettingTx(
    companyId: string,
    id: string,
    enabled: boolean,
    actorId: string,
    tx: TenantTx,
  ) {
    return tx
      .update(companySettings)
      .set({ settingValue: enabled, updatedBy: actorId, updatedAt: new Date() })
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
