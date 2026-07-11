import { z } from "zod";
import { dashboardTypeEnum } from "./dashboard-resolver";

/**
 * S4-DASH-BE-2 — Widget DATA contracts (dữ liệu THẬT của 1 widget: GET /dashboard/widgets ·
 * /dashboard/widgets/:slug). Tách khỏi ./dashboard-resolver (S4-DASH-BE-1 — registry/metadata,
 * `data` luôn null ở đó). API-08 §8.3/§8.4/§8.5, §7.3, §9.1, §11.3.
 *
 * Server mask + áp data-scope TRƯỚC khi trả (BẤT BIẾN #1) — các schema ở đây chỉ validate SHAPE trên
 * biên response/request, KHÔNG tự suy quyền/scope (đó là việc của service — xem BACKEND-10 §9.7).
 *
 * Boolean query-param IDEMPOTENT dưới ZodValidationPipe KÉP (memory zod-query-param-double-pipe-idempotent):
 * nhận CẢ chuỗi "true"/"false" LẪN boolean → boolean|undefined. KHÔNG z.coerce.boolean ("false" → true, sai).
 */
const optionalBooleanParam = () =>
  z.preprocess(
    (v) => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined),
    z.boolean().optional(),
  );

// ─── status / error / cache (API-08 §7.3, §8.3, §8.5) ─────────────────────────

/**
 * 5 status khả dĩ cho response GET /dashboard/widgets/:slug. KHÔNG gồm `Inactive` — đó là trạng thái
 * catalog-level (dashboard_widget_configs bật/tắt), không phải trạng thái của 1 lần fetch data.
 */
export const dashboardWidgetDataStatusEnum = z.enum([
  "Active",
  "Empty",
  "Error",
  "Degraded",
  "Hidden",
]);
export type DashboardWidgetDataStatus = z.infer<typeof dashboardWidgetDataStatusEnum>;

/** API-08 §8.5 — widget error DTO. `source_module` = mã module nguồn bị lỗi (ATT/TASK/LEAVE/...). */
export const dashboardWidgetErrorStateSchema = z.object({
  code: z.string(),
  message: z.string(),
  source_module: z.string(),
  retryable: z.boolean(),
});
export type DashboardWidgetErrorStateDto = z.infer<typeof dashboardWidgetErrorStateSchema>;

/** API-08 §8.3 `cache` block. `hit=false` khi vừa regenerate (miss hoặc ?refresh=true). */
export const dashboardWidgetCacheMetaSchema = z.object({
  hit: z.boolean(),
  ttl_seconds: z.number().int().nonnegative(),
  expires_at: z.string(),
});
export type DashboardWidgetCacheMetaDto = z.infer<typeof dashboardWidgetCacheMetaSchema>;

// ─── quick action (API-08 §8.4 + §5.5, BACKEND-10 §20 — DASH KHÔNG xử lý nghiệp vụ gốc) ────────
//
// DASH CHỈ phát METADATA điều hướng: `enabled`/`disabled_reason` tính từ permission NGƯỜI XEM tại tầng
// service (PermissionService.can — KHÔNG hard-code role), action THẬT do FE gọi module gốc qua `api_endpoint`/
// `target_url`. Đặt TRƯỚC dashboardWidgetDataSchema/widgetCatalogItemSchema vì chúng nhúng mảng này (const
// initializer đọc top-down — tránh temporal-dead-zone khi 2 schema response tham chiếu quickActionSchema).

/** UI-08 §24 QuickActionVM.method — DASH chỉ trả metadata điều hướng, KHÔNG tự thực thi nghiệp vụ gốc. */
export const quickActionMethodEnum = z.enum(["NAVIGATE", "API_CALL", "OPEN_DRAWER", "OPEN_MODAL"]);
export type QuickActionMethod = z.infer<typeof quickActionMethodEnum>;

export const quickActionSchema = z.object({
  action_code: z.string(),
  label: z.string(),
  target_module: z.string(),
  method: quickActionMethodEnum,
  target_url: z.string().nullable(),
  api_endpoint: z.string().nullable(),
  /** enabled/disabled_reason tính từ permission NGƯỜI XEM hiện tại (§8.4) — KHÔNG hard-code role. */
  enabled: z.boolean(),
  disabled_reason: z.string().nullable(),
});
export type QuickActionDto = z.infer<typeof quickActionSchema>;

