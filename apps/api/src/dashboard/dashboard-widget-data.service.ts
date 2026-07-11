import { HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import type {
  DashboardTypeValue,
  DashboardWidgetDataDto,
  DashboardWidgetSummaryDto,
  WidgetCatalogItemDto,
  WidgetDataQuery,
} from "@mediaos/contracts";
import { DASH_WIDGET_LIST_LIMIT_MAX } from "@mediaos/contracts";
import { DashboardResolverService } from "./dashboard-resolver.service";
import { DashboardWidgetRegistryService } from "./dashboard-widget-registry.service";
import { DashboardWidgetHandlersService } from "./dashboard-widget-handlers.service";
import { DashboardWidgetCacheService } from "./dashboard-widget-cache.service";
import { gatePairFor, ttlSecondsFor, widgetEntryBySlug } from "./dashboard-widget-data.const";
import { DASH_ERR } from "./dashboard-resolver.errors";
import { DASH_WIDGET_CATALOG, type DashWidgetEntry } from "./dashboard-widget-catalog.const";
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
    const cacheKey = this.cache.buildCacheKey(dashboardType, entry.widgetCode, identity, user.id);

    // 2. Đọc cache tươi (áp min-interval refresh). Hit ⇒ serve (đã re-verify quyền ở bước 1).
    const served = await this.cache.getServable(user.companyId, cacheKey, !!query.refresh);
    if (served) {
      return this.toDto(entry, this.resultFromCache(served.data), {
        hit: true,
        ttlSeconds: ttlSecondsFor(entry),
        expiresAt: served.expiresAt,
        lastUpdatedAt: served.generatedAt,
      });
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
      return this.toDto(entry, result, {
        hit: false,
        ttlSeconds: identity.ttlSeconds,
        expiresAt,
        lastUpdatedAt: generatedAt,
      });
    } catch (err) {
      if (err instanceof HttpException) throw err; // 403/404/400 fail-closed — KHÔNG nuốt thành Degraded.
      return this.degradedDto(entry);
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
    if (!query.include_data) return base;
    return this.attachData(user, dashboardType, widgets, base);
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
    };
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
