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
