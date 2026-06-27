/**
 * G11-1 — Pure attendance-calculation logic (no I/O, fully unit-testable).
 *
 * ADR-0008 (UTC-at-rest): instants are `Date` (UTC); work_date and late/early figures are derived
 * in the schedule's IANA timezone via common/tz.util. The DB-touching AttendanceService composes
 * these helpers; keeping them pure makes the timezone-correctness deny/edge cases easy to pin.
 */

import {
  addDaysToLocalDate,
  localDateOf,
  minutesBetween,
  wallTimeToInstant,
  weekdayOfLocalDate,
} from "../common/tz.util";

/** Just the schedule fields attendance math needs — decoupled from the Drizzle row shape. */
export interface ScheduleCalc {
  /** Wall-clock 'HH:MM' or 'HH:MM:SS' in `timezone`. */
  startTime: string;
  endTime: string;
  graceMinutes: number;
  timezone: string;
  /** ISO weekdays the schedule works (1=Mon … 7=Sun). */
  workingDays: number[];
}

export type DerivedStatus = "present" | "late" | "early_leave";

/** work_date (local 'YYYY-MM-DD') of a check-in instant, in the schedule's timezone. */
export function workDateForCheckIn(checkInAt: Date, schedule: ScheduleCalc): string {
  return localDateOf(checkInAt, schedule.timezone);
}

/**
 * Minutes late = full minutes after the scheduled start, but 0 while within the grace window.
 * Grace forgives entirely (≤ grace ⇒ not late); once over, the count is from the actual start
 * (payroll wants total lateness, not lateness-past-grace).
 */
export function lateMinutesFor(checkInAt: Date, workDate: string, schedule: ScheduleCalc): number {
  const scheduledStart = wallTimeToInstant(workDate, schedule.startTime, schedule.timezone);
  const minsLate = minutesBetween(scheduledStart, checkInAt); // positive when check-in is after start
  if (minsLate <= schedule.graceMinutes) return 0;
  return minsLate;
}

/**
 * Minutes left before the scheduled end (0 if on-time or later). Overnight shifts (end ≤ start in
 * wall-clock) end on the NEXT local day, so the scheduled-end instant rolls forward a day.
 */
export function earlyLeaveMinutesFor(
  checkOutAt: Date,
  workDate: string,
  schedule: ScheduleCalc,
): number {
  const endDate = isOvernight(schedule) ? addDaysToLocalDate(workDate, 1) : workDate;
  const scheduledEnd = wallTimeToInstant(endDate, schedule.endTime, schedule.timezone);
  const minsEarly = minutesBetween(checkOutAt, scheduledEnd); // positive when check-out is before end
  return minsEarly > 0 ? minsEarly : 0;
}

/**
 * Single attendance status from the late/early figures. The status column is single-valued, so when
 * both apply, `late` wins (the lateness is chronologically first and the primary attendance marker);
 * the minute columns still carry the full truth for payroll.
 */
export function deriveAttendanceStatus(
  lateMinutes: number,
  earlyLeaveMinutes: number,
): DerivedStatus {
  if (lateMinutes > 0) return "late";
  if (earlyLeaveMinutes > 0) return "early_leave";
  return "present";
}

/** Does the schedule work on the given local date (by ISO weekday)? */
export function isWorkingDay(workDate: string, schedule: ScheduleCalc): boolean {
  return schedule.workingDays.includes(weekdayOfLocalDate(workDate));
}

function isOvernight(schedule: ScheduleCalc): boolean {
  return toSeconds(schedule.endTime) <= toSeconds(schedule.startTime);
}

function toSeconds(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h * 3600 + m * 60 + (s ?? 0);
}

/**
 * S3-ATT-BE-1 (DB-04 §7) — shift-aware pure helpers for the new Today/check-in/check-out path.
 *
 * Distinct from the legacy ScheduleCalc helpers above (still used by attendance adjustments): the new
 * `shifts` table carries separate late/early grace windows, an explicit break, a required-minutes target
 * and a cross_day flag. start/end may be NULL (no-effective-shift) → contributions degrade to 0 so a
 * missing shift never 500s nor inflates lateness. Server time is authoritative (caller passes new Date()).
 */
export interface ShiftCalc {
  /** Wall-clock 'HH:MM[:SS]' in `timezone`, or null when the shift has no fixed start/end. */
  startTime: string | null;
  endTime: string | null;
  graceLateMinutes: number;
  graceEarlyLeaveMinutes: number;
  breakMinutes: number;
  /** End wall-clock falls on the NEXT local day (overnight shift). */
  crossDay: boolean;
  timezone: string;
}

/** Minutes late vs. the shift start; forgiven entirely within grace (≤ grace ⇒ 0). 0 when no start. */
export function shiftLateMinutes(checkInAt: Date, workDate: string, shift: ShiftCalc): number {
  if (!shift.startTime) return 0;
  const start = wallTimeToInstant(workDate, shift.startTime, shift.timezone);
  const mins = minutesBetween(start, checkInAt); // positive when check-in is after start
  return mins <= shift.graceLateMinutes ? 0 : mins;
}

/** Minutes early vs. the shift end (overnight ⇒ next day); forgiven within grace. 0 when no end. */
export function shiftEarlyLeaveMinutes(
  checkOutAt: Date,
  workDate: string,
  shift: ShiftCalc,
): number {
  if (!shift.endTime) return 0;
  const endDate = shift.crossDay ? addDaysToLocalDate(workDate, 1) : workDate;
  const end = wallTimeToInstant(endDate, shift.endTime, shift.timezone);
  const mins = minutesBetween(checkOutAt, end); // positive when check-out is before end
  return mins <= shift.graceEarlyLeaveMinutes ? 0 : mins;
}

/** Worked minutes = elapsed (check-in→check-out) minus the unpaid break; never negative. */
export function computeWorkingMinutes(
  checkInAt: Date,
  checkOutAt: Date,
  breakMinutes: number,
): number {
  return Math.max(0, minutesBetween(checkInAt, checkOutAt) - breakMinutes);
}

/** Shortfall vs. the required target (0 when no required target or when target is met). */
export function computeMissingMinutes(
  requiredWorkingMinutes: number | null,
  workedMinutes: number,
): number {
  if (requiredWorkingMinutes == null) return 0;
  return Math.max(0, requiredWorkingMinutes - workedMinutes);
}

export type CheckInTitleStatus = "Checked-in" | "Late";
/** attendance_status at check-in (no EOD job): Late if late > 0, else Checked-in. */
export function checkInTitleStatus(isLate: boolean): CheckInTitleStatus {
  return isLate ? "Late" : "Checked-in";
}

export type CheckOutTitleStatus = "Present" | "Late" | "Early Leave" | "Missing Hours";
/** attendance_status at check-out: Late ≻ Early Leave ≻ Missing Hours ≻ Present (single-valued). */
export function checkOutTitleStatus(
  lateMinutes: number,
  earlyLeaveMinutes: number,
  missingMinutes: number,
): CheckOutTitleStatus {
  if (lateMinutes > 0) return "Late";
  if (earlyLeaveMinutes > 0) return "Early Leave";
  if (missingMinutes > 0) return "Missing Hours";
  return "Present";
}
