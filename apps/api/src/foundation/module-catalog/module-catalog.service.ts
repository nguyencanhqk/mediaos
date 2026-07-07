import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { FOUNDATION_ERROR_CODES } from "@mediaos/contracts";
import { PermissionService } from "../../permission/permission.service";
import { SettingService, type ResolvedSetting } from "../settings/setting.service";
import type { Module } from "../../db/schema/seed-tracking";
import type { AdminModuleDetail, AdminModuleItem } from "./module-admin.dto";
import type { MyAppItem } from "./module-catalog.dto";
import { ModuleCatalogRepository } from "./module-catalog.repository";
import { MODULE_APP_METADATA, hasAnyCapability } from "./module-app-metadata";

interface Actor {
  id: string;
  companyId: string;
}

/**
 * S1-FND-MODULE-1 — ModuleCatalogService (crown-jewel: listing lọc theo quyền).
 *
 * getMyApps: app user được phép thấy ở Home Portal/App Switcher (BACKEND-04 §9.3). Bước:
 *  (1) đọc `modules` active (catalog no-RLS) — đã ORDER BY sort_order.
 *  (2) enabled BATCH: SettingService.resolveMany key `module.<code>.enabled` (precedence company→system→
 *      default; default=true) — KHÔNG N+1.
 *  (3) caps = MERGE getCapabilities() (non-sensitive ALLOW) + getAllowlistedSensitiveCapabilities()
 *      (cặp NHẠY CẢM curated trong SENSITIVE_CAPABILITY_ALLOWLIST — vd view-*:attendance, view:audit-log).
 *      LÝ DO (S2-FND-BE-5 / Option B): metadata ATT/AUTH gate bằng cặp is_sensitive=true (0454/0340) mà
 *      getCapabilities() CỐ Ý lọc sensitive ⇒ nếu chỉ dùng nó, app ATT ẩn-ngầm cho MỌI role. Merge =
 *      surface CÓ KIỂM SOÁT ĐÚNG cặp allowlist để dựng app card (cờ HIỂN THỊ, KHÔNG phải enforcement —
 *      cổng THẬT vẫn là PermissionGuard per-resource ở từng controller).
 *  (4) LỌC: enabled AND (requiredAny rỗng → HIỆN | có ≥1 cap khớp → HIỆN | thiếu hết → ẨN). Module active mà
 *      thiếu metadata → bỏ qua + warn (không dựng app card, KHÔNG bịa).
 *
 * Tenant: mọi đường lấy companyId/userId TỪ AuthContext (actor) — resolveMany/getCapabilities keyed actor ⇒
 * company A KHÔNG thấy enabled-flag/quyền của B (BẤT BIẾN #1).
 */
@Injectable()
export class ModuleCatalogService {
  private readonly logger = new Logger(ModuleCatalogService.name);

  constructor(
    private readonly repo: ModuleCatalogRepository,
    private readonly settings: SettingService,
    private readonly permission: PermissionService,
  ) {}

  async getMyApps(actor: Actor): Promise<MyAppItem[]> {
    const mods = await this.repo.findActiveModules();
    if (mods.length === 0) return [];

    const keys = mods.map((m) => settingKey(m.moduleCode));
    // Option B: MERGE non-sensitive caps + allowlisted sensitive caps (view-*:attendance / view:audit-log).
    // Cả 2 method fail-safe → {} khi lỗi hạ tầng ⇒ merge KHÔNG throw; thiếu cap ⇒ chỉ ẩn app (an toàn, không rò).
    const [resolved, caps, sensitiveCaps] = await Promise.all([
      this.settings.resolveMany(actor.companyId, keys),
      this.permission.getCapabilities(actor.id, actor.companyId),
      this.permission.getAllowlistedSensitiveCapabilities(actor.id, actor.companyId),
    ]);
    const mergedCaps: Record<string, boolean> = { ...caps, ...sensitiveCaps };
    const resolvedByKey = new Map(resolved.map((r) => [r.key, r]));

    const items: MyAppItem[] = [];
    for (const m of mods) {
      const meta = MODULE_APP_METADATA[m.moduleCode];
      if (!meta) {
        this.logger.warn(
          `Module '${m.moduleCode}' active nhưng thiếu MODULE_APP_METADATA — bỏ qua (không dựng app card).`,
        );
        continue;
      }

      const r = resolvedByKey.get(settingKey(m.moduleCode));
      // default=true: chưa seed/không thấy → enabled. Chỉ tắt khi setting tồn tại và = false.
      const enabled = r?.found ? r.value === true || r.value === "true" : true;
      if (!enabled) continue;

      // Lọc quyền: requiredAny rỗng → HIỆN; ngược lại cần ≥1 cap khớp (wildcard-aware). caps = merged
      // (non-sensitive + allowlisted sensitive) ⇒ cặp sensitive-canonical (ATT/audit) surface đúng.
      if (!hasAnyCapability(mergedCaps, meta.requiredAny)) continue;

      items.push({
        module_code: m.moduleCode,
        name: m.name,
        description: m.description,
        route: meta.route,
        icon: meta.icon,
        group: m.moduleGroup,
        is_active: true,
        // recent/favorite chưa có bảng (user_module_preferences) → trả false.
        // TODO(Phase 2): user_module_preferences cho recent/favorite — KHÔNG bịa dữ liệu.
        is_favorite: false,
        is_recent: false,
        badges: [],
        required_permissions: [...meta.feCodes],
        allowed_actions: ["open", "favorite"],
      });
    }
    return items; // giữ thứ tự sort_order từ repo
  }

