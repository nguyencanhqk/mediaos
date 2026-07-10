import { z } from "zod";

/**
 * S4-DASH-BE-1 — Dashboard resolver contracts (registry: widget nào được PHÉP thấy). KHÔNG chứa widget
 * `data` thật (đó là S4-DASH-BE-2). Server lọc theo permission + dashboard_widget_configs; FE render đúng
 * những gì server trả (masking server-side, BẤT BIẾN #1). Tách khỏi ./dashboard (legacy G14 aggregate).
 */

/** 4 dashboard type user-facing (API-08 §10.1). System/Project KHÔNG mở route ở lane này. */
export const dashboardTypeEnum = z.enum(["Employee", "Manager", "HR", "Admin"]);
export type DashboardTypeValue = z.infer<typeof dashboardTypeEnum>;

/** 1 widget metadata trong registry (KHÔNG data — data=null tới BE-2). */
export const dashboardWidgetSummarySchema = z.object({
  widget_code: z.string(),
  widget_name: z.string(),
  widget_type: z.string(),
  /** module(s) nguồn của widget (hiện 1 phần tử: module_code catalog). */
  source_modules: z.array(z.string()),
  data_scope: z.string(),
  layout: z.object({ order: z.number().int() }),
  /** Data thật lazy-load qua S4-DASH-BE-2 — lane này CHỦ Ý null. */
  data: z.null(),
  last_updated_at: z.null(),
});
export type DashboardWidgetSummaryDto = z.infer<typeof dashboardWidgetSummarySchema>;

/** Response /dashboard/me + 4 route type. */
export const dashboardViewResponseSchema = z.object({
  dashboard_type: dashboardTypeEnum,
  widgets: z.array(dashboardWidgetSummarySchema),
  /** ISO UTC snapshot time (server now). */
  generated_at: z.string(),
});
export type DashboardViewResponseDto = z.infer<typeof dashboardViewResponseSchema>;

/** 1 phần tử /dashboard/types. */
export const dashboardTypeItemSchema = z.object({
  dashboard_type: dashboardTypeEnum,
  label: z.string(),
  is_default: z.boolean(),
  /** cặp engine "action:resourceType" gate route đó — FE truy vết, KHÔNG suy quyền. */
  permission: z.string(),
});
export type DashboardTypeItemDto = z.infer<typeof dashboardTypeItemSchema>;

export const dashboardTypesResponseSchema = z.array(dashboardTypeItemSchema);
export type DashboardTypesResponseDto = z.infer<typeof dashboardTypesResponseSchema>;

/** cap đơn giản (KHÔNG pagination). limit ≥1, ≤MAX; mặc định DEFAULT. z.coerce cho query-string. */
export const DASH_WIDGET_LIST_LIMIT_DEFAULT = 20;
export const DASH_WIDGET_LIST_LIMIT_MAX = 50;

export const dashboardWidgetListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(DASH_WIDGET_LIST_LIMIT_MAX)
    .default(DASH_WIDGET_LIST_LIMIT_DEFAULT),
});
export type DashboardWidgetListQuery = z.infer<typeof dashboardWidgetListQuerySchema>;
