/**
 * S3-ATT-BE-1 — pure value-object builders for attendance DB writes.
 *
 * Extracted from attendance.service.ts (behavior-preserving): each builder takes already-resolved
 * inputs (actor/employee/shift/rule + server `now`/snapshot) and returns the plain insert/update
 * shape — no `this`, no DB, no injected deps. The service composes these inside `withTenant`.
 */

import type { CheckInRequest, CheckOutRequest } from "@mediaos/contracts";
import {
  type CheckOutTitleStatus,
  type DerivedStatus,
  checkInTitleStatus,
  deriveAttendanceStatus,
  earlyLeaveMinutesFor,
  lateMinutesFor,
} from "./attendance.logic";
import { toScheduleCalc } from "./attendance.mappers";
import type {
  Actor,
  AttendanceLogInsert,
  EffectiveRule,
  ResolvedEmployee,
  ScheduleRow,
  ShiftRow,
} from "./attendance.types";

/** method (web/mobile) → attendance source enum (WEB/MOBILE) — CHECK chk_*_source. */
function methodToSource(method: string): "WEB" | "MOBILE" {
  return method === "mobile" ? "MOBILE" : "WEB";
}

/** Giá trị ghi attendance_records lúc check-in (cột legacy + DB-04 §7.4 additive). */
export function buildCheckInValues(
  actor: Actor,
  employee: ResolvedEmployee,
  shift: ShiftRow | null,
  rule: EffectiveRule,
  tz: string,
  now: Date,
  dto: CheckInRequest,
  lateMinutes: number,
) {
  const isLate = lateMinutes > 0;
  return {
    // ── legacy (KEEP — user_id NOT NULL ⇒ live 0-dup unique attendance_records_company_user_date_uq) ──
    checkInAt: now,
    checkInMethod: dto.method,
    locationJson: dto.location ?? null,
    lateMinutes,
    earlyLeaveMinutes: 0,
    status: deriveAttendanceStatus(lateMinutes, 0),
    // ── DB-04 §7.4 additive (nullable) ──
    employeeId: employee.id,
    departmentId: employee.orgUnitId,
    positionId: employee.positionId,
    shiftId: shift?.id ?? null,
    appliedRuleId: rule.id,
    requiredWorkingMinutes: shift?.requiredWorkingMinutes ?? null,
    breakMinutes: shift?.breakMinutes ?? null,
    attendanceStatus: checkInTitleStatus(isLate),
    attendanceSource: methodToSource(dto.method),
    workMode: "Office",
    isLate,
    isEarlyLeave: false,
    isMissingCheckIn: false,
    isMissingCheckOut: true,
    calculationSnapshot: {
      tz,
      shiftId: shift?.id ?? null,
      shiftCode: shift?.shiftCode ?? null,
      startTime: shift?.startTime ?? null,
      graceLateMinutes: shift?.graceLateMinutes ?? null,
      lateMinutes,
      ruleId: rule.id,
      checkInAt: now.toISOString(),
    },
    updatedBy: actor.id,
  };
}

/** Giá trị cập nhật attendance_records lúc check-out (legacy status + DB-04 §7.4 + snapshot). */
export function buildCheckOutValues(
  actor: Actor,
  shift: ShiftRow | null,
  tz: string,
  now: Date,
  dto: CheckOutRequest,
  calc: {
    earlyLeaveMinutes: number;
    workingMinutes: number;
    missingMinutes: number;
    requiredWorkingMinutes: number | null;
    legacyStatus: DerivedStatus;
    attendanceStatus: CheckOutTitleStatus;
  },
) {
  const { earlyLeaveMinutes, workingMinutes, missingMinutes, requiredWorkingMinutes } = calc;
  return {
    checkOutAt: now,
    checkOutMethod: dto.method,
    earlyLeaveMinutes,
    status: calc.legacyStatus,
    workingMinutes,
    missingMinutes,
    attendanceStatus: calc.attendanceStatus,
    isEarlyLeave: earlyLeaveMinutes > 0,
    isMissingCheckOut: false,
    calculationSnapshot: {
      tz,
      shiftId: shift?.id ?? null,
      endTime: shift?.endTime ?? null,
      earlyLeaveMinutes,
      workingMinutes,
      requiredWorkingMinutes,
      missingMinutes,
      checkOutAt: now.toISOString(),
    },
    updatedBy: actor.id,
  };
}

