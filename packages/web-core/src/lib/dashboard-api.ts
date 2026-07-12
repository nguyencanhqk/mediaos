import { z } from "zod";
import {
  dashboardSummarySchema,
  reportResponseSchema,
  mvStatsResponseSchema,
  alertsResponseSchema,
  refreshResponseSchema,
  dashboardViewResponseSchema,
  dashboardTypesResponseSchema,
  widgetCatalogItemSchema,
  dashboardWidgetDataSchema,
  type DashboardSummaryDto,
  type ReportResponseDto,
  type MvStatsResponseDto,
  type AlertsResponseDto,
  type RefreshResponseDto,
  type ReportQueryDto,
  type MvStatsQueryDto,
  type DashboardViewResponseDto,
  type DashboardTypesResponseDto,
  type DashboardTypeValue,
  type WidgetCatalogItemDto,
  type DashboardWidgetDataDto,
  type WidgetDataQuery,
  type DashboardWidgetListQuery,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * S4-FE-DASH-1 — widget_code (S4-DASH-SEED-1 catalog) → dataSourceKey (slug GET /dashboard/widgets/:slug).
 * Mirror TẠI ĐÂY apps/api/src/dashboard/dashboard-widget-catalog.const.ts (DASH_WIDGET_CATALOG[].dataSourceKey)
 * — web-core KHÔNG import ngược từ apps/api. Chỉ liệt kê widget ĐÃ có FE component (P0: MY_TASKS/TASK_ALERTS/
 * NOTIFICATIONS · S4-FE-DASH-2 P1: ATTENDANCE_TODAY/PENDING_LEAVE/PROJECT_PROGRESS/HR_OVERVIEW). Thêm widget
 * mới → thêm dòng khi component tương ứng được build.
 */
export const DASH_WIDGET_SLUG: Readonly<Record<string, string>> = {
  MY_TASKS: "my-tasks",
  TASK_ALERTS: "task-alerts",
  NOTIFICATIONS: "notifications",
  // S4-FE-DASH-2 (APPEND) — slug khớp DASH_WIDGET_CATALOG[].dataSourceKey của 4 widget P1.
  ATTENDANCE_TODAY: "attendance-today",
  PENDING_LEAVE: "pending-leave",
  PROJECT_PROGRESS: "project-progress",
  HR_OVERVIEW: "hr-overview",
};

/** 4 dashboard type user-facing → path GET /dashboard/{type} (API-08 §10.1, DashboardResolverController). */
const DASHBOARD_TYPE_PATH: Readonly<Record<DashboardTypeValue, string>> = {
  Employee: "employee",
  Manager: "manager",
  HR: "hr",
  Admin: "admin",
};

/**
 * DASH API client — S4-FE-REGISTRY-1 (skeleton typed, page thật = S4-FE-DASH-1).
 *
 * BẤT BIẾN: company_id do SERVER resolve từ AuthContext — client KHÔNG nhận/forward (mirror
 * attendance-api.ts / my-notification-api.ts). Response validate Zod ở ranh giới (schema @mediaos/contracts
 * dashboard.ts). KHÔNG import token-storage (apiFetch tự gắn Bearer + refresh-on-401 + envelope unwrap).
 *
 * MASKING là việc của SERVER: read-only aggregate, gated read:dashboard; các mảng nhạy cảm (finance/
 * employee/attendance report · task byStatus) server trả `null` khi caller thiếu grant chi tiết — client
 * chỉ render field nhận được, KHÔNG tự suy field server đã ẩn.
 */
export const dashboardApi = {
  /** GET /dashboard/summary — tổng hợp task/chấm công/nghỉ (role-filtered). Permission: read:dashboard. */
  getSummary: (): Promise<DashboardSummaryDto> =>
    apiFetch("/dashboard/summary", dashboardSummarySchema),

  /**
   * GET /dashboard/report — báo cáo tổng hợp (finance/headcount/attendance, mask per-permission server-side).
   * Permission: read:dashboard (masking chi tiết theo read:finance_report/employee_report/attendance_report).
   */
  getReport: (query?: Partial<ReportQueryDto>): Promise<ReportResponseDto> =>
    apiFetch(`/dashboard/report${buildQueryString(query ?? {})}`, reportResponseSchema),

  /** GET /dashboard/mv-stats — thống kê MV (task-status + output breakdown). Permission: read:dashboard. */
  getMvStats: (query?: Partial<MvStatsQueryDto>): Promise<MvStatsResponseDto> =>
    apiFetch(`/dashboard/mv-stats${buildQueryString(query ?? {})}`, mvStatsResponseSchema),

  /** GET /dashboard/alerts — cảnh báo trực tiếp (quá hạn + rủi ro kênh). Permission: read:dashboard. */
  getAlerts: (): Promise<AlertsResponseDto> => apiFetch("/dashboard/alerts", alertsResponseSchema),

  /** POST /dashboard/refresh — làm mới MV (concurrently). Permission: manage:dashboard. */
  refresh: (): Promise<RefreshResponseDto> =>
    apiFetch("/dashboard/refresh", refreshResponseSchema, { method: "POST" }),

  // ── S4-FE-DASH-1 — resolver (S4-DASH-BE-1) + widget DATA (S4-DASH-BE-2) ─────────────────────────
  //
  // Tách khỏi 5 method G14 phía trên (report/mv-stats/alerts/refresh/summary — aggregate cũ). Đây là API
  // THẬT cho DashboardMePage: /dashboard/me trả SHELL nhẹ (widget metadata, data=null — "load shell trước");
  // mỗi WidgetCard sau đó tự lazy-load data qua getWidgetData("widget lazy"). Server OMIT hẳn widget mà
  // caller thiếu quyền khỏi mảng — client KHÔNG tự suy/hiện field bị ẩn (BẤT BIẾN #1, masking ở server).

  /** GET /dashboard/me — dashboard mặc định (widget list, data=null). Permission: read:dashboard. */
  getMyDashboard: (query?: Partial<DashboardWidgetListQuery>): Promise<DashboardViewResponseDto> =>
    apiFetch(`/dashboard/me${buildQueryString(query ?? {})}`, dashboardViewResponseSchema),

  /** GET /dashboard/types — dashboard type user được phép xem (+ is_default). Permission: read:dashboard. */
  getDashboardTypes: (): Promise<DashboardTypesResponseDto> =>
    apiFetch("/dashboard/types", dashboardTypesResponseSchema),

  /**
   * GET /dashboard/{type} — widget của MỘT dashboard type cụ thể (DashboardTypeSwitcher, S4-FE-DASH-2).
   * Permission: view-{type}:dashboard (gate ở BE — 403 nếu user không có type đó, mirror /dashboard/types).
   */
  getDashboardByType: (
    type: DashboardTypeValue,
    query?: Partial<DashboardWidgetListQuery>,
  ): Promise<DashboardViewResponseDto> =>
    apiFetch(
      `/dashboard/${DASHBOARD_TYPE_PATH[type]}${buildQueryString(query ?? {})}`,
      dashboardViewResponseSchema,
    ),

  /**
   * GET /dashboard/widgets — catalog widget khả dụng (server đã omit widget thiếu quyền). `include_data:true`
   * kèm data từng widget trong 1 round-trip. Permission: read:dashboard (+ per-widget gate ở service).
   */
  getWidgetCatalog: (query?: Partial<WidgetDataQuery>): Promise<WidgetCatalogItemDto[]> =>
    apiFetch(
      `/dashboard/widgets${buildQueryString(query ?? {})}`,
      z.array(widgetCatalogItemSchema),
    ),

  /**
   * GET /dashboard/widgets/:slug — data 1 widget (lazy-load, dùng trong từng WidgetCard). `widgetCode` = mã
   * catalog (vd "MY_TASKS") — slug resolve qua DASH_WIDGET_SLUG (fail-fast nếu widget chưa có FE mapping,
   * tránh gọi nhầm endpoint). `query.refresh:true` bỏ qua cache hợp lệ (nút "Làm mới" từng widget).
   */
  getWidgetData: (
    widgetCode: string,
    query?: Partial<WidgetDataQuery>,
  ): Promise<DashboardWidgetDataDto> => {
    const slug = DASH_WIDGET_SLUG[widgetCode];
    if (!slug) {
      throw new Error(`[dashboardApi] widget chưa có FE slug mapping: ${widgetCode}`);
    }
    return apiFetch(
      `/dashboard/widgets/${slug}${buildQueryString(query ?? {})}`,
      dashboardWidgetDataSchema,
    );
  },
};
