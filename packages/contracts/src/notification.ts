import { z } from "zod";

export const notificationTypeSchema = z.enum([
  "task_assigned",
  "task_submitted",
  "approval_requested",
  "approved",
  "revision_requested",
  "mentioned",
  "general",
  // G10-2 — thêm 3 type chat/meeting
  "chat_message",
  "meeting_invited",
  "meeting_action_assigned",
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  type: notificationTypeSchema,
  refId: z.string().uuid().nullable(),
  refType: z.string().nullable(),
  body: z.string(),
  isRead: z.boolean(),
  createdAt: z.string().datetime(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const unreadCountSchema = z.object({
  count: z.number().int().nonnegative(),
});
export type UnreadCount = z.infer<typeof unreadCountSchema>;

// ─── notification_preference (user-level opt-in/out) ─────────────────────────

export const notificationPreferenceSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  notificationType: notificationTypeSchema,
  enabled: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type NotificationPreferenceDto = z.infer<typeof notificationPreferenceSchema>;

export const upsertNotificationPreferenceSchema = z.object({
  notificationType: notificationTypeSchema,
  enabled: z.boolean(),
});
export type UpsertNotificationPreferenceDto = z.infer<typeof upsertNotificationPreferenceSchema>;

// ─── notification_rule (company-level config) ─────────────────────────────────

export const notificationRuleSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  notificationType: notificationTypeSchema,
  enabled: z.boolean(),
  /** true = user không được opt-out loại thông báo này (NOTI-002). */
  mandatory: z.boolean(),
  config: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});
export type NotificationRuleDto = z.infer<typeof notificationRuleSchema>;

// ─── device_tokens (G15-2 push notification registration) ────────────────────

export const devicePlatformSchema = z.enum(["ios", "android", "web"]);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

export const registerDeviceSchema = z.object({
  token: z.string().min(1),
  platform: devicePlatformSchema,
});
export type RegisterDeviceDto = z.infer<typeof registerDeviceSchema>;

// ─── S4-NOTI-BE-2 — enum TitleCase mới (DB-07 §7.3), khớp CHECK 0479 ─────────
// KHÔNG đụng notificationTypeSchema/notificationSchema legacy lowercase ở trên
// (dùng cho cột `type`/`body` cũ). Enum này khớp cột MỚI `notification_type`/
// `priority` trên bảng notifications (migration 0479_s4_notidb1_notification_core.sql
// :257 chk_notifications_notification_type, :260 chk_notifications_priority).

export const notificationTypeEnumSchema = z.enum([
  "System",
  "Account",
  "HR",
  "Attendance",
  "Leave",
  "Task",
  "Project",
  "Approval",
  "Reminder",
  "Warning",
  "Error",
]);
export type NotificationTypeEnum = z.infer<typeof notificationTypeEnumSchema>;

export const notificationPrioritySchema = z.enum(["Low", "Normal", "High", "Urgent", "Critical"]);
export type NotificationPriority = z.infer<typeof notificationPrioritySchema>;

// ─── S4-NOTI-BE-2 — POST /internal/v1/notifications/events (event intake) ───
// Trust-boundary DTO cho engine `NotificationEngineService.intake()` — xem
// docs/plans/S4-NOTI-BE-2.md §3/§6. CỐ Ý KHÔNG có `companyId`: company_id lấy
// từ `req.user.companyId` (token) ở tầng controller, KHÔNG bao giờ từ body —
// tránh cross-tenant spoof. Chỉ 2 recipient mode BE-2 thật sự resolve
// (UserIds/EmployeeIds); các mode khác (RoleCodes/DepartmentIds/…, API-07
// §16.1) để dành cho lane sau — chưa khai ở đây (tránh mã treo không route).
//
// `internalDirectSendSchema` (POST /send, single-shot) KHÔNG thuộc BE-2 —
// đẩy sang S4-NOTI-BE-3 (docs/plans/S4-NOTI-BE-2.md §0 hàng 2).

export const notificationRecipientModeSchema = z.enum(["UserIds", "EmployeeIds"]);
export type NotificationRecipientMode = z.infer<typeof notificationRecipientModeSchema>;

export const internalEventRecipientSchema = z.object({
  mode: notificationRecipientModeSchema,
  userIds: z.array(z.string().uuid()).default([]),
  employeeIds: z.array(z.string().uuid()).default([]),
});
export type InternalEventRecipient = z.infer<typeof internalEventRecipientSchema>;

export const internalEventIntakeSchema = z.object({
  eventCode: z.string().trim().min(1).max(100),
  actorUserId: z.string().uuid().optional(),
  sourceModule: z.string().trim().min(1).max(50),
  sourceEntityType: z.string().trim().min(1).max(100).optional(),
  sourceEntityId: z.string().uuid().optional(),
  dedupeKey: z.string().trim().min(1).max(255).optional(),
  recipient: internalEventRecipientSchema,
  payload: z.record(z.unknown()).default({}),
  priorityOverride: notificationPrioritySchema.optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});
export type InternalEventIntakeDto = z.infer<typeof internalEventIntakeSchema>;

export const intakeSummarySchema = z.object({
  createdCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  dedupedCount: z.number().int().nonnegative(),
});
export type IntakeSummary = z.infer<typeof intakeSummarySchema>;
