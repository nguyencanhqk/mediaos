import { z } from "zod";

/**
 * AC-7 module-registry — DTO cho lớp "module" TRÊN feature-flag (G16-3).
 *
 * Module = bundle các feature-key + metadata hiển thị (tên/icon/route/DAG phụ thuộc) trong CATALOG
 * GLOBAL `system_modules` (no-RLS, mirror permissions/subscription_plans). KHÔNG store on/off thứ 3:
 * trạng thái bật/tắt per-tenant = `company_feature_flags` (set tất cả feature_keys của module qua
 * FeatureFlagService). Effective-state đọc từ FeatureFlagService.isEnabled (AND mọi feature_key).
 *
 * Operator (platform-admin) bật/tắt CHÉO tenant qua `withTenant(targetCompanyId)` + recordOperatorAction
 * cùng tx (atomic, rollback-safe). Mọi route gated @OperatorOnly + manage:module-toggle (is_sensitive).
 */

/** Metadata catalog 1 module (no secret — chỉ field hiển thị + bundle feature-key + DAG). */
export const systemModuleSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  route: z.string().nullable(),
  /** Bundle feature-key (trỏ plan_entitlements kind=feature). Bật module = bật mọi key này. */
  featureKeys: z.array(z.string()),
  /** Module-key phụ thuộc (DAG): bật module này yêu cầu các depends_on đã bật. */
  dependsOn: z.array(z.string()),
  displayOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SystemModuleDto = z.infer<typeof systemModuleSchema>;

/** Trạng thái HIỆU LỰC của 1 module cho 1 tenant (đọc từ FeatureFlagService — KHÔNG bảng song song). */
export const moduleEffectiveStateSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
});
export type ModuleEffectiveStateDto = z.infer<typeof moduleEffectiveStateSchema>;

/** 1 module catalog kèm trạng thái hiệu lực cho 1 tenant (GET companies/:id/modules). */
export const tenantModuleStateSchema = systemModuleSchema.extend({
  enabled: z.boolean(),
});
export type TenantModuleStateDto = z.infer<typeof tenantModuleStateSchema>;

/** PUT companies/:id/modules/:moduleKey — bật/tắt module cho tenant. */
export const toggleModuleRequestSchema = z.object({
  enabled: z.boolean(),
});
export type ToggleModuleRequest = z.infer<typeof toggleModuleRequestSchema>;

/** GET admin/platform/modules — catalog list (pagination). */
export const listModulesQuerySchema = z.object({
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListModulesQuery = z.infer<typeof listModulesQuerySchema>;
