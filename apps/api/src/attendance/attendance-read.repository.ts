import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { AttendanceRecordSortField } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { attendanceLogs, attendanceRecords, employeeProfiles, orgUnits, users } from "../db/schema";
import type { RecordRowForDto } from "./attendance.types";

/**
 * S3-ATT-BE-2 — read-only repository for scoped attendance records + logs.
 *
 * Every method runs inside the caller's tenant tx (withTenant → RLS+FORCE, BẤT BIẾN #1) and ANDs an
 * explicit company_id (defense-in-depth over RLS). It SELECTs only — NO UPDATE/DELETE.
 *
 * KEY (plan): attendance_records is keyed by user_id, but DataScopeService.buildEmployeeScopeCondition
 * references employee_profiles columns. So the list/detail queries INNER JOIN employee_profiles ON
 * (user_id + company_id, deleted_at IS NULL) and AND the scope predicate there. The employee summary
 * (employeeCode/fullName/orgUnitName) and the Department/Team in-scope columns all come from that join —
 * NEVER from attendance_records.department_id (nullable, not backfilled).
 *
 * No N+1: one page query + one count query, both single-statement (joins, no per-row lookups).
 */

/** Safe record columns + employee summary. NO location_json / gps / ip / device (BẤT BIẾN #3). */
const RECORD_COLUMNS = {
  id: attendanceRecords.id,
  userId: attendanceRecords.userId,
  workDate: attendanceRecords.workDate,
  employeeId: attendanceRecords.employeeId,
  shiftId: attendanceRecords.shiftId,
  checkInAt: attendanceRecords.checkInAt,
  checkOutAt: attendanceRecords.checkOutAt,
  checkInMethod: attendanceRecords.checkInMethod,
  checkOutMethod: attendanceRecords.checkOutMethod,
  lateMinutes: attendanceRecords.lateMinutes,
  earlyLeaveMinutes: attendanceRecords.earlyLeaveMinutes,
  workingMinutes: attendanceRecords.workingMinutes,
  requiredWorkingMinutes: attendanceRecords.requiredWorkingMinutes,
  missingMinutes: attendanceRecords.missingMinutes,
  breakMinutes: attendanceRecords.breakMinutes,
  status: attendanceRecords.status,
  attendanceStatus: attendanceRecords.attendanceStatus,
  isLate: attendanceRecords.isLate,
  isEarlyLeave: attendanceRecords.isEarlyLeave,
  isMissingCheckOut: attendanceRecords.isMissingCheckOut,
  // Employee summary — derived from the employee_profiles JOIN (NOT attendance_records.department_id).
  employeeCode: employeeProfiles.employeeCode,
  fullName: users.fullName,
  orgUnitId: employeeProfiles.orgUnitId,
  orgUnitName: orgUnits.name,
} as const;

/** Detail = list columns + scope columns + record-only location_json (gated) + extra status/source. */
const DETAIL_COLUMNS = {
  ...RECORD_COLUMNS,
  companyId: attendanceRecords.companyId,
  // employee_profiles.direct_manager_id references users.id → the manager's user id (Team in-scope).
  directManagerUserId: employeeProfiles.directManagerId,
  locationJson: attendanceRecords.locationJson,
  workScheduleId: attendanceRecords.workScheduleId,
  checkInStatus: attendanceRecords.checkInStatus,
  checkOutStatus: attendanceRecords.checkOutStatus,
  attendanceSource: attendanceRecords.attendanceSource,
  workMode: attendanceRecords.workMode,
  createdAt: attendanceRecords.createdAt,
  updatedAt: attendanceRecords.updatedAt,
} as const;

