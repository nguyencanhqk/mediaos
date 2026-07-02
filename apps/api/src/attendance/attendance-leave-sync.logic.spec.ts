import { describe, expect, it } from "vitest";
import {
  buildFullDaySyncPatch,
  buildPartialSyncPatch,
  buildRevertPatch,
  computeSyncedRequiredMinutes,
  isSyncableDay,
  recomputeAgainstNewRequired,
  type SyncDayInput,
  type SyncRecordInput,
  type SyncShiftInput,
} from "./attendance-leave-sync.logic";

const SHIFT_480: SyncShiftInput = { id: "shift-1", requiredWorkingMinutes: 480 };
const NO_SHIFT: SyncShiftInput = { id: null, requiredWorkingMinutes: null };

function day(overrides: Partial<SyncDayInput> = {}): SyncDayInput {
  return {
    id: "day-1",
    employeeId: "emp-1",
    workDate: "2027-04-05",
    dayType: "Full Day",
    leaveMinutes: 0,
    isWorkingDay: true,
    ...overrides,
  };
}

function record(overrides: Partial<SyncRecordInput> = {}): SyncRecordInput {
  return {
    id: "rec-1",
    checkInAt: null,
    checkOutAt: null,
    workingMinutes: null,
    requiredWorkingMinutes: 480,
    lateMinutes: null,
    earlyLeaveMinutes: null,
    ...overrides,
  };
}

describe("isSyncableDay", () => {
  it("working day with Full Day/Half Day/Hourly → syncable", () => {
    expect(isSyncableDay(day({ dayType: "Full Day" }))).toBe(true);
    expect(isSyncableDay(day({ dayType: "Half Day" }))).toBe(true);
    expect(isSyncableDay(day({ dayType: "Hourly" }))).toBe(true);
  });
  it("Non Working Day / Public Holiday → NOT syncable", () => {
    expect(isSyncableDay(day({ dayType: "Non Working Day" }))).toBe(false);
    expect(isSyncableDay(day({ dayType: "Public Holiday" }))).toBe(false);
  });
  it("isWorkingDay=false → NOT syncable regardless of dayType", () => {
    expect(isSyncableDay(day({ dayType: "Full Day", isWorkingDay: false }))).toBe(false);
  });
});

describe("computeSyncedRequiredMinutes", () => {
  it("Full Day → 0 (blocks entirely) regardless of shift", () => {
    expect(computeSyncedRequiredMinutes(day({ dayType: "Full Day" }), SHIFT_480, 480)).toBe(0);
    expect(computeSyncedRequiredMinutes(day({ dayType: "Full Day" }), NO_SHIFT, 100)).toBe(0);
  });
  it("Half Day → half the shift requirement, floored", () => {
    expect(computeSyncedRequiredMinutes(day({ dayType: "Half Day" }), SHIFT_480, null)).toBe(240);
    // odd base → floor, never negative.
    expect(
      computeSyncedRequiredMinutes(
        day({ dayType: "Half Day" }),
        { id: "s", requiredWorkingMinutes: 481 },
        null,
      ),
    ).toBe(240);
  });
  it("Hourly → shift requirement minus exact leave_minutes, never below 0", () => {
    expect(
      computeSyncedRequiredMinutes(day({ dayType: "Hourly", leaveMinutes: 120 }), SHIFT_480, null),
    ).toBe(360);
    expect(
      computeSyncedRequiredMinutes(day({ dayType: "Hourly", leaveMinutes: 999 }), SHIFT_480, null),
    ).toBe(0);
  });
  it("no shift resolvable → falls back to currentRequired (or 0)", () => {
    expect(computeSyncedRequiredMinutes(day({ dayType: "Half Day" }), NO_SHIFT, 300)).toBe(150);
    expect(computeSyncedRequiredMinutes(day({ dayType: "Half Day" }), NO_SHIFT, null)).toBe(0);
  });
});

