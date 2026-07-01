/**
 * S3-ATT-BE-3 — pure DTO mappers for the shift/rule/assignment CRUD surface (DB-04 §7.1/7.2/7.3).
 * Extracted into its own file (feature split from attendance.mappers.ts, which owns the
 * check-in/out/today shapes) — no `this`, no DB, no injected deps.
 */

import type { AttendanceRule, Shift, ShiftAssignment } from "../db/schema/attendance";

export function toShiftDto(row: Shift) {
  return {
    id: row.id,
    shiftCode: row.shiftCode,
    name: row.name,
    description: row.description,
    shiftType: row.shiftType,
    startTime: row.startTime,
    endTime: row.endTime,
    breakStartTime: row.breakStartTime,
    breakEndTime: row.breakEndTime,
    breakMinutes: row.breakMinutes,
    requiredWorkingMinutes: row.requiredWorkingMinutes,
    flexibleCheckInFrom: row.flexibleCheckInFrom,
    flexibleCheckInTo: row.flexibleCheckInTo,
    graceLateMinutes: row.graceLateMinutes,
    graceEarlyLeaveMinutes: row.graceEarlyLeaveMinutes,
    allowEarlyCheckIn: row.allowEarlyCheckIn,
    allowLateCheckOut: row.allowLateCheckOut,
    crossDay: row.crossDay,
    workDays: row.workDays ?? null,
    status: row.status,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toRuleDto(row: AttendanceRule) {
  return {
    id: row.id,
    ruleCode: row.ruleCode,
    name: row.name,
    description: row.description,
    ruleScope: row.ruleScope,
    departmentId: row.departmentId,
    employeeId: row.employeeId,
    priority: row.priority,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    requireCheckIn: row.requireCheckIn,
    requireCheckOut: row.requireCheckOut,
    allowWebCheckIn: row.allowWebCheckIn,
    allowMobileCheckIn: row.allowMobileCheckIn,
    allowRemoteCheckIn: row.allowRemoteCheckIn,
    allowAdjustmentRequest: row.allowAdjustmentRequest,
    requireGps: row.requireGps,
    requireNote: row.requireNote,
    requirePhoto: row.requirePhoto,
    allowHolidayAttendance: row.allowHolidayAttendance,
    allowWeekendAttendance: row.allowWeekendAttendance,
    autoAttendanceEnabled: row.autoAttendanceEnabled,
    autoCheckOutEnabled: row.autoCheckOutEnabled,
    autoAttendanceWorkingMinutes: row.autoAttendanceWorkingMinutes,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toShiftAssignmentDto(row: ShiftAssignment) {
  return {
    id: row.id,
    shiftId: row.shiftId,
    assignmentScope: row.assignmentScope,
    departmentId: row.departmentId,
    employeeId: row.employeeId,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    priority: row.priority,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
