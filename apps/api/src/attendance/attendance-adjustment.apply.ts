/**
 * S3-ATT-BE-4 — apply/derive builders + audit/outbox emitters extracted from AttendanceAdjustmentService
 * so the service file stays <800 lines and each method <50 lines (CLAUDE.md §5). The builders are pure
 * (no `this`, deterministic transforms over the recalc patch/request context); the emitters take the
 * append-only sinks explicitly and always run inside the caller's withTenant tx (never open their own).
 * Tested transitively via the adjustment logic + integration specs.
 */

import type { TenantTx } from "../db/db.service";
import type { AuditService } from "../events/audit.service";
import type { OutboxService } from "../events/outbox.service";
import type { ScheduleCalc } from "./attendance.logic";
import type {
  AdjustmentItemProposal,
  AppliedItem,
  RecordPatch,
} from "./attendance-adjustment.logic";

/** A work_schedules row (only the columns the recalc math reads). */
export interface ScheduleRow {
  startTime: string;
  endTime: string;
  graceMinutes: number;
  timezone: string;
  workingDaysJson: number[];
}

/** Map a work_schedules row → the pure ScheduleCalc the late/early recompute reads. */
export function toScheduleCalc(row: ScheduleRow): ScheduleCalc {
  return {
    startTime: row.startTime,
    endTime: row.endTime,
    graceMinutes: row.graceMinutes,
    timezone: row.timezone,
    workingDays: row.workingDaysJson,
  };
}

/** The check-in/out method view of the current record (kept unless the field is being adjusted). */
export interface RecordMethods {
  checkInMethod?: string | null;
  checkOutMethod?: string | null;
}

/** Owner context threaded into every persisted row (tenant + subject employee + actor). */
export interface ApplyContext {
  companyId: string;
  employeeId: string;
  departmentId: string | null;
  actorId: string;
  requestId: string;
}

/** attendance_records column values from a recalc patch — check-in/out method flips to 'adjustment'. */
export function buildRecordValues(
  patch: RecordPatch,
  existing: RecordMethods | undefined,
  ctx: Pick<ApplyContext, "employeeId" | "departmentId" | "actorId">,
) {
  return {
    ...patch,
    checkInMethod: patch.checkInAt ? "adjustment" : (existing?.checkInMethod ?? null),
    checkOutMethod: patch.checkOutAt ? "adjustment" : (existing?.checkOutMethod ?? null),
    employeeId: ctx.employeeId,
    departmentId: ctx.departmentId,
    updatedBy: ctx.actorId,
  };
}

/** append-only attendance_adjustment_items rows (is_applied=true) from the applied ledger entries. */
export function buildAppliedItemRows(
  appliedItems: AppliedItem[],
  ctx: Pick<ApplyContext, "companyId" | "requestId" | "actorId">,
) {
  return appliedItems.map((item) => ({
    companyId: ctx.companyId,
    requestId: ctx.requestId,
    fieldName: item.fieldName,
    oldValue: item.oldValue,
    newValue: item.newValue,
    appliedValue: item.appliedValue,
    isApplied: true,
    note: item.note,
    createdBy: ctx.actorId,
  }));
}

/** dto.items[] → field-change proposals (drops the create/direct DTO wrapping). */
export function toProposals(
  items: ReadonlyArray<{ fieldName: string; newValue: unknown; note?: string | null }> | undefined,
): AdjustmentItemProposal[] {
  return (items ?? []).map((i) => ({
    fieldName: i.fieldName,
    newValue: i.newValue,
    note: i.note,
  }));
}

/** create-time proposal ledger rows (is_applied=false — the not-yet-applied snapshot). */
export function buildProposalRows(
  requestId: string,
  proposals: AdjustmentItemProposal[],
  isApplied: boolean,
  actorId: string,
) {
  return proposals.map((p) => ({
    requestId,
    fieldName: p.fieldName,
    oldValue: null,
    newValue: p.newValue,
    appliedValue: null,
    isApplied,
    note: p.note ?? null,
    createdBy: actorId,
  }));
}

// ─── audit + outbox emitters (one-shot, always inside the caller's withTenant tx) ────────────────

/** The two append-only sinks every important adjustment action writes to (SPEC-01 §16.3). */
export interface EventSinks {
  audit: AuditService;
  outbox: OutboxService;
}

/** AttendanceAdjustmentRequested audit + attendance.adjustment_requested outbox (create path). */
export async function emitAdjustmentRequested(
  sinks: EventSinks,
  tx: TenantTx,
  p: {
    requestId: string;
    employeeId: string;
    userId: string;
    workDate: string;
    requestType: string;
    taskId: string;
    actorId: string;
    onBehalf: boolean;
  },
): Promise<void> {
  await sinks.audit.record(tx, {
    action: "AttendanceAdjustmentRequested",
    objectType: "attendance_adjustment_request",
    objectId: p.requestId,
    actorUserId: p.actorId,
    after: {
      employeeId: p.employeeId,
      workDate: p.workDate,
      requestType: p.requestType,
      onBehalf: p.onBehalf,
    },
  });
  await sinks.outbox.enqueue(tx, {
    eventType: "attendance.adjustment_requested",
    payload: {
      requestId: p.requestId,
      employeeId: p.employeeId,
      userId: p.userId,
      workDate: p.workDate,
      requestType: p.requestType,
      taskId: p.taskId,
      // S4-INT-4: actor for engine actor-exclusion (recipient resolver drops actorUserId).
      actorUserId: p.actorId,
    },
  });
}

/** AttendanceAdjustmentApproved + AttendanceRecordAdjusted audit + adjustment_approved outbox (approve). */
export async function emitAdjustmentApproved(
  sinks: EventSinks,
  tx: TenantTx,
  p: { requestId: string; recordId: string; userId: string; workDate: string; actorId: string },
): Promise<void> {
  await sinks.audit.record(tx, {
    action: "AttendanceAdjustmentApproved",
    objectType: "attendance_adjustment_request",
    objectId: p.requestId,
    actorUserId: p.actorId,
    after: { recordId: p.recordId, workDate: p.workDate },
  });
  await sinks.audit.record(tx, {
    action: "AttendanceRecordAdjusted",
    objectType: "attendance_record",
    objectId: p.recordId,
    actorUserId: p.actorId,
    after: { fromRequestId: p.requestId, workDate: p.workDate },
  });
  await sinks.outbox.enqueue(tx, {
    eventType: "attendance.adjustment_approved",
    payload: {
      requestId: p.requestId,
      recordId: p.recordId,
      userId: p.userId,
      approvedBy: p.actorId,
      // S4-INT-4: actor for engine actor-exclusion (recipient resolver drops actorUserId).
      actorUserId: p.actorId,
    },
  });
}

/** AttendanceRecordAdjusted audit + attendance.record_adjusted outbox (adjust-direct path). */
export async function emitRecordAdjustedDirect(
  sinks: EventSinks,
  tx: TenantTx,
  p: { recordId: string; requestId: string; userId: string; workDate: string; actorId: string },
): Promise<void> {
  await sinks.audit.record(tx, {
    action: "AttendanceRecordAdjusted",
    objectType: "attendance_record",
    objectId: p.recordId,
    actorUserId: p.actorId,
    after: { fromRequestId: p.requestId, workDate: p.workDate, direct: true },
  });
  await sinks.outbox.enqueue(tx, {
    eventType: "attendance.record_adjusted",
    payload: {
      requestId: p.requestId,
      recordId: p.recordId,
      userId: p.userId,
      adjustedBy: p.actorId,
    },
  });
}