describe("recomputeAgainstNewRequired", () => {
  it("no check-in/out yet → status derived purely from missing target", () => {
    const r = recomputeAgainstNewRequired(record({ workingMinutes: 0 }), 240);
    expect(r.missingMinutes).toBe(240);
    expect(r.attendanceStatus).toBe("Missing Hours");
  });
  it("late > 0 wins over everything else", () => {
    const r = recomputeAgainstNewRequired(
      record({
        checkInAt: new Date(),
        checkOutAt: new Date(),
        workingMinutes: 240,
        lateMinutes: 10,
      }),
      240,
    );
    expect(r.attendanceStatus).toBe("Late");
  });
  it("early leave wins when late=0", () => {
    const r = recomputeAgainstNewRequired(
      record({
        checkInAt: new Date(),
        checkOutAt: new Date(),
        workingMinutes: 240,
        lateMinutes: 0,
        earlyLeaveMinutes: 5,
      }),
      240,
    );
    expect(r.attendanceStatus).toBe("Early Leave");
  });
  it("worked >= required, no late/early → Present", () => {
    const r = recomputeAgainstNewRequired(
      record({ checkInAt: new Date(), checkOutAt: new Date(), workingMinutes: 240 }),
      240,
    );
    expect(r.missingMinutes).toBe(0);
    expect(r.attendanceStatus).toBe("Present");
  });
  it("checked-in, not yet checked-out, still short of target → Checked-in reflected once no shortfall", () => {
    const r = recomputeAgainstNewRequired(
      record({ checkInAt: new Date(), checkOutAt: null, workingMinutes: 240 }),
      240,
    );
    expect(r.attendanceStatus).toBe("Checked-in");
  });
});

describe("buildFullDaySyncPatch", () => {
  it("always Leave/required=0/missing=0/workMode=Leave", () => {
    expect(buildFullDaySyncPatch()).toEqual({
      attendanceStatus: "Leave",
      requiredWorkingMinutes: 0,
      missingMinutes: 0,
      workMode: "Leave",
    });
  });
});

describe("buildPartialSyncPatch", () => {
  it("half-day, no existing record → Not Checked-in + reduced target, missing=null (forward-looking)", () => {
    const patch = buildPartialSyncPatch(day({ dayType: "Half Day" }), SHIFT_480, null);
    expect(patch).toEqual({
      attendanceStatus: "Not Checked-in",
      requiredWorkingMinutes: 240,
      missingMinutes: null,
      workMode: null,
    });
  });
  it("half-day WITH an existing completed record → recomputed against the reduced target", () => {
    const rec = record({ checkInAt: new Date(), checkOutAt: new Date(), workingMinutes: 250 });
    const patch = buildPartialSyncPatch(day({ dayType: "Half Day" }), SHIFT_480, rec);
    expect(patch.requiredWorkingMinutes).toBe(240);
    expect(patch.missingMinutes).toBe(0); // 250 worked >= 240 required
    expect(patch.attendanceStatus).toBe("Present");
  });
});

describe("buildRevertPatch", () => {
  it("no existing record → Not Checked-in + FULL shift requirement restored", () => {
    const patch = buildRevertPatch(SHIFT_480, null);
    expect(patch).toEqual({
      attendanceStatus: "Not Checked-in",
      requiredWorkingMinutes: 480,
      missingMinutes: null,
      workMode: null,
    });
  });
  it("existing record with check-in/out → recomputed against the FULL (restored) target, Leave dropped", () => {
    const rec = record({ checkInAt: new Date(), checkOutAt: new Date(), workingMinutes: 480 });
    const patch = buildRevertPatch(SHIFT_480, rec);
    expect(patch.requiredWorkingMinutes).toBe(480);
    expect(patch.missingMinutes).toBe(0);
    expect(patch.attendanceStatus).toBe("Present");
    expect(patch.workMode).toBeNull();
  });
  it("existing record under-worked vs. restored target → Missing Hours", () => {
    const rec = record({ checkInAt: new Date(), checkOutAt: new Date(), workingMinutes: 100 });
    const patch = buildRevertPatch(SHIFT_480, rec);
    expect(patch.missingMinutes).toBe(380);
    expect(patch.attendanceStatus).toBe("Missing Hours");
  });
  it("no shift resolvable → restores to 0 (fail-safe, never invents a target)", () => {
    const patch = buildRevertPatch(NO_SHIFT, null);
    expect(patch.requiredWorkingMinutes).toBe(0);
  });
});
