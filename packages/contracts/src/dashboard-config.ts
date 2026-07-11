import { z } from "zod";

/**
 * S4-DASH-BE-3 — Dashboard widget CONFIG contracts (admin CRUD trên `dashboard_widget_configs`,
 * DB-07 §8.2). KHÁC `./dashboard-resolver` (registry đọc + widget nào ĐƯỢC PHÉP thấy — S4-DASH-BE-1):
 * lane này là ranh giới ghi (PATCH) cho is_enabled/sort_order/layout/data_scope_override/
 * refresh_seconds_override/config theo precedence User>Role>Company. PATCH KHÔNG mở quyền xem widget
 * — read-time gating (tier-2 registry gate) vẫn authoritative (permission-matrix-spec §7).
 *
 * Boolean/enum query-param IDEMPOTENT dưới ZodValidationPipe KÉP (memory
 * zod-query-param-double-pipe-idempotent, mirror packages/contracts/src/my-notification.ts
 * optionalBooleanParam / packages/contracts/src/task.ts taskCoreOptionalBooleanParam).
 */

/** 6 dashboard_type hợp lệ ở tầng config (DB CHECK chk_dashboard_widget_configs_dashboard_type) —
 * SIÊU TẬP 4 route type user-facing của ./dashboard-resolver dashboardTypeEnum (+System/Project,
 * config có thể target trước khi route mở). KHÔNG tái dùng enum đó (khác phạm vi giá trị). */
export const dashboardConfigDashboardTypeEnum = z.enum([
  "Employee",
  "Manager",
  "HR",
  "Admin",
  "System",
  "Project",
]);
export type DashboardConfigDashboardType = z.infer<typeof dashboardConfigDashboardTypeEnum>;

/** config_scope (DB CHECK chk_dashboard_widget_configs_scope) — precedence User>Role>Company. */
export const dashboardConfigScopeEnum = z.enum(["Company", "Role", "User"]);
export type DashboardConfigScope = z.infer<typeof dashboardConfigScopeEnum>;

/** data_scope_override (DB CHECK chk_dashboard_widget_configs_data_scope_override) — 6 giá trị,
 * SIÊU TẬP DATA_SCOPES của auth.ts (thiếu "Project") nên định nghĩa riêng, KHÔNG tái dùng. */
export const dashboardConfigDataScopeOverrideEnum = z.enum([
  "Own",
  "Team",
  "Department",
  "Project",
  "Company",
  "System",
]);
export type DashboardConfigDataScopeOverride = z.infer<typeof dashboardConfigDataScopeOverrideEnum>;

/** layout override (px/grid — x/y/width/height cột dashboard_widget_configs.layout_*, đều nullable). */
export const dashboardConfigLayoutSchema = z.object({
  x: z.number().int().nullable().optional(),
  y: z.number().int().nullable().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
});
export type DashboardConfigLayoutDto = z.infer<typeof dashboardConfigLayoutSchema>;

/** 1 phần tử GET /dashboard/configs — 1 row dashboard_widget_configs (đã join widget_code/name). */
export const dashboardConfigItemSchema = z.object({
  id: z.string().uuid(),
  widget_id: z.string().uuid(),
  widget_code: z.string(),
  widget_name: z.string(),
  dashboard_type: dashboardConfigDashboardTypeEnum,
  config_scope: dashboardConfigScopeEnum,
  role_id: z.string().uuid().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  is_enabled: z.boolean(),
  sort_order: z.number().int(),
  layout: dashboardConfigLayoutSchema,
  data_scope_override: dashboardConfigDataScopeOverrideEnum.nullable().optional(),
  refresh_seconds_override: z.number().int().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  updated_at: z.string(),
  updated_by: z.string().uuid().nullable().optional(),
});
export type DashboardConfigItemDto = z.infer<typeof dashboardConfigItemSchema>;

/**
 * IDEMPOTENT preprocess cho query-param enum: chuỗi rỗng/whitespace → undefined (bỏ filter);
 * chuỗi hợp lệ đi thẳng vào z.enum để validate — chạy 2 lần (ZodValidationPipe) vẫn cho cùng kết quả
 * vì lần 2 nhận LẠI giá trị đã pass qua z.enum (không transform giá trị, khác optionalBooleanParam
 * phải coerce true/false).
 */
const optionalEnumParam = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(values).optional(),
  );

/** GET /dashboard/configs query — filter theo dashboard_type/config_scope/role_id/user_id. */
export const dashboardConfigListQuerySchema = z.object({
  dashboard_type: optionalEnumParam(dashboardConfigDashboardTypeEnum.options),
  config_scope: optionalEnumParam(dashboardConfigScopeEnum.options),
  role_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
});
export type DashboardConfigListQueryDto = z.infer<typeof dashboardConfigListQuerySchema>;

/** GET /dashboard/configs response — envelope items[] (KHÔNG pagination, mirror
 * shiftListResponseSchema/attendanceRuleListResponseSchema — danh sách config nhỏ theo company). */
export const dashboardConfigListResponseSchema = z.object({
  items: z.array(dashboardConfigItemSchema),
});
export type DashboardConfigListResponseDto = z.infer<typeof dashboardConfigListResponseSchema>;

/**
 * PATCH /dashboard/configs/:id body — TẤT CẢ optional (partial update). `data_scope_override` CHO
 * PHÉP null tường minh (xoá override, quay lại default_data_scope của widget) — PHẢI phân biệt với
 * "không gửi field" (giữ nguyên giá trị cũ) nên dùng `.nullable().optional()` chứ KHÔNG `.optional()`
 * đơn thuần. `.refine` chặn body rỗng ({}) → 400 (DASH-API-203).
 */
export const dashboardConfigPatchSchema = z
  .object({
    is_enabled: z.boolean().optional(),
    sort_order: z.number().int().optional(),
    layout_x: z.number().int().nullable().optional(),
    layout_y: z.number().int().nullable().optional(),
    layout_width: z.number().int().nullable().optional(),
    layout_height: z.number().int().nullable().optional(),
    data_scope_override: dashboardConfigDataScopeOverrideEnum.nullable().optional(),
    refresh_seconds_override: z.number().int().nullable().optional(),
    config: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "Phải cung cấp ít nhất một trường để cập nhật.",
  });
export type DashboardConfigPatchDto = z.infer<typeof dashboardConfigPatchSchema>;
