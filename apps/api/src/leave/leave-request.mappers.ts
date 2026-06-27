import type {
  LeaveRequestApprovalView,
  LeaveRequestDayView,
  LeaveRequestDetailView,
  LeaveRequestListItemView,
} from "@mediaos/contracts";
import {
  numOrNull,
  type LeaveRequestApprovalRow,
  type LeaveRequestDayRow,
  type LeaveRequestRow,
  type LeaveTypeRow,
} from "./leave-request.logic";

/**
 * S3-LEAVE-BE-2 — row → DTO view mappers for the LEAVE request workflow. snake_case DB rows → camelCase
 * FE views; numeric strings → numbers; Date → ISO string. No I/O.
 */

/** Shape of a row from listOwnRequestsTx (subset of leave_requests + leave_type join). */
export interface ListItemRow {
  id: string;
  leaveTypeId: string;
  leaveTypeCode: string | null;
  leaveTypeName: string | null;
  startDate: string;
  endDate: string;
  durationType: string | null;
  totalDays: string;
  totalHours: string | null;
  status: string;
  reason: string | null;
  balanceEffectStatus: string | null;
  submittedAt: Date | null;
  createdAt: Date;
}

export function toListItemView(row: ListItemRow): LeaveRequestListItemView {
  return {
    id: row.id,
    leaveTypeId: row.leaveTypeId,
    leaveTypeCode: row.leaveTypeCode,
    leaveTypeName: row.leaveTypeName,
    startDate: row.startDate,
    endDate: row.endDate,
    durationType: row.durationType,
    totalDays: Number(row.totalDays),
    totalHours: numOrNull(row.totalHours),
    status: row.status,
    reason: row.reason,
    balanceEffectStatus: row.balanceEffectStatus,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toDayView(row: LeaveRequestDayRow): LeaveRequestDayView {
  return {
    id: row.id,
    workDate: row.workDate,
    dayType: row.dayType,
    halfDaySession: row.halfDaySession,
    startTime: row.startTime,
    endTime: row.endTime,
    leaveDays: Number(row.leaveDays),
    leaveHours: Number(row.leaveHours),
    leaveMinutes: row.leaveMinutes,
    isWorkingDay: row.isWorkingDay,
    isPublicHoliday: row.isPublicHoliday,
    status: row.status,
  };
}

export function toApprovalView(row: LeaveRequestApprovalRow): LeaveRequestApprovalView {
  return {
    id: row.id,
    approvalStep: row.approvalStep,
    action: row.action,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    comment: row.comment,
    approverUserId: row.approverUserId,
    actedAt: row.actedAt.toISOString(),
  };
}

export function toDetailView(
  request: LeaveRequestRow,
  type: LeaveTypeRow | null,
  days: LeaveRequestDayRow[],
  approvals: LeaveRequestApprovalRow[],
): LeaveRequestDetailView {
  return {
    id: request.id,
    leaveTypeId: request.leaveTypeId,
    leaveTypeCode: type?.code ?? null,
    leaveTypeName: type?.name ?? null,
    startDate: request.startDate,
    endDate: request.endDate,
    durationType: request.durationType,
    totalDays: Number(request.totalDays),
    totalHours: numOrNull(request.totalHours),
    status: request.status,
    reason: request.reason,
    balanceEffectStatus: request.balanceEffectStatus,
    submittedAt: request.submittedAt ? request.submittedAt.toISOString() : null,
    createdAt: request.createdAt.toISOString(),
    employeeId: request.employeeId,
    leavePolicyId: request.leavePolicyId,
    halfDaySession: request.halfDaySession,
    startTime: request.startTime,
    endTime: request.endTime,
    handoverNote: request.handoverNote,
    contactDuringLeave: request.contactDuringLeave,
    cancelReason: request.cancelReason,
    cancelledAt: request.cancelledAt ? request.cancelledAt.toISOString() : null,
    days: days.map(toDayView),
    approvals: approvals.map(toApprovalView),
  };
}
