/**
 * S3-ATT-BE-2 — pure DTO mappers for scoped attendance records + logs.
 *
 * Every function is pure (no `this`, no DB, no injected deps): it shapes a resolved row into a REST DTO
 * and applies the SERVER-side mask. Masking is a single page-uniform `revealSensitive` decision passed
 * in by the service (one PermissionService.can() per request, never per-row) — mirrors HrReadService.
 * Date → JSON ISO is handled by the serializer (same as attendance.mappers.toRecordV2Dto).
 */

import type {
  AttendanceLogListItem,
  AttendanceRecordDetail,
  AttendanceRecordListItem,
} from "@mediaos/contracts";
import { toRecordV2Dto } from "./attendance.mappers";
import type { AttLogRow, AttRecordDetailRow, AttRecordListRow } from "./attendance-read.repository";

/** List item = safe V2 record fields + employee summary. NEVER carries location/gps/ip/device. */
export function toAttendanceRecordListItem(row: AttRecordListRow): AttendanceRecordListItem {
  return {
    ...toRecordV2Dto(row),
    userId: row.userId,
    employeeCode: row.employeeCode ?? null,
    fullName: row.fullName ?? null,
    orgUnitId: row.orgUnitId ?? null,
    orgUnitName: row.orgUnitName ?? null,
  } as AttendanceRecordListItem;
}

/**
 * Detail = list item + the record-only `location_json` gated behind view-sensitive (null when not
 * revealed) + extra status/source/timestamp columns. No own-record bypass: the same gate as everyone.
 */
export function toAttendanceRecordDetail(
  row: AttRecordDetailRow,
  revealSensitive: boolean,
): AttendanceRecordDetail {
  return {
    ...toAttendanceRecordListItem(row),
    locationJson: revealSensitive ? (row.locationJson ?? null) : null,
    workScheduleId: row.workScheduleId ?? null,
    checkInStatus: row.checkInStatus ?? null,
    checkOutStatus: row.checkOutStatus ?? null,
    attendanceSource: row.attendanceSource ?? null,
    workMode: row.workMode ?? null,
    createdAt: row.createdAt as unknown as string,
    updatedAt: row.updatedAt as unknown as string,
  };
}

/**
 * Log item — always-safe fields kept; sensitive fields (gps/ip/device/locationLabel/userAgent/
 * rawPayload) nulled unless `revealSensitive`. `isValid` is ALWAYS present (an employee viewing their
 * own logs sees validity but never the gps — no own-record bypass, BẤT BIẾN #3).
 */
export function toAttendanceLogListItem(
  row: AttLogRow,
  revealSensitive: boolean,
): AttendanceLogListItem {
  return {
    id: row.id,
    logType: row.logType,
    logTime: row.logTime as unknown as string,
    source: row.source,
    platform: row.platform ?? null,
    clientTime: (row.clientTime as unknown as string) ?? null,
    clientTimezone: row.clientTimezone ?? null,
    isValid: row.isValid,
    invalidReason: row.invalidReason ?? null,
    note: row.note ?? null,
    workDate: row.workDate,
    // SENSITIVE — null unless view-sensitive:attendance.
    gpsLatitude: revealSensitive ? (row.gpsLatitude ?? null) : null,
    gpsLongitude: revealSensitive ? (row.gpsLongitude ?? null) : null,
    gpsAccuracyMeters: revealSensitive ? (row.gpsAccuracyMeters ?? null) : null,
    locationLabel: revealSensitive ? (row.locationLabel ?? null) : null,
    ipAddress: revealSensitive ? (row.ipAddress ?? null) : null,
    deviceId: revealSensitive ? (row.deviceId ?? null) : null,
    deviceName: revealSensitive ? (row.deviceName ?? null) : null,
    userAgent: revealSensitive ? (row.userAgent ?? null) : null,
    rawPayload: revealSensitive ? (row.rawPayload ?? null) : null,
  };
}
