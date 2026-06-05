import { z } from "zod";

export const notificationTypeSchema = z.enum([
  "task_assigned",
  "task_submitted",
  "approval_requested",
  "approved",
  "revision_requested",
  "mentioned",
  "general",
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
