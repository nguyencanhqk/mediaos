import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { attendanceAdjustmentItems } from "../db/schema/attendance";
import { attendanceAdjustmentRequests } from "../db/schema/hr";
import { employeeProfiles } from "../db/schema/employees";
import { orgUnits } from "../db/schema/org";
import { users } from "../db/schema/users";

/**
 * S3-ATT-BE-4 — persistence for the canonical adjustment-request surface.
 *
 * Every method runs inside the caller's tenant tx (withTenant → RLS + FORCE, BẤT BIẾN #1) and ANDs an
 * explicit company_id (defense-in-depth). attendance_adjustment_items is APPEND-ONLY (BẤT BIẾN #2) —
 * only INSERT/SELECT (the app role has no UPDATE/DELETE grant; enforced at the DB, mig 0452).
 *
 * The request row is keyed by employee_id (canonical) but joined to employee_profiles + users + org_units
 * so a DataScope predicate (which references employee_profiles columns) can filter the list, and the
 * detail row carries the scope columns (userId / orgUnitId / directManagerUserId) for the membership test.
 */

/** Request + employee summary + scope columns (list & detail share this projection). */
const REQUEST_COLUMNS = {
  id: attendanceAdjustmentRequests.id,
  companyId: attendanceAdjustmentRequests.companyId,
  requestCode: attendanceAdjustmentRequests.requestCode,
  employeeId: attendanceAdjustmentRequests.employeeId,
  userId: attendanceAdjustmentRequests.userId,
  attendanceRecordId: attendanceAdjustmentRequests.attendanceRecordId,
  workDate: attendanceAdjustmentRequests.workDate,
  requestType: attendanceAdjustmentRequests.requestType,
  requestedCheckInAt: attendanceAdjustmentRequests.requestedCheckInAt,
  requestedCheckOutAt: attendanceAdjustmentRequests.requestedCheckOutAt,
  reason: attendanceAdjustmentRequests.reason,
  status: attendanceAdjustmentRequests.status,
  submittedAt: attendanceAdjustmentRequests.submittedAt,
  requestedBy: attendanceAdjustmentRequests.requestedBy,
  currentApproverUserId: attendanceAdjustmentRequests.currentApproverUserId,
  reviewedBy: attendanceAdjustmentRequests.reviewedBy,
  reviewedAt: attendanceAdjustmentRequests.reviewedAt,
  reviewNote: attendanceAdjustmentRequests.reviewNote,
  attachmentFileId: attendanceAdjustmentRequests.attachmentFileId,
  taskId: attendanceAdjustmentRequests.taskId,
  createdAt: attendanceAdjustmentRequests.createdAt,
  updatedAt: attendanceAdjustmentRequests.updatedAt,
  // Employee summary + scope columns (from the employee_profiles / users / org_units joins).
  employeeCode: employeeProfiles.employeeCode,
  fullName: users.fullName,
  orgUnitId: employeeProfiles.orgUnitId,
  orgUnitName: orgUnits.name,
  directManagerUserId: employeeProfiles.directManagerId,
} as const;

export type AdjustmentRequestRow = {
  [K in keyof typeof REQUEST_COLUMNS]: unknown;
};

