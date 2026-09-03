import { Injectable, Logger } from "@nestjs/common";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { DashboardWidgetSummaryDto } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { dashboardWidgetConfigs, dashboardWidgets } from "../db/schema/dashboard";
import { userRoles } from "../db/schema/permissions";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import {
  DASH_WIDGET_GATE_PAIR,
  DASH_WIDGET_MIN_DATA_SCOPE,
  meetsMinDataScope,
  type EnginePair,
} from "./dashboard-widget-catalog.const";

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
 *   2. DASH_WIDGET_GATE_PAIR[widgetCode] — permission MODULE NGUỒN, fail-closed khi thiếu entry; kèm
 *      SÀN scope DASH_WIDGET_MIN_DATA_SCOPE cho widget mà cặp một mình quá rộng (S11-OFFICE-DASH-1).
 * Mọi query đi qua db.withTenant(companyId) (RLS + FORCE, BẤT BIẾN #1); mọi filter deleted_at IS NULL.
 */
@Injectable()
export class DashboardWidgetRegistryService {
  private readonly logger = new Logger(DashboardWidgetRegistryService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    // S11-OFFICE-DASH-1: sàn data-scope cho widget mà cặp gate một mình quá rộng (ASSET_SUMMARY).
    private readonly dataScope: DataScopeService,
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

    // Bước 4: gate tầng-2 permission module nguồn + SÀN scope (fail-closed). can() song song.
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
   * Gate tầng-2, HAI PHA: (1) mỗi widget qua DASH_WIDGET_GATE_PAIR[widgetCode] → can(action,resourceType);
   * (2) widget khai sàn → MỘT lượt resolveManyOrNull(cùng cặp) → meetsMinDataScope.
   *   - thiếu entry map ⇒ LOẠI + log.warn (fail-closed; KHÔNG throw làm sập cả dashboard).
   *   - KHÔNG truyền isSensitive — GIỮ NGUYÊN hành vi cũ. ⚠️ Câu cũ ở đây («engine tự ép
   *     effectivelySensitive ⇒ wildcard KHÔNG lọt») SAI một nửa: `decideStrongestScope` /`decideCan` đọc
   *     `is_sensitive` của HÀNG GRANT KHỚP — tức hàng `*:*` (is_sensitive=false) — chứ không của cặp đích,
   *     nên actor chỉ cầm wildcard VẪN qua. Chưa nổ (mig 0565 §6.7 census: 0 role seed giữ wildcard; tầng-2
   *     service nguồn truyền cờ tường minh). Siết = đổi hành vi quyền thật ⇒ WO riêng
   *     S14-SEC-DASHGATE-WILDCARD-1; xem doc-block `dashboard-widget-gate.ts`.
   */
  private async filterByGatePair(
    companyId: string,
    userId: string,
    rows: ConfigRow[],
  ): Promise<ConfigRow[]> {
    // ── Pha 1: cặp gate + can() (đi qua cache grant, không phải nút thắt) ──────────────────────────
    const gated = await Promise.all(
      rows.map(async (row) => {
        const pair: EnginePair | undefined = DASH_WIDGET_GATE_PAIR[row.widgetCode];
        if (!pair) {
          this.logger.warn(
            `widget '${row.widgetCode}' thiếu DASH_WIDGET_GATE_PAIR — fail-closed loại khỏi registry`,
          );
          return null;
        }
        const decision = await this.permission.can({
          userId,
          companyId,
          action: pair.action,
          resourceType: pair.resourceType,
        });
        return decision.allow ? pair : null;
      }),
    );

    // ── Pha 2: sàn scope — MỘT lượt đọc grant cho MỌI widget khai sàn ──────────────────────────────
    // ⟲ S14-PERF-DASHACTOR-1: trước đây mỗi widget khai sàn tốn MỘT `resolveOrNull` =
    // `getCompanyRoleGrantsWithScope` (KHÔNG cache) ⇒ 3 query cho dashboard admin đủ 3 widget khai sàn.
    // Nay gom thành một `resolveManyOrNull`.
    //
    // Tính chất PHẢI GIỮ (comment gốc S11-OFFICE-DASH-1: «đa số không khai ⇒ không tốn round-trip thứ
    // hai»): danh sách khai-sàn RỖNG ⇒ **0 query**, không phải 1. `resolveStrongestScopes` short-circuit
    // trên `requests.length === 0` TRƯỚC khi chạm repository, nên dashboard của nhân viên thường (0
    // widget khai sàn, hoặc 3 widget khai sàn nhưng `can()` deny hết) vẫn tốn đúng 0 như trước.
    //
    // Chỉ hỏi cho widget ĐÃ QUA `can()` — hỏi cho widget đã bị deny là tính thừa, và mảng theo chỉ số
    // buộc phải khớp đúng tập đó.
    const floorIdx: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (gated[i] && DASH_WIDGET_MIN_DATA_SCOPE[rows[i].widgetCode]) floorIdx.push(i);
    }
    // resolveManyOrNull KHÔNG ném (một widget thiếu scope không được làm sập cả dashboard); `null` ⇒
    // meetsMinDataScope trả false = fail-closed. Đọc THEO CHỈ SỐ, không tra theo cặp: hai widget hoàn
    // toàn có thể dùng CHUNG một cặp gate, tra theo khoá sẽ nhập nhằng.
    const floorScopes = await this.dataScope.resolveManyOrNull(
      userId,
      companyId,
      floorIdx.map((i) => {
        const pair = gated[i] as EnginePair;
        return { action: pair.action, resourceType: pair.resourceType };
      }),
    );

    const keep = rows.map((_, i) => gated[i] != null);
    floorIdx.forEach((rowIndex, k) => {
      // `?? null` là ĐAI fail-closed CÓ CHỦ Ý, không phải phòng hờ thừa: `resolveManyOrNull` cam kết
      // mảng đủ độ dài (kể cả nhánh catch), nhưng nếu cam kết đó vỡ thì `undefined` phải rơi về
      // `meetsMinDataScope(code, null)` = false (LOẠI widget), KHÔNG được lọt thành "không kiểm sàn".
      keep[rowIndex] = meetsMinDataScope(rows[rowIndex].widgetCode, floorScopes[k] ?? null);
    });
    return rows.filter((_, i) => keep[i]);
  }
}
