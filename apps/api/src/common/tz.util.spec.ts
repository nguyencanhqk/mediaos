/**
 * GX-7 — Timezone util DST + day/month-boundary + validation suite (RED first).
 *
 * ADR-0008 (UTC-at-rest, render IANA tz). This suite pins the EXACT contract that payroll/attendance
 * depend on, so swapping the internals (Intl → @date-fns/tz TZDate) cannot drift even one minute at a
 * boundary. Concrete expected values are computed independently (not from the impl under test) so the
 * suite is a true oracle for BOTH the legacy Intl impl and the @date-fns/tz impl.
 *
 * Coverage:
 *  - assertValidTimezone fail-fast on garbage tz (create/update work_schedule + company settings)
 *  - localDateOf at the company-tz midnight boundary (off-by-one day guard)
 *  - monthDateRange + month-boundary attribution (period feed to payslip)
 *  - wallTimeToInstant on a DST spring-forward gap + fall-back overlap (stable instant)
 *  - parity grid: VN (no DST) + America/New_York (DST) round-trips
 */

import { describe, expect, it } from "vitest";
import {
  addDaysToLocalDate,
  assertValidTimezone,
  localDateOf,
  localWeekdayOf,
  minutesBetween,
  monthDateRange,
  monthOfDate,
  wallTimeToInstant,
  weekdayOfLocalDate,
} from "./tz.util";

const VN = "Asia/Ho_Chi_Minh"; // UTC+7, no DST
const NY = "America/New_York"; // UTC-5 / UTC-4 (DST)

describe("assertValidTimezone — boundary validation (fail-fast)", () => {
  it("throws RangeError on garbage timezones", () => {
    for (const bad of ["Mars/Phobos", "", "Asia/Nope", "Not/A/Zone", "UTC+7"]) {
      expect(() => assertValidTimezone(bad)).toThrow(RangeError);
    }
  });

  it("passes for valid IANA timezones", () => {
    expect(() => assertValidTimezone(VN)).not.toThrow();
    expect(() => assertValidTimezone(NY)).not.toThrow();
    expect(() => assertValidTimezone("UTC")).not.toThrow();
  });
});

describe("localDateOf — day-boundary off-by-one guard", () => {
  it("maps the correct calendar day at company-tz midnight under VN (+7)", () => {
    // 2024-06-30T17:00:00Z == 2024-07-01 00:00 local in Asia/Ho_Chi_Minh (+7) → belongs to July.
    expect(localDateOf(new Date("2024-06-30T17:00:00Z"), VN)).toBe("2024-07-01");
    // One minute before local midnight is still June 30 local.
    expect(localDateOf(new Date("2024-06-30T16:59:00Z"), VN)).toBe("2024-06-30");
  });

  it("maps the correct calendar day across UTC midnight under NY (-4/-5)", () => {
    // 2024-07-01T03:00:00Z == 2024-06-30 23:00 local in New York (EDT -4) → still June 30.
    expect(localDateOf(new Date("2024-07-01T03:00:00Z"), NY)).toBe("2024-06-30");
    // 2024-07-01T04:00:00Z == 2024-07-01 00:00 local → July 1.
    expect(localDateOf(new Date("2024-07-01T04:00:00Z"), NY)).toBe("2024-07-01");
  });
});

describe("monthDateRange / monthOfDate — month-boundary period attribution", () => {
  it("computes [from, toExclusive) for a normal month", () => {
    expect(monthDateRange("2024-06")).toEqual({ from: "2024-06-01", toExclusive: "2024-07-01" });
  });

  it("rolls the year over in December", () => {
    expect(monthDateRange("2024-12")).toEqual({ from: "2024-12-01", toExclusive: "2025-01-01" });
  });

  it("attributes a last-day-23:30-local instant to that month, next-day-00:30-local to next month (VN)", () => {
    // Last day of June, 23:30 local in VN = 2024-06-30 16:30Z → local date 2024-06-30 → month 2024-06.
    const lastDayLate = new Date("2024-06-30T16:30:00Z");
    expect(monthOfDate(localDateOf(lastDayLate, VN))).toBe("2024-06");
    // 00:30 local next day = 2024-06-30 17:30Z → local date 2024-07-01 → month 2024-07.
    const nextDayEarly = new Date("2024-06-30T17:30:00Z");
    expect(monthOfDate(localDateOf(nextDayEarly, VN))).toBe("2024-07");
  });
});

