/** S16-SOCIAL-FE-3B (L5a) — KHUNG cho lượt RED: mọi hàm trả giá trị rỗng đúng kiểu, chưa có luật nào. */
import type { StatsDateRange } from "./stats-route-search";

export const STATS_WEEK_OPTIONS: readonly number[] = [];

export interface StatsRange extends StatsDateRange {
  weeks: number;
}

export type StatsShiftDirection = "back" | "forward";

export function shiftIsoDate(_date: string, _days: number): string | null {
  return null;
}

export function currentWeekEnd(_now: Date = new Date()): string {
  return "";
}

export function canShiftForward(_range: StatsRange, _now: Date = new Date()): boolean {
  return false;
}

export function shiftRange(
  _range: StatsRange,
  _direction: StatsShiftDirection,
  _now: Date = new Date(),
): StatsDateRange | null {
  return null;
}

export function rangeForWeeks(_range: StatsRange, _weeks: number): StatsDateRange | null {
  return null;
}

export function asUrlRange(
  _range: StatsDateRange | null,
  _now: Date = new Date(),
): StatsDateRange | null {
  return null;
}

export function weekEndOf(_weekStart: string): string | null {
  return null;
}

export function formatStatsDate(_date: string): string {
  return "";
}
