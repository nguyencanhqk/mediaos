import { Injectable, Logger } from "@nestjs/common";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { DashboardWidgetSummaryDto } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import { dashboardWidgetConfigs, dashboardWidgets } from "../db/schema/dashboard";
import { userRoles } from "../db/schema/permissions";
import { DASH_WIDGET_GATE_PAIR, type EnginePair } from "./dashboard-widget-catalog.const";

/** Precedence config_scope: User > Role > Company (DB-07 §8.2 rule 1). */
const SCOPE_RANK: Record<string, number> = { User: 3, Role: 2, Company: 1 };

interface ConfigRow {
  widgetId: string;
  configScope: string;
  isEnabled: boolean;
  sortOrder: number;
  dataScopeOverride: string | null;
  widgetCode: string;
  widgetName: string;
  widgetType: string;
  moduleCode: string;
  defaultDataScope: string;
}

/**
 * S4-DASH-BE-1 — DashboardWidgetRegistryService: với (companyId, userId, dashboardType) → trả widget
 * METADATA (KHÔNG data — đó là S4-DASH-BE-2) đã lọc 2 tầng:
 *   1. dashboard_widget_configs (precedence User>Role>Company, is_enabled, deleted_at) — nguồn DUY NHẤT
 *      quyết định widget nào thuộc dashboard type nào (KHÔNG hard-code if(role)).
 *   2. DASH_WIDGET_GATE_PAIR[widgetCode] — permission MODULE NGUỒN, fail-closed khi thiếu entry.
 * Mọi query đi qua db.withTenant(companyId) (RLS + FORCE, BẤT BIẾN #1); mọi filter deleted_at IS NULL.
 */
@Injectable()
export class DashboardWidgetRegistryService {
  private readonly logger = new Logger(DashboardWidgetRegistryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
  ) {}

  async listWidgets(
    companyId: string,
    userId: string,
    dashboardType: string,
    limit: number,
  ): Promise<DashboardWidgetSummaryDto[]> {
    // Bước 1-2: đọc role active + config JOIN widget — TẤT CẢ trong 1 tenant tx (RLS sống).
    const rows = await this.db.withTenant(companyId, async (tx) => {
      const roleIds = await this.activeRoleIds(tx, companyId, userId);
      return this.fetchConfigRows(tx, companyId, userId, dashboardType, roleIds);
    });

    // Bước 3: precedence User>Role>Company — 1 row / widget_id; loại nếu row thắng có is_enabled=false.
    const picked = this.pickByPrecedence(rows);

    // Bước 4: gate tầng-2 permission module nguồn (fail-closed). can() song song.
    const gated = await this.filterByGatePair(companyId, userId, picked);

    // Bước 5: sort theo sort_order asc rồi cap.
    gated.sort((a, b) => a.sortOrder - b.sortOrder);
    const limited = gated.slice(0, Math.max(0, limit));

    // Bước 6: map → DTO (data=null tới BE-2).
    return limited.map((r) => ({
      widget_code: r.widgetCode,
      widget_name: r.widgetName,
      widget_type: r.widgetType,
      source_modules: [r.moduleCode],
      data_scope: r.dataScopeOverride ?? r.defaultDataScope,
      layout: { order: r.sortOrder },
      data: null,
      last_updated_at: null,
    }));
  }

