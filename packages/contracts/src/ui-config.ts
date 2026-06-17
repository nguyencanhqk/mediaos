import { z } from "zod";

/**
 * AC-4 UI config (Admin Control Plane N3) — branding / navigation / i18n overrides DTOs.
 * Nguồn sự thật cho contract api ↔ admin. TENANT self-service: company-admin thao tác CÔNG TY MÌNH
 * (companyId từ JWT — KHÔNG cross-tenant operator).
 *
 * BẤT BIẾN #3 (không secret): branding/menu/i18n CHỈ metadata công khai (logo_url, màu, label, route,
 *   key/value i18n) — KHÔNG plaintext secret nào. Các permission is_sensitive=FALSE.
 */

/** Mã màu hex (#RGB | #RRGGBB). Reject chuỗi không phải hex tại boundary (fail-fast). */
const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Màu phải là mã hex hợp lệ (#RGB hoặc #RRGGBB)");

// ── Branding (1 row / tenant) ──────────────────────────────────────────────────

/** DTO branding hiệu lực cho 1 tenant. Mọi field nullable (chưa cấu hình ⇒ FE dùng mặc định hệ thống). */
export const brandingSchema = z.object({
  logoUrl: z.string().url().nullable(),
  faviconUrl: z.string().url().nullable(),
  primaryColor: hexColorSchema.nullable(),
  secondaryColor: hexColorSchema.nullable(),
  companyName: z.string().max(200).nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type BrandingDto = z.infer<typeof brandingSchema>;

/**
 * PUT /settings/branding — body cập nhật branding (upsert idempotent 1-row/tenant). Field absent =
 * KHÔNG đổi; field null tường minh = xoá giá trị (về mặc định). url/màu validate tại boundary.
 */
export const updateBrandingRequestSchema = z
  .object({
    logoUrl: z.string().url().nullable().optional(),
    faviconUrl: z.string().url().nullable().optional(),
    primaryColor: hexColorSchema.nullable().optional(),
    secondaryColor: hexColorSchema.nullable().optional(),
    companyName: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();
export type UpdateBrandingRequest = z.infer<typeof updateBrandingRequestSchema>;

// ── Navigation (menu động) ──────────────────────────────────────────────────────

/**
 * 1 item menu điều hướng. `moduleKey` (nullable) trỏ feature/module — item ẩn khỏi effective menu nếu
 * module TẮT (FeatureFlagService). `parentKey` null = item gốc. `isVisible` false = ẩn cứng (admin tắt).
 */
export const uiNavigationItemSchema = z.object({
  key: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
  route: z.string().min(1).max(300),
  icon: z.string().max(120).nullable(),
  parentKey: z.string().max(120).nullable(),
  displayOrder: z.number().int(),
  moduleKey: z.string().max(120).nullable(),
  isVisible: z.boolean(),
});
export type UiNavigationItemDto = z.infer<typeof uiNavigationItemSchema>;

/**
 * PUT /settings/ui-navigation — thay TOÀN BỘ danh sách item menu của tenant (replace-set idempotent).
 * Server xoá-mềm/upsert theo (company_id, key). `key` UNIQUE per-tenant (reject trùng tại boundary).
 */
export const putUiNavigationRequestSchema = z
  .object({
    items: z.array(uiNavigationItemSchema).max(500),
  })
  .strict()
  .superRefine((val, ctx) => {
    const seen = new Set<string>();
    for (const item of val.items) {
      if (seen.has(item.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `key trùng trong danh sách menu: ${item.key}`,
          path: ["items"],
        });
      }
      seen.add(item.key);
    }
  });
export type PutUiNavigationRequest = z.infer<typeof putUiNavigationRequestSchema>;

// ── i18n overrides ────────────────────────────────────────────────────────────

/** 1 override i18n: (locale, namespace, key) → value. locale/namespace/key KHÔNG rỗng. */
export const i18nOverrideSchema = z.object({
  locale: z.string().min(1).max(20),
  namespace: z.string().min(1).max(120),
  key: z.string().min(1).max(300),
  value: z.string().max(4000),
});
export type I18nOverrideDto = z.infer<typeof i18nOverrideSchema>;

/**
 * PUT /settings/i18n-overrides — thay TOÀN BỘ tập override của tenant (replace-set idempotent). Server
 * upsert theo (company_id, locale, namespace, key). Reject bộ khoá trùng tại boundary.
 */
export const putI18nOverridesRequestSchema = z
  .object({
    overrides: z.array(i18nOverrideSchema).max(2000),
  })
  .strict()
  .superRefine((val, ctx) => {
    const seen = new Set<string>();
    for (const o of val.overrides) {
      const k = [o.locale, o.namespace, o.key].join("|");
      if (seen.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `bộ khoá (locale, namespace, key) trùng: ${o.locale}/${o.namespace}/${o.key}`,
          path: ["overrides"],
        });
      }
      seen.add(k);
    }
  });
export type PutI18nOverridesRequest = z.infer<typeof putI18nOverridesRequestSchema>;
