/**
 * G11-2 — Pure leave-day counting (no I/O). Counts only the schedule's working days within an
 * inclusive [start, end] date range, so weekends/off-days are not deducted from the quota.
 * ISO date strings compare lexicographically, so the range walk needs no Date math beyond +1 day.
 */

import { addDaysToLocalDate, weekdayOfLocalDate } from "../common/tz.util";

/** Hard cap on the range walk — a leave request never legitimately spans > ~1 year. */
const MAX_SPAN_DAYS = 400;

/**
 * Number of working days in [startDate, endDate] (inclusive), counting only ISO weekdays present in
 * `workingDays` (1=Mon … 7=Sun). Returns 0 when start > end or the range has no working day.
 */
export function countLeaveDays(
  startDate: string,
  endDate: string,
  workingDays: number[],
): number {
  let count = 0;
  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && guard <= MAX_SPAN_DAYS) {
    if (workingDays.includes(weekdayOfLocalDate(cursor))) count += 1;
    cursor = addDaysToLocalDate(cursor, 1);
    guard += 1;
  }
  return count;
}
