/**
 * G11-1 — RED suite for the pure attendance-calculation logic (no I/O).
 *
 * ADR-0008: instants are UTC; the work_date + late/early figures are derived in the
 * schedule's IANA timezone. Fixtures use Asia/Ho_Chi_Minh (UTC+7, no DST) for determinism,
 * plus one overnight-shift case. ALL tests fail until attendance.logic.ts exists.
 */

import { describe, expect, it } from "vitest";
import {
  deriveAttendanceStatus,
  earlyLeaveMinutesFor,
  isWorkingDay,
  lateMinutesFor,
  workDateForCheckIn,
  type ScheduleCalc,
} from "./attendance.logic";

const VN: ScheduleCalc = {
  startTime: "09:00",
  endTime: "18:00",
  graceMinutes: 15,
  timezone: "Asia/Ho_Chi_Minh",
  workingDays: [1, 2, 3, 4, 5],
};

// 2024-06-03 is a Monday. 09:00 VN === 02:00 UTC.
const at = (utcIso: string) => new Date(utcIso);

describe("workDateForCheckIn", () => {
  it("derives the local work_date in the schedule timezone", () => {
    // 2024-06-03 02:00Z === 2024-06-03 09:00 VN
    expect(workDateForCheckIn(at("2024-06-03T02:00:00Z"), VN)).toBe("2024-06-03");
  });

  it("rolls to the correct local date when the UTC instant is the previous day", () => {
    // 2024-06-02 23:30Z === 2024-06-03 06:30 VN → local date is the 3rd, not the 2nd
    expect(workDateForCheckIn(at("2024-06-02T23:30:00Z"), VN)).toBe("2024-06-03");
  });

  it("snaps the work_date around local midnight Asia/Ho_Chi_Minh (UTC+7) — both sides of the boundary", () => {
    // Local midnight 2024-06-03 00:00 VN === 2024-06-02 17:00Z.
    // One minute BEFORE local midnight: 2024-06-02 23:59 VN === 2024-06-02 16:59Z → still the 2nd.
    expect(workDateForCheckIn(at("2024-06-02T16:59:00Z"), VN)).toBe("2024-06-02");
    // Exactly at local midnight: 2024-06-02 17:00Z → flips to the 3rd.
    expect(workDateForCheckIn(at("2024-06-02T17:00:00Z"), VN)).toBe("2024-06-03");
    // One minute AFTER local midnight: 2024-06-02 17:01Z → the 3rd.
    expect(workDateForCheckIn(at("2024-06-02T17:01:00Z"), VN)).toBe("2024-06-03");
  });

  it("crosses the month boundary by tz, not by UTC instant (period_month feed for payroll lock)", () => {
    // 2024-05-31 23:30 VN === 2024-05-31 16:30Z → local month is May (2024-05), NOT June.
    expect(workDateForCheckIn(at("2024-05-31T16:30:00Z"), VN)).toBe("2024-05-31");
    // 2024-05-31 17:00Z === 2024-06-01 00:00 VN → flips into June by wall-clock.
    expect(workDateForCheckIn(at("2024-05-31T17:00:00Z"), VN)).toBe("2024-06-01");
  });
});

describe("lateMinutesFor", () => {
  const wd = "2024-06-03";

  it("is 0 when checking in exactly at the scheduled start", () => {
    expect(lateMinutesFor(at("2024-06-03T02:00:00Z"), wd, VN)).toBe(0);
  });

  it("is 0 within the grace window (09:10, grace 15)", () => {
    expect(lateMinutesFor(at("2024-06-03T02:10:00Z"), wd, VN)).toBe(0);
  });

  it("is 0 exactly at the grace boundary (09:15)", () => {
    expect(lateMinutesFor(at("2024-06-03T02:15:00Z"), wd, VN)).toBe(0);
  });

  it("counts full minutes from scheduled start once past the grace window (09:16 → 16)", () => {
    expect(lateMinutesFor(at("2024-06-03T02:16:00Z"), wd, VN)).toBe(16);
  });

  it("counts a large lateness (09:45 → 45)", () => {
    expect(lateMinutesFor(at("2024-06-03T02:45:00Z"), wd, VN)).toBe(45);
  });
});

describe("earlyLeaveMinutesFor", () => {
  const wd = "2024-06-03";

  it("is 0 when checking out exactly at the scheduled end", () => {
    // 18:00 VN === 11:00Z
    expect(earlyLeaveMinutesFor(at("2024-06-03T11:00:00Z"), wd, VN)).toBe(0);
  });

  it("is 0 when checking out after the scheduled end", () => {
    expect(earlyLeaveMinutesFor(at("2024-06-03T11:30:00Z"), wd, VN)).toBe(0);
  });

  it("counts minutes left before the scheduled end (17:30 → 30)", () => {
    // 17:30 VN === 10:30Z
    expect(earlyLeaveMinutesFor(at("2024-06-03T10:30:00Z"), wd, VN)).toBe(30);
  });

  it("handles an overnight shift (end <= start ⇒ next local day)", () => {
    const night: ScheduleCalc = { ...VN, startTime: "22:00", endTime: "06:00" };
    // work_date 2024-06-03; scheduled end is 2024-06-04 06:00 VN === 2024-06-03 23:00Z.
    // Checkout 2024-06-04 05:30 VN === 2024-06-03 22:30Z → 30 min early.
    expect(earlyLeaveMinutesFor(at("2024-06-03T22:30:00Z"), "2024-06-03", night)).toBe(30);
  });
});

describe("deriveAttendanceStatus", () => {
  it("is present when neither late nor early", () => {
    expect(deriveAttendanceStatus(0, 0)).toBe("present");
  });

  it("is late when late > 0 (late takes precedence over early)", () => {
    expect(deriveAttendanceStatus(16, 0)).toBe("late");
    expect(deriveAttendanceStatus(16, 30)).toBe("late");
  });

  it("is early_leave when only early > 0", () => {
    expect(deriveAttendanceStatus(0, 30)).toBe("early_leave");
  });
});

describe("isWorkingDay", () => {
  it("is true for a configured working weekday (Mon)", () => {
    expect(isWorkingDay("2024-06-03", VN)).toBe(true); // Monday
  });

  it("is false for a non-working day (Sun)", () => {
    expect(isWorkingDay("2024-06-02", VN)).toBe(false); // Sunday
  });
});