  /** role_id active của user (deleted_at IS NULL, chưa hết hạn) — qua withTenant. */
  private async activeRoleIds(tx: TenantTx, companyId: string, userId: string): Promise<string[]> {
    const rows = await tx
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.companyId, companyId),
          isNull(userRoles.deletedAt),
          or(isNull(userRoles.expiresAt), gt(userRoles.expiresAt, sql`now()`)),
        ),
      );
    return rows.map((r) => r.roleId);
  }

  /** config rows Company + Role(∈roleIds) + User(=userId) cho 1 dashboardType, JOIN widget Active. */
  private async fetchConfigRows(
    tx: TenantTx,
    companyId: string,
    userId: string,
    dashboardType: string,
    roleIds: string[],
  ): Promise<ConfigRow[]> {
    // Role-scope chỉ khớp khi user CÓ role đó; roleIds rỗng ⇒ nhánh Role không bao giờ đúng.
    const roleScopeCond =
      roleIds.length > 0
        ? and(
            eq(dashboardWidgetConfigs.configScope, "Role"),
            sql`${dashboardWidgetConfigs.roleId} = ANY(${sql.param(roleIds)}::uuid[])`,
          )
        : sql`false`;

    const rows = await tx
      .select({
        widgetId: dashboardWidgetConfigs.widgetId,
        configScope: dashboardWidgetConfigs.configScope,
        isEnabled: dashboardWidgetConfigs.isEnabled,
        sortOrder: dashboardWidgetConfigs.sortOrder,
        dataScopeOverride: dashboardWidgetConfigs.dataScopeOverride,
        widgetCode: dashboardWidgets.widgetCode,
        widgetName: dashboardWidgets.name,
        widgetType: dashboardWidgets.widgetType,
        moduleCode: dashboardWidgets.moduleCode,
        defaultDataScope: dashboardWidgets.defaultDataScope,
      })
      .from(dashboardWidgetConfigs)
      .innerJoin(dashboardWidgets, eq(dashboardWidgets.id, dashboardWidgetConfigs.widgetId))
      .where(
        and(
          eq(dashboardWidgetConfigs.companyId, companyId),
          eq(dashboardWidgetConfigs.dashboardType, dashboardType),
          isNull(dashboardWidgetConfigs.deletedAt),
          isNull(dashboardWidgets.deletedAt),
          eq(dashboardWidgets.status, "Active"),
          or(
            eq(dashboardWidgetConfigs.configScope, "Company"),
            roleScopeCond,
            and(
              eq(dashboardWidgetConfigs.configScope, "User"),
              eq(dashboardWidgetConfigs.userId, userId),
            ),
          ),
        ),
      );
    return rows as ConfigRow[];
  }

  /** 1 row thắng / widget_id theo precedence User>Role>Company; loại nếu row thắng is_enabled=false. */
  private pickByPrecedence(rows: ConfigRow[]): ConfigRow[] {
    const best = new Map<string, ConfigRow>();
    for (const row of rows) {
      const current = best.get(row.widgetId);
      if (!current || SCOPE_RANK[row.configScope] > SCOPE_RANK[current.configScope]) {
        best.set(row.widgetId, row);
      }
    }
    return [...best.values()].filter((r) => r.isEnabled);
  }

  /**
   * Gate tầng-2: mỗi widget qua DASH_WIDGET_GATE_PAIR[widgetCode] → can(action,resourceType).
   *   - thiếu entry map ⇒ LOẠI + log.warn (fail-closed; KHÔNG throw làm sập cả dashboard).
   *   - KHÔNG truyền isSensitive: engine tự ép effectivelySensitive = input.isSensitive OR grant.isSensitive
   *     (permission.service.ts:206) ⇒ cặp nguồn is_sensitive=true VẪN bị ép exact-match, wildcard KHÔNG lọt.
   */
  private async filterByGatePair(
    companyId: string,
    userId: string,
    rows: ConfigRow[],
  ): Promise<ConfigRow[]> {
    const decisions = await Promise.all(
      rows.map(async (row) => {
        const pair: EnginePair | undefined = DASH_WIDGET_GATE_PAIR[row.widgetCode];
        if (!pair) {
          this.logger.warn(
            `widget '${row.widgetCode}' thiếu DASH_WIDGET_GATE_PAIR — fail-closed loại khỏi registry`,
          );
          return false;
        }
        const decision = await this.permission.can({
          userId,
          companyId,
          action: pair.action,
          resourceType: pair.resourceType,
        });
        return decision.allow;
      }),
    );
    return rows.filter((_, i) => decisions[i]);
  }
}
