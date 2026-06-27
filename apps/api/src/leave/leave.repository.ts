import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { leaveBalances, leaveRequests, leaveTypes, workSchedules } from "../db/schema/hr";
import { users } from "../db/schema/users";

/** Persistence for G11-2 leave. Tenant-scoped (RLS + explicit company_id). */
@Injectable()
export class LeaveRepository {
  constructor(private readonly db: DatabaseService) {}

  // ─── work_schedules (read-only: resolve working days for the day-count) ──────

  /**
   * Working-day calendar for a user (ISO weekdays, 1=Mon…7=Sun): the user's assigned schedule,
   * falling back to the company default, then to Mon–Fri. Read-only — leave never writes schedules.
   */
  async resolveWorkingDaysForUserTx(
    companyId: string,
    userId: string,
    tx: TenantTx,
  ): Promise<number[]> {
    const [profile] = await tx
      .select({ workScheduleId: employeeProfiles.workScheduleId })
      .from(employeeProfiles)
      .where(and(eq(employeeProfiles.companyId, companyId), eq(employeeProfiles.userId, userId)))
      .limit(1);

    const conds = profile?.workScheduleId
      ? and(
          eq(workSchedules.companyId, companyId),
          eq(workSchedules.id, profile.workScheduleId),
          isNull(workSchedules.deletedAt),
        )
      : and(
          eq(workSchedules.companyId, companyId),
          eq(workSchedules.isDefault, true),
          eq(workSchedules.status, "active"),
          isNull(workSchedules.deletedAt),
        );

    const [schedule] = await tx
      .select({ workingDaysJson: workSchedules.workingDaysJson })
      .from(workSchedules)
      .where(conds)
      .limit(1);

    return schedule?.workingDaysJson ?? [1, 2, 3, 4, 5];
  }

  /**
   * S3-LEAVE-BE-1 — resolve the actor's employee_profiles row by (company, user). Used to anchor
   * SERVER-SIDE actor resolution for calculate (§6.2 — ignore any client employee_id). Returns [] when
   * the user has no employee profile; leave_balances key on user_id so the link is NOT required to
   * compute days (caller proceeds either way).
   */
  resolveEmployeeByUserIdTx(companyId: string, userId: string, tx: TenantTx) {
    return tx
      .select({ id: employeeProfiles.id })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, userId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
  }

  // ─── leave_types ───────────────────────────────────────────────────────────

