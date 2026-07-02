import { Injectable, Logger } from "@nestjs/common";
import type { TenantTx } from "../db/db.service";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import type { EventContext } from "../events/event-bus";
import { AttendanceRepository } from "./attendance.repository";
import {
  AttendanceLeaveSyncRepository,
  type SyncableDayRow,
} from "./attendance-leave-sync.repository";
import {
  buildFullDaySyncPatch,
  buildPartialSyncPatch,
  buildRevertPatch,
  isSyncableDay,
  type SyncRecordInput,
} from "./attendance-leave-sync.logic";

/**
 * S3-INT-1 — LEAVE→ATT sync. Consumes `leave.request.approved` (EventBus consumer `onLeaveApproved`,
 * registered by AttendanceModule) to project APPROVED leave onto attendance_records; also exposes
 * `revertRequestTx` for LeaveModule to call INLINE (same tx as cancel/revoke) so balance-restore and
 * ATT-revert commit/rollback together (BẤT BIẾN #1 — no ghost writes on rollback).
 *
 * IDEMPOTENCY (S3-SYNC-004): sync only touches day-rows whose attendance_sync_status is 'Pending'
 * (marked by LeaveApprovalService.approve, S3-LEAVE-BE-3); revert only touches 'Synced' rows. Retrying
 * either after a partial failure is safe — an already-Synced/Reverted day is skipped, so balance/ATT
 * changes are NEVER applied twice for the same request.
 *
 * NO DUPLICATE RECORDS: one attendance_records row per (employee_id, work_date) — sync UPDATEs an
 * existing row (created by check-in, or by a PRIOR sync day) rather than blind-inserting.
 */
@Injectable()
export class AttendanceLeaveSyncService {
  private readonly logger = new Logger(AttendanceLeaveSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly attRepo: AttendanceRepository,
    private readonly syncRepo: AttendanceLeaveSyncRepository,
    private readonly audit: AuditService,
  ) {}

  // ─── EventBus consumer: onLeaveApproved (leave.request.approved) ─────────────

  /**
   * Handler bound to EventBus by AttendanceModule (OnModuleInit, consumerName 'attendance-leave-sync').
   * Runs OUTSIDE the original approve() tx (OutboxWorker claims the event after commit) — opens its OWN
   * withTenant tx so the sync writes + audit are atomic together, independent of the approval tx.
   */
  async onLeaveApproved(ctx: EventContext): Promise<void> {
    const payload = ctx.payload as { requestId?: string; approvedBy?: string };
    const requestId = payload.requestId;
    if (!requestId) {
      this.logger.warn("leave.request.approved missing requestId — skipping sync", {
        eventId: ctx.eventId,
      });
      return;
    }
    await this.db.withTenant(ctx.companyId, (tx) =>
      this.syncApprovedRequestTx(tx, ctx.companyId, requestId, payload.approvedBy),
    );
  }

