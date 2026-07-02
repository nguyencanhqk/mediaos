/**
 * S3-ATT-BE-5 — pure DTO mapper for the remote-work-request surface (no `this`, no DB). Mirrors
 * attendance-adjustment.mappers.ts.
 */

import type { RemoteWorkRequestDetail } from "@mediaos/contracts";

/** A joined request row (repo REQUEST_COLUMNS) — untyped columns coerced at the mapper boundary. */
type RequestRow = Record<string, unknown>;

function asString(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}
function asNullableString(v: unknown): string | null {
  return v == null ? null : asString(v);
}
function asWatcherIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function toRemoteWorkRequestDetail(row: RequestRow): RemoteWorkRequestDetail {
  return {
    id: asString(row.id),
    requestCode: asNullableString(row.requestCode),
    employeeId: asNullableString(row.employeeId),
    employeeCode: asNullableString(row.employeeCode),
    fullName: asNullableString(row.fullName),
    requestType: asString(row.requestType) as RemoteWorkRequestDetail["requestType"],
    startDate: asString(row.startDate),
    endDate: asString(row.endDate),
    startTime: asNullableString(row.startTime),
    endTime: asNullableString(row.endTime),
    attendanceMode: asString(row.attendanceMode) as RemoteWorkRequestDetail["attendanceMode"],
    locationText: asNullableString(row.locationText),
    reason: asString(row.reason),
    taskId: asNullableString(row.taskId),
    projectId: asNullableString(row.projectId),
    status: asString(row.status) as RemoteWorkRequestDetail["status"],
    submittedAt: row.submittedAt as string | null,
    requestedBy: asNullableString(row.requestedBy),
    currentApproverUserId: asNullableString(row.currentApproverUserId),
    watcherUserIds: asWatcherIds(row.watcherUserIds),
    approvedBy: asNullableString(row.approvedBy),
    approvedAt: row.approvedAt as string | null,
    rejectedBy: asNullableString(row.rejectedBy),
    rejectedAt: row.rejectedAt as string | null,
    rejectReason: asNullableString(row.rejectReason),
    cancelledAt: row.cancelledAt as string | null,
    cancelledBy: asNullableString(row.cancelledBy),
    attachmentFileId: asNullableString(row.attachmentFileId),
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export function toRemoteWorkRequestListItem(row: RequestRow): RemoteWorkRequestDetail {
  return toRemoteWorkRequestDetail(row);
}
