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

// ─── Combined dashboard response ──────────────────────────────────────────────

export const dashboardSummarySchema = z.object({
  tasks: taskSummarySchema,
  attendance: attendanceSummarySchema,
  leave: leaveSummarySchema,
  /** ISO date of snapshot (server UTC now). */
  asOf: z.string(),
});
export type DashboardSummaryDto = z.infer<typeof dashboardSummarySchema>;