/** attendance_logs columns — safe + sensitive (the service masks the sensitive ones per permission). */
const LOG_COLUMNS = {
  id: attendanceLogs.id,
  logType: attendanceLogs.logType,
  logTime: attendanceLogs.logTime,
  source: attendanceLogs.source,
  platform: attendanceLogs.platform,
  clientTime: attendanceLogs.clientTime,
  clientTimezone: attendanceLogs.clientTimezone,
  isValid: attendanceLogs.isValid,
  invalidReason: attendanceLogs.invalidReason,
  note: attendanceLogs.note,
  workDate: attendanceLogs.workDate,
  // SENSITIVE — always selected, masked by the mapper unless view-sensitive.
  gpsLatitude: attendanceLogs.gpsLatitude,
  gpsLongitude: attendanceLogs.gpsLongitude,
  gpsAccuracyMeters: attendanceLogs.gpsAccuracyMeters,
  locationLabel: attendanceLogs.locationLabel,
  ipAddress: attendanceLogs.ipAddress,
  deviceId: attendanceLogs.deviceId,
  deviceName: attendanceLogs.deviceName,
  userAgent: attendanceLogs.userAgent,
  rawPayload: attendanceLogs.rawPayload,
} as const;

/** DTO sort key → concrete column (allowlist; blocks ORDER BY injection — Zod enum is the gate). */
const SORT_COLUMNS = {
  workDate: attendanceRecords.workDate,
  checkInAt: attendanceRecords.checkInAt,
  checkOutAt: attendanceRecords.checkOutAt,
  lateMinutes: attendanceRecords.lateMinutes,
  earlyLeaveMinutes: attendanceRecords.earlyLeaveMinutes,
  missingMinutes: attendanceRecords.missingMinutes,
  workingMinutes: attendanceRecords.workingMinutes,
  createdAt: attendanceRecords.createdAt,
  updatedAt: attendanceRecords.updatedAt,
} as const;

/** A scoped/self list row: safe V2 record fields (RecordRowForDto) + the employee-summary columns. */
export interface AttRecordListRow extends RecordRowForDto {
  userId: string;
  employeeCode: string | null;
  fullName: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
}

/** A detail row: list row + tenant/scope columns + record-only location_json + extra status/source. */
export interface AttRecordDetailRow extends AttRecordListRow {
  companyId: string;
  directManagerUserId: string | null;
  locationJson: unknown;
  workScheduleId: string | null;
  checkInStatus: string | null;
  checkOutStatus: string | null;
  attendanceSource: string | null;
  workMode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A raw attendance_logs row (sensitive fields still raw — the service masks per permission). */
export interface AttLogRow {
  id: string;
  logType: string;
  logTime: Date;
  source: string;
  platform: string | null;
  clientTime: Date | null;
  clientTimezone: string | null;
  isValid: boolean;
  invalidReason: string | null;
  note: string | null;
  workDate: string;
  gpsLatitude: string | null;
  gpsLongitude: string | null;
  gpsAccuracyMeters: string | null;
  locationLabel: string | null;
  ipAddress: string | null;
  deviceId: string | null;
  deviceName: string | null;
  userAgent: string | null;
  rawPayload: unknown;
}

export interface AttendanceListFilters {
  fromDate?: string;
  toDate?: string;
  status?: string;
  attendanceStatus?: string;
  shiftId?: string;
  departmentId?: string;
  employeeId?: string;
  sort: AttendanceRecordSortField;
  order: "asc" | "desc";
  /** 1-based page number (already clamped by the DTO). */
  page: number;
  pageSize: number;
}

@Injectable()
export class AttendanceReadRepository {
  /** The employee_profiles INNER JOIN that links records→profile (user_id + tenant, active only). */
  private readonly employeeJoin: SQL = and(
    eq(employeeProfiles.userId, attendanceRecords.userId),
    eq(employeeProfiles.companyId, attendanceRecords.companyId),
    isNull(employeeProfiles.deletedAt),
  )!;

  /**
   * Scoped page: `scopeCond` is the DataScopeService predicate over employee_profiles (Own/Team/
   * Company/…); it is ANDed with tenant + soft-delete + filters so a row outside the caller's scope is
   * never returned. Returns the page rows + the total matching count.
   */
  listScopedRecordsTx(
    tx: TenantTx,
    companyId: string,
    scopeCond: SQL,
    filters: AttendanceListFilters,
  ): Promise<{ rows: AttRecordListRow[]; total: number }> {
    return this.runList(tx, companyId, scopeCond, filters);
  }

