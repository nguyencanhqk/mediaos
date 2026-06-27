import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKING_DAYS,
  computeIsWorkingDay,
  effectiveHolidaysForDate,
  filterByCountry,
  type HolidayFact,
} from "./holidays.logic";

// Known weekdays (ISO): 2024-01-01 = Mon(1), 2024-01-06 = Sat(6), 2024-01-07 = Sun(7).
const MON = "2024-01-01";
const SAT = "2024-01-06";

function fact(overrides: Partial<HolidayFact> = {}): HolidayFact {
  return {
    companyId: null,
    holidayDate: MON,
    holidayType: "PublicHoliday",
    affectsAttendance: true,
    status: "Active",
    ...overrides,
  };
}

describe("computeIsWorkingDay", () => {
  it("weekday with no holiday → working", () => {
    expect(computeIsWorkingDay(MON, [])).toBe(true);
  });

  it("weekend with no holiday → not working", () => {
    expect(computeIsWorkingDay(SAT, [])).toBe(false);
  });

  it("weekday with an Active attendance-affecting holiday → not working", () => {
    expect(computeIsWorkingDay(MON, [fact()])).toBe(false);
  });

  it("WorkingDayOverride forces a working day even on a weekend (làm bù)", () => {
    expect(
      computeIsWorkingDay(SAT, [fact({ holidayDate: SAT, holidayType: "WorkingDayOverride" })]),
    ).toBe(true);
  });

  it("WorkingDayOverride wins over a co-located blocking holiday", () => {
    expect(
      computeIsWorkingDay(MON, [
        fact(),
        fact({ holidayType: "WorkingDayOverride" }),
      ]),
    ).toBe(true);
  });

  it("Inactive holiday is ignored → weekday stays working", () => {
    expect(computeIsWorkingDay(MON, [fact({ status: "Inactive" })])).toBe(true);
  });

  it("holiday that does not affect attendance → weekday stays working", () => {
    expect(
      computeIsWorkingDay(MON, [fact({ holidayType: "SpecialDay", affectsAttendance: false })]),
    ).toBe(true);
  });

  it("custom workingDays can make Saturday a working day", () => {
    expect(computeIsWorkingDay(SAT, [], [1, 2, 3, 4, 5, 6])).toBe(true);
  });

  it("default working days are Mon–Fri", () => {
    expect([...DEFAULT_WORKING_DAYS]).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("effectiveHolidaysForDate (company overrides global per date)", () => {
  const rows = [
    { companyId: null, holidayDate: MON, holidayCode: "G1" },
    { companyId: "co", holidayDate: MON, holidayCode: "C1" },
    { companyId: null, holidayDate: SAT, holidayCode: "G2" },
  ];

  it("returns ONLY company rows for a date that has a company holiday", () => {
    const eff = effectiveHolidaysForDate(rows, MON);
    expect(eff.map((r) => r.holidayCode)).toEqual(["C1"]);
  });

  it("falls back to global rows when no company holiday on that date", () => {
    const eff = effectiveHolidaysForDate(rows, SAT);
    expect(eff.map((r) => r.holidayCode)).toEqual(["G2"]);
  });

  it("ignores rows on other dates", () => {
    expect(effectiveHolidaysForDate(rows, "2024-12-25")).toEqual([]);
  });
});

describe("filterByCountry (global rows only; company rows always kept)", () => {
  const rows = [
    { companyId: "co", countryCode: "US", holidayCode: "C" }, // company → always kept
    { companyId: null, countryCode: "VN", holidayCode: "G-VN" },
    { companyId: null, countryCode: "US", holidayCode: "G-US" },
    { companyId: null, countryCode: null, holidayCode: "G-ALL" },
  ];

  it("no country filter → keep everything", () => {
    expect(filterByCountry(rows, null).map((r) => r.holidayCode)).toEqual([
      "C",
      "G-VN",
      "G-US",
      "G-ALL",
    ]);
  });

  it("country=VN → drop global US, keep VN + country-less global + all company rows", () => {
    expect(filterByCountry(rows, "VN").map((r) => r.holidayCode)).toEqual(["C", "G-VN", "G-ALL"]);
  });
});
