import { HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import type {
  DashboardTypeValue,
  DashboardWidgetDataDto,
  DashboardWidgetSummaryDto,
  QuickActionDto,
  WidgetCatalogItemDto,
  WidgetDataQuery,
} from "@mediaos/contracts";
import { DASH_WIDGET_LIST_LIMIT_MAX } from "@mediaos/contracts";
import { PermissionService } from "../permission/permission.service";
import { DashboardResolverService } from "./dashboard-resolver.service";
import { DashboardWidgetRegistryService } from "./dashboard-widget-registry.service";
import { DashboardWidgetHandlersService } from "./dashboard-widget-handlers.service";
import { DashboardWidgetCacheService } from "./dashboard-widget-cache.service";
import { gatePairFor, ttlSecondsFor, widgetEntryBySlug } from "./dashboard-widget-data.const";
import { buildQuickAction, quickActionDefsFor } from "./dashboard-widget-quick-actions.const";
import { DASH_ERR } from "./dashboard-resolver.errors";
import {
  DASH_WIDGET_CATALOG,
  type DashWidgetEntry,
  type EnginePair,
} from "./dashboard-widget-catalog.const";
import type {
  WidgetFetchResult,
  WidgetHandlerContext,
  WidgetRequestUser,
} from "./dashboard-widget-data.types";

const DEFAULT_DASHBOARD_TYPE = "Employee";

/**
 * S4-DASH-BE-2 — DashboardWidgetDataService: orchestrate DATA 1 widget (GET /widgets/:slug) + catalog
 * (GET /widgets). Ghép gate (handlers) + cache (cacheService) + registry (BE-1 omit widget thiếu quyền).
 *
 * FAIL-CLOSED: permission-deny (ForbiddenException) / authorize (NotFound 404) / validation (BadRequest 400)
 * KHÔNG bị nuốt thành Degraded — chúng PROPAGATE. CHỈ lỗi hạ tầng module nguồn (non-HttpException) → Degraded
 * (HTTP 200, BACKEND-10 §17.5). Cache đọc lại re-verify quyền người đọc TRƯỚC serve (gateAndResolve luôn chạy).
 */
@Injectable()
export class DashboardWidgetDataService {
  constructor(
    private readonly resolver: DashboardResolverService,
    private readonly registry: DashboardWidgetRegistryService,
    private readonly handlers: DashboardWidgetHandlersService,
    private readonly cache: DashboardWidgetCacheService,
    // Quick-action `enabled`/`disabled_reason` tính từ permission NGƯỜI XEM (§8.4/§20.1.5) — per-viewer,
    // KHÔNG bao giờ vào cache. PermissionModule đã import ở DashboardModule (không đổi module).
    private readonly permission: PermissionService,
  ) {}

  // ── GET /dashboard/widgets/:slug ────────────────────────────────────────────

  async getWidget(
    user: WidgetRequestUser,
    slug: string,
    query: WidgetDataQuery,
  ): Promise<DashboardWidgetDataDto> {
    const entry = widgetEntryBySlug(slug);
    if (!entry) {
      throw new NotFoundException({
        code: DASH_ERR.WIDGET_NOT_FOUND,
        message: `widget không tồn tại (${slug})`,
      });
    }
    const handler = this.handlers.get(slug);
    if (!handler) {
      throw new NotFoundException({
        code: DASH_ERR.WIDGET_NOT_FOUND,
        message: `widget không tồn tại (${slug})`,
      });
    }
    const dashboardType = query.dashboard_type ?? DEFAULT_DASHBOARD_TYPE;
    const ctx: WidgetHandlerContext = {
      user,
      dashboardType,
      entry,
      query: { refresh: query.refresh, projectId: query.project_id },
    };

    // 1. GATE + resolve cache identity — LUÔN chạy (re-verify quyền người đọc). 403/404/400 propagate.
    const identity = await handler.gateAndResolve(ctx);
    // Quick-action metadata (per-viewer, KHÔNG cache — §8.4/§20). Gate widget đã pass; chỉ còn tính quyền
    // từng action của người xem. Tính SAU gate, đính vào MỌI nhánh trả (hit/regen/degraded).
    const quickActions = await this.resolveQuickActions(user, entry.widgetCode, query.project_id);
    const cacheKey = this.cache.buildCacheKey(dashboardType, entry.widgetCode, identity, user.id);

    // 2. Đọc cache tươi (áp min-interval refresh). Hit ⇒ serve (đã re-verify quyền ở bước 1).
    const served = await this.cache.getServable(user.companyId, cacheKey, !!query.refresh);
    if (served) {
      return this.withQuickActions(
        this.toDto(entry, this.resultFromCache(served.data), {
          hit: true,
          ttlSeconds: ttlSecondsFor(entry),
          expiresAt: served.expiresAt,
          lastUpdatedAt: served.generatedAt,
        }),
        quickActions,
      );
    }

    // 3. Regenerate — CHỈ non-HttpException → Degraded (fail-closed cho auth/validation).
    try {
      const result = await handler.fetch(ctx);
      const generatedAt = new Date();
      const widgetId = await this.cache.resolveWidgetId(user.companyId, entry.widgetCode);
      const { expiresAt } = await this.cache.upsert({
        companyId: user.companyId,
        widgetId,
        dashboardType,
        cacheKey,
        identity,
        userId: identity.shareScope === "user" ? user.id : null,
        data: result.data,
        generatedAt,
      });
      return this.withQuickActions(
        this.toDto(entry, result, {
          hit: false,
          ttlSeconds: identity.ttlSeconds,
          expiresAt,
          lastUpdatedAt: generatedAt,
        }),
        quickActions,
      );
    } catch (err) {
      if (err instanceof HttpException) throw err; // 403/404/400 fail-closed — KHÔNG nuốt thành Degraded.
      return this.withQuickActions(this.degradedDto(entry), quickActions);
    }
  }

  // ── GET /dashboard/widgets ──────────────────────────────────────────────────

  async getCatalog(
    user: WidgetRequestUser,
    query: WidgetDataQuery,
  ): Promise<WidgetCatalogItemDto[]> {
    const dashboardType = await this.resolveCatalogType(user, query);
    // registry.listWidgets ĐÃ omit widget thiếu quyền (per-widget source gate) — nguồn "widget khả dụng".
    const widgets = await this.registry.listWidgets(
      user.companyId,
      user.id,
      dashboardType,
      DASH_WIDGET_LIST_LIMIT_MAX,
    );
    const base = widgets.map((w) => this.toCatalogItem(w));
    // Đính quick-action metadata per-viewer cho từng item (§8.4/§11.3). Chia sẻ memo can() giữa các widget
    // trong CÙNG request (nhiều widget dùng chung cặp, vd read:task) — giảm số lần gọi permission.
    const withActions = await this.attachCatalogQuickActions(user, base);
    if (!query.include_data) return withActions;
    return this.attachData(user, dashboardType, widgets, withActions);
  }

  /** Đính quick_actions cho từng catalog item (memo can() chia sẻ trong 1 request). */
  private async attachCatalogQuickActions(
    user: WidgetRequestUser,
    items: WidgetCatalogItemDto[],
  ): Promise<WidgetCatalogItemDto[]> {
    const memo = new Map<string, boolean>();
    return Promise.all(
      items.map(async (item) => ({
        ...item,
        quick_actions: await this.resolveQuickActions(user, item.widget_code, undefined, memo),
      })),
    );
  }

  /** dashboard_type cho catalog: query chỉ định (phải nằm trong allowed) hoặc default của user. 404 nếu 0 type. */
  private async resolveCatalogType(
    user: WidgetRequestUser,
    query: WidgetDataQuery,
  ): Promise<DashboardTypeValue> {
    const allowed = await this.resolver.listAllowedTypes(user.companyId, user.id);
    if (query.dashboard_type) {
      if (!allowed.some((t) => t.dashboard_type === query.dashboard_type)) {
        throw new ForbiddenException(
          `AUTH-ERR-FORBIDDEN: không được xem dashboard type ${query.dashboard_type}`,
        );
      }
      return query.dashboard_type;
    }
    const def = allowed.find((t) => t.is_default) ?? allowed[0];
    return def.dashboard_type;
  }

  /** include_data=true: fetch data từng widget qua Promise.allSettled (degraded per-widget; KHÔNG nuốt 403). */
  private async attachData(
    user: WidgetRequestUser,
    dashboardType: DashboardTypeValue,
    widgets: DashboardWidgetSummaryDto[],
    base: WidgetCatalogItemDto[],
  ): Promise<WidgetCatalogItemDto[]> {
    const settled = await Promise.allSettled(
      widgets.map((w) => {
        const entry = widgetEntryBySlug(this.slugOf(w.widget_code));
        return entry
          ? this.getWidget(user, entry.dataSourceKey, { dashboard_type: dashboardType })
          : Promise.reject(new Error("unknown widget"));
      }),
    );
    const out: WidgetCatalogItemDto[] = [];
    for (let i = 0; i < base.length; i++) {
      const item = base[i];
      const r = settled[i];
      if (r.status === "fulfilled") {
        out.push({ ...item, ...this.dataFields(r.value) });
      } else if (r.reason instanceof ForbiddenException) {
        // Fail-closed: 403 khi fetch data ⇒ omit (KHÔNG hiện widget người xem không được truy cập).
        continue;
      } else {
        out.push({
          ...item,
          status: "Degraded",
          error_state: this.errorState(item.source_modules),
        });
      }
    }
    return out;
  }

  // ── mappers ─────────────────────────────────────────────────────────────────

  private toCatalogItem(w: DashboardWidgetSummaryDto): WidgetCatalogItemDto {
    const pair = gatePairFor(w.widget_code);
    return {
      widget_code: w.widget_code,
      widget_name: w.widget_name,
      widget_type: w.widget_type,
      permission: pair ? `${pair.action}:${pair.resourceType}` : "",
      source_modules: w.source_modules,
      data_scope: w.data_scope,
      enabled: true, // đã qua registry gate (thiếu quyền đã bị omit).
      layout: { order: w.layout.order },
      quick_actions: [], // default; attachCatalogQuickActions ghi đè bằng metadata per-viewer.
    };
  }

  private dataFields(dto: DashboardWidgetDataDto): Partial<WidgetCatalogItemDto> {
    return {
      status: dto.status,
      data: dto.data,
      empty_state: dto.empty_state,
      error_state: dto.error_state,
      last_updated_at: dto.last_updated_at,
      cache: dto.cache,
    };
  }

  private toDto(
    entry: DashWidgetEntry,
    result: WidgetFetchResult,
    cache: { hit: boolean; ttlSeconds: number; expiresAt: Date; lastUpdatedAt: Date },
  ): DashboardWidgetDataDto {
    return {
      widget_code: entry.widgetCode,
      widget_type: entry.widgetType,
      status: result.status,
      data: result.status === "Empty" ? null : result.data,
      empty_state: result.emptyState ?? null,
      error_state: null,
      last_updated_at: cache.lastUpdatedAt.toISOString(),
      cache: {
        hit: cache.hit,
        ttl_seconds: cache.ttlSeconds,
        expires_at: cache.expiresAt.toISOString(),
      },
      quick_actions: [], // withQuickActions ghi đè bằng metadata per-viewer (KHÔNG cache).
    };
  }

  private degradedDto(entry: DashWidgetEntry): DashboardWidgetDataDto {
    return {
      widget_code: entry.widgetCode,
      widget_type: entry.widgetType,
      status: "Degraded",
      data: null,
      empty_state: null,
      error_state: this.errorState([entry.moduleCode]),
      last_updated_at: null,
      cache: null,
      quick_actions: [], // withQuickActions ghi đè bằng metadata per-viewer (KHÔNG cache).
    };
  }

  // ── quick action metadata (§8.4 + BACKEND-10 §20 — per-viewer, KHÔNG cache) ───────────────────────

  /** Đính quick_actions vào 1 widget DTO (ghi đè default []). */
  private withQuickActions(
    dto: DashboardWidgetDataDto,
    quickActions: QuickActionDto[],
  ): DashboardWidgetDataDto {
    return { ...dto, quick_actions: quickActions };
  }

  /**
   * Resolve quick_actions cho 1 widget: mỗi def → can() cặp gate của NGƯỜI XEM → enabled/disabled_reason
   * (§20.1.5). PROJECT_PROGRESS deep-link theo projectId. memo (nếu có) chia sẻ can() giữa các widget cùng
   * request. KHÔNG hard-code role; KHÔNG cache (per-viewer).
   */
  private async resolveQuickActions(
    user: WidgetRequestUser,
    widgetCode: string,
    projectId?: string,
    memo?: Map<string, boolean>,
  ): Promise<QuickActionDto[]> {
    const defs = quickActionDefsFor(widgetCode);
    if (defs.length === 0) return [];
    const out: QuickActionDto[] = [];
    for (const def of defs) {
      const allowed = await this.canGate(user, def.gate, memo);
      out.push(buildQuickAction(def, allowed, projectId));
    }
    return out;
  }

  /** can() cho 1 cặp gate với memo per-request (dedupe cặp lặp). Fail-closed: lỗi hạ tầng → can() tự deny. */
  private async canGate(
    user: WidgetRequestUser,
    pair: EnginePair,
    memo?: Map<string, boolean>,
  ): Promise<boolean> {
    const key = `${pair.action}:${pair.resourceType}`;
    const cached = memo?.get(key);
    if (cached !== undefined) return cached;
    const decision = await this.permission.can({
      userId: user.id,
      companyId: user.companyId,
      action: pair.action,
      resourceType: pair.resourceType,
    });
    memo?.set(key, decision.allow);
    return decision.allow;
  }

  private errorState(sourceModules: string[]) {
    return {
      code: DASH_ERR.SOURCE_MODULE_UNAVAILABLE,
      message: "Module nguồn tạm thời không phản hồi",
      source_module: sourceModules[0] ?? "UNKNOWN",
      retryable: true,
    };
  }

  private resultFromCache(data: Record<string, unknown>): WidgetFetchResult {
    return { status: "Active", data, emptyState: null };
  }

  /** Tra slug (dataSourceKey) theo widget_code — nghịch của catalog (đọc DASH_WIDGET_CATALOG). */
  private slugOf(widgetCode: string): string {
    return DASH_WIDGET_CATALOG.find((w) => w.widgetCode === widgetCode)?.dataSourceKey ?? "";
  }
}