/** attendance_logs APPEND-ONLY row: server-time (logTime DEFAULT now()); client_time = tham chiếu. */
export function buildLog(
  actor: Actor,
  employee: ResolvedEmployee,
  recordId: string,
  workDate: string,
  logType: "Check-in" | "Check-out",
  dto: CheckInRequest | CheckOutRequest,
): AttendanceLogInsert {
  return {
    attendanceRecordId: recordId,
    employeeId: employee.id,
    userId: actor.id,
    workDate,
    logType,
    clientTime: dto.clientTime ? new Date(dto.clientTime) : null,
    clientTimezone: dto.clientTimezone ?? null,
    source: methodToSource(dto.method),
    gpsLatitude: dto.location ? String(dto.location.lat) : null,
    gpsLongitude: dto.location ? String(dto.location.lng) : null,
    locationLabel: dto.location?.label ?? null,
    isValid: true,
    note: dto.note ?? null,
    createdBy: actor.id,
  };
}

/** audit `after` cho attendance.check_in (server-time + status title). */
export function buildCheckInAudit(
  workDate: string,
  now: Date,
  lateMinutes: number,
  isLate: boolean,
  method: string,
) {
  return {
    workDate,
    checkInAt: now,
    lateMinutes,
    attendanceStatus: checkInTitleStatus(isLate),
    method,
  };
}

/** audit `after` cho attendance.check_out (đọc từ calc đã tính ở check-out). */
export function buildCheckOutAudit(
  workDate: string,
  now: Date,
  method: string,
  calc: {
    earlyLeaveMinutes: number;
    workingMinutes: number;
    missingMinutes: number;
    attendanceStatus: CheckOutTitleStatus;
  },
) {
  return {
    workDate,
    checkOutAt: now,
    earlyLeaveMinutes: calc.earlyLeaveMinutes,
    workingMinutes: calc.workingMinutes,
    missingMinutes: calc.missingMinutes,
    attendanceStatus: calc.attendanceStatus,
    method,
  };
}

/** outbox payload cho attendance.checked_in / checked_out (cùng shape). */
export function buildAttendanceEvent(
  recordId: string,
  actor: Actor,
  employee: ResolvedEmployee,
  workDate: string,
  status: DerivedStatus,
) {
  return {
    recordId,
    userId: actor.id,
    employeeId: employee.id,
    workDate,
    status,
  };
}

/** Giá trị áp vào attendance_records khi duyệt đơn bổ sung công (requested ≻ existing). */
export function buildAdjustmentRecordValues(
  request: {
    requestedCheckInAt: Date | null;
    requestedCheckOutAt: Date | null;
    workDate: string;
  },
  existing:
    | {
        checkInAt: Date | null;
        checkOutAt: Date | null;
        checkInMethod: string | null;
        checkOutMethod: string | null;
        workScheduleId: string | null;
      }
    | undefined,
  schedule: ScheduleRow | null,
) {
  const calc = schedule ? toScheduleCalc(schedule) : null;
  const checkInAt = request.requestedCheckInAt ?? existing?.checkInAt ?? null;
  const checkOutAt = request.requestedCheckOutAt ?? existing?.checkOutAt ?? null;
  const lateMinutes = calc && checkInAt ? lateMinutesFor(checkInAt, request.workDate, calc) : 0;
  const earlyLeaveMinutes =
    calc && checkOutAt ? earlyLeaveMinutesFor(checkOutAt, request.workDate, calc) : 0;
  return {
    checkInAt,
    checkOutAt,
    checkInMethod: request.requestedCheckInAt ? "adjustment" : (existing?.checkInMethod ?? null),
    checkOutMethod: request.requestedCheckOutAt ? "adjustment" : (existing?.checkOutMethod ?? null),
    lateMinutes,
    earlyLeaveMinutes,
    status: "approved_adjustment" as const,
    workScheduleId: schedule?.id ?? existing?.workScheduleId ?? null,
  };
}
