/**
 * S3-ATT-BE-4 — pure, I/O-free helpers extracted from AttendanceAdjustmentService so the service file
 * stays focused (<800 lines, CLAUDE.md §5). No `this`, no DB, no permission — deterministic transforms
 * over request/record shapes. Tested transitively via the adjustment service + logic specs.
 */

import { eq } from "drizzle-orm";
import { attendanceAdjustmentRequests } from "../db/schema/hr";
import type { AdjustmentItemProposal, RecordCalcInput } from "./attendance-adjustment.logic";

/** attendanceAdjustmentRequests.userId self-lock predicate for the "my" list. */
export function eqUserId(userId: string) {
  return eq(attendanceAdjustmentRequests.userId, userId);
}

/** Pull a Date from a checkInAt/checkOutAt proposal (ISO string / Date), or null when absent/invalid. */
function itemDate(proposals: AdjustmentItemProposal[], field: string): Date | null {
  const item = proposals.find((p) => p.fieldName === field);
  if (!item || item.newValue == null) return null;
  const d = item.newValue instanceof Date ? item.newValue : new Date(String(item.newValue));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A request row must carry ≥1 requested time (att_adj_has_request_check, mig 0061 — NOT dropped by
 * 0457). Explicit dto times win, else derive from a checkInAt/checkOutAt item, else fall back to the
 * existing record's check-in or a start-of-workday sentinel so an explanation-only request still persists.
 */
export function deriveRequestedTimes(
  workDate: string,
  opts: {
    explicitIn?: string | null;
    explicitOut?: string | null;
    proposals: AdjustmentItemProposal[];
    existingCheckIn?: Date | null;
  },
): { checkInAt: Date | null; checkOutAt: Date | null } {
  const inAt = opts.explicitIn ? new Date(opts.explicitIn) : itemDate(opts.proposals, "checkInAt");
  const outAt = opts.explicitOut
    ? new Date(opts.explicitOut)
    : itemDate(opts.proposals, "checkOutAt");
  if (inAt || outAt) return { checkInAt: inAt, checkOutAt: outAt };
  return {
    checkInAt: opts.existingCheckIn ?? new Date(`${workDate}T00:00:00.000Z`),
    checkOutAt: null,
  };
}

interface RecordCalcSource {
  checkInAt: Date | null;
  checkOutAt: Date | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workingMinutes: number | null;
  requiredWorkingMinutes: number | null;
  breakMinutes: number | null;
  missingMinutes: number | null;
  note: string | null;
}

/** attendance_records row (or absent) → the minimal view the recalc reads. Absent = a fresh record. */
export function toCalcInput(row: RecordCalcSource | undefined): RecordCalcInput {
  return {
    checkInAt: row?.checkInAt ?? null,
    checkOutAt: row?.checkOutAt ?? null,
    lateMinutes: row?.lateMinutes ?? 0,
    earlyLeaveMinutes: row?.earlyLeaveMinutes ?? 0,
    workingMinutes: row?.workingMinutes ?? null,
    requiredWorkingMinutes: row?.requiredWorkingMinutes ?? null,
    breakMinutes: row?.breakMinutes ?? null,
    missingMinutes: row?.missingMinutes ?? null,
    note: row?.note ?? null,
  };
}