  /**
   * S2-FND-BE-1 — Admin module catalog (GET /foundation/modules). KHÁC getMyApps:
   *  - Trả TẤT CẢ module (active + inactive, deleted_at IS NULL) — quản trị viên thấy hết để bật/tắt.
   *  - KHÔNG lọc theo capability user (KHÔNG gọi getCapabilities) — gate ở PermissionGuard
   *    (view:foundation-module) TRƯỚC service; ai vào được là thấy toàn bộ catalog.
   *  - enabled resolve BATCH qua SettingService.resolveMany key `module.<code>.enabled`
   *    (precedence company→system→default=true) keyed actor.companyId ⇒ cờ enabled theo TENANT (BẤT BIẾN #1:
   *    company A tắt module KHÔNG ảnh hưởng B).
   *  - Module thiếu MODULE_APP_METADATA (vd PAYROLL/extension) VẪN hiện: route/icon rỗng, required_permissions=[]
   *    (KHÔNG bịa — nguồn route/icon là hằng metadata, chưa khai báo ⇒ để trống).
   */
  async getAllModules(actor: Actor): Promise<AdminModuleItem[]> {
    const mods = await this.repo.findAllModules();
    if (mods.length === 0) return [];

    const keys = mods.map((m) => settingKey(m.moduleCode));
    const resolved = await this.settings.resolveMany(actor.companyId, keys);
    const resolvedByKey = new Map(resolved.map((r) => [r.key, r]));

    return mods.map((m) => this.toAdminItem(m, resolvedByKey)); // giữ thứ tự sort_order từ repo
  }

  /**
   * S2-FND-BE-1 — Admin module detail (GET /foundation/modules/:code). NotFoundException nếu code không tồn
   * tại (hoặc đã soft-delete). enabled resolve theo actor.companyId như list.
   */
  async getModuleDetail(actor: Actor, code: string): Promise<AdminModuleDetail> {
    const [m] = await this.repo.findByCode(code);
    if (!m) {
      throw new NotFoundException({
        code: FOUNDATION_ERROR_CODES.MODULE_NOT_FOUND,
        message: `Module '${code}' không tồn tại.`,
      });
    }
    const resolved = await this.settings.resolveMany(actor.companyId, [settingKey(m.moduleCode)]);
    const resolvedByKey = new Map(resolved.map((r) => [r.key, r]));
    return this.toAdminItem(m, resolvedByKey);
  }

  /** Map 1 row `modules` → AdminModuleItem (merge metadata + enabled-flag đã resolve). PURE. */
  private toAdminItem(m: Module, resolvedByKey: Map<string, ResolvedSetting>): AdminModuleItem {
    const meta = MODULE_APP_METADATA[m.moduleCode];
    const r = resolvedByKey.get(settingKey(m.moduleCode));
    // default=true: chưa seed/không thấy → enabled. Chỉ tắt khi setting tồn tại và = false.
    const enabled = r?.found ? r.value === true || r.value === "true" : true;
    return {
      module_code: m.moduleCode,
      name: m.name,
      description: m.description,
      group: m.moduleGroup,
      is_active: m.isActive,
      enabled,
      route: meta?.route ?? "",
      icon: meta?.icon ?? "",
      required_permissions: meta ? [...meta.feCodes] : [],
    };
  }
}

/** Key setting bật/tắt module (BACKEND-04 §8.3). */
function settingKey(moduleCode: string): string {
  return `module.${moduleCode}.enabled`;
}
