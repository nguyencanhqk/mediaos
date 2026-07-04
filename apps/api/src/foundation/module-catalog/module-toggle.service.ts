import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../db/db.service";
import { AuditService } from "../../events/audit.service";
import type { AdminModuleDetail } from "./module-admin.dto";
import { ModuleCatalogRepository } from "./module-catalog.repository";
import { ModuleCatalogService } from "./module-catalog.service";

interface Actor {
  id: string;
  companyId: string;
}

/**
 * 7 module lõi MVP KHÓA CỨNG — KHÔNG cho bật/tắt (bề mặt nghiệp vụ cốt lõi luôn hiện). Toggle bất kỳ mã
 * trong tập này → 400, 0 ghi company_settings, 0 audit. Danh sách = SPEC-01 §7 (AUTH/HR/ATT/LEAVE/TASK/
 * DASH/NOTI). KHÔNG hard-code role/phòng ban — CHỈ ràng buộc module lõi (rule sản phẩm, không phải phân quyền).
 */
export const CORE_MODULE_CODES: ReadonlySet<string> = new Set<string>([
  "AUTH",
  "HR",
  "ATT",
  "LEAVE",
  "TASK",
  "DASH",
  "NOTI",
]);

/**
 * S2-FND-BE-8 — ModuleToggleService (crown-jewel: permission sensitive + audit append-only).
 *
 * PATCH /foundation/modules/:code (cổng update:foundation-module, is_sensitive=TRUE — enforce ở
 * ModuleAdminController/PermissionGuard TRƯỚC service). Ghi cờ bật/tắt vào company_settings key
 * `module.<code>.enabled` (bảng TENANT-SCOPED, RLS+FORCE — BẤT BIẾN #1) qua repo-method RIÊNG trong
 * ModuleCatalogRepository (KHÔNG mượn SettingService.updateCompanySetting) + tự ghi audit CONFIG_UPDATE
 * object_type='module' CÙNG tx withTenant (BẤT BIẾN #2 append-only, mask BẤT BIẾN #3).
 *
 * getMyApps/getAllModules resolve enabled qua SettingService.resolveMany(`module.<code>.enabled`) ⇒ phản
 * ánh thay đổi NGAY sau khi tx commit (không cache).
 */
@Injectable()
export class ModuleToggleService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ModuleCatalogRepository,
    private readonly audit: AuditService,
    private readonly catalog: ModuleCatalogService,
  ) {}

  /**
   * Bật/tắt module cho tenant `actor.companyId`. Trả detail đã re-resolve (enabled cập nhật).
   *
   * @throws NotFoundException nếu code không tồn tại / đã soft-delete (KHÔNG write, KHÔNG audit).
   * @throws BadRequestException nếu code ∈ CORE_MODULE_CODES (KHÔNG write, KHÔNG audit).
   */
  async toggleModule(actor: Actor, code: string, enabled: boolean): Promise<AdminModuleDetail> {
    // 1. Module tồn tại? (catalog GLOBAL no-RLS). Code lạ / soft-deleted → 404 (không side-effect).
    const [m] = await this.repo.findByCode(code);
    if (!m) {
      throw new NotFoundException(`Module '${code}' không tồn tại.`);
    }

    // 2. Core-lock: 7 module MVP KHÓA CỨNG → 400 TRƯỚC mọi write/audit (BẤT BIẾN #2: deny KHÔNG ghi audit).
    if (CORE_MODULE_CODES.has(m.moduleCode)) {
      throw new BadRequestException(
        `Module lõi '${m.moduleCode}' không thể bật/tắt (7 module MVP luôn bật).`,
      );
    }

    // 3. withTenant tx: đọc old → upsert company_settings 'module.<code>.enabled' → audit CÙNG tx.
    //    Mọi query đi qua withTenant (BẤT BIẾN #1) — company_settings RLS ép cô lập tenant ở DB.
    await this.db.withTenant(actor.companyId, async (tx) => {
      const key = moduleEnabledKey(m.moduleCode);
      const [existing] = await this.repo.findModuleSettingTx(actor.companyId, key, tx);
      // default=true: chưa seed → enabled. old = giá trị hiện hữu (jsonb boolean/'true').
      const oldEnabled = existing ? coerceEnabled(existing.settingValue) : true;

      if (existing) {
        await this.repo.updateModuleSettingTx(actor.companyId, existing.id, enabled, actor.id, tx);
      } else {
        await this.repo.insertModuleSettingTx(
          actor.companyId,
          key,
          enabled,
          m.moduleCode,
          actor.id,
          tx,
        );
      }

      // Audit CÙNG tx (BẤT BIẾN #2 append-only). object_type='module' ∈ CHECK (mig 0474). action=
      // ModuleEnabled/ModuleDisabled; action_group='CONFIG_UPDATE'; permission_code='FOUNDATION.MODULE.UPDATE'.
      // old/new CHỈ {code,enabled} — KHÔNG secret/PII (AuditMasker cũng che phòng thủ chiều sâu, BẤT BIẾN #3).
      // Bật/tắt module đổi bề mặt ứng dụng toàn công ty = hành động quan trọng (SPEC-01 §16.3).
      await this.audit.record(tx, {
        action: enabled ? "ModuleEnabled" : "ModuleDisabled",
        objectType: "module",
        objectId: m.id,
        actorUserId: actor.id,
        actorType: "User",
        actionGroup: "CONFIG_UPDATE",
        moduleCode: m.moduleCode,
        entityType: "module",
        entityId: m.id,
        entityCode: m.moduleCode,
        oldValues: { code: m.moduleCode, enabled: oldEnabled },
        newValues: { code: m.moduleCode, enabled },
        sensitivityLevel: "Normal",
        resultStatus: "Success",
        dataScope: "Company",
        permissionCode: "FOUNDATION.MODULE.UPDATE",
      });
    });

    // 4. Re-resolve detail (mở withTenant riêng, đọc sau commit) → enabled phản ánh NGAY.
    return this.catalog.getModuleDetail(actor, m.moduleCode);
  }
}

/** Key setting bật/tắt module (BACKEND-04 §8.3) — mirror ModuleCatalogService.settingKey. */
function moduleEnabledKey(moduleCode: string): string {
  return `module.${moduleCode}.enabled`;
}

/** jsonb boolean/'true' → boolean (chỉ true khi === true hoặc 'true'; mọi giá trị khác = false). */
function coerceEnabled(value: unknown): boolean {
  return value === true || value === "true";
}