  findTypes(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(leaveTypes)
        .where(and(eq(leaveTypes.companyId, companyId), isNull(leaveTypes.deletedAt)))
        .orderBy(leaveTypes.name),
    );
  }

  findTypeByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(leaveTypes)
      .where(
        and(
          eq(leaveTypes.companyId, companyId),
          eq(leaveTypes.id, id),
          isNull(leaveTypes.deletedAt),
        ),
      )
      .limit(1);
  }

  createTypeTx(companyId: string, data: typeof leaveTypes.$inferInsert, tx: TenantTx) {
    return tx
      .insert(leaveTypes)
      .values({ ...data, companyId })
      .returning();
  }

  updateTypeTx(
    companyId: string,
    id: string,
    data: Partial<typeof leaveTypes.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(leaveTypes)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(leaveTypes.companyId, companyId),
          eq(leaveTypes.id, id),
          isNull(leaveTypes.deletedAt),
        ),
      )
      .returning();
  }

  // ─── leave_balances ──────────────────────────────────────────────────────────

  findBalances(companyId: string, opts: { userId?: string; year?: number }) {
    return this.db.withTenant(companyId, (tx) => {
      const conds = [eq(leaveBalances.companyId, companyId)];
      if (opts.userId) conds.push(eq(leaveBalances.userId, opts.userId));
      if (opts.year) conds.push(eq(leaveBalances.year, opts.year));
      return tx
        .select({
          id: leaveBalances.id,
          userId: leaveBalances.userId,
          userFullName: users.fullName,
          leaveTypeId: leaveBalances.leaveTypeId,
          leaveTypeName: leaveTypes.name,
          year: leaveBalances.year,
          totalDays: leaveBalances.totalDays,
          usedDays: leaveBalances.usedDays,
          remainingDays: leaveBalances.remainingDays,
        })
        .from(leaveBalances)
        .innerJoin(users, eq(leaveBalances.userId, users.id))
        .innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
        .where(and(...conds))
        .orderBy(users.fullName, leaveTypes.name);
    });
  }

  findBalanceTx(
    companyId: string,
    userId: string,
    leaveTypeId: string,
    year: number,
    tx: TenantTx,
  ) {
    return tx
      .select()
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.userId, userId),
          eq(leaveBalances.leaveTypeId, leaveTypeId),
          eq(leaveBalances.year, year),
        ),
      )
      .limit(1);
  }

  upsertBalanceTx(
    companyId: string,
    data: { userId: string; leaveTypeId: string; year: number; totalDays: string },
    tx: TenantTx,
  ) {
    return tx
      .insert(leaveBalances)
      .values({
        companyId,
        userId: data.userId,
        leaveTypeId: data.leaveTypeId,
        year: data.year,
        totalDays: data.totalDays,
      })
      .onConflictDoUpdate({
        target: [
          leaveBalances.companyId,
          leaveBalances.userId,
          leaveBalances.leaveTypeId,
          leaveBalances.year,
        ],
        set: { totalDays: data.totalDays, updatedAt: new Date() },
      })
      .returning();
  }

  /**
   * Atomically add `delta` to used_days ONLY if it keeps used_days ≤ total_days. Returns the updated
   * row, or [] when no balance row exists OR the deduction would exceed the quota — race-safe (the
   * guard is in the WHERE, so two concurrent approvals can't both pass). delta is a decimal string.
   */
  incrementUsedIfEnoughTx(
    companyId: string,
    data: { userId: string; leaveTypeId: string; year: number; delta: string },
    tx: TenantTx,
  ) {
    return tx
      .update(leaveBalances)
      .set({
        usedDays: sql`${leaveBalances.usedDays} + ${data.delta}::numeric`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leaveBalances.companyId, companyId),
          eq(leaveBalances.userId, data.userId),
          eq(leaveBalances.leaveTypeId, data.leaveTypeId),
          eq(leaveBalances.year, data.year),
          sql`${leaveBalances.usedDays} + ${data.delta}::numeric <= ${leaveBalances.totalDays}`,
        ),
      )
      .returning();
  }

  // ─── leave_requests ──────────────────────────────────────────────────────────

  findRequestByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.companyId, companyId),
          eq(leaveRequests.id, id),
          isNull(leaveRequests.deletedAt),
        ),
      )
      .limit(1);
  }

  /**
   * Same as findRequestByIdTx but takes a row-level `FOR UPDATE` lock so two concurrent
   * approve/reject requests serialize on the request row — the second blocks, then sees
   * status≠pending and is rejected. Closes the TOCTOU double-approval / double-deduction window.
   */
  findRequestByIdForUpdateTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.companyId, companyId),
          eq(leaveRequests.id, id),
          isNull(leaveRequests.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
  }

  findRequests(
    companyId: string,
    opts: { userId?: string; status?: string; year?: number; limit: number; offset: number },
  ) {
    return this.db.withTenant(companyId, (tx) => {
      const conds = [eq(leaveRequests.companyId, companyId), isNull(leaveRequests.deletedAt)];
      if (opts.userId) conds.push(eq(leaveRequests.userId, opts.userId));
      if (opts.status) conds.push(eq(leaveRequests.status, opts.status));
      if (opts.year) {
        conds.push(gte(leaveRequests.startDate, `${opts.year}-01-01`));
        conds.push(lt(leaveRequests.startDate, `${opts.year + 1}-01-01`));
      }
      return tx
        .select({
          id: leaveRequests.id,
          userId: leaveRequests.userId,
          userFullName: users.fullName,
          leaveTypeId: leaveRequests.leaveTypeId,
          leaveTypeName: leaveTypes.name,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          totalDays: leaveRequests.totalDays,
          reason: leaveRequests.reason,
          status: leaveRequests.status,
          taskId: leaveRequests.taskId,
          approvedBy: leaveRequests.approvedBy,
          approvedAt: leaveRequests.approvedAt,
          reviewNote: leaveRequests.reviewNote,
          createdAt: leaveRequests.createdAt,
        })
        .from(leaveRequests)
        .innerJoin(users, eq(leaveRequests.userId, users.id))
        .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
        .where(and(...conds))
        .orderBy(desc(leaveRequests.createdAt))
        .limit(opts.limit)
        .offset(opts.offset);
    });
  }

  insertRequestTx(companyId: string, data: typeof leaveRequests.$inferInsert, tx: TenantTx) {
    return tx
      .insert(leaveRequests)
      .values({ ...data, companyId })
      .returning();
  }

  updateRequestTx(
    companyId: string,
    id: string,
    data: Partial<typeof leaveRequests.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(leaveRequests)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(leaveRequests.companyId, companyId),
          eq(leaveRequests.id, id),
          isNull(leaveRequests.deletedAt),
        ),
      )
      .returning();
  }

  /** Team calendar: APPROVED leave overlapping [from, toExclusive). No `reason` (privacy). */
  findCalendar(companyId: string, range: { from: string; toExclusive: string }) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select({
          userId: leaveRequests.userId,
          userFullName: users.fullName,
          leaveTypeCode: leaveTypes.code,
          leaveTypeName: leaveTypes.name,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          totalDays: leaveRequests.totalDays,
        })
        .from(leaveRequests)
        .innerJoin(users, eq(leaveRequests.userId, users.id))
        .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
        .where(
          and(
            eq(leaveRequests.companyId, companyId),
            eq(leaveRequests.status, "approved"),
            isNull(leaveRequests.deletedAt),
            lt(leaveRequests.startDate, range.toExclusive),
            gte(leaveRequests.endDate, range.from),
          ),
        )
        .orderBy(leaveRequests.startDate, users.fullName),
    );
  }
}
