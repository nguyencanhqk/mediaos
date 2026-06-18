import { z } from "zod";

/**
 * G14-1: Dashboard aggregate contracts — read-only, server-filtered by company_id + role.
 * FE renders ONLY what the server returns — masking is server-side, client never receives denied data.
 */

// ─── Task aggregate ────────────────────────────────────────────────────────────

export const taskSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  notStarted: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  waitingReview: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  /** Populated for manager/leadership: per-status breakdown by assignee (null = no read:task perm). */
  byStatus: z
    .array(
      z.object({
        status: z.string(),
        count: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});
export type TaskSummaryDto = z.infer<typeof taskSummarySchema>;

// ─── Attendance aggregate ──────────────────────────────────────────────────────

export const attendanceSummarySchema = z.object({
  /** Today's stats (null = caller lacks read:attendance). */
  todayPresent: z.number().int().nonnegative().nullable(),
  todayAbsent: z.number().int().nonnegative().nullable(),
  todayLate: z.number().int().nonnegative().nullable(),
  /** Current month aggregate. */
  monthAttendanceDays: z.number().int().nonnegative().nullable(),
  monthAbsentDays: z.number().int().nonnegative().nullable(),
  monthLateDays: z.number().int().nonnegative().nullable(),
});
export type AttendanceSummaryDto = z.infer<typeof attendanceSummarySchema>;

// ─── Leave aggregate ──────────────────────────────────────────────────────────

export const leaveSummarySchema = z.object({
  /** Pending leave requests this month (null = lacks read:leave). */
  pendingRequests: z.number().int().nonnegative().nullable(),
  approvedThisMonth: z.number().int().nonnegative().nullable(),
  /** Personal leave balance — only populated for own employee or HR with read:leave perm. */
  myAnnualBalanceDays: z.number().nonnegative().nullable(),
});
export type LeaveSummaryDto = z.infer<typeof leaveSummarySchema>;

// ─── Report aggregate (G14-2) ────────────────────────────────────────────────

/**
 * Reporting period for the finance section of the report. The server resolves this to a concrete
 * half-open date range [start, end) server-side — the client only picks the window, never the dates.
 * Default `thisMonth` reproduces the original G14-2 behavior.
 */
export const reportPeriodSchema = z.enum(["thisMonth", "lastMonth", "thisQuarter"]);
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

/** Query params for GET /dashboard/report. `period` scopes the finance aggregates. */
export const reportQuerySchema = z.object({
  period: reportPeriodSchema.default("thisMonth"),
});
export type ReportQueryDto = z.infer<typeof reportQuerySchema>;

/**
 * Role-filtered report summary. null = caller lacks read:finance_report.
 * Masking is server-side — FE renders what it receives.
 *
 * NOTE: the finance fields (revenue/cost/profit/revenueByChannel) reflect the SELECTED `period`
 * (echoed on the response envelope). Field names are retained for backward-compat — `*ThisMonth`
 * is the default-period name, not a literal "this calendar month" guarantee. Headcount and
 * attendance are current-snapshot and are NOT period-scoped.
 */
export const reportSummarySchema = z.object({
  /** Total revenue this month (null = no read:finance_report). */
  revenueThisMonth: z.number().nullable(),
  /** Total cost this month (null = no read:finance_report). */
  costThisMonth: z.number().nullable(),
  /** Net profit this month = revenue - cost (null = no read:finance_report). */
  profitThisMonth: z.number().nullable(),
  /** Total active employees in company (null = no read:employee_report). */
  totalEmployees: z.number().int().nonnegative().nullable(),
  /** Employees present today as % of total (null = no read:attendance_report). */
  todayAttendanceRate: z.number().nonnegative().nullable(),
  /** Revenue breakdown by channel for current month (null = no read:finance_report). */
  revenueByChannel: z
    .array(
      z.object({
        channelId: z.string(),
        channelName: z.string(),
        amount: z.number(),
      }),
    )
    .nullable(),
});
export type ReportSummaryDto = z.infer<typeof reportSummarySchema>;

// ─── Combined dashboard response ──────────────────────────────────────────────

export const dashboardSummarySchema = z.object({
  tasks: taskSummarySchema,
  attendance: attendanceSummarySchema,
  leave: leaveSummarySchema,
  /** ISO date of snapshot (server UTC now). */
  asOf: z.string(),
});
export type DashboardSummaryDto = z.infer<typeof dashboardSummarySchema>;

// ─── Report endpoint response ─────────────────────────────────────────────────

export const reportResponseSchema = z.object({
  report: reportSummarySchema,
  /** The period the finance aggregates were computed for (echo of the resolved query). */
  period: reportPeriodSchema,
  /** ISO date of snapshot (server UTC now). */
  asOf: z.string(),
});
export type ReportResponseDto = z.infer<typeof reportResponseSchema>;

// ─── G14-3: MV stats filter + response ───────────────────────────────────────

export const mvStatsQuerySchema = z.object({
  /** Filter by month, format YYYY-MM. */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  channelId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});
export type MvStatsQueryDto = z.infer<typeof mvStatsQuerySchema>;

export const taskStatusStatSchema = z.object({
  status: z.string(),
  taskCount: z.number().int().nonnegative(),
});

export const outputStatSchema = z.object({
  status: z.string(),
  projectId: z.string().uuid().nullable(),
  departmentId: z.string().uuid().nullable(),
  channelId: z.string().uuid().nullable(),
  /** YYYY-MM-DD date string (first day of month). */
  month: z.string().nullable(),
  taskCount: z.number().int().nonnegative(),
});

export const mvStatsResponseSchema = z.object({
  taskStatus: z.array(taskStatusStatSchema),
  output: z.array(outputStatSchema),
  asOf: z.string(),
});
export type MvStatsResponseDto = z.infer<typeof mvStatsResponseSchema>;

// ─── G14-3: Alerts ───────────────────────────────────────────────────────────

export const overdueAlertSchema = z.object({
  type: z.literal("overdue_task"),
  taskId: z.string().uuid(),
  title: z.string(),
  dueDate: z.string(),
  status: z.string(),
  assigneeUserId: z.string().uuid().nullable(),
});

export const channelRiskAlertSchema = z.object({
  type: z.literal("channel_risk"),
  channelId: z.string().uuid(),
  overdueRate: z.number().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
});

export const alertSchema = z.discriminatedUnion("type", [
  overdueAlertSchema,
  channelRiskAlertSchema,
]);
export type AlertDto = z.infer<typeof alertSchema>;

export const alertsResponseSchema = z.object({
  alerts: z.array(alertSchema),
  asOf: z.string(),
});
export type AlertsResponseDto = z.infer<typeof alertsResponseSchema>;

export const refreshResponseSchema = z.object({
  refreshedAt: z.string(),
});
export type RefreshResponseDto = z.infer<typeof refreshResponseSchema>;
