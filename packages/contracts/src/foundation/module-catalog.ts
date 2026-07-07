import { z } from "zod";

/**
 * S1-FND-WIRE-1 — Foundation my-apps response DTO (nguồn sự thật contracts cho GET
 * /api/v1/foundation/modules/my-apps). Khớp MyAppItem (apps/api foundation/module-catalog). BACKEND-04 §9.3.
 * snake_case theo ví dụ spec. required_permissions = FE display code (KHÔNG phải cặp engine enforcement).
 */
export const myAppItemSchema = z.object({
  module_code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  route: z.string(),
  icon: z.string(),
  group: z.string().nullable(),
  is_active: z.boolean(),
  is_favorite: z.boolean(),
  is_recent: z.boolean(),
  badges: z.array(z.string()),
  required_permissions: z.array(z.string()),
  allowed_actions: z.array(z.string()),
});

export type MyAppItem = z.infer<typeof myAppItemSchema>;

/** Response /modules/my-apps = mảng app (envelope bọc ở interceptor; chuẩn hoá envelope = WIRE-DRIFT-1). */
export const myAppsResponseSchema = z.array(myAppItemSchema);
export type MyAppsResponse = z.infer<typeof myAppsResponseSchema>;

/**
 * S2-FND-BE-1 — Admin module-catalog response DTO (nguồn sự thật contracts cho GET
 * /api/v1/foundation/modules). KHÁC my-apps: admin thấy TẤT CẢ module (active + inactive,
 * deleted_at IS NULL) — KHÔNG lọc theo capability user. `enabled` = cờ resolve theo setting
 * module.<code>.enabled per-tenant (default true). route/icon/required_permissions từ hằng
 * MODULE_APP_METADATA (apps/api foundation/module-catalog). KHÔNG có secret; KHÔNG có field
 * per-user của my-apps (is_favorite/is_recent/badges/allowed_actions).
 */
export const adminModuleItemSchema = z.object({
  module_code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  group: z.string().nullable(),
  is_active: z.boolean(),
  enabled: z.boolean(),
  required_permissions: z.array(z.string()),
  route: z.string(),
  icon: z.string(),
});

export type AdminModuleItem = z.infer<typeof adminModuleItemSchema>;

/**
 * Detail GET /foundation/modules/:code — cùng shape item (metadata/required_permissions/enabled).
 * Tách tên để phân biệt endpoint list vs detail + mở rộng độc lập về sau.
 */
export const adminModuleDetailSchema = adminModuleItemSchema;
export type AdminModuleDetail = z.infer<typeof adminModuleDetailSchema>;

/** Response GET /foundation/modules = mảng (envelope {success,message,data,meta} bọc ở interceptor). */
export const adminModulesResponseSchema = z.array(adminModuleItemSchema);
export type AdminModulesResponse = z.infer<typeof adminModulesResponseSchema>;

/** Response GET /foundation/modules/:code = 1 detail (envelope bọc ở interceptor). */
export const adminModuleDetailResponseSchema = adminModuleDetailSchema;
export type AdminModuleDetailResponse = z.infer<typeof adminModuleDetailResponseSchema>;

/**
 * S2-FND-BE-8 — PATCH /foundation/modules/:code body (bật/tắt module theo tenant). Nguồn sự thật DTO cho
 * ModuleToggleService.toggleModule → ghi company_settings 'module.<code>.enabled' + audit CONFIG_UPDATE
 * (object_type='module') CÙNG tx withTenant. Cổng = update:foundation-module (mig 0435, is_sensitive=TRUE).
 *
 * .strict() chặn field lạ (chống leo thang input — BẤT BIẾN: không trust input). CHỈ `enabled` boolean.
 * 7 module lõi MVP (AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI) KHÓA CỨNG → service từ chối 400 (rule nghiệp vụ, KHÔNG
 * biểu diễn ở Zod). KHÔNG có secret trong DTO. APPEND-only vào file đã-export (barrel index.ts KHÔNG đổi).
 */
export const patchModuleToggleSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export type PatchModuleToggleInput = z.infer<typeof patchModuleToggleSchema>;