/**
 * Response 1 widget đã fetch data (GET /dashboard/widgets/:slug, và mỗi phần tử `data` khi
 * GET /dashboard/widgets?include_data=true). `data` là container theo-widget (summary/items — shape khác nhau
 * mỗi widget, xem API-08 §12.x) — KHÔNG ép 1 shape chung ở tầng contract này. `quick_actions` là metadata điều
 * hướng ĐỘC LẬP với `data` (tính per-viewer, KHÔNG cache — xem BACKEND-10 §20 / §8.4).
 */
export const dashboardWidgetDataSchema = z.object({
  widget_code: z.string(),
  /** DB-07 CHECK dashboard_widgets.widget_type: Summary/List/Chart/Calendar/Action/Alert — để string
   * tránh trôi khỏi DB CHECK khi catalog thêm loại mới. */
  widget_type: z.string(),
  status: dashboardWidgetDataStatusEnum,
  data: z.unknown().nullable(),
  empty_state: z.unknown().nullable(),
  error_state: dashboardWidgetErrorStateSchema.nullable(),
  last_updated_at: z.string().nullable(),
  cache: dashboardWidgetCacheMetaSchema.nullable(),
  /** Metadata điều hướng per-viewer (§8.4) — [] khi widget không có quick action. KHÔNG bao giờ vào cache. */
  quick_actions: z.array(quickActionSchema),
});
export type DashboardWidgetDataDto = z.infer<typeof dashboardWidgetDataSchema>;

// ─── query GET /dashboard/widgets · /dashboard/widgets/:slug (API-08 §9.1, §11.3, §12) ────────────

/**
 * Query chung cho catalog (`/dashboard/widgets`) và data 1 widget (`/dashboard/widgets/:slug`).
 * `project_id` CHỈ bắt buộc khi slug=`project-progress` (PROJECT_PROGRESS) — kiểm ở handler/service,
 * KHÔNG ở schema này (schema dùng chung mọi slug); thiếu ⇒ 400 DASH-ERR-VALIDATION.
 */
export const widgetDataQuerySchema = z.object({
  /** true = bỏ qua cache hợp lệ, regenerate (API-08 §9.1/§9.2, tôn trọng min-interval per user+widget). */
  refresh: optionalBooleanParam(),
  dashboard_type: dashboardTypeEnum.optional(),
  /** true = catalog trả kèm `data` từng widget (chỉ áp dụng cho GET /dashboard/widgets). */
  include_data: optionalBooleanParam(),
  project_id: z.string().uuid().optional(),
});
export type WidgetDataQuery = z.infer<typeof widgetDataQuerySchema>;

// ─── GET /dashboard/widgets — 1 phần tử catalog (API-08 §11.3) ────────────────

/**
 * 1 phần tử catalog GET /dashboard/widgets. Widget mà user THIẾU quyền bị OMIT khỏi mảng kết quả
 * (KHÔNG trả kèm status Hidden có data — permission-deny không bị nuốt thành 1 dạng widget "degraded").
 */
export const widgetCatalogItemSchema = z.object({
  widget_code: z.string(),
  widget_name: z.string(),
  widget_type: z.string(),
  /** cặp engine "action:resourceType" gate widget này — FE truy vết, KHÔNG suy quyền. */
  permission: z.string(),
  source_modules: z.array(z.string()),
  data_scope: z.string(),
  enabled: z.boolean(),
  layout: z.object({
    order: z.number().int(),
    size: z.string().optional(),
  }),
  /** Metadata điều hướng per-viewer (§8.4/§11.3) — [] khi widget không có quick action. */
  quick_actions: z.array(quickActionSchema),
  /** Chỉ có khi query include_data=true (§11.3) — cùng shape GET /dashboard/widgets/:slug trừ
   * widget_code/widget_type (đã có ở top-level). */
  status: dashboardWidgetDataStatusEnum.optional(),
  data: z.unknown().nullable().optional(),
  empty_state: z.unknown().nullable().optional(),
  error_state: dashboardWidgetErrorStateSchema.nullable().optional(),
  last_updated_at: z.string().nullable().optional(),
  cache: dashboardWidgetCacheMetaSchema.nullable().optional(),
});
export type WidgetCatalogItemDto = z.infer<typeof widgetCatalogItemSchema>;