  /**
   * Self-locked page: filters by attendance_records.user_id = userId (NOT a scope query — mirrors HR
   * getMyProfile). view-own:attendance is the gate; this pins the rows to the caller within the tenant.
   */
  listMyRecordsTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    filters: AttendanceListFilters,
  ): Promise<{ rows: AttRecordListRow[]; total: number }> {
    return this.runList(tx, companyId, eq(attendanceRecords.userId, userId), filters);
  }

  private async runList(
    tx: TenantTx,
    companyId: string,
    rowCond: SQL,
    filters: AttendanceListFilters,
  ): Promise<{ rows: AttRecordListRow[]; total: number }> {
    const where = this.buildWhere(companyId, rowCond, filters);
    const direction = filters.order === "desc" ? desc : asc;
    const sortCol = SORT_COLUMNS[filters.sort];
    const offset = (filters.page - 1) * filters.pageSize;

    const rows = await tx
      .select(RECORD_COLUMNS)
      .from(attendanceRecords)
      .innerJoin(employeeProfiles, this.employeeJoin)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .where(where)
      // Stable tiebreaker (id) so pagination is deterministic when sort keys tie.
      .orderBy(direction(sortCol), direction(attendanceRecords.id))
      .limit(filters.pageSize)
      .offset(offset);

    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(attendanceRecords)
      .innerJoin(employeeProfiles, this.employeeJoin)
      .where(where);

    return { rows: rows as AttRecordListRow[], total: Number(count) };
  }

  private buildWhere(companyId: string, rowCond: SQL, filters: AttendanceListFilters): SQL {
    const conditions: SQL[] = [
      eq(attendanceRecords.companyId, companyId),
      isNull(attendanceRecords.deletedAt),
      rowCond,
    ];
    // Half-open [fromDate, toDate) over work_date (toDate exclusive — avoids the prevDay footgun).
    if (filters.fromDate) conditions.push(gte(attendanceRecords.workDate, filters.fromDate));
    if (filters.toDate) conditions.push(lt(attendanceRecords.workDate, filters.toDate));
    if (filters.status) conditions.push(eq(attendanceRecords.status, filters.status));
    if (filters.attendanceStatus)
      conditions.push(eq(attendanceRecords.attendanceStatus, filters.attendanceStatus));
    if (filters.shiftId) conditions.push(eq(attendanceRecords.shiftId, filters.shiftId));
    if (filters.departmentId) conditions.push(eq(employeeProfiles.orgUnitId, filters.departmentId));
    if (filters.employeeId) conditions.push(eq(employeeProfiles.id, filters.employeeId));
    return and(...conditions)!;
  }

  /**
   * One record by id (tenant-scoped). INNER JOINs employee_profiles so the in-scope columns
   * (userId/orgUnitId/directManagerUserId) and the employee summary are available; a record whose
   * employee profile is missing/soft-deleted returns undefined → the service 404s (no existence leak).
   */
  async findRecordDetailTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<AttRecordDetailRow | undefined> {
    const [row] = await tx
      .select(DETAIL_COLUMNS)
      .from(attendanceRecords)
      .innerJoin(employeeProfiles, this.employeeJoin)
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          eq(attendanceRecords.id, id),
          isNull(attendanceRecords.deletedAt),
        ),
      )
      .limit(1);
    return row as AttRecordDetailRow | undefined;
  }

  /** Append-only logs for a record (tenant-scoped), chronological. Caller masks sensitive fields. */
  findLogsByRecordTx(tx: TenantTx, companyId: string, recordId: string): Promise<AttLogRow[]> {
    return tx
      .select(LOG_COLUMNS)
      .from(attendanceLogs)
      .where(
        and(
          eq(attendanceLogs.companyId, companyId),
          eq(attendanceLogs.attendanceRecordId, recordId),
          isNull(attendanceLogs.deletedAt),
        ),
      )
      .orderBy(asc(attendanceLogs.logTime), asc(attendanceLogs.id)) as Promise<AttLogRow[]>;
  }
}
