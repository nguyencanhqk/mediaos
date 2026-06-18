import type { ReportPeriod } from "@mediaos/contracts";

/**
 * Resolved reporting window as a HALF-OPEN range [startDate, endDate) of YYYY-MM-DD strings (UTC).
 * Query finance rows with `revenueDate >= startDate AND revenueDate < endDate` — the exclusive upper
 * bound is what keeps "this month" from silently including future-dated entries.
 */
export interface ReportRange {
  /** Inclusive start, YYYY-MM-DD (UTC). */
  startDate: string;
  /** EXCLUSIVE end, YYYY-MM-DD (UTC). */
  endDate: string;
}

/**
 * First day of a (year, month) as YYYY-MM-DD in UTC. `month` may be out of [0,11]; Date.UTC normalizes
 * the overflow/underflow across year boundaries (e.g. month=12 → Jan next year, month=-1 → Dec prev year).
 */
function firstOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

/**
 * Resolve a {@link ReportPeriod} to a concrete UTC date range. Pure + deterministic — `now` is injected
 * so the window is testable. `thisMonth` reproduces the original G14-2 month-to-date window.
 */
export function resolveReportRange(period: ReportPeriod, now: Date): ReportRange {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-11

  switch (period) {
    case "thisMonth":
      return { startDate: firstOfMonth(year, month), endDate: firstOfMonth(year, month + 1) };
    case "lastMonth":
      return { startDate: firstOfMonth(year, month - 1), endDate: firstOfMonth(year, month) };
    case "thisQuarter": {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return {
        startDate: firstOfMonth(year, quarterStartMonth),
        endDate: firstOfMonth(year, quarterStartMonth + 3),
      };
    }
  }
}
