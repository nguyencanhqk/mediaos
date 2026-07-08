import {
  dashboardSummarySchema,
  reportResponseSchema,
  mvStatsResponseSchema,
  alertsResponseSchema,
  refreshResponseSchema,
  type DashboardSummaryDto,
  type ReportResponseDto,
  type MvStatsResponseDto,
  type AlertsResponseDto,
  type RefreshResponseDto,
  type ReportQueryDto,
  type MvStatsQueryDto,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * DASH API client — S4-FE-REGISTRY-1 (skeleton typed, page thật = S4-FE-DASH-1).
 *
 * BẤT BIẾN: company_id do SERVER resolve từ AuthContext — client KHÔNG nhận/forward (mirror
 * attendance-api.ts / notification-api.ts). Response validate Zod ở ranh giới (schema @mediaos/contracts
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
};
