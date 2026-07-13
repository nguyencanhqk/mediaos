import { z } from "zod";

/**
 * S4-NOTI-BE-3/BE-4 — Notification ADMIN config contracts (API-07 §14.1–14.5, SPEC-08).
 *   • READ (BE-3): GET /notifications/events (list) · GET /notifications/templates/{id} (detail) ·
 *     GET /notifications/delivery-logs (list).
 *   • WRITE (BE-4): PATCH /notifications/events/{id} (bật/tắt = company-override) · PATCH
 *     /notifications/templates/{id} (sửa nội dung = company-override). GRANT INSERT,UPDATE mở ở mig 0487;
 *     ghi luôn tạo/hiệu-chỉnh hàng company-override (company_id=GUC) — KHÔNG UPDATE hàng global (0479 WITH
 *     CHECK company_id=GUC chặn cứng). Biến template nhạy cảm (password/token/…) → 422 (API-07 §14.3 #6).
 *
 * Boolean query-param IDEMPOTENT dưới ZodValidationPipe KÉP (memory zod-query-param-double-pipe-idempotent),
 * mirror packages/contracts/src/my-notification.ts optionalBooleanParam.
 */
const optionalBooleanParam = () =>
  z.preprocess(
    (v) => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined),
    z.boolean().optional(),
  );

export const NOTI_ADMIN_PAGE_SIZE_DEFAULT = 20 as const;
export const NOTI_ADMIN_PAGE_SIZE_MAX = 100 as const;

// ─── NOTI-API-301: GET /notifications/events ──────────────────────────────────

export const notificationEventAdminQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce
    .number()
    .int()
    .positive()
    .max(NOTI_ADMIN_PAGE_SIZE_MAX)
    .default(NOTI_ADMIN_PAGE_SIZE_DEFAULT),
  module_code: z.string().trim().min(1).max(50).optional(),
  event_code: z.string().trim().min(1).max(100).optional(),
  enabled: optionalBooleanParam(),
  search: z.string().trim().min(1).max(200).optional(),
});
export type NotificationEventAdminQuery = z.infer<typeof notificationEventAdminQuerySchema>;

export const notificationEventAdminItemSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid().nullable(),
  is_company_override: z.boolean(),
  module_code: z.string(),
  event_code: z.string(),
  event_name: z.string(),
  description: z.string().nullable(),
  notification_type: z.string(),
  default_priority: z.string(),
  default_channels: z.array(z.string()),
  dedupe_strategy: z.string(),
  dedupe_window_seconds: z.number().int().nullable(),
  is_enabled: z.boolean(),
  is_system_event: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type NotificationEventAdminItem = z.infer<typeof notificationEventAdminItemSchema>;

// ─── NOTI-API-303 (LIST — mở lại scope gốc): GET /notifications/templates ─────────────────────────
// Danh mục template company override ∪ global (merge "override thắng global" theo event/template_code/
// channel/locale ở repo). Filter theo event_id/event_code/channel/locale + phân trang in-memory (catalog
// nhỏ, mirror notificationEventAdminQuerySchema). `channel` = z.enum (idempotent dưới ZodValidationPipe KÉP;
// string hợp lệ đi qua nguyên trạng — mirror optionalBooleanParam, memory zod-query-param-double-pipe).
export const notificationTemplateAdminQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce
    .number()
    .int()
    .positive()
    .max(NOTI_ADMIN_PAGE_SIZE_MAX)
    .default(NOTI_ADMIN_PAGE_SIZE_DEFAULT),
  event_id: z.string().uuid().optional(),
  event_code: z.string().trim().min(1).max(100).optional(),
  channel: z.enum(["IN_APP", "EMAIL", "PUSH", "REALTIME", "INTEGRATION"]).optional(),
  locale: z.string().trim().min(1).max(20).optional(),
});
export type NotificationTemplateAdminQuery = z.infer<typeof notificationTemplateAdminQuerySchema>;

