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

// ── S4-FE-DASH-2 — 4 widget P1 (ATTENDANCE_TODAY/PENDING_LEAVE/PROJECT_PROGRESS/HR_OVERVIEW) ──────

// ATTENDANCE_TODAY — fetchAttendanceToday(): { date, items, summary: { total } }.
export const dashWidgetAttendanceTodayItemSchema = z.object({
  id: z.string(),
  workDate: z.string(),
  attendanceStatus: z.string().nullable(),
  status: z.string().nullable(),
  checkInAt: z.string().nullable(),
  checkOutAt: z.string().nullable(),
});
export type DashWidgetAttendanceTodayItem = z.infer<typeof dashWidgetAttendanceTodayItemSchema>;

export const attendanceTodayWidgetDataSchema = z.object({
  date: z.string(),
  items: z.array(dashWidgetAttendanceTodayItemSchema),
  summary: z.object({ total: z.number().int().nonnegative() }),
});
export type AttendanceTodayWidgetData = z.infer<typeof attendanceTodayWidgetDataSchema>;

// PENDING_LEAVE — fetchPendingLeave(): { items, summary: { total } }.
export const dashWidgetPendingLeaveItemSchema = z.object({
  id: z.string(),
  leaveTypeName: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  totalDays: z.number(),
  status: z.string(),
  submittedAt: z.string().nullable(),
  requester: z.object({
    fullName: z.string().nullable(),
    department: z.string().nullable(),
  }),
});
export type DashWidgetPendingLeaveItem = z.infer<typeof dashWidgetPendingLeaveItemSchema>;

export const pendingLeaveWidgetDataSchema = z.object({
  items: z.array(dashWidgetPendingLeaveItemSchema),
  summary: z.object({ total: z.number().int().nonnegative() }),
});
export type PendingLeaveWidgetData = z.infer<typeof pendingLeaveWidgetDataSchema>;

// PROJECT_PROGRESS — fetchProjectProgress(): { projectId, summary: { total, done, percent }, byStatus }.
export const projectProgressWidgetDataSchema = z.object({
  projectId: z.string(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    percent: z.number().int().min(0).max(100),
  }),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
});
export type ProjectProgressWidgetData = z.infer<typeof projectProgressWidgetDataSchema>;

// HR_OVERVIEW — fetchHrOverview(): { summary: { headcount }, byStatus, byOrgUnit }. KHÔNG salary/PII.
export const hrOverviewWidgetDataSchema = z.object({
  summary: z.object({ headcount: z.number().int().nonnegative() }),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
  byOrgUnit: z.record(z.string(), z.number().int().nonnegative()),
});
export type HrOverviewWidgetData = z.infer<typeof hrOverviewWidgetDataSchema>;

// ── S5-GOAL-DASH-1 — GOAL_PROGRESS (fetchGoalProgress — dashboard-widget-handlers.service.ts) ─────
// `progressPercent` NULL = "chưa đo" (KHÁC 0% — SPEC-10 §13.2), giữ nguyên nullable, KHÔNG `?? 0`.
export const dashWidgetGoalProgressItemSchema = z.object({
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
  goalId: z.string(),
  goalName: z.string(),
  progressPercent: z.number().nullable(),
  status: z.string(),
});
export type DashWidgetGoalProgressItem = z.infer<typeof dashWidgetGoalProgressItemSchema>;

export const goalProgressWidgetDataSchema = z.object({
  items: z.array(dashWidgetGoalProgressItemSchema),
  summary: z.object({
    totalDepartments: z.number().int().nonnegative(),
    avgProgressPercent: z.number().nullable(),
  }),
});
export type GoalProgressWidgetData = z.infer<typeof goalProgressWidgetDataSchema>;
