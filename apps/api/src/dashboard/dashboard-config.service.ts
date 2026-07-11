import { Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import type {
  DashboardConfigItemDto,
  DashboardConfigListQueryDto,
  DashboardConfigListResponseDto,
  DashboardConfigPatchDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService, type AuditEntry } from "../events/audit.service";
import { dashboardWidgetConfigs, dashboardWidgets } from "../db/schema/dashboard";
import { DASH_CONFIG_ERR } from "./dashboard-config.errors";

/** Ưu tiên config_scope cho ORDER BY (Company < Role < User) — mirror registry SCOPE_RANK nhưng ngược
 * chiều (list hiển thị Company trước). */
const SCOPE_ORDER: Record<string, number> = { Company: 1, Role: 2, User: 3 };

/** Cột config SELECT cho list/patch (join widget_code/name). */
const configSelection = {
  id: dashboardWidgetConfigs.id,
  widgetId: dashboardWidgetConfigs.widgetId,
  widgetCode: dashboardWidgets.widgetCode,
  widgetName: dashboardWidgets.name,
  dashboardType: dashboardWidgetConfigs.dashboardType,
  configScope: dashboardWidgetConfigs.configScope,
  roleId: dashboardWidgetConfigs.roleId,
  userId: dashboardWidgetConfigs.userId,
  isEnabled: dashboardWidgetConfigs.isEnabled,
  sortOrder: dashboardWidgetConfigs.sortOrder,
  layoutX: dashboardWidgetConfigs.layoutX,
  layoutY: dashboardWidgetConfigs.layoutY,
  layoutWidth: dashboardWidgetConfigs.layoutWidth,
  layoutHeight: dashboardWidgetConfigs.layoutHeight,
  dataScopeOverride: dashboardWidgetConfigs.dataScopeOverride,
  refreshSecondsOverride: dashboardWidgetConfigs.refreshSecondsOverride,
  config: dashboardWidgetConfigs.config,
  updatedAt: dashboardWidgetConfigs.updatedAt,
  updatedBy: dashboardWidgetConfigs.updatedBy,
} as const;

type ConfigRow = {
  id: string;
  widgetId: string;
  widgetCode: string;
  widgetName: string;
  dashboardType: string;
  configScope: string;
  roleId: string | null;
  userId: string | null;
  isEnabled: boolean;
  sortOrder: number;
  layoutX: number | null;
  layoutY: number | null;
  layoutWidth: number | null;
  layoutHeight: number | null;
  dataScopeOverride: string | null;
  refreshSecondsOverride: number | null;
  config: Record<string, unknown> | null;
  updatedAt: Date;
  updatedBy: string | null;
};

/** Snapshot config-only (audit before/after) — CHỈ các field cấu hình có thể đổi (bảng KHÔNG có secret/PII;
 * AuditService mask lần nữa trước insert — BẤT BIẾN #3). Bỏ updatedAt/updatedBy (không phải config; luôn đổi
 * ⇒ nhiễu changed_fields). */
function configSnapshot(row: ConfigRow): Record<string, unknown> {
  return {
    is_enabled: row.isEnabled,
    sort_order: row.sortOrder,
    layout_x: row.layoutX,
    layout_y: row.layoutY,
    layout_width: row.layoutWidth,
    layout_height: row.layoutHeight,
    data_scope_override: row.dataScopeOverride,
    refresh_seconds_override: row.refreshSecondsOverride,
    config: row.config,
  };
}

function toItemDto(row: ConfigRow): DashboardConfigItemDto {
  return {
    id: row.id,
    widget_id: row.widgetId,
    widget_code: row.widgetCode,
    widget_name: row.widgetName,
    dashboard_type: row.dashboardType as DashboardConfigItemDto["dashboard_type"],
    config_scope: row.configScope as DashboardConfigItemDto["config_scope"],
    role_id: row.roleId,
    user_id: row.userId,
    is_enabled: row.isEnabled,
    sort_order: row.sortOrder,
    layout: {
      x: row.layoutX,
      y: row.layoutY,
      width: row.layoutWidth,
      height: row.layoutHeight,
    },
    data_scope_override: row.dataScopeOverride as DashboardConfigItemDto["data_scope_override"],
    refresh_seconds_override: row.refreshSecondsOverride,
    config: row.config,
    updated_at: row.updatedAt.toISOString(),
    updated_by: row.updatedBy,
  };
}

const notFound = () =>
  new NotFoundException({
    code: DASH_CONFIG_ERR.NOT_FOUND,
    message: "Không tìm thấy cấu hình widget dashboard.",
  });

/**
 * S4-DASH-BE-3 — DashboardConfigService: ranh giới GHI admin cho `dashboard_widget_configs` (DB-07 §8.2).
 *
 *   list(companyId, filters): db.withTenant (RLS+FORCE, BẤT BIẾN #1) → innerJoin widget lấy code/name,
 *     deleted_at IS NULL, filter dashboard_type/config_scope/role_id/user_id, sort
 *     dashboard_type → config_scope(Company<Role<User) → sort_order.
 *
 *   patch(companyId, actor, id, dto): db.withTenant TX { SELECT theo id+company_id+deleted_at (RLS ẩn
 *     tenant khác ⇒ thiếu = 404 KHÔNG lộ tồn tại); capture BEFORE; UPDATE CHỈ field cho phép + updated_by/
 *     updated_at; capture AFTER; audit.record(tx,…) CÙNG tx (append-only, cùng commit/rollback) }.
 *
 * KHÔNG mở đường đọc: PATCH data_scope_override/is_enabled chỉ GỢI Ý hiển thị — read-time gating (tier-2
 * DashboardWidgetRegistryService DASH_WIDGET_GATE_PAIR) là AUTHORITATIVE, cap quyền xem widget
 * (permission-matrix-spec §7). AuditService lấy từ @Global EventsModule (KHÔNG import module).
 */
@Injectable()
export class DashboardConfigService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(
    companyId: string,
    filters: DashboardConfigListQueryDto,
  ): Promise<DashboardConfigListResponseDto> {
    const conds: SQL[] = [
      eq(dashboardWidgetConfigs.companyId, companyId),
      isNull(dashboardWidgetConfigs.deletedAt),
    ];
    if (filters.dashboard_type) {
      conds.push(eq(dashboardWidgetConfigs.dashboardType, filters.dashboard_type));
    }
    if (filters.config_scope) {
      conds.push(eq(dashboardWidgetConfigs.configScope, filters.config_scope));
    }
    if (filters.role_id) conds.push(eq(dashboardWidgetConfigs.roleId, filters.role_id));
    if (filters.user_id) conds.push(eq(dashboardWidgetConfigs.userId, filters.user_id));

    const rows = (await this.db.withTenant(companyId, async (tx) =>
      tx
        .select(configSelection)
        .from(dashboardWidgetConfigs)
        .innerJoin(dashboardWidgets, eq(dashboardWidgets.id, dashboardWidgetConfigs.widgetId))
        .where(and(...conds)),
    )) as ConfigRow[];

    rows.sort(
      (a, b) =>
        a.dashboardType.localeCompare(b.dashboardType) ||
        (SCOPE_ORDER[a.configScope] ?? 99) - (SCOPE_ORDER[b.configScope] ?? 99) ||
        a.sortOrder - b.sortOrder,
    );

    return { items: rows.map(toItemDto) };
  }

  async patch(
    companyId: string,
    actor: { id: string },
    id: string,
    dto: DashboardConfigPatchDto,
  ): Promise<DashboardConfigItemDto> {
    return this.db.withTenant(companyId, async (tx) => {
      const [existing] = (await tx
        .select(configSelection)
        .from(dashboardWidgetConfigs)
        .innerJoin(dashboardWidgets, eq(dashboardWidgets.id, dashboardWidgetConfigs.widgetId))
        .where(
          and(
            eq(dashboardWidgetConfigs.id, id),
            eq(dashboardWidgetConfigs.companyId, companyId),
            isNull(dashboardWidgetConfigs.deletedAt),
          ),
        )) as ConfigRow[];
      if (!existing) throw notFound();

      const set = this.buildUpdateSet(dto, actor.id);
      const [updated] = (await tx
        .update(dashboardWidgetConfigs)
        .set(set)
        .where(
          and(
            eq(dashboardWidgetConfigs.id, id),
            eq(dashboardWidgetConfigs.companyId, companyId),
            isNull(dashboardWidgetConfigs.deletedAt),
          ),
        )
        .returning(this.updateReturning())) as UpdatedRow[];
      if (!updated) throw notFound();

      // widget_code/name không đổi khi PATCH config ⇒ tái dùng từ existing (đã join).
      const after: ConfigRow = {
        ...updated,
        widgetCode: existing.widgetCode,
        widgetName: existing.widgetName,
      };

      await this.audit.record(tx, this.buildAuditEntry(existing, after, actor, id));

      return toItemDto(after);
    });
  }

  /** Dựng AuditEntry CONFIG_UPDATE (append-only, BẤT BIẾN #2) cho PATCH config — tách khỏi patch() giữ hàm
   * < 50 dòng. Field/giá trị GIỮ NGUYÊN (thuần refactor); snapshot config-only đã bỏ updatedAt/updatedBy.
   * AuditService mask before/after/old/new lần nữa trước insert (BẤT BIẾN #3). */
  private buildAuditEntry(
    before: ConfigRow,
    after: ConfigRow,
    actor: { id: string },
    id: string,
  ): AuditEntry {
    return {
      action: "DashboardConfigUpdated",
      actionGroup: "CONFIG_UPDATE",
      objectType: "dashboard_widget_config",
      objectId: id,
      actorUserId: actor.id,
      actorType: "User",
      moduleCode: "DASH",
      entityType: "dashboard_widget_config",
      entityId: id,
      before: configSnapshot(before),
      after: configSnapshot(after),
      oldValues: configSnapshot(before),
      newValues: configSnapshot(after),
      sensitivityLevel: "Sensitive",
      resultStatus: "Success",
      dataScope: "Company",
      permissionCode: "DASH.CONFIG.UPDATE",
    };
  }

  /** UPDATE set: CHỈ field cho phép (whitelist). Key có mặt (kể cả null tường minh) → set; vắng → giữ nguyên.
   * data_scope_override/refresh_seconds_override/config/layout_* nullable ⇒ null = xoá override về default. */
  private buildUpdateSet(
    dto: DashboardConfigPatchDto,
    actorId: string,
  ): Partial<typeof dashboardWidgetConfigs.$inferInsert> {
    const set: Partial<typeof dashboardWidgetConfigs.$inferInsert> = {
      updatedBy: actorId,
      updatedAt: new Date(),
    };
    if ("is_enabled" in dto) set.isEnabled = dto.is_enabled;
    if ("sort_order" in dto) set.sortOrder = dto.sort_order;
    if ("layout_x" in dto) set.layoutX = dto.layout_x;
    if ("layout_y" in dto) set.layoutY = dto.layout_y;
    if ("layout_width" in dto) set.layoutWidth = dto.layout_width;
    if ("layout_height" in dto) set.layoutHeight = dto.layout_height;
    if ("data_scope_override" in dto) set.dataScopeOverride = dto.data_scope_override;
    if ("refresh_seconds_override" in dto) {
      set.refreshSecondsOverride = dto.refresh_seconds_override;
    }
    if ("config" in dto) set.config = dto.config;
    return set;
  }

  /** RETURNING của UPDATE = cột config (KHÔNG có widget_code/name — tái dùng từ existing). */
  private updateReturning() {
    return {
      id: dashboardWidgetConfigs.id,
      widgetId: dashboardWidgetConfigs.widgetId,
      dashboardType: dashboardWidgetConfigs.dashboardType,
      configScope: dashboardWidgetConfigs.configScope,
      roleId: dashboardWidgetConfigs.roleId,
      userId: dashboardWidgetConfigs.userId,
      isEnabled: dashboardWidgetConfigs.isEnabled,
      sortOrder: dashboardWidgetConfigs.sortOrder,
      layoutX: dashboardWidgetConfigs.layoutX,
      layoutY: dashboardWidgetConfigs.layoutY,
      layoutWidth: dashboardWidgetConfigs.layoutWidth,
      layoutHeight: dashboardWidgetConfigs.layoutHeight,
      dataScopeOverride: dashboardWidgetConfigs.dataScopeOverride,
      refreshSecondsOverride: dashboardWidgetConfigs.refreshSecondsOverride,
      config: dashboardWidgetConfigs.config,
      updatedAt: dashboardWidgetConfigs.updatedAt,
      updatedBy: dashboardWidgetConfigs.updatedBy,
    } as const;
  }
}

type UpdatedRow = Omit<ConfigRow, "widgetCode" | "widgetName">;
