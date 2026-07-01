/**
 * S3-ATT-BE-4 — pure adjustment FSM + record-recalc logic (no I/O, fully unit-testable).
 *
 * The recalc APPLIES the approved field-changes (items[] + requested check-in/out) onto the current
 * attendance_record view and RE-DERIVES working_minutes / missing_minutes so payroll figures stay
 * consistent. It NEVER touches attendance_logs (append-only is the service's job) and NEVER deletes a
 * value — an unset field keeps its existing value. Deterministic: same inputs → same patch.
 */

import {
  computeMissingMinutes,
  computeWorkingMinutes,
  earlyLeaveMinutesFor,
  lateMinutesFor,
  type ScheduleCalc,
} from "./attendance.logic";

/** FSM canonical (DB-04 §7.6): Draft → Pending → Approved | Rejected | Cancelled (all three terminal). */
export const ADJUSTMENT_STATUS = {
  DRAFT: "Draft",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
} as const;

/** Terminal states — a decision (approve/reject/cancel) on any of these is a no-op conflict (409). */
export const ADJUSTMENT_TERMINAL_STATUSES: readonly string[] = [
  ADJUSTMENT_STATUS.APPROVED,
  ADJUSTMENT_STATUS.REJECTED,
  ADJUSTMENT_STATUS.CANCELLED,
];

/** Only a Pending request may be approved/rejected. Draft is not yet submitted; terminals are frozen. */
export function isDecidable(status: string): boolean {
  return status === ADJUSTMENT_STATUS.PENDING;
}

/** attendance_status marker written whenever an adjustment is applied (CHECK chk_*_attendance_status). */
export const ADJUSTED_ATTENDANCE_STATUS = "Adjusted";
/** legacy lowercase status column value for an adjusted record (CHECK attendance_status_check). */
export const ADJUSTED_LEGACY_STATUS = "approved_adjustment";

/** Fields a client item may set — coercion is field-typed so a jsonb primitive lands in the right column. */
const DATE_FIELDS = new Set(["checkInAt", "checkOutAt"]);
const NUMERIC_FIELDS = new Set([
  "lateMinutes",
  "earlyLeaveMinutes",
  "workingMinutes",
  "requiredWorkingMinutes",
  "missingMinutes",
]);

