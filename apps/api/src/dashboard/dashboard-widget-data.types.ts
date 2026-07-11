/**
 * S4-DASH-BE-2 — kiểu nội bộ chia sẻ giữa handler / cache / runner của lớp widget DATA.
 */
import type { DashDataScope, DashWidgetEntry } from "./dashboard-widget-catalog.const";

/** Người gọi (từ JWT) — company_id + user id. Mọi query đi qua withTenant(companyId). */
export interface WidgetRequestUser {
  id: string;
  companyId: string;
}

/** Ngữ cảnh 1 lần fetch widget. */
export interface WidgetHandlerContext {
  user: WidgetRequestUser;
  dashboardType: string;
  entry: DashWidgetEntry;
  query: {
    refresh?: boolean;
    projectId?: string;
  };
}

/**
 * Định danh cache do handler quyết định SAU khi gate + resolve scope. Quyết định key có kèm userId hay không
 * (per-user vs company-shared) — BẤT BIẾN chống rò chéo người xem: chỉ share company-wide khi
 * shareScope='company' (viewer-independent + resolved scope=Company).
 */
export interface WidgetCacheIdentity {
  /** 'user' ⇒ cache_key kèm userId (per-user). 'company' ⇒ chia sẻ toàn company (viewer-independent). */
  shareScope: "user" | "company";
  /** cache_scope column (Own/Team/Department/Project/Company/System) — phản ánh scope đã resolve. */
  cacheScope: DashDataScope;
  /** Đoạn phân biệt thêm trong key (vd project_id cho PROJECT_PROGRESS). null ⇒ không có. */
  keyDiscriminator: string | null;
  /** scope_reference_id polymorphic (userId cho per-user / projectId / null cho company). */
  scopeReferenceId: string | null;
  /** TTL (giây) của widget này. */
  ttlSeconds: number;
}

/** Kết quả aggregate của 1 handler (đã mask + trong-scope). */
export interface WidgetFetchResult {
  /** 'Active' khi có data; 'Empty' khi rỗng (empty_state). Degraded/Error do runner set khi source lỗi. */
  status: "Active" | "Empty";
  /** Payload widget đã mask + trong-scope — KHÔNG chứa field nhạy cảm ngoài quyền người xem. */
  data: Record<string, unknown>;
  /** Gợi ý empty-state khi status=Empty. */
  emptyState?: Record<string, unknown> | null;
}

/**
 * 1 handler widget: gate (fail-closed 403) + resolve cache identity, rồi fetch data (đã scope). fetch tách khỏi
 * gate để runner đọc cache TRƯỚC khi aggregate (hit ⇒ bỏ qua fetch), nhưng gate LUÔN chạy trước mọi lần serve.
 */
export interface WidgetHandler {
  readonly slug: string;
  readonly widgetCode: string;
  /** Gate quyền (throw ForbiddenException khi thiếu) + validate tham số + resolve cache identity. */
  gateAndResolve(ctx: WidgetHandlerContext): Promise<WidgetCacheIdentity>;
  /** Aggregate data thật (chỉ gọi khi cache miss/refresh). Lỗi hạ tầng ném ra → runner map Degraded. */
  fetch(ctx: WidgetHandlerContext): Promise<WidgetFetchResult>;
}
