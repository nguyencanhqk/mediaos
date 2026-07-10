import { z } from "zod";

/**
 * S4-NOTI-BE-1 — My-Notification API contracts (SPEC-08 §17.1/17.2, API-07 §11–12). Own-scope TUYỆT ĐỐI:
 * mọi endpoint chỉ trả thông báo của CHÍNH user hiện tại (recipient_user_id = current user).
 *
 * Boolean query-param IDEMPOTENT dưới ZodValidationPipe KÉP (memory zod-query-param-double-pipe-idempotent):
 * nhận CẢ chuỗi "true"/"false" LẪN boolean → boolean|undefined (mirror packages/contracts/src/auth/user-admin.ts
 * optionalBooleanParam). KHÔNG z.coerce.boolean ("false" → true, sai). Thiếu/rác → undefined = coi như false
 * ở tầng dùng (`?? false`).
 */
const optionalBooleanParam = () =>
  z.preprocess(
    (v) => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined),
    z.boolean().optional(),
  );

// ─── enum dùng chung (SPEC-08 §7.5/§7.6) ──────────────────────────────────────

export const myNotificationStatusSchema = z.enum([
  "Unread",
  "Read",
  "Hidden",
  "Archived",
  "Deleted",
  "Failed",
]);
export type MyNotificationStatus = z.infer<typeof myNotificationStatusSchema>;

export const myNotificationPrioritySchema = z.enum(["Low", "Normal", "High", "Urgent", "Critical"]);
export type MyNotificationPriority = z.infer<typeof myNotificationPrioritySchema>;

export const MY_NOTIFICATION_PAGE_SIZE_DEFAULT = 20 as const;
export const MY_NOTIFICATION_PAGE_SIZE_MAX = 100 as const;
export const MY_NOTIFICATION_DROPDOWN_LIMIT_DEFAULT = 10 as const;
export const MY_NOTIFICATION_DROPDOWN_LIMIT_MAX = 20 as const;

// ─── NOTI-API-001: GET /notifications (query) ─────────────────────────────────

export const myNotificationListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    per_page: z.coerce
      .number()
      .int()
      .positive()
      .max(MY_NOTIFICATION_PAGE_SIZE_MAX)
      .default(MY_NOTIFICATION_PAGE_SIZE_DEFAULT),
    status: myNotificationStatusSchema.optional(),
    notification_type: z.string().trim().min(1).max(50).optional(),
    source_module: z.string().trim().min(1).max(50).optional(),
    event_code: z.string().trim().min(1).max(100).optional(),
    priority: myNotificationPrioritySchema.optional(),
    created_from: z.coerce.date().optional(),
    created_to: z.coerce.date().optional(),
    /** Mặc định false (SPEC-08 §17.1 business validation #4). */
    include_archived: optionalBooleanParam(),
    include_hidden: optionalBooleanParam(),
  })
  .refine(
    (q) => !q.created_from || !q.created_to || q.created_from.getTime() <= q.created_to.getTime(),
    {
      message: "created_from phải <= created_to.",
      path: ["created_from"],
    },
  );
export type MyNotificationListQuery = z.infer<typeof myNotificationListQuerySchema>;

/** 1 dòng list (NOTI-API-001) — response snake_case theo API-07 §11.1. */
export const myNotificationListItemSchema = z.object({
  notification_id: z.string().uuid(),
  title: z.string(),
  short_content: z.string(),
  notification_type: z.string().nullable(),
  priority: myNotificationPrioritySchema,
  status: myNotificationStatusSchema,
  is_read: z.boolean(),
  source_module: z.string().nullable(),
  event_code: z.string().nullable(),
  target_module: z.string().nullable(),
  target_type: z.string().nullable(),
  target_id: z.string().uuid().nullable(),
  target_url: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  read_at: z.string().datetime({ offset: true }).nullable(),
});
export type MyNotificationListItem = z.infer<typeof myNotificationListItemSchema>;

// ─── NOTI-API-002: GET /notifications/dropdown ────────────────────────────────