/** Current record view the recalc reads from (only the columns the math needs). */
export interface RecordCalcInput {
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

export interface AdjustmentItemProposal {
  fieldName: string;
  newValue: unknown;
  note?: string | null;
}

/** One append-only ledger entry (attendance_adjustment_items §7.7) — old/new/applied snapshot. */
export interface AppliedItem {
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  appliedValue: unknown;
  note: string | null;
}

/** The attendance_records column patch produced by an applied adjustment. */
export interface RecordPatch {
  checkInAt: Date | null;
  checkOutAt: Date | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workingMinutes: number | null;
  requiredWorkingMinutes: number | null;
  missingMinutes: number | null;
  note: string | null;
  status: string;
  attendanceStatus: string;
  isAdjusted: boolean;
}

export interface RecalcResult {
  patch: RecordPatch;
  appliedItems: AppliedItem[];
}

function coerceDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date value: ${String(value)}`);
  return d;
}

function coerceNumber(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0)
    throw new Error(`Invalid non-negative number: ${String(value)}`);
  return Math.trunc(n);
}

function readExisting(rec: RecordCalcInput, field: string): unknown {
  switch (field) {
    case "checkInAt":
      return rec.checkInAt;
    case "checkOutAt":
      return rec.checkOutAt;
    case "lateMinutes":
      return rec.lateMinutes;
    case "earlyLeaveMinutes":
      return rec.earlyLeaveMinutes;
    case "workingMinutes":
      return rec.workingMinutes;
    case "requiredWorkingMinutes":
      return rec.requiredWorkingMinutes;
    case "missingMinutes":
      return rec.missingMinutes;
    case "note":
      return rec.note;
    default:
      return undefined;
  }
}

type WorkingRecord = RecordCalcInput & Record<string, unknown>;

function applyField(working: WorkingRecord, field: string, value: unknown): unknown {
  if (DATE_FIELDS.has(field)) {
    const d = coerceDate(value);
    working[field] = d;
    return d;
  }
  if (NUMERIC_FIELDS.has(field)) {
    const n = coerceNumber(value);
    working[field] = n;
    return n;
  }
  // note (or any allowed string field)
  const s = value == null ? null : String(value);
  working[field] = s;
  return s;
}

/**
 * Apply the proposed items (+ optional requested check-in/out) onto `existing` and re-derive the
 * dependent minute columns. working_minutes is recomputed from the resulting check-in→check-out minus
 * break UNLESS an item set it explicitly; missing_minutes follows from working vs. required. The record
 * is marked Adjusted. Throws on an out-of-range coercion (surfaced by the caller as a 400/500).
 */
export interface RecalcOptions {
  requestedCheckInAt?: Date | null;
  requestedCheckOutAt?: Date | null;
  /** Local 'YYYY-MM-DD' of the record — required (with `schedule`) to recompute late/early. */
  workDate?: string;
  /** Work schedule for the subject user; null/absent ⇒ late/early are NOT recomputed (safe fallback). */
  schedule?: ScheduleCalc | null;
}

export function recomputeRecord(
  existing: RecordCalcInput,
  items: AdjustmentItemProposal[],
  opts: RecalcOptions = {},
): RecalcResult {
  const working: WorkingRecord = { ...existing };
  const appliedItems: AppliedItem[] = [];
  const setFields = new Set<string>();

  const proposals: AdjustmentItemProposal[] = [...items];
  if (opts.requestedCheckInAt != null && !items.some((i) => i.fieldName === "checkInAt")) {
    proposals.push({ fieldName: "checkInAt", newValue: opts.requestedCheckInAt });
  }
  if (opts.requestedCheckOutAt != null && !items.some((i) => i.fieldName === "checkOutAt")) {
    proposals.push({ fieldName: "checkOutAt", newValue: opts.requestedCheckOutAt });
  }

  for (const item of proposals) {
    const oldValue = readExisting(existing, item.fieldName);
    const applied = applyField(working, item.fieldName, item.newValue);
    setFields.add(item.fieldName);
    appliedItems.push({
      fieldName: item.fieldName,
      oldValue: normalizeLedgerValue(oldValue),
      newValue: normalizeLedgerValue(item.newValue),
      appliedValue: normalizeLedgerValue(applied),
      note: item.note ?? null,
    });
  }

  recomputeLateEarly(working, setFields, opts);

  // Re-derive working_minutes unless the caller pinned it explicitly.
  if (!setFields.has("workingMinutes") && working.checkInAt && working.checkOutAt) {
    working.workingMinutes = computeWorkingMinutes(
      working.checkInAt,
      working.checkOutAt,
      working.breakMinutes ?? 0,
    );
  }
  // Re-derive missing_minutes unless pinned.
  if (!setFields.has("missingMinutes")) {
    working.missingMinutes = computeMissingMinutes(
      working.requiredWorkingMinutes,
      working.workingMinutes ?? 0,
    );
  }

  return {
    patch: {
      checkInAt: working.checkInAt,
      checkOutAt: working.checkOutAt,
      lateMinutes: working.lateMinutes,
      earlyLeaveMinutes: working.earlyLeaveMinutes,
      workingMinutes: working.workingMinutes,
      requiredWorkingMinutes: working.requiredWorkingMinutes,
      missingMinutes: working.missingMinutes,
      note: working.note,
      status: ADJUSTED_LEGACY_STATUS,
      attendanceStatus: ADJUSTED_ATTENDANCE_STATUS,
      isAdjusted: true,
    },
    appliedItems,
  };
}

/**
 * Recompute lateMinutes/earlyLeaveMinutes from the schedule when the corresponding check-in/out was
 * adjusted — otherwise the stored figure goes stale (a UPDATE_CHECK_IN would leave the OLD lateness).
 * Only recomputes when: a schedule + workDate are supplied, the check-in/out field was actually set in
 * THIS adjustment, and the client did NOT pin the minute field explicitly. Missing schedule ⇒ no-op
 * (the caller logs a warning and keeps the stored value — a safe fallback, never a swallowed error).
 */
function recomputeLateEarly(
  working: WorkingRecord,
  setFields: Set<string>,
  opts: RecalcOptions,
): void {
  const { schedule, workDate } = opts;
  if (!schedule || !workDate) return;

  if (setFields.has("checkInAt") && !setFields.has("lateMinutes") && working.checkInAt) {
    working.lateMinutes = lateMinutesFor(working.checkInAt, workDate, schedule);
  }
  if (setFields.has("checkOutAt") && !setFields.has("earlyLeaveMinutes") && working.checkOutAt) {
    working.earlyLeaveMinutes = earlyLeaveMinutesFor(working.checkOutAt, workDate, schedule);
  }
}

/** jsonb-safe snapshot: Date → ISO string, everything else passthrough (primitives only reach here). */
function normalizeLedgerValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}
