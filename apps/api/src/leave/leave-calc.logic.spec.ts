/**
 * S3-LEAVE-BE-1 — unit tests for the pure leave preview math (no DB).
 * Covers FullDay / HalfDay / Hourly / MultipleDays, weekend + holiday exclusion, and per-day flags.
 */

import { describe, expect, it } from "vitest";
import { HOURS_PER_DAY, calculateLeave, type LeaveCalcInput } from "./leave-calc.logic";

const MON_FRI = [1, 2, 3, 4, 5];
const NO_HOLIDAYS = new Set<string>();

// 2026-06-22 = Monday … 2026-06-28 = Sunday (verified ISO weekday lattice).
const MON = "2026-06-22";
const TUE = "2026-06-23";
const WED = "2026-06-24";
const FRI = "2026-06-26";
const SAT = "2026-06-27";
const SUN = "2026-06-28";

describe("leave-calc.logic — FullDay / MultipleDays", () => {
  it("single full working day → 1 day / 8h", () => {
    const input: LeaveCalcInput = {
      startDate: MON,
      endDate: MON,
      durationType: "FullDay",
    };
    const r = calculateLeave(input, MON_FRI, NO_HOLIDAYS);
    expect(r.calculatedDays).toBe(1);
    expect(r.calculatedHours).toBe(HOURS_PER_DAY);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]).toMatchObject({
      date: MON,
      is_working_day: true,
      is_public_holiday: false,
      leave_days: 1,
      leave_hours: 8,
    });
  });

  it("MultipleDays Mon→Fri excludes nothing → 5 days / 40h", () => {
    const input: LeaveCalcInput = {
      startDate: MON,
      endDate: FRI,
      durationType: "MultipleDays",
    };
    const r = calculateLeave(input, MON_FRI, NO_HOLIDAYS);
    expect(r.calculatedDays).toBe(5);
    expect(r.calculatedHours).toBe(40);
    expect(r.days).toHaveLength(5);
  });
});

describe("leave-calc.logic — weekend + holiday exclusion", () => {
  it("Fri→Mon spanning a weekend → only Fri + Mon count (2 days)", () => {
    const input: LeaveCalcInput = {
      startDate: FRI,
      endDate: addDays(MON, 7), // next Monday 2026-06-29? use range Fri..following Mon
      durationType: "MultipleDays",
    };
    // Fri 26, Sat 27, Sun 28, Mon 29 → 2 working days
    input.endDate = "2026-06-29";
    const r = calculateLeave(input, MON_FRI, NO_HOLIDAYS);
    expect(r.calculatedDays).toBe(2);
    const sat = r.days.find((d) => d.date === SAT);
    const sun = r.days.find((d) => d.date === SUN);
    expect(sat?.is_working_day).toBe(false);
    expect(sat?.leave_days).toBe(0);
    expect(sun?.is_working_day).toBe(false);
  });

  it("seeded company holiday on a weekday is excluded + flagged is_public_holiday", () => {
    const input: LeaveCalcInput = {
      startDate: MON,
      endDate: WED,
      durationType: "MultipleDays",
    };
    const holidays = new Set<string>([TUE]); // Tue is a leave-affecting holiday
    const r = calculateLeave(input, MON_FRI, holidays);
    expect(r.calculatedDays).toBe(2); // Mon + Wed
    const tue = r.days.find((d) => d.date === TUE);
    expect(tue?.is_public_holiday).toBe(true);
    expect(tue?.is_working_day).toBe(false);
    expect(tue?.leave_days).toBe(0);
  });

  it("range entirely on a weekend → 0 days + warning (no crash)", () => {
    const input: LeaveCalcInput = {
      startDate: SAT,
      endDate: SUN,
      durationType: "MultipleDays",
    };
    const r = calculateLeave(input, MON_FRI, NO_HOLIDAYS);
    expect(r.calculatedDays).toBe(0);
    expect(r.calculatedHours).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("leave-calc.logic — HalfDay", () => {
  it("half day on a working day → 0.5 day / 4h", () => {
    const input: LeaveCalcInput = {
      startDate: WED,
      endDate: WED,
      durationType: "HalfDay",
      halfDaySession: "Morning",
    };
    const r = calculateLeave(input, MON_FRI, NO_HOLIDAYS);
    expect(r.calculatedDays).toBe(0.5);
    expect(r.calculatedHours).toBe(4);
    expect(r.days[0].leave_days).toBe(0.5);
  });

  it("half day on a weekend → 0 day", () => {
    const input: LeaveCalcInput = {
      startDate: SAT,
      endDate: SAT,
      durationType: "HalfDay",
      halfDaySession: "Afternoon",
    };
    const r = calculateLeave(input, MON_FRI, NO_HOLIDAYS);
    expect(r.calculatedDays).toBe(0);
  });
});

describe("leave-calc.logic — Hourly", () => {
  it("09:00→12:00 → 3h / 0.375 day", () => {
    const input: LeaveCalcInput = {
      startDate: TUE,
      endDate: TUE,
      durationType: "Hourly",
      startTime: "09:00",
      endTime: "12:00",
    };
    const r = calculateLeave(input, MON_FRI, NO_HOLIDAYS);
    expect(r.calculatedHours).toBe(3);
    expect(r.calculatedDays).toBe(0.38); // 3/8 = 0.375 → round2 0.38
    expect(r.days).toHaveLength(1);
  });

  it("08:00→16:00 → 8h / 1 day", () => {
    const input: LeaveCalcInput = {
      startDate: TUE,
      endDate: TUE,
      durationType: "Hourly",
      startTime: "08:00",
      endTime: "16:00",
    };
    const r = calculateLeave(input, MON_FRI, NO_HOLIDAYS);
    expect(r.calculatedHours).toBe(8);
    expect(r.calculatedDays).toBe(1);
  });
});

/** Helper: add N days to an ISO date (UTC calendar math), local to this spec. */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