  /**
   * Sync every 'Pending' working day-row of `requestId` onto attendance_records. Per-day failure is
   * caught + recorded on that day-row (attendance_sync_status='Failed' + error) so ONE bad day never
   * blocks the others — matches "lưu sync error nếu fail + log" (done_when).
   */
  async syncApprovedRequestTx(
    tx: TenantTx,
    companyId: string,
    requestId: string,
    actorUserId?: string,
  ): Promise<number> {
    const days = await this.syncRepo.findSyncableDaysTx(companyId, requestId, tx, ["Pending"]);
    const userId = await this.syncRepo.findRequestUserIdTx(companyId, requestId, tx);
    let processed = 0;
    for (const day of days) {
      if (!isSyncableDay(day)) {
        await this.syncRepo.updateDaySyncStatusTx(
          companyId,
          day.id,
          { attendanceSyncStatus: "Not Required", updatedBy: actorUserId },
          tx,
        );
        continue;
      }
      try {
        if (!userId)
          throw new Error("Leave request has no owning user_id — cannot sync attendance");
        // syncOneDayTx finalizes the day-row itself (Synced + attendanceRecordId) — no duplicate call here.
        await this.syncOneDayTx(tx, companyId, day, userId, actorUserId);
        processed += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`LEAVE→ATT sync failed for day ${day.id} (request ${requestId})`, {
          err,
          companyId,
          requestId,
          dayId: day.id,
        });
        await this.syncRepo.updateDaySyncStatusTx(
          companyId,
          day.id,
          { attendanceSyncStatus: "Failed", attendanceSyncError: message, updatedBy: actorUserId },
          tx,
        );
      }
    }
    return processed;
  }

  private async syncOneDayTx(
    tx: TenantTx,
    companyId: string,
    day: SyncableDayRow,
    userId: string,
    actorUserId: string | undefined,
  ): Promise<void> {
    const employee = await this.syncRepo.findEmployeeContextTx(companyId, day.employeeId, tx);
    const shift = await this.resolveShiftTx(
      tx,
      companyId,
      day.employeeId,
      employee?.orgUnitId ?? null,
      day.workDate,
    );

    const [existing] = await this.syncRepo.findRecordByEmployeeDateTx(
      companyId,
      day.employeeId,
      day.workDate,
      tx,
    );
    const recordInput: SyncRecordInput | null = existing
      ? {
          id: existing.id,
          checkInAt: existing.checkInAt,
          checkOutAt: existing.checkOutAt,
          workingMinutes: existing.workingMinutes,
          requiredWorkingMinutes: existing.requiredWorkingMinutes,
          lateMinutes: existing.lateMinutes,
          earlyLeaveMinutes: existing.earlyLeaveMinutes,
        }
      : null;

    const patch =
      day.dayType === "Full Day"
        ? buildFullDaySyncPatch()
        : buildPartialSyncPatch(
            day,
            {
              id: shift?.id ?? null,
              requiredWorkingMinutes: shift?.requiredWorkingMinutes ?? null,
            },
            recordInput,
          );

    const values = {
      attendanceStatus: patch.attendanceStatus,
      requiredWorkingMinutes: patch.requiredWorkingMinutes,
      missingMinutes: patch.missingMinutes,
      workMode: patch.workMode ?? undefined,
      leaveRequestId: day.leaveRequestId,
      shiftId: shift?.id ?? null,
      employeeId: day.employeeId,
      departmentId: employee?.orgUnitId ?? null,
      positionId: employee?.positionId ?? null,
      updatedBy: actorUserId,
    };

    let recordId: string;
    if (existing) {
      const [updated] = await this.syncRepo.updateRecordTx(companyId, existing.id, values, tx);
      if (!updated)
        throw new Error(`Failed to update attendance_records ${existing.id} for LEAVE sync`);
      recordId = updated.id;
      await this.audit.record(tx, {
        action: "attendance.leave_sync.update",
        objectType: "attendance_record",
        objectId: recordId,
        actorUserId,
        before: {
          attendanceStatus: existing.attendanceStatus,
          requiredWorkingMinutes: existing.requiredWorkingMinutes,
        },
        after: {
          attendanceStatus: values.attendanceStatus,
          requiredWorkingMinutes: values.requiredWorkingMinutes,
        },
      });
    } else {
      const [inserted] = await this.syncRepo.insertRecordTx(
        companyId,
        {
          companyId,
          userId,
          workDate: day.workDate,
          createdBy: actorUserId,
          ...values,
        },
        tx,
      );
      if (!inserted) throw new Error("Failed to insert attendance_records for LEAVE sync");
      recordId = inserted.id;
      await this.audit.record(tx, {
        action: "attendance.leave_sync.create",
        objectType: "attendance_record",
        objectId: recordId,
        actorUserId,
        after: {
          attendanceStatus: values.attendanceStatus,
          requiredWorkingMinutes: values.requiredWorkingMinutes,
        },
      });
    }

    await this.syncRepo.updateDaySyncStatusTx(
      companyId,
      day.id,
      { attendanceSyncStatus: "Synced", attendanceRecordId: recordId, updatedBy: actorUserId },
      tx,
    );
  }

  // ─── revert on Cancel|Revoke of an ALREADY-Approved+synced request (S3-SYNC-004) ─────

  /**
   * Revert every 'Synced' working day-row of `requestId`: restore required_working_minutes to the
   * shift/rule EFFECTIVE value, drop 'Leave' status, recompute from any existing check-in/out. Called
   * INLINE by LeaveRequestService.cancel / LeaveApprovalService.revoke INSIDE the SAME tx as the
   * balance-restore + status update — one atomic unit (commit/rollback together).
   *
   * IDEMPOTENT: only 'Synced' rows are touched; a retry after a day is already 'Reverted' is a no-op for
   * that day (never double-reverts, never double-restores required minutes).
   */
  async revertRequestTx(
    tx: TenantTx,
    companyId: string,
    requestId: string,
    actorUserId: string,
  ): Promise<void> {
    const days = await this.syncRepo.findSyncableDaysTx(companyId, requestId, tx, ["Synced"]);
    for (const day of days) {
      try {
        await this.revertOneDayTx(tx, companyId, day, actorUserId);
        await this.syncRepo.updateDaySyncStatusTx(
          companyId,
          day.id,
          { attendanceSyncStatus: "Reverted", updatedBy: actorUserId },
          tx,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`LEAVE→ATT revert failed for day ${day.id} (request ${requestId})`, {
          err,
          companyId,
          requestId,
          dayId: day.id,
        });
        await this.syncRepo.updateDaySyncStatusTx(
          companyId,
          day.id,
          { attendanceSyncStatus: "Failed", attendanceSyncError: message, updatedBy: actorUserId },
          tx,
        );
        throw err; // revert failure must roll back the cancel/revoke tx (never a half-reverted state)
      }
    }
  }

  private async revertOneDayTx(
    tx: TenantTx,
    companyId: string,
    day: SyncableDayRow,
    actorUserId: string,
  ): Promise<void> {
    const [existing] = await this.syncRepo.findRecordByEmployeeDateTx(
      companyId,
      day.employeeId,
      day.workDate,
      tx,
    );
    if (!existing) return; // nothing to revert (record was never created / already removed)

    const employee = await this.syncRepo.findEmployeeContextTx(companyId, day.employeeId, tx);
    const shift = await this.resolveShiftTx(
      tx,
      companyId,
      day.employeeId,
      employee?.orgUnitId ?? null,
      day.workDate,
    );
    const recordInput: SyncRecordInput = {
      id: existing.id,
      checkInAt: existing.checkInAt,
      checkOutAt: existing.checkOutAt,
      workingMinutes: existing.workingMinutes,
      requiredWorkingMinutes: existing.requiredWorkingMinutes,
      lateMinutes: existing.lateMinutes,
      earlyLeaveMinutes: existing.earlyLeaveMinutes,
    };
    const patch = buildRevertPatch(
      { id: shift?.id ?? null, requiredWorkingMinutes: shift?.requiredWorkingMinutes ?? null },
      recordInput,
    );

    const values = {
      attendanceStatus: patch.attendanceStatus,
      requiredWorkingMinutes: patch.requiredWorkingMinutes,
      missingMinutes: patch.missingMinutes,
      workMode: patch.workMode ?? null,
      updatedBy: actorUserId,
    };
    const [updated] = await this.syncRepo.updateRecordTx(companyId, existing.id, values, tx);
    if (!updated) throw new Error(`Failed to revert attendance_records ${existing.id}`);

    await this.audit.record(tx, {
      action: "attendance.leave_sync.revert",
      objectType: "attendance_record",
      objectId: updated.id,
      actorUserId,
      before: {
        attendanceStatus: existing.attendanceStatus,
        requiredWorkingMinutes: existing.requiredWorkingMinutes,
      },
      after: {
        attendanceStatus: values.attendanceStatus,
        requiredWorkingMinutes: values.requiredWorkingMinutes,
      },
    });
  }

  /** Reuse the SAME Employee≻Department≻Company priority resolution as check-in/out (attendance.repository). */
  private async resolveShiftTx(
    tx: TenantTx,
    companyId: string,
    employeeId: string,
    orgUnitId: string | null,
    workDate: string,
  ) {
    return (
      (await this.attRepo.resolveEffectiveShiftTx(
        companyId,
        { employeeId, orgUnitId, workDate },
        tx,
      )) ?? (await this.attRepo.findDefaultShiftTx(companyId, tx))
    );
  }
}
