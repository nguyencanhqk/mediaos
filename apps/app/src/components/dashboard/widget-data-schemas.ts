/**
 * Zod schema LOCAL cho phần `data`/`empty_state`/`error_state` (unknown ở ranh giới packages/contracts —
 * dashboardWidgetDataSchema §API-08 CỐ Ý để `data: z.unknown()` vì shape khác nhau mỗi widget, xem
 * dashboard-widget-data.ts). S4-FE-DASH-1 chỉ định hình 3 widget P0: MY_TASKS/TASK_ALERTS/NOTIFICATIONS —
 * khớp apps/api/src/dashboard/dashboard-widget-handlers.service.ts (fetchMyTasks/fetchTaskAlerts/
 * fetchNotifications + `listResult`).
 *
 * Reuse `taskCoreStatusSchema`/`taskCorePrioritySchema` từ @mediaos/contracts (nguồn sự thật enum TASK) —
 * cho phép TaskStatusBadge/TaskPriorityBadge/TaskOverdueBadge (đã build ở S4-FE-TASK-2) tái dùng thẳng,
 * KHÔNG cast tay.
 */
import { z } from "zod";
import { taskCoreStatusSchema, taskCorePrioritySchema } from "@mediaos/contracts";

/** message localized do SERVER trả (§16.6/§16.7) — component ưu tiên message này hơn copy i18n tĩnh. */
export const widgetMessageSchema = z.object({ message: z.string() });

// ── MY_TASKS / TASK_ALERTS (toTaskItem — dashboard-widget-handlers.service.ts) ────────────────────

export const dashWidgetTaskItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: taskCoreStatusSchema.nullable(),
  priority: taskCorePrioritySchema.nullable(),
  dueAt: z.string().nullable(),
  isOverdue: z.boolean(),
  projectName: z.string().nullable(),
});
export type DashWidgetTaskItem = z.infer<typeof dashWidgetTaskItemSchema>;

/** MY_TASKS — `listResult()`: { items, summary: { total } }. */
export const myTasksWidgetDataSchema = z.object({
  items: z.array(dashWidgetTaskItemSchema),
  summary: z.object({ total: z.number().int().nonnegative() }),
});
export type MyTasksWidgetData = z.infer<typeof myTasksWidgetDataSchema>;

/** TASK_ALERTS — `fetchTaskAlerts()`: { items, summary: { total, overdue, dueSoon } }. */
export const taskAlertsWidgetDataSchema = z.object({
  items: z.array(dashWidgetTaskItemSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    dueSoon: z.number().int().nonnegative(),
  }),
});
export type TaskAlertsWidgetData = z.infer<typeof taskAlertsWidgetDataSchema>;

// ── NOTIFICATIONS (fetchNotifications — dashboard-widget-handlers.service.ts) ─────────────────────

export const dashWidgetNotificationItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  shortContent: z.string().nullable(),
  priority: z.string().nullable(),
  status: z.string().nullable(),
  isRead: z.boolean(),
  targetUrl: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type DashWidgetNotificationItem = z.infer<typeof dashWidgetNotificationItemSchema>;

export const notificationsWidgetDataSchema = z.object({
  items: z.array(dashWidgetNotificationItemSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    unread: z.number().int().nonnegative(),
  }),
});
export type NotificationsWidgetData = z.infer<typeof notificationsWidgetDataSchema>;
