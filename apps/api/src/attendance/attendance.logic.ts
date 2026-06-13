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