export const myNotificationDropdownQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MY_NOTIFICATION_DROPDOWN_LIMIT_MAX).optional(),
  unread_only: optionalBooleanParam(),
});
export type MyNotificationDropdownQuery = z.infer<typeof myNotificationDropdownQuerySchema>;

export const myNotificationDropdownItemSchema = z.object({
  notification_id: z.string().uuid(),
  title: z.string(),
  short_content: z.string(),
  notification_type: z.string().nullable(),
  priority: myNotificationPrioritySchema,
  status: myNotificationStatusSchema,
  is_read: z.boolean(),
  target_url: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
});
export type MyNotificationDropdownItem = z.infer<typeof myNotificationDropdownItemSchema>;

export const myNotificationDropdownResponseSchema = z.object({
  unread_count: z.number().int().nonnegative(),
  items: z.array(myNotificationDropdownItemSchema),
});
export type MyNotificationDropdownResponse = z.infer<typeof myNotificationDropdownResponseSchema>;

// ─── NOTI-API-003: GET /notifications/unread-count ────────────────────────────

export const myNotificationUnreadCountResponseSchema = z.object({
  unread_count: z.number().int().nonnegative(),
  high_priority_unread_count: z.number().int().nonnegative(),
  urgent_unread_count: z.number().int().nonnegative(),
  last_notification_at: z.string().datetime({ offset: true }).nullable(),
});
export type MyNotificationUnreadCountResponse = z.infer<
  typeof myNotificationUnreadCountResponseSchema
>;

// ─── NOTI-API-004: GET /notifications/:id ─────────────────────────────────────

export const myNotificationDetailQuerySchema = z.object({
  auto_mark_read: optionalBooleanParam(),
});
export type MyNotificationDetailQuery = z.infer<typeof myNotificationDetailQuerySchema>;

export const myNotificationTargetSchema = z.object({
  target_module: z.string().nullable(),
  target_type: z.string().nullable(),
  target_id: z.string().uuid().nullable(),
  target_url: z.string().nullable(),
});
export type MyNotificationTarget = z.infer<typeof myNotificationTargetSchema>;

export const myNotificationDetailSchema = z.object({
  notification_id: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  short_content: z.string(),
  notification_type: z.string().nullable(),
  priority: myNotificationPrioritySchema,
  status: myNotificationStatusSchema,
  is_read: z.boolean(),
  source_module: z.string().nullable(),
  event_code: z.string().nullable(),
  target: myNotificationTargetSchema,
  payload: z.record(z.unknown()).nullable(),
  created_at: z.string().datetime({ offset: true }),
  read_at: z.string().datetime({ offset: true }).nullable(),
});
export type MyNotificationDetail = z.infer<typeof myNotificationDetailSchema>;

// ─── NOTI-API-101: POST /notifications/:id/mark-read ──────────────────────────

export const myNotificationMarkReadResponseSchema = z.object({
  notification_id: z.string().uuid(),
  status: myNotificationStatusSchema,
  read_at: z.string().datetime({ offset: true }).nullable(),
});
export type MyNotificationMarkReadResponse = z.infer<typeof myNotificationMarkReadResponseSchema>;

// ─── NOTI-API-103: POST /notifications/mark-all-read ──────────────────────────

export const markAllNotificationsReadRequestSchema = z.object({
  source_module: z.string().trim().min(1).max(50).nullable().optional(),
  notification_type: z.string().trim().min(1).max(50).nullable().optional(),
  created_before: z.coerce.date().nullable().optional(),
});
export type MarkAllNotificationsReadRequest = z.infer<typeof markAllNotificationsReadRequestSchema>;

export const myNotificationMarkAllReadResponseSchema = z.object({
  updated_count: z.number().int().nonnegative(),
  unread_count: z.number().int().nonnegative(),
  read_at: z.string().datetime({ offset: true }),
});
export type MyNotificationMarkAllReadResponse = z.infer<
  typeof myNotificationMarkAllReadResponseSchema
>;
