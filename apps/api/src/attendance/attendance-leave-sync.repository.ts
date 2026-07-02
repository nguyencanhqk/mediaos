import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { attendanceRecords, leaveRequests } from "../db/schema/hr";
import { leaveRequestDays } from "../db/schema/leave";

/**
 * S3-INT-1 — persistence for LEAVE→ATT sync (onLeaveApproved / revert on Cancel|Revoke). Every method
 * takes the caller's `tx` so the SERVICE owns withTenant (RLS + explicit company_id, BẤT BIẾN #1).
 *
 * BẤT BIẾN #2: attendance_records is NOT append-only (soft-delete update table, same as check-in/out) —
 * UPDATE/INSERT here is the same "app writes its own tenant rows" surface check-in/out already uses.
 * leave_request_days.attendance_sync_status is a flag column (UPDATE only, not a delete).
 */
export type SyncableDayRow = typeof leaveRequestDays.$inferSelect;

@Injectable()
export class AttendanceLeaveSyncRepository {
  /** Active working day-rows of a request whose sync_status is one of `statuses` (default: ['Pending']). */
  findSyncableDaysTx(
    companyId: string,
    requestId: string,
    tx: TenantTx,
    statuses: readonly string[] = ["Pending"],
  ) {
    return tx
      .select()
      .from(leaveRequestDays)
      .where(
        and(
          eq(leaveRequestDays.companyId, companyId),
          eq(leaveRequestDays.leaveRequestId, requestId),
          eq(leaveRequestDays.status, "Active"),
          isNull(leaveRequestDays.deletedAt),
        ),
      )
      .then((rows) => rows.filter((r) => statuses.includes(r.attendanceSyncStatus)));
  }

  /** Owning user_id of a leave request (attendance_records.user_id NOT NULL — always required for insert). */
  async findRequestUserIdTx(
    companyId: string,
    requestId: string,
    tx: TenantTx,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ userId: leaveRequests.userId })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.companyId, companyId), eq(leaveRequests.id, requestId)))
      .limit(1);
    return row?.userId ?? null;
  }

  /** Employee org_unit + position (for resolveEffectiveShiftTx / new-record columns). */
  async findEmployeeContextTx(companyId: string, employeeId: string, tx: TenantTx) {
    const [row] = await tx
      .select({
        id: employeeProfiles.id,
        orgUnitId: employeeProfiles.orgUnitId,
        positionId: employeeProfiles.positionId,
      })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.id, employeeId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  findRecordByEmployeeDateTx(
    companyId: string,
    employeeId: string,
    workDate: string,
    tx: TenantTx,
  ) {
    return tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          eq(attendanceRecords.employeeId, employeeId),
          eq(attendanceRecords.workDate, workDate),
          isNull(attendanceRecords.deletedAt),
        ),
      )
      .limit(1);
  }

  insertRecordTx(companyId: string, data: typeof attendanceRecords.$inferInsert, tx: TenantTx) {
    return tx
      .insert(attendanceRecords)
      .values({ ...data, companyId })
      .returning();
  }

  updateRecordTx(
    companyId: string,
    id: string,
    data: Partial<typeof attendanceRecords.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(attendanceRecords)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          eq(attendanceRecords.id, id),
          isNull(attendanceRecords.deletedAt),
        ),
      )
      .returning();
  }

  /** Mark 1 day-row's sync outcome (flag columns only — NOT a delete). */
  updateDaySyncStatusTx(
    companyId: string,
    dayId: string,
    data: {
      attendanceSyncStatus: string;
      attendanceRecordId?: string | null;
      attendanceSyncError?: string | null;
      updatedBy?: string;
    },
    tx: TenantTx,
  ) {
    return tx
      .update(leaveRequestDays)
      .set({
        attendanceSyncStatus: data.attendanceSyncStatus,
        attendanceRecordId: data.attendanceRecordId,
        attendanceSyncError: data.attendanceSyncError ?? null,
        attendanceSyncedAt: new Date(),
        updatedBy: data.updatedBy,
        updatedAt: new Date(),
      })
      .where(and(eq(leaveRequestDays.companyId, companyId), eq(leaveRequestDays.id, dayId)));
  }
}
