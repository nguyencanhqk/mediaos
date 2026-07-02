/**
 * S3-INT-1 — pure helpers for LEAVE→ATT sync (no I/O, fully unit-testable). Mirrors the pattern of
 * attendance.logic.ts / attendance-adjustment.logic.ts: the SERVICE composes these + DB reads/writes
 * inside `withTenant`; the math itself has no `this`, no DI.
 *
 * SPEC (IMPLEMENTATION-06 §8.7, S3-SYNC-001..004):
 *   full-day  → attendance_status='Leave', required_working_minutes=0 (block check-in/out entirely).
 *   half-day  → required_working_minutes reduced by the shift's half (or exact leave_minutes when known).
 *   hourly    → required_working_minutes reduced by leave_minutes (never below 0).
 *   revert (Cancel/Revoke of an ALREADY-SYNCED day) → required_working_minutes restored to the
 *     shift/rule EFFECTIVE value, attendance_status recomputed from whatever check-in/out already exists
 *     (present/late/early/missing), 'Leave' status removed.
 */

export type LeaveDayType =
  | "Full Day"
  | "Half Day"
  | "Hourly"
  | "Non Working Day"
  | "Public Holiday";

/** The subset of leave_request_days columns the sync math needs. */
export interface SyncDayInput {
  id: string;
  employeeId: string;
  workDate: string;
  dayType: string;
  leaveMinutes: number;
  isWorkingDay: boolean;
}

/** The subset of an existing attendance_records row the sync math needs (null = no record yet). */
export interface SyncRecordInput {
  id: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  workingMinutes: number | null;
  requiredWorkingMinutes: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
}

/** Effective shift figures the sync falls back to when creating a fresh record / restoring on revert. */
export interface SyncShiftInput {
  id: string | null;
  requiredWorkingMinutes: number | null;
}

export interface SyncPatch {
  /** attendance_status to set ('Leave' for full-day; recomputed for half/hourly with an existing check-in/out). */
  attendanceStatus: string;
  requiredWorkingMinutes: number;
  /** missing_minutes recomputed against the NEW required target when a check-in/out already exists. */
  missingMinutes: number | null;
  workMode: "Leave" | null;
}

/** Non-working days (weekend/holiday) never touch attendance — sync must skip them. */
export function isSyncableDay(day: SyncDayInput): boolean {
  return day.isWorkingDay && day.dayType !== "Non Working Day" && day.dayType !== "Public Holiday";
}

/**
 * Compute the new required_working_minutes for an APPROVED leave day. Full Day → 0 (blocks entirely).
 * Half Day → half the shift's requirement (rounded down; floor never goes negative). Hourly → shift
 * requirement minus the exact leave_minutes (never below 0). Falls back to the CURRENT record's
 * required_working_minutes (or 0) when no shift is resolvable.
 */
export function computeSyncedRequiredMinutes(
  day: SyncDayInput,
  shift: SyncShiftInput,
  currentRequired: number | null,
): number {
  const base = shift.requiredWorkingMinutes ?? currentRequired ?? 0;
  if (day.dayType === "Full Day") return 0;
  if (day.dayType === "Half Day") return Math.max(0, Math.floor(base / 2));
  if (day.dayType === "Hourly") return Math.max(0, base - day.leaveMinutes);
  return base;
}

/** attendance_status for a Full-Day leave day — always 'Leave' regardless of any prior check-in/out. */
export function fullDayLeaveStatus(): string {
  return "Leave";
}

/**
 * Recompute attendance_status + missing_minutes for a half-day/hourly leave day against the NEW
 * (reduced) required target. When the record has NO check-in yet, keep it a forward-looking target
 * (attendance_status unchanged input passthrough is the caller's job — this only computes the
 * work-so-far figures once check-in/out data exists).
 */
export function recomputeAgainstNewRequired(
  record: SyncRecordInput,
  newRequired: number,
): { missingMinutes: number; attendanceStatus: string } {
  const worked = record.workingMinutes ?? 0;
  if (!record.checkOutAt) {
    // Still open (or never checked in) — nothing to finalize; missing = shortfall vs. target so far.
    const missing = Math.max(0, newRequired - worked);
    return { missingMinutes: missing, attendanceStatus: statusFromRecord(record, missing) };
  }
  const missing = Math.max(0, newRequired - worked);
  return { missingMinutes: missing, attendanceStatus: statusFromRecord(record, missing) };
}

function statusFromRecord(record: SyncRecordInput, missingMinutes: number): string {
  const late = record.lateMinutes ?? 0;
  const early = record.earlyLeaveMinutes ?? 0;
  if (late > 0) return "Late";
  if (early > 0) return "Early Leave";
  if (missingMinutes > 0) return "Missing Hours";
  if (record.checkInAt && !record.checkOutAt) return "Checked-in";
  return "Present";
}

/**
 * Build the full-day-leave patch (no existing check-in/out consideration needed — Leave always wins).
 */
export function buildFullDaySyncPatch(): SyncPatch {
  return {
    attendanceStatus: fullDayLeaveStatus(),
    requiredWorkingMinutes: 0,
    missingMinutes: 0,
    workMode: "Leave",
  };
}

/** Build the half-day/hourly sync patch: reduced required target + recomputed status if data exists. */
export function buildPartialSyncPatch(
  day: SyncDayInput,
  shift: SyncShiftInput,
  record: SyncRecordInput | null,
): SyncPatch {
  const currentRequired = record?.requiredWorkingMinutes ?? null;
  const requiredWorkingMinutes = computeSyncedRequiredMinutes(day, shift, currentRequired);
  if (!record || (!record.checkInAt && !record.checkOutAt)) {
    return {
      attendanceStatus: "Not Checked-in",
      requiredWorkingMinutes,
      missingMinutes: null,
      workMode: null,
    };
  }
  const { missingMinutes, attendanceStatus } = recomputeAgainstNewRequired(
    record,
    requiredWorkingMinutes,
  );
  return { attendanceStatus, requiredWorkingMinutes, missingMinutes, workMode: null };
}

/**
 * REVERT patch (Cancel/Revoke of an already-synced day): restore required_working_minutes to the
 * shift/rule EFFECTIVE value (NOT the reduced one), drop 'Leave'/work_mode, recompute status from
 * whatever check-in/out already exists (idempotent — running twice on an already-reverted day is a no-op
 * because the caller only invokes this for sync_status='Synced' rows, see repository guard).
 */
export function buildRevertPatch(shift: SyncShiftInput, record: SyncRecordInput | null): SyncPatch {
  const requiredWorkingMinutes = shift.requiredWorkingMinutes ?? 0;
  if (!record || (!record.checkInAt && !record.checkOutAt)) {
    return {
      attendanceStatus: "Not Checked-in",
      requiredWorkingMinutes,
      missingMinutes: null,
      workMode: null,
    };
  }
  const { missingMinutes, attendanceStatus } = recomputeAgainstNewRequired(
    record,
    requiredWorkingMinutes,
  );
  return { attendanceStatus, requiredWorkingMinutes, missingMinutes, workMode: null };
}
