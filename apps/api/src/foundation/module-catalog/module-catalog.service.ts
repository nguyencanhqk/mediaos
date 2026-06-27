import { Injectable, Logger } from "@nestjs/common";
import { PermissionService } from "../../permission/permission.service";
import { SettingService } from "../settings/setting.service";
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
 *  (3) caps = PermissionService.getCapabilities (1 lần, chỉ non-sensitive ALLOW — đủ phủ mọi cặp module).
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
    const [resolved, caps] = await Promise.all([
      this.settings.resolveMany(actor.companyId, keys),
      this.permission.getCapabilities(actor.id, actor.companyId),
    ]);
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

      // Lọc quyền: requiredAny rỗng → HIỆN; ngược lại cần ≥1 cap khớp (wildcard-aware).
      if (!hasAnyCapability(caps, meta.requiredAny)) continue;

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
}

/** Key setting bật/tắt module (BACKEND-04 §8.3). */
function settingKey(moduleCode: string): string {
  return `module.${moduleCode}.enabled`;
}
