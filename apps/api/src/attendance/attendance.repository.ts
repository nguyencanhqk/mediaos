import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNotNull, isNull, lt } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import {
  attendanceAdjustmentRequests,
  attendancePeriods,
  attendanceRecords,
  workSchedules,
} from "../db/schema/hr";
import { users } from "../db/schema/users";

/** Persistence for G11-1 attendance. Every method is tenant-scoped (RLS + explicit company_id). */
@Injectable()
export class AttendanceRepository {
  constructor(private readonly db: DatabaseService) {}

  // ─── work_schedules ────────────────────────────────────────────────────────

  findSchedules(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(workSchedules)
        .where(and(eq(workSchedules.companyId, companyId), isNull(workSchedules.deletedAt)))
        .orderBy(desc(workSchedules.isDefault), workSchedules.name),
    );
  }

  findScheduleByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(workSchedules)
      .where(
        and(
          eq(workSchedules.companyId, companyId),
          eq(workSchedules.id, id),
          isNull(workSchedules.deletedAt),
        ),
      )
      .limit(1);
  }

  findDefaultScheduleTx(companyId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workSchedules)
      .where(
        and(
          eq(workSchedules.companyId, companyId),
          eq(workSchedules.isDefault, true),
          eq(workSchedules.status, "active"),
          isNull(workSchedules.deletedAt),
        ),
      )
      .limit(1);
  }

  /** Resolve the user's assigned schedule, falling back to the company default — all inside one tx. */
  async resolveScheduleForUserTx(companyId: string, userId: string, tx: TenantTx) {
    const [profile] = await tx
      .select({ workScheduleId: employeeProfiles.workScheduleId })
      .from(employeeProfiles)
      .where(and(eq(employeeProfiles.companyId, companyId), eq(employeeProfiles.userId, userId)))
      .limit(1);

    if (profile?.workScheduleId) {
      const [assigned] = await this.findScheduleByIdTx(companyId, profile.workScheduleId, tx);
      if (assigned) return assigned;
    }
    const [fallback] = await this.findDefaultScheduleTx(companyId, tx);
    return fallback ?? null;
  }

  createScheduleTx(
    companyId: string,
    data: typeof workSchedules.$inferInsert,
    tx: TenantTx,
  ) {
    return tx.insert(workSchedules).values({ ...data, companyId }).returning();
  }

  updateScheduleTx(
    companyId: string,
    id: string,
    data: Partial<typeof workSchedules.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(workSchedules)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(workSchedules.companyId, companyId),
          eq(workSchedules.id, id),
          isNull(workSchedules.deletedAt),
        ),
      )
      .returning();
  }

  // ─── attendance_records ────────────────────────────────────────────────────

  findRecordByUserDateTx(companyId: string, userId: string, workDate: string, tx: TenantTx) {
    return tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          eq(attendanceRecords.userId, userId),
          eq(attendanceRecords.workDate, workDate),
          isNull(attendanceRecords.deletedAt),
        ),
      )
      .limit(1);
  }

  /**
   * Most recent OPEN record (checked-in, not yet checked-out) for a user. Used by check-out so an
   * overnight shift (check-in on day D, check-out on D+1 local) resolves the in-progress record
   * regardless of today's local date — fixes the dropped-checkout bug for cross-midnight shifts.
   */
  findOpenRecordForUserTx(companyId: string, userId: string, tx: TenantTx) {
    return tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          eq(attendanceRecords.userId, userId),
          isNotNull(attendanceRecords.checkInAt),
          isNull(attendanceRecords.checkOutAt),
          isNull(attendanceRecords.deletedAt),
        ),
      )
      .orderBy(desc(attendanceRecords.workDate))
      .limit(1);
  }

  findRecordsByMonth(
    companyId: string,
    opts: { from: string; toExclusive: string; userId?: string; limit: number; offset: number },
  ) {
    return this.db.withTenant(companyId, (tx) => {
      const conds = [
        eq(attendanceRecords.companyId, companyId),
        isNull(attendanceRecords.deletedAt),
        // Half-open interval [from, toExclusive) via gte + lt — avoids the prevDay footgun.
        gte(attendanceRecords.workDate, opts.from),
        lt(attendanceRecords.workDate, opts.toExclusive),
      ];
      if (opts.userId) conds.push(eq(attendanceRecords.userId, opts.userId));
      return tx
        .select({
          id: attendanceRecords.id,
          userId: attendanceRecords.userId,
          userFullName: users.fullName,
          workDate: attendanceRecords.workDate,
          workScheduleId: attendanceRecords.workScheduleId,
          checkInAt: attendanceRecords.checkInAt,
          checkOutAt: attendanceRecords.checkOutAt,
          checkInMethod: attendanceRecords.checkInMethod,
          checkOutMethod: attendanceRecords.checkOutMethod,
          lateMinutes: attendanceRecords.lateMinutes,
          earlyLeaveMinutes: attendanceRecords.earlyLeaveMinutes,
          status: attendanceRecords.status,
          note: attendanceRecords.note,
        })
        .from(attendanceRecords)
        .innerJoin(users, eq(attendanceRecords.userId, users.id))
        .where(and(...conds))
        .orderBy(attendanceRecords.workDate, users.fullName)
        .limit(opts.limit)
        .offset(opts.offset);
    });
  }

  insertRecordTx(companyId: string, data: typeof attendanceRecords.$inferInsert, tx: TenantTx) {
    return tx.insert(attendanceRecords).values({ ...data, companyId }).returning();
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

  // ─── attendance_adjustment_requests ──────────────────────────────────────────

  findAdjustmentByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(attendanceAdjustmentRequests)
      .where(
        and(
          eq(attendanceAdjustmentRequests.companyId, companyId),
          eq(attendanceAdjustmentRequests.id, id),
          isNull(attendanceAdjustmentRequests.deletedAt),
        ),
      )
      .limit(1);
  }

  /**
   * Same as findAdjustmentByIdTx but takes a row-level `FOR UPDATE` lock — the caller re-reads
   * `status` under the lock so two concurrent approve/reject requests serialize (the second blocks,
   * then sees status≠pending). Closes the TOCTOU double-approval window.
   */
  findAdjustmentByIdForUpdateTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(attendanceAdjustmentRequests)
      .where(
        and(
          eq(attendanceAdjustmentRequests.companyId, companyId),
          eq(attendanceAdjustmentRequests.id, id),
          isNull(attendanceAdjustmentRequests.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
  }

  findAdjustments(
    companyId: string,
    opts: { userId?: string; status?: string; limit: number; offset: number },
  ) {
    return this.db.withTenant(companyId, (tx) => {
      const conds = [
        eq(attendanceAdjustmentRequests.companyId, companyId),
        isNull(attendanceAdjustmentRequests.deletedAt),
      ];
      if (opts.userId) conds.push(eq(attendanceAdjustmentRequests.userId, opts.userId));
      if (opts.status) conds.push(eq(attendanceAdjustmentRequests.status, opts.status));
      return tx
        .select({
          id: attendanceAdjustmentRequests.id,
          userId: attendanceAdjustmentRequests.userId,
          userFullName: users.fullName,
          attendanceRecordId: attendanceAdjustmentRequests.attendanceRecordId,
          workDate: attendanceAdjustmentRequests.workDate,
          requestedCheckInAt: attendanceAdjustmentRequests.requestedCheckInAt,
          requestedCheckOutAt: attendanceAdjustmentRequests.requestedCheckOutAt,
          reason: attendanceAdjustmentRequests.reason,
          status: attendanceAdjustmentRequests.status,
          taskId: attendanceAdjustmentRequests.taskId,
          approvedBy: attendanceAdjustmentRequests.approvedBy,
          approvedAt: attendanceAdjustmentRequests.approvedAt,
          reviewNote: attendanceAdjustmentRequests.reviewNote,
          createdAt: attendanceAdjustmentRequests.createdAt,
        })
        .from(attendanceAdjustmentRequests)
        .innerJoin(users, eq(attendanceAdjustmentRequests.userId, users.id))
        .where(and(...conds))
        .orderBy(desc(attendanceAdjustmentRequests.createdAt))
        .limit(opts.limit)
        .offset(opts.offset);
    });
  }

  insertAdjustmentTx(
    companyId: string,
    data: typeof attendanceAdjustmentRequests.$inferInsert,
    tx: TenantTx,
  ) {
    return tx.insert(attendanceAdjustmentRequests).values({ ...data, companyId }).returning();
  }

  updateAdjustmentTx(
    companyId: string,
    id: string,
    data: Partial<typeof attendanceAdjustmentRequests.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(attendanceAdjustmentRequests)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(attendanceAdjustmentRequests.companyId, companyId),
          eq(attendanceAdjustmentRequests.id, id),
          isNull(attendanceAdjustmentRequests.deletedAt),
        ),
      )
      .returning();
  }

  // ─── attendance_periods ──────────────────────────────────────────────────────

  findPeriods(companyId: string, opts: { limit: number; offset: number }) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(attendancePeriods)
        .where(eq(attendancePeriods.companyId, companyId))
        .orderBy(desc(attendancePeriods.periodMonth))
        .limit(opts.limit)
        .offset(opts.offset),
    );
  }

  findPeriodTx(companyId: string, periodMonth: string, tx: TenantTx) {
    return tx
      .select()
      .from(attendancePeriods)
      .where(
        and(
          eq(attendancePeriods.companyId, companyId),
          eq(attendancePeriods.periodMonth, periodMonth),
        ),
      )
      .limit(1);
  }

  /** True iff the given period is locked. Read inside the caller's tx for check-in/adjust gating. */
  async isPeriodLockedTx(companyId: string, periodMonth: string, tx: TenantTx): Promise<boolean> {
    const [row] = await this.findPeriodTx(companyId, periodMonth, tx);
    return row?.status === "locked";
  }

  lockPeriodTx(
    companyId: string,
    data: { periodMonth: string; lockedBy: string },
    tx: TenantTx,
  ) {
    return tx
      .insert(attendancePeriods)
      .values({
        companyId,
        periodMonth: data.periodMonth,
        status: "locked",
        lockedBy: data.lockedBy,
        lockedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [attendancePeriods.companyId, attendancePeriods.periodMonth],
        set: { status: "locked", lockedBy: data.lockedBy, lockedAt: new Date(), updatedAt: new Date() },
      })
      .returning();
  }
}

