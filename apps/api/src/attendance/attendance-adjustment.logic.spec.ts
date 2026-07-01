import { describe, expect, it } from "vitest";
import {
  ADJUSTED_ATTENDANCE_STATUS,
  ADJUSTED_LEGACY_STATUS,
  ADJUSTMENT_STATUS,
  ADJUSTMENT_TERMINAL_STATUSES,
  isDecidable,
  recomputeRecord,
  type RecordCalcInput,
} from "./attendance-adjustment.logic";

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
