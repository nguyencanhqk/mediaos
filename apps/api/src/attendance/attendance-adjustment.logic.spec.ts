import { describe, expect, it } from "vitest";
import type { ScheduleCalc } from "./attendance.logic";
import {
  ADJUSTED_ATTENDANCE_STATUS,
  ADJUSTED_LEGACY_STATUS,
  ADJUSTMENT_STATUS,
  ADJUSTMENT_TERMINAL_STATUSES,
  isDecidable,
  recomputeRecord,
  type RecordCalcInput,
} from "./attendance-adjustment.logic";

// 08:00–17:00 local Asia/Ho_Chi_Minh (UTC+7): scheduled start = 01:00Z, end = 10:00Z, no grace.
const SCHEDULE: ScheduleCalc = {
  startTime: "08:00",
  endTime: "17:00",
  graceMinutes: 0,
  timezone: "Asia/Ho_Chi_Minh",
  workingDays: [1, 2, 3, 4, 5],
};

const EMPTY: RecordCalcInput = {
  checkInAt: null,
  checkOutAt: null,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  workingMinutes: null,
  requiredWorkingMinutes: 480,
  breakMinutes: 60,
  missingMinutes: null,
  note: null,
};

describe("adjustment FSM", () => {
  it("only Pending is decidable; Draft + all terminals are not", () => {
    expect(isDecidable(ADJUSTMENT_STATUS.PENDING)).toBe(true);
    expect(isDecidable(ADJUSTMENT_STATUS.DRAFT)).toBe(false);
    for (const terminal of ADJUSTMENT_TERMINAL_STATUSES) {
      expect(isDecidable(terminal)).toBe(false);
    }
  });

  it("Approved/Rejected/Cancelled are the three terminal states", () => {
    expect([...ADJUSTMENT_TERMINAL_STATUSES].sort()).toEqual(
      ["Approved", "Cancelled", "Rejected"].sort(),
    );
  });
});

describe("recomputeRecord — recalc keeps derived figures consistent", () => {
  it("derives working_minutes from requested check-in/out minus break and marks record Adjusted", () => {
    const { patch, appliedItems } = recomputeRecord(EMPTY, [], {
      requestedCheckInAt: new Date("2024-06-03T01:00:00Z"), // 08:00 local
      requestedCheckOutAt: new Date("2024-06-03T10:00:00Z"), // 9h elapsed
    });
    // 9h elapsed − 60m break = 480 worked; required 480 → missing 0.
    expect(patch.workingMinutes).toBe(480);
    expect(patch.missingMinutes).toBe(0);
    expect(patch.attendanceStatus).toBe(ADJUSTED_ATTENDANCE_STATUS);
    expect(patch.status).toBe(ADJUSTED_LEGACY_STATUS);
    expect(patch.isAdjusted).toBe(true);
    // Two applied ledger entries (checkInAt + checkOutAt), each with an ISO applied value.
    expect(appliedItems.map((i) => i.fieldName).sort()).toEqual(["checkInAt", "checkOutAt"]);
    expect(appliedItems.every((i) => i.appliedValue !== undefined)).toBe(true);
  });

  it("recomputes missing_minutes when the shift target is not met (short day)", () => {
    const { patch } = recomputeRecord(EMPTY, [], {
      requestedCheckInAt: new Date("2024-06-03T01:00:00Z"),
      requestedCheckOutAt: new Date("2024-06-03T06:00:00Z"), // 5h − 60m = 240 worked
    });
    expect(patch.workingMinutes).toBe(240);
    expect(patch.missingMinutes).toBe(240); // 480 − 240
  });

  it("captures old→new per item and never mutates the input record", () => {
    const existing: RecordCalcInput = { ...EMPTY, lateMinutes: 30 };
    const { patch, appliedItems } = recomputeRecord(existing, [
      { fieldName: "lateMinutes", newValue: 0, note: "explain late" },
    ]);
    expect(patch.lateMinutes).toBe(0);
    const item = appliedItems.find((i) => i.fieldName === "lateMinutes");
    expect(item?.oldValue).toBe(30);
    expect(item?.newValue).toBe(0);
    expect(item?.appliedValue).toBe(0);
    expect(existing.lateMinutes).toBe(30); // immutable input
  });

  it("an explicit workingMinutes item pins the value (no re-derivation)", () => {
    const { patch } = recomputeRecord(EMPTY, [{ fieldName: "workingMinutes", newValue: 300 }], {
      requestedCheckInAt: new Date("2024-06-03T01:00:00Z"),
      requestedCheckOutAt: new Date("2024-06-03T10:00:00Z"),
    });
    expect(patch.workingMinutes).toBe(300);
  });

  it("rejects an out-of-range numeric coercion", () => {
    expect(() => recomputeRecord(EMPTY, [{ fieldName: "lateMinutes", newValue: -5 }])).toThrow();
  });
});

