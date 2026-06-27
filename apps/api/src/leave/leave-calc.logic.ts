/**
 * S3-LEAVE-BE-1 — Pure leave preview math (no I/O, no DI → fast unit tests).
 *
 * Walks the inclusive [startDate, endDate] range counting only WORKING days (ISO weekday in `workingDays`
 * AND not a leave-affecting holiday). FullDay/MultipleDays = 1.0 day / HOURS_PER_DAY each working day;
 * HalfDay = 0.5 day / half-day on the single day (if working); Hourly = (endTime − startTime) hours on the
 * single day, days = hours / HOURS_PER_DAY. Holidays/weekends are excluded from day/half-day counts.
 *
 * HOURS_PER_DAY is a CONSTANT 8 — shift-based per-day hours (work_schedules start/end, attendance rules)
 * are DEFERRED (not in BE-1 scope); when the shift engine lands, replace the constant with a per-day lookup.
 */

import { addDaysToLocalDate, weekdayOfLocalDate } from "../common/tz.util";

/** Standard working hours per full leave day. Shift-based hours DEFERRED (see file header). */
export const HOURS_PER_DAY = 8;

/** Hard cap on the range walk — a single preview never legitimately spans > ~1 year. */
const MAX_SPAN_DAYS = 400;

export type LeaveDurationType = "FullDay" | "HalfDay" | "Hourly" | "MultipleDays";

export interface LeaveCalcInput {
  startDate: string;
  endDate: string;
  durationType: LeaveDurationType;
  halfDaySession?: "Morning" | "Afternoon";
  startTime?: string;
  endTime?: string;
}

export interface LeaveCalcDayRow {
  date: string;
  is_working_day: boolean;
  is_public_holiday: boolean;
  leave_days: number;
  leave_hours: number;
}

export interface LeaveCalcResult {
  calculatedDays: number;
  calculatedHours: number;
  days: LeaveCalcDayRow[];
  warnings: string[];
}

/** Round to 2 decimals — kills float drift from /8 divisions and 0.5 sums. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Minutes since midnight for 'HH:MM' / 'HH:MM:SS'. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

/**
 * Build the per-day preview rows + totals. `holidayDates` = set of 'YYYY-MM-DD' that affect LEAVE
 * (caller built it keying on affectsLeaveCalculation, NOT affectsAttendance). Working day = weekday in
 * `workingDays` AND date not in `holidayDates`.
 */
export function calculateLeave(
  input: LeaveCalcInput,
  workingDays: readonly number[],
  holidayDates: ReadonlySet<string>,
): LeaveCalcResult {
  const days: LeaveCalcDayRow[] = [];
  const warnings: string[] = [];
  let totalDays = 0;
  let totalHours = 0;

  let cursor = input.startDate;
  let guard = 0;
  while (cursor <= input.endDate && guard <= MAX_SPAN_DAYS) {
    const isHoliday = holidayDates.has(cursor);
    const isWeekday = workingDays.includes(weekdayOfLocalDate(cursor));
    const isWorkingDay = isWeekday && !isHoliday;

    const { leaveDays, leaveHours } = perDayValues(input, isWorkingDay);
    totalDays += leaveDays;
    totalHours += leaveHours;
    days.push({
      date: cursor,
      is_working_day: isWorkingDay,
      is_public_holiday: isHoliday,
      leave_days: round2(leaveDays),
      leave_hours: round2(leaveHours),
    });

    cursor = addDaysToLocalDate(cursor, 1);
    guard += 1;
  }

  if (totalDays <= 0 && totalHours <= 0) {
    warnings.push("Khoảng nghỉ không có ngày làm việc nào (toàn cuối tuần/ngày lễ).");
  }

  return {
    calculatedDays: round2(totalDays),
    calculatedHours: round2(totalHours),
    days,
    warnings,
  };
}

/** Day/hour contribution of ONE date by duration type. Non-working day ⇒ 0 (excluded). */
function perDayValues(
  input: LeaveCalcInput,
  isWorkingDay: boolean,
): { leaveDays: number; leaveHours: number } {
  switch (input.durationType) {
    case "HalfDay":
      return isWorkingDay
        ? { leaveDays: 0.5, leaveHours: HOURS_PER_DAY / 2 }
        : { leaveDays: 0, leaveHours: 0 };
    case "Hourly": {
      // Single-day, time-bounded (Zod enforced 1 day + endTime>startTime). Count regardless of weekday/
      // holiday flag (an hourly request is explicit) — but still report the flags for the FE.
      const hours =
        input.startTime != null && input.endTime != null
          ? (timeToMinutes(input.endTime) - timeToMinutes(input.startTime)) / 60
          : 0;
      return { leaveDays: hours / HOURS_PER_DAY, leaveHours: hours };
    }
    case "FullDay":
    case "MultipleDays":
    default:
      return isWorkingDay
        ? { leaveDays: 1, leaveHours: HOURS_PER_DAY }
        : { leaveDays: 0, leaveHours: 0 };
  }
}