describe("wallTimeToInstant — DST gap + overlap + no-DST round-trips", () => {
  it("round-trips wall time under VN (no DST)", () => {
    const instant = wallTimeToInstant("2024-06-15", "09:30", VN);
    // 09:30 local +7 → 02:30Z.
    expect(instant.toISOString()).toBe("2024-06-15T02:30:00.000Z");
    // Local readback is identical.
    expect(localDateOf(instant, VN)).toBe("2024-06-15");
  });

  it("returns a stable instant on the spring-forward GAP day (NY 2024-03-10 02:30 does not exist)", () => {
    // EST→EDT: 02:00 jumps to 03:00. 02:30 is non-existent. The two-pass monotonic resolver lands on
    // a single, stable instant without throwing or NaN. CANONICAL CHOICE (ADR-0008): the second pass
    // re-reads the offset at the first guess (which lands in EDT, -4), so 02:30 resolves as 02:30 EDT
    // == 06:30Z. Determinism + stability is the contract; the exact hour is pinned so a future
    // internals change cannot silently shift it.
    const instant = wallTimeToInstant("2024-03-10", "02:30", NY);
    expect(Number.isNaN(instant.getTime())).toBe(false);
    expect(instant.toISOString()).toBe("2024-03-10T06:30:00.000Z");
  });

  it("returns a stable instant on the fall-back OVERLAP hour (NY 2024-11-03 01:30 occurs twice)", () => {
    // EDT→EST: 02:00 falls back to 01:00, so 01:30 happens twice. CANONICAL CHOICE (ADR-0008): the
    // resolver deterministically picks the first (pre-transition, EDT -4) occurrence: 01:30 EDT ==
    // 05:30Z. Stable + deterministic is the contract.
    const instant = wallTimeToInstant("2024-11-03", "01:30", NY);
    expect(Number.isNaN(instant.getTime())).toBe(false);
    expect(instant.toISOString()).toBe("2024-11-03T05:30:00.000Z");
  });

  it("round-trips a normal (non-DST-edge) NY wall time both directions", () => {
    const instant = wallTimeToInstant("2024-07-15", "08:00", NY); // EDT -4 → 12:00Z
    expect(instant.toISOString()).toBe("2024-07-15T12:00:00.000Z");
    expect(localDateOf(instant, NY)).toBe("2024-07-15");
  });
});

describe("weekday + addDays + minutesBetween — pure calendar helpers", () => {
  it("localWeekdayOf returns ISO weekday in tz", () => {
    // 2024-06-30 is a Sunday → ISO 7.
    expect(localWeekdayOf(new Date("2024-06-30T05:00:00Z"), VN)).toBe(7);
    // 2024-07-01 is a Monday → ISO 1 (local in VN).
    expect(localWeekdayOf(new Date("2024-06-30T17:30:00Z"), VN)).toBe(1);
  });

  it("weekdayOfLocalDate matches ISO weekday for a local date string", () => {
    expect(weekdayOfLocalDate("2024-06-30")).toBe(7); // Sunday
    expect(weekdayOfLocalDate("2024-07-01")).toBe(1); // Monday
  });

  it("addDaysToLocalDate crosses month + year boundaries", () => {
    expect(addDaysToLocalDate("2024-06-30", 1)).toBe("2024-07-01");
    expect(addDaysToLocalDate("2024-12-31", 1)).toBe("2025-01-01");
    expect(addDaysToLocalDate("2024-03-01", -1)).toBe("2024-02-29"); // leap year
  });

  it("minutesBetween floors to whole minutes", () => {
    const a = new Date("2024-06-15T02:00:00Z");
    const b = new Date("2024-06-15T03:30:59Z");
    expect(minutesBetween(a, b)).toBe(90);
    expect(minutesBetween(b, a)).toBe(-91); // floor of -90.98
  });
});

describe("payroll-feed cross-tenant attribution — same UTC instant, different tenant tz", () => {
  // work_date is a `date` column computed ONCE at check-in via localDateOf(now, companyTz). Payslip
  // aggregation then filters to_char(work_date,'YYYY-MM') on that already-tz-derived date — so the
  // ONLY tz boundary is here. This pins the genuine off-by-one / cross-tenant payroll-feed guard:
  // one shared UTC instant must attribute to DIFFERENT work_date (and month) per tenant timezone.
  const sharedInstant = new Date("2024-06-30T17:30:00Z");

  it("company A (VN +7) attributes the instant to July; company B (NY -4) keeps it in June", () => {
    const companyAtz = VN;
    const companyBtz = NY;
    const workDateA = localDateOf(sharedInstant, companyAtz);
    const workDateB = localDateOf(sharedInstant, companyBtz);
    expect(workDateA).toBe("2024-07-01"); // 00:30 local next day in VN
    expect(workDateB).toBe("2024-06-30"); // 13:30 local same day in NY
    expect(workDateA).not.toBe(workDateB);
    // …and the payslip period (periodMonth = monthOf(work_date)) therefore differs too.
    expect(monthOfDate(workDateA)).toBe("2024-07");
    expect(monthOfDate(workDateB)).toBe("2024-06");
  });

  it("a last-day-of-month VN instant feeds exactly one month's range (no prev/next leakage)", () => {
    const workDate = localDateOf(new Date("2024-06-30T16:30:00Z"), VN); // 23:30 local Jun 30
    expect(workDate).toBe("2024-06-30");
    const { from, toExclusive } = monthDateRange(monthOfDate(workDate));
    // work_date falls within [from, toExclusive) for June and NOT in May or July ranges.
    expect(workDate >= from && workDate < toExclusive).toBe(true);
    expect(workDate >= monthDateRange("2024-07").from).toBe(false);
  });
});

describe("parity grid — DST tz daily round-trip stability", () => {
  // For every day across the NY spring-forward week, a 09:00 local check-in must round-trip back to
  // the same local date (payroll feed must never shift a work_date across the DST transition).
  const days = [
    "2024-03-08",
    "2024-03-09",
    "2024-03-10", // spring forward
    "2024-03-11",
    "2024-03-12",
  ];
  for (const d of days) {
    it(`09:00 local on ${d} round-trips to the same NY local date`, () => {
      const instant = wallTimeToInstant(d, "09:00", NY);
      expect(localDateOf(instant, NY)).toBe(d);
    });
  }
});
