import { Injectable, NotFoundException } from "@nestjs/common";
import type { DashboardTypeItemDto, DashboardViewResponseDto } from "@mediaos/contracts";
import { PermissionService } from "../permission/permission.service";
import { DashboardWidgetRegistryService } from "./dashboard-widget-registry.service";
import {
  DASH_TYPE_LABEL,
  DASH_TYPE_PERMISSION_PAIR,
  DASH_TYPE_PRIORITY,
  type DashResolverType,
} from "./dashboard-widget-catalog.const";
import { DASH_ERR } from "./dashboard-resolver.errors";

const notResolved = () =>
  new NotFoundException({
    code: DASH_ERR.DASHBOARD_NOT_RESOLVED,
    message: "Không xác định được dashboard mặc định cho người dùng",
  });

/**
 * S4-DASH-BE-1 — DashboardResolverService: quyết định dashboard type mặc định + liệt kê type được phép, và
 * orchestrate /me + 4 route type qua DashboardWidgetRegistryService.
 *
 * Dùng PermissionService.can() TRỰC TIẾP (KHÔNG qua guard) để resolve — thứ tự ưu tiên Admin>HR>Manager>
 * Employee CỐ ĐỊNH (DASH_TYPE_PRIORITY), KHÔNG đọc user_roles.name (BẤT BIẾN: không hard-code role).
 *
 * BỎ bước "personal default" (SPEC-07 §11.2 bước 1): bảng dashboard_user_preferences CHƯA build (mig 0482
 * chỉ có widgets/configs/cache) — đi thẳng ưu tiên role. Thêm bảng đó = WO DB riêng, ngoài phạm vi lane BE.
 */
@Injectable()
export class DashboardResolverService {
  constructor(
    private readonly permission: PermissionService,
    private readonly registry: DashboardWidgetRegistryService,
  ) {}

  /** /dashboard/me — resolve default type rồi trả widget của type đó. */
  async getMyDashboard(
    companyId: string,
    userId: string,
    limit: number,
  ): Promise<DashboardViewResponseDto> {
    const allowed = await this.allowedTypeSet(companyId, userId);
    const defaultType = this.pickDefault(allowed);
    if (!defaultType) throw notResolved();
    return this.buildView(companyId, userId, defaultType, limit);
  }

  /** /dashboard/{type} — type ĐÃ được gate ở controller (@RequirePermission). Trả widget của type. */
  async getDashboardByType(
    companyId: string,
    userId: string,
    dashboardType: DashResolverType,
    limit: number,
  ): Promise<DashboardViewResponseDto> {
    return this.buildView(companyId, userId, dashboardType, limit);
  }

  /** /dashboard/types — mọi type user được phép + is_default (default tính 1 lần). 0 type ⇒ 404. */
  async listAllowedTypes(companyId: string, userId: string): Promise<DashboardTypeItemDto[]> {
    const allowed = await this.allowedTypeSet(companyId, userId);
    const defaultType = this.pickDefault(allowed);
    if (!defaultType) throw notResolved();

    // Giữ thứ tự ưu tiên (Admin>HR>Manager>Employee) cho ổn định output.
    return DASH_TYPE_PRIORITY.filter((t) => allowed.has(t)).map((t) => {
      const pair = DASH_TYPE_PERMISSION_PAIR[t];
      return {
        dashboard_type: t,
        label: DASH_TYPE_LABEL[t],
        is_default: t === defaultType,
        permission: `${pair.action}:${pair.resourceType}`,
      };
    });
  }

  /** Tập type user được phép — 4 can() song song theo cặp view-*:dashboard (kèm isSensitive). */
  private async allowedTypeSet(companyId: string, userId: string): Promise<Set<DashResolverType>> {
    const checks = await Promise.all(
      DASH_TYPE_PRIORITY.map(async (type) => {
        const pair = DASH_TYPE_PERMISSION_PAIR[type];
        const decision = await this.permission.can({
          userId,
          companyId,
          action: pair.action,
          resourceType: pair.resourceType,
          isSensitive: pair.isSensitive,
        });
        return [type, decision.allow] as const;
      }),
    );
    return new Set(checks.filter(([, allow]) => allow).map(([type]) => type));
  }

  /** Default = type ưu tiên cao nhất trong tập allowed (Admin>HR>Manager>Employee); rỗng ⇒ null. */
  private pickDefault(allowed: Set<DashResolverType>): DashResolverType | null {
    for (const type of DASH_TYPE_PRIORITY) {
      if (allowed.has(type)) return type;
    }
    return null;
  }

  private async buildView(
    companyId: string,
    userId: string,
    dashboardType: DashResolverType,
    limit: number,
  ): Promise<DashboardViewResponseDto> {
    const widgets = await this.registry.listWidgets(companyId, userId, dashboardType, limit);
    return {
      dashboard_type: dashboardType,
      widgets,
      generated_at: new Date().toISOString(),
    };
  }
}