// ─── NOTI-API-303 (thu hẹp): GET /notifications/templates/{id} (detail) — tái dùng item cho LIST ────

export const notificationTemplateAdminItemSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid().nullable(),
  is_company_override: z.boolean(),
  event_id: z.string().uuid(),
  template_code: z.string(),
  channel: z.string(),
  locale: z.string(),
  title_template: z.string(),
  body_template: z.string(),
  short_body_template: z.string().nullable(),
  action_label_template: z.string().nullable(),
  target_url_template: z.string().nullable(),
  variables_schema: z.record(z.unknown()).nullable(),
  status: z.string(),
  is_default: z.boolean(),
  version: z.number().int(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type NotificationTemplateAdminItem = z.infer<typeof notificationTemplateAdminItemSchema>;

// ─── NOTI-API-302 (BE-4): PATCH /notifications/events/{id} — bật/tắt event (company-override) ──────
// CHỈ is_enabled (bật/tắt). Body ghi vào hàng company-override; hàng global KHÔNG bao giờ bị sửa.
export const notificationEventAdminPatchSchema = z.object({
  is_enabled: z.boolean(),
});
export type NotificationEventAdminPatch = z.infer<typeof notificationEventAdminPatchSchema>;

// ─── NOTI-API-304 (BE-4): PATCH /notifications/templates/{id} — sửa nội dung (company-override) ────
// MỌI field optional; .refine ≥1 field present (KHÔNG cho body rỗng). Biến template nhạy cảm chặn ở
// tầng service (assertTemplateVariablesSafe → 422), KHÔNG ở schema (schema chỉ validate hình dạng).
export const notificationTemplateAdminPatchSchema = z
  .object({
    title_template: z.string().trim().min(1).max(255).optional(),
    body_template: z.string().trim().min(1).optional(),
    short_body_template: z.string().max(500).nullable().optional(),
    action_label_template: z.string().max(100).nullable().optional(),
    target_url_template: z.string().max(500).nullable().optional(),
    status: z.enum(["Draft", "Active", "Inactive", "Archived"]).optional(),
  })
  .refine((obj) => Object.keys(obj).length >= 1, {
    message: "Phải cung cấp ít nhất một trường để cập nhật.",
  });
export type NotificationTemplateAdminPatch = z.infer<typeof notificationTemplateAdminPatchSchema>;

// ─── NOTI-API-401: GET /notifications/delivery-logs ───────────────────────────

export const notificationDeliveryLogAdminQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    per_page: z.coerce
      .number()
      .int()
      .positive()
      .max(NOTI_ADMIN_PAGE_SIZE_MAX)
      .default(NOTI_ADMIN_PAGE_SIZE_DEFAULT),
    notification_id: z.string().uuid().optional(),
    recipient_user_id: z.string().uuid().optional(),
    channel: z.string().trim().min(1).max(50).optional(),
    delivery_status: z.string().trim().min(1).max(50).optional(),
    created_from: z.coerce.date().optional(),
    created_to: z.coerce.date().optional(),
  })
  .refine(
    (q) => !q.created_from || !q.created_to || q.created_from.getTime() <= q.created_to.getTime(),
    { message: "created_from phải <= created_to.", path: ["created_from"] },
  );
export type NotificationDeliveryLogAdminQuery = z.infer<
  typeof notificationDeliveryLogAdminQuerySchema
>;

export const notificationDeliveryLogAdminItemSchema = z.object({
  id: z.string().uuid(),
  notification_id: z.string().uuid(),
  recipient_user_id: z.string().uuid(),
  channel: z.string(),
  provider: z.string().nullable(),
  delivery_status: z.string(),
  attempt_no: z.number().int(),
  max_attempts: z.number().int(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  sent_at: z.string().datetime({ offset: true }).nullable(),
  failed_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type NotificationDeliveryLogAdminItem = z.infer<
  typeof notificationDeliveryLogAdminItemSchema
>;