export interface AdjustmentListFilters {
  status?: string;
  requestType?: string;
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class AttendanceAdjustmentRepository {
  constructor(private readonly db: DatabaseService) {}

  // ─── request writes ──────────────────────────────────────────────────────────

  insertRequestTx(
    companyId: string,
    data: typeof attendanceAdjustmentRequests.$inferInsert,
    tx: TenantTx,
  ) {
    return tx
      .insert(attendanceAdjustmentRequests)
      .values({ ...data, companyId })
      .returning();
  }

  updateRequestTx(
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

  /**
   * FOR UPDATE row-lock on the request table ALONE (no join — a joined FOR UPDATE would lock the
   * employee/user rows too and can surprise). Two concurrent approve/reject serialize here: the second
   * blocks on the lock, then re-reads status≠Pending → 409.
   */
  findRequestByIdForUpdateTx(companyId: string, id: string, tx: TenantTx) {
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

  // ─── request reads (join for summary + scope) ────────────────────────────────

  findDetailByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select(REQUEST_COLUMNS)
      .from(attendanceAdjustmentRequests)
      .leftJoin(users, eq(attendanceAdjustmentRequests.userId, users.id))
      .leftJoin(employeeProfiles, eq(attendanceAdjustmentRequests.employeeId, employeeProfiles.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
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
   * Scoped/filtered page. `scopeConds` is the DataScope predicate (over employee_profiles) for team/
   * company lists, or the self-lock (attendanceAdjustmentRequests.userId = actor) for "my". One page
   * query + one count query — no N+1.
   */
  async listTx(
    companyId: string,
    scopeConds: SQL[],
    filters: AdjustmentListFilters,
    tx: TenantTx,
  ): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const where = and(...this.buildConds(companyId, scopeConds, filters));
    const offset = (filters.page - 1) * filters.pageSize;

    const rows = await tx
      .select(REQUEST_COLUMNS)
      .from(attendanceAdjustmentRequests)
      .leftJoin(users, eq(attendanceAdjustmentRequests.userId, users.id))
      .leftJoin(employeeProfiles, eq(attendanceAdjustmentRequests.employeeId, employeeProfiles.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .where(where)
      .orderBy(
        desc(attendanceAdjustmentRequests.workDate),
        desc(attendanceAdjustmentRequests.createdAt),
      )
      .limit(filters.pageSize)
      .offset(offset);

    const [countRow] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(attendanceAdjustmentRequests)
      .leftJoin(employeeProfiles, eq(attendanceAdjustmentRequests.employeeId, employeeProfiles.id))
      .where(where);

    return { rows, total: countRow?.total ?? 0 };
  }

  private buildConds(companyId: string, scopeConds: SQL[], filters: AdjustmentListFilters): SQL[] {
    const conds: SQL[] = [
      eq(attendanceAdjustmentRequests.companyId, companyId),
      isNull(attendanceAdjustmentRequests.deletedAt),
      ...scopeConds,
    ];
    if (filters.status) conds.push(eq(attendanceAdjustmentRequests.status, filters.status));
    if (filters.requestType)
      conds.push(eq(attendanceAdjustmentRequests.requestType, filters.requestType));
    if (filters.employeeId)
      conds.push(eq(attendanceAdjustmentRequests.employeeId, filters.employeeId));
    if (filters.fromDate) conds.push(gte(attendanceAdjustmentRequests.workDate, filters.fromDate));
    if (filters.toDate) conds.push(lte(attendanceAdjustmentRequests.workDate, filters.toDate));
    return conds;
  }

  // ─── employee scope resolution (create-thay / approve membership) ─────────────

  /** Employee scope target by profile id — userId / orgUnitId / directManagerUserId for isEmployeeInScope. */
  async findEmployeeScopeByIdTx(companyId: string, employeeId: string, tx: TenantTx) {
    const rows = await tx
      .select({
        id: employeeProfiles.id,
        userId: employeeProfiles.userId,
        companyId: employeeProfiles.companyId,
        orgUnitId: employeeProfiles.orgUnitId,
        directManagerUserId: employeeProfiles.directManagerId,
        status: employeeProfiles.status,
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
    return rows[0] ?? null;
  }

  /** Same, resolved by the linked user id (fallback when a request has no employee_id backfilled). */
  async findEmployeeScopeByUserIdTx(companyId: string, userId: string, tx: TenantTx) {
    const rows = await tx
      .select({
        id: employeeProfiles.id,
        userId: employeeProfiles.userId,
        companyId: employeeProfiles.companyId,
        orgUnitId: employeeProfiles.orgUnitId,
        directManagerUserId: employeeProfiles.directManagerId,
        status: employeeProfiles.status,
      })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, companyId),
          eq(employeeProfiles.userId, userId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // ─── attendance_adjustment_items (APPEND-ONLY ledger §7.7) ────────────────────

  /** Append ledger rows (INSERT only — BẤT BIẾN #2). company_id from context + explicit. */
  insertItemsTx(
    companyId: string,
    rows: (typeof attendanceAdjustmentItems.$inferInsert)[],
    tx: TenantTx,
  ) {
    if (rows.length === 0) return Promise.resolve([]);
    return tx
      .insert(attendanceAdjustmentItems)
      .values(rows.map((r) => ({ ...r, companyId })))
      .returning();
  }

  findItemsByRequestTx(companyId: string, requestId: string, tx: TenantTx) {
    return tx
      .select()
      .from(attendanceAdjustmentItems)
      .where(
        and(
          eq(attendanceAdjustmentItems.companyId, companyId),
          eq(attendanceAdjustmentItems.requestId, requestId),
        ),
      )
      .orderBy(attendanceAdjustmentItems.createdAt);
  }
}