describe("recomputeRecord — recompute late/early from schedule when check-in/out change (SPEC-04 §14)", () => {
  it("recomputes lateMinutes from the schedule when checkInAt changes (stale value overwritten)", () => {
    // Stored late=0 but the adjusted check-in is 09:00 local (02:00Z) = 60m after an 08:00 start.
    const existing: RecordCalcInput = { ...EMPTY, lateMinutes: 0 };
    const { patch } = recomputeRecord(existing, [], {
      requestedCheckInAt: new Date("2024-06-03T02:00:00Z"),
      workDate: "2024-06-03",
      schedule: SCHEDULE,
    });
    expect(patch.lateMinutes).toBe(60);
  });

  it("recomputes earlyLeaveMinutes from the schedule when checkOutAt changes", () => {
    // Adjusted check-out is 16:00 local (09:00Z) = 60m before a 17:00 end.
    const { patch } = recomputeRecord(EMPTY, [], {
      requestedCheckInAt: new Date("2024-06-03T01:00:00Z"),
      requestedCheckOutAt: new Date("2024-06-03T09:00:00Z"),
      workDate: "2024-06-03",
      schedule: SCHEDULE,
    });
    expect(patch.earlyLeaveMinutes).toBe(60);
    expect(patch.lateMinutes).toBe(0); // on-time check-in
  });

  it("an explicit lateMinutes item PINS the value (no schedule recompute)", () => {
    const { patch } = recomputeRecord(EMPTY, [{ fieldName: "lateMinutes", newValue: 5 }], {
      requestedCheckInAt: new Date("2024-06-03T02:00:00Z"), // would compute 60 from schedule
      workDate: "2024-06-03",
      schedule: SCHEDULE,
    });
    expect(patch.lateMinutes).toBe(5);
  });

  it("no schedule → keeps the stored late/early (safe fallback, no recompute)", () => {
    const existing: RecordCalcInput = { ...EMPTY, lateMinutes: 12, earlyLeaveMinutes: 7 };
    const { patch } = recomputeRecord(existing, [], {
      requestedCheckInAt: new Date("2024-06-03T02:00:00Z"),
      requestedCheckOutAt: new Date("2024-06-03T09:00:00Z"),
      workDate: "2024-06-03",
      schedule: null,
    });
    expect(patch.lateMinutes).toBe(12);
    expect(patch.earlyLeaveMinutes).toBe(7);
  });

  it("does not recompute late when check-in is unchanged (only check-out adjusted)", () => {
    const existing: RecordCalcInput = { ...EMPTY, lateMinutes: 15 };
    const { patch } = recomputeRecord(existing, [], {
      requestedCheckOutAt: new Date("2024-06-03T09:00:00Z"),
      workDate: "2024-06-03",
      schedule: SCHEDULE,
    });
    expect(patch.lateMinutes).toBe(15); // untouched — checkInAt not in this adjustment
    expect(patch.earlyLeaveMinutes).toBe(60); // check-out recomputed
  });
});
