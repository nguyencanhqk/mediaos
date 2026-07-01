/**
 * S3-ATT-BE-1 — pure DTO mappers / projection builders for attendance.
 *
 * Extracted verbatim from attendance.service.ts (behavior-preserving): every function here is pure
 * (no `this`, no DB, no injected deps) — it shapes resolved rows into REST/WS DTOs or calc inputs.
 * Date → JSON ISO is handled by the serializer.
 */

import { monthOfDate } from "../common/tz.util";
import type { ScheduleCalc, ShiftCalc } from "./attendance.logic";
import {
  DEFAULT_TZ,
  type EffectiveRule,
  type RecordRowForDto,
  type ResolvedEmployee,
  type ScheduleRow,
  type ShiftRow,
} from "./attendance.types";

export function toScheduleDto(row: ScheduleRow) {
  return {
    id: row.id,
    name: row.name,
    workType: row.workType,
    startTime: row.startTime,
    endTime: row.endTime,
    workingDays: row.workingDaysJson,
    timezone: row.timezone,
    graceMinutes: row.graceMinutes,
    isDefault: row.isDefault,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toScheduleCalc(row: ScheduleRow): ScheduleCalc {
  return {
    startTime: row.startTime,
    endTime: row.endTime,
    graceMinutes: row.graceMinutes,
    timezone: row.timezone,
    workingDays: row.workingDaysJson,
  };
}

/** Đọc tz từ shift.metadata.timezone (jsonb), fallback DEFAULT_TZ. */
export function shiftTimezone(shift: ShiftRow | null): string {
  const meta = shift?.metadata;
  if (meta && typeof meta === "object" && "timezone" in meta) {
    const tz = (meta as { timezone?: unknown }).timezone;
    if (typeof tz === "string" && tz.length > 0) return tz;
  }
  return DEFAULT_TZ;
}

/** ShiftRow → ShiftCalc (chỉ field math cần). */
export function toShiftCalc(shift: ShiftRow, tz: string): ShiftCalc {
  return {
    startTime: shift.startTime,
    endTime: shift.endTime,
    graceLateMinutes: shift.graceLateMinutes,
    graceEarlyLeaveMinutes: shift.graceEarlyLeaveMinutes,
    breakMinutes: shift.breakMinutes,
    crossDay: shift.crossDay,
    timezone: tz,
  };
}

/** Chuẩn hoá rule row → EffectiveRule (block_when_leave_approved default true khi thiếu). */
export function toEffectiveRule(row: {
  id: string;
  ruleCode: string;
  requireCheckIn: boolean;
  requireCheckOut: boolean;
  ruleConfig: unknown;
}): EffectiveRule {
  const cfg = (row.ruleConfig ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    ruleCode: row.ruleCode,
    requireCheckIn: row.requireCheckIn,
    requireCheckOut: row.requireCheckOut,
    blockWhenLeaveApproved: cfg["block_when_leave_approved"] !== false,
  };
}

export function toRecordV2Dto(row: RecordRowForDto) {
  return {
    id: row.id,
    workDate: row.workDate,
    employeeId: row.employeeId ?? null,
    shiftId: row.shiftId ?? null,
    checkInAt: row.checkInAt,
    checkOutAt: row.checkOutAt,
    checkInMethod: row.checkInMethod,
    checkOutMethod: row.checkOutMethod,
    lateMinutes: row.lateMinutes,
    earlyLeaveMinutes: row.earlyLeaveMinutes,
    workingMinutes: row.workingMinutes ?? null,
    requiredWorkingMinutes: row.requiredWorkingMinutes ?? null,
    missingMinutes: row.missingMinutes ?? null,
    breakMinutes: row.breakMinutes ?? null,
    status: row.status,
    attendanceStatus: row.attendanceStatus ?? null,
    isLate: row.isLate ?? null,
    isEarlyLeave: row.isEarlyLeave ?? null,
    isMissingCheckOut: row.isMissingCheckOut ?? null,
  };
}

function toShiftSummary(shift: ShiftRow, tz: string) {
  return {
    id: shift.id,
    shiftCode: shift.shiftCode,
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    breakMinutes: shift.breakMinutes,
    requiredWorkingMinutes: shift.requiredWorkingMinutes,
    graceLateMinutes: shift.graceLateMinutes,
    graceEarlyLeaveMinutes: shift.graceEarlyLeaveMinutes,
    crossDay: shift.crossDay,
    isDefault: shift.isDefault,
    timezone: tz,
  };
}

function toRuleSummary(rule: EffectiveRule) {
  return {
    id: rule.id,
    ruleCode: rule.ruleCode,
    requireCheckIn: rule.requireCheckIn,
    requireCheckOut: rule.requireCheckOut,
    blockWhenLeaveApproved: rule.blockWhenLeaveApproved,
  };
}

/** Today khi không có employee mapping (KHÔNG throw — màn hình hiển thị lý do). */
export function emptyToday(workDate: string, reason: string) {
  return {
    workDate,
    employee: null,
    shift: null,
    rule: null,
    record: null,
    allowedActions: { canCheckIn: false, canCheckOut: false },
    disabledReason: reason,
    periodLocked: false,
  };
}

function todayDisabledReason(args: {
  active: boolean;
  onLeave: boolean;
  periodLocked: boolean;
  checkedOut: boolean;
  workDate: string;
}): string | null {
  if (!args.active) return "Hồ sơ nhân sự không ở trạng thái làm việc — không thể chấm công";
  if (args.onLeave) return `Đã có đơn nghỉ được duyệt cho ngày ${args.workDate}`;
  if (args.periodLocked) return `Kỳ công ${monthOfDate(args.workDate)} đã khoá`;
  if (args.checkedOut) return "Đã hoàn tất chấm công hôm nay";
  return null;
}

export function buildTodayDto(args: {
  workDate: string;
  employee: ResolvedEmployee;
  shift: ShiftRow | null;
  rule: EffectiveRule;
  tz: string;
  record: RecordRowForDto | null;
  periodLocked: boolean;
  onLeave: boolean;
}) {
  const { workDate, employee, shift, rule, tz, record, periodLocked, onLeave } = args;
  const active = employee.status === "active";
  const checkedIn = Boolean(record?.checkInAt);
  const checkedOut = Boolean(record?.checkOutAt);
  return {
    workDate,
    employee: { id: employee.id, status: employee.status },
    shift: shift ? toShiftSummary(shift, tz) : null,
    rule: toRuleSummary(rule),
    record: record ? toRecordV2Dto(record) : null,
    allowedActions: {
      canCheckIn: active && !periodLocked && !onLeave && !checkedIn,
      canCheckOut: active && !periodLocked && !onLeave && checkedIn && !checkedOut,
    },
    disabledReason: todayDisabledReason({ active, onLeave, periodLocked, checkedOut, workDate }),
    periodLocked,
  };
}

export function toPeriodDto(row: {
  id: string;
  periodMonth: string;
  status: string;
  lockedBy: string | null;
  lockedAt: Date | null;
}) {
  return {
    id: row.id,
    periodMonth: row.periodMonth,
    status: row.status,
    lockedBy: row.lockedBy,
    lockedAt: row.lockedAt,
  };
}
