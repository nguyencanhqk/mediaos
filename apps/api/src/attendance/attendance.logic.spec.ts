/**
 * G11-1 — RED suite for the pure attendance-calculation logic (no I/O).
 *
 * ADR-0008: instants are UTC; the work_date + late/early figures are derived in the
 * schedule's IANA timezone. Fixtures use Asia/Ho_Chi_Minh (UTC+7, no DST) for determinism,
 * plus one overnight-shift case. ALL tests fail until attendance.logic.ts exists.
 */

import { describe, expect, it } from "vitest";
import {
  checkInTitleStatus,
  checkOutTitleStatus,
  computeMissingMinutes,
  computeWorkingMinutes,
  deriveAttendanceStatus,
  earlyLeaveMinutesFor,
  isWorkingDay,
  lateMinutesFor,
  type ShiftCalc,
  shiftEarlyLeaveMinutes,
  shiftLateMinutes,
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

// ─── S3-ATT-BE-1 — shift-aware helpers (OFFICE_8H grid: 08:00–17:00, grace 5/5, break 60, req 480) ──

const OFFICE: ShiftCalc = {
  startTime: "08:00:00", // 08:00 VN === 01:00Z
  endTime: "17:00:00", // 17:00 VN === 10:00Z
  graceLateMinutes: 5,
  graceEarlyLeaveMinutes: 5,
  breakMinutes: 60,
  crossDay: false,
  timezone: "Asia/Ho_Chi_Minh",
};

describe("shiftLateMinutes", () => {
  const wd = "2024-06-03";
  it("is 0 at the scheduled start (08:00)", () => {
    expect(shiftLateMinutes(at("2024-06-03T01:00:00Z"), wd, OFFICE)).toBe(0);
  });
  it("is 0 inside the grace window (08:05, grace 5)", () => {
    expect(shiftLateMinutes(at("2024-06-03T01:05:00Z"), wd, OFFICE)).toBe(0);
  });
  it("counts full minutes from start once past grace (08:20 → 20)", () => {
    expect(shiftLateMinutes(at("2024-06-03T01:20:00Z"), wd, OFFICE)).toBe(20);
  });
  it("is 0 when checking in early (07:30)", () => {
    expect(shiftLateMinutes(at("2024-06-03T00:30:00Z"), wd, OFFICE)).toBe(0);
  });
  it("is 0 when the shift has no start time (no-effective-shift)", () => {
    expect(shiftLateMinutes(at("2024-06-03T05:00:00Z"), wd, { ...OFFICE, startTime: null })).toBe(
      0,
    );
  });
});

describe("shiftEarlyLeaveMinutes", () => {
  const wd = "2024-06-03";
  it("is 0 at the scheduled end (17:00)", () => {
    expect(shiftEarlyLeaveMinutes(at("2024-06-03T10:00:00Z"), wd, OFFICE)).toBe(0);
  });
  it("is 0 inside the grace window (16:56, grace 5)", () => {
    expect(shiftEarlyLeaveMinutes(at("2024-06-03T09:56:00Z"), wd, OFFICE)).toBe(0);
  });
  it("counts minutes before end once past grace (16:30 → 30)", () => {
    expect(shiftEarlyLeaveMinutes(at("2024-06-03T09:30:00Z"), wd, OFFICE)).toBe(30);
  });
  it("is 0 when checking out after end (17:30)", () => {
    expect(shiftEarlyLeaveMinutes(at("2024-06-03T10:30:00Z"), wd, OFFICE)).toBe(0);
  });
  it("rolls end to the next local day for an overnight shift", () => {
    const night: ShiftCalc = {
      ...OFFICE,
      startTime: "22:00:00",
      endTime: "06:00:00",
      crossDay: true,
    };
    // end 2024-06-04 06:00 VN === 2024-06-03 23:00Z; checkout 05:30 VN === 22:30Z → 30 early.
    expect(shiftEarlyLeaveMinutes(at("2024-06-03T22:30:00Z"), "2024-06-03", night)).toBe(30);
  });
  it("is 0 when the shift has no end time", () => {
    expect(
      shiftEarlyLeaveMinutes(at("2024-06-03T08:00:00Z"), wd, { ...OFFICE, endTime: null }),
    ).toBe(0);
  });
});

describe("computeWorkingMinutes", () => {
  it("subtracts the break from elapsed (08:00→17:00, break 60 → 480)", () => {
    expect(computeWorkingMinutes(at("2024-06-03T01:00:00Z"), at("2024-06-03T10:00:00Z"), 60)).toBe(
      480,
    );
  });
  it("never goes negative when elapsed < break", () => {
    expect(computeWorkingMinutes(at("2024-06-03T01:00:00Z"), at("2024-06-03T01:10:00Z"), 60)).toBe(
      0,
    );
  });
});

describe("computeMissingMinutes", () => {
  it("is 0 when no required target", () => {
    expect(computeMissingMinutes(null, 100)).toBe(0);
  });
  it("is the shortfall vs. required (480 req, 450 worked → 30)", () => {
    expect(computeMissingMinutes(480, 450)).toBe(30);
  });
  it("is 0 when the required target is met or exceeded", () => {
    expect(computeMissingMinutes(480, 500)).toBe(0);
  });
});

describe("checkInTitleStatus / checkOutTitleStatus (TitleCase)", () => {
  it("check-in: Checked-in when on time, Late when late", () => {
    expect(checkInTitleStatus(false)).toBe("Checked-in");
    expect(checkInTitleStatus(true)).toBe("Late");
  });
  it("check-out precedence: Late ≻ Early Leave ≻ Missing Hours ≻ Present", () => {
    expect(checkOutTitleStatus(10, 20, 30)).toBe("Late");
    expect(checkOutTitleStatus(0, 20, 30)).toBe("Early Leave");
    expect(checkOutTitleStatus(0, 0, 30)).toBe("Missing Hours");
    expect(checkOutTitleStatus(0, 0, 0)).toBe("Present");
  });
});
