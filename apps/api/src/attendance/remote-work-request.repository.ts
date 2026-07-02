import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { remoteWorkRequestApprovals, remoteWorkRequests } from "../db/schema/attendance";
import { employeeProfiles } from "../db/schema/employees";
import { orgUnits } from "../db/schema/org";
import { users } from "../db/schema/users";

/**
 * S3-ATT-BE-5 — persistence for the remote/onsite-work request workflow (DB-04 §7.8/7.9).
 *
 * Every method runs inside the caller's tenant tx (withTenant → RLS + FORCE, BẤT BIẾN #1) and ANDs an
 * explicit company_id (defense-in-depth). remote_work_request_approvals is APPEND-ONLY (BẤT BIẾN #2) —
 * only INSERT/SELECT (app role has no UPDATE/DELETE grant, mig 0452).
 *
 * The request row is keyed by employee_id (canonical) but joined to employee_profiles + users + org_units
 * so a DataScope predicate (referencing employee_profiles columns) can filter the list, and the detail row
 * carries the scope columns (userId / orgUnitId / directManagerUserId) for the membership test — mirrors
 * AttendanceAdjustmentRepository (S3-ATT-BE-4).
 */

const REQUEST_COLUMNS = {
  id: remoteWorkRequests.id,
  companyId: remoteWorkRequests.companyId,
  requestCode: remoteWorkRequests.requestCode,
  employeeId: remoteWorkRequests.employeeId,
  requestType: remoteWorkRequests.requestType,
  startDate: remoteWorkRequests.startDate,
  endDate: remoteWorkRequests.endDate,
  startTime: remoteWorkRequests.startTime,
  endTime: remoteWorkRequests.endTime,
  attendanceMode: remoteWorkRequests.attendanceMode,
  locationText: remoteWorkRequests.locationText,
  reason: remoteWorkRequests.reason,
  taskId: remoteWorkRequests.taskId,
  projectId: remoteWorkRequests.projectId,
  status: remoteWorkRequests.status,
  submittedAt: remoteWorkRequests.submittedAt,
  requestedBy: remoteWorkRequests.requestedBy,
  currentApproverUserId: remoteWorkRequests.currentApproverUserId,
  currentApproverEmployeeId: remoteWorkRequests.currentApproverEmployeeId,
  watcherUserIds: remoteWorkRequests.watcherUserIds,
  approvedBy: remoteWorkRequests.approvedBy,
  approvedAt: remoteWorkRequests.approvedAt,
  rejectedBy: remoteWorkRequests.rejectedBy,
  rejectedAt: remoteWorkRequests.rejectedAt,
  rejectReason: remoteWorkRequests.rejectReason,
  cancelledAt: remoteWorkRequests.cancelledAt,
  cancelledBy: remoteWorkRequests.cancelledBy,
  attachmentFileId: remoteWorkRequests.attachmentFileId,
  createdAt: remoteWorkRequests.createdAt,
  updatedAt: remoteWorkRequests.updatedAt,
  // Employee summary + scope columns (from the employee_profiles / users / org_units joins).
  employeeCode: employeeProfiles.employeeCode,
  fullName: users.fullName,
  userId: employeeProfiles.userId,
  orgUnitId: employeeProfiles.orgUnitId,
  orgUnitName: orgUnits.name,
  directManagerUserId: employeeProfiles.directManagerId,
} as const;

export interface RemoteRequestListFilters {
  status?: string;
  requestType?: string;
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
  page: number;
  pageSize: number;
}

@Injectable()
export class RemoteWorkRequestRepository {
  constructor(private readonly db: DatabaseService) {}

  // ─── request writes ──────────────────────────────────────────────────────────

  insertRequestTx(companyId: string, data: typeof remoteWorkRequests.$inferInsert, tx: TenantTx) {
    return tx
      .insert(remoteWorkRequests)
      .values({ ...data, companyId })
      .returning();
  }

  updateRequestTx(
    companyId: string,
    id: string,
    data: Partial<typeof remoteWorkRequests.$inferInsert>,
    tx: TenantTx,
  ) {
    return tx
      .update(remoteWorkRequests)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(remoteWorkRequests.companyId, companyId),
          eq(remoteWorkRequests.id, id),
          isNull(remoteWorkRequests.deletedAt),
        ),
      )
      .returning();
  }

  /**
   * FOR UPDATE row-lock on the request table ALONE (mirror AttendanceAdjustmentRepository) — two
   * concurrent submit/approve/reject/cancel serialize here: the second blocks then re-reads status.
   */
  findRequestByIdForUpdateTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(remoteWorkRequests)
      .where(
        and(
          eq(remoteWorkRequests.companyId, companyId),
          eq(remoteWorkRequests.id, id),
          isNull(remoteWorkRequests.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
  }

  // ─── request reads (join for summary + scope) ────────────────────────────────

  findDetailByIdTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select(REQUEST_COLUMNS)
      .from(remoteWorkRequests)
      .leftJoin(employeeProfiles, eq(remoteWorkRequests.employeeId, employeeProfiles.id))
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .where(
        and(
          eq(remoteWorkRequests.companyId, companyId),
          eq(remoteWorkRequests.id, id),
          isNull(remoteWorkRequests.deletedAt),
        ),
      )
      .limit(1);
  }

  /**
   * Scoped/filtered page. `scopeConds` is the DataScope predicate (over employee_profiles) for team/
   * company lists, or the self-lock (employeeProfiles.userId = actor) for "my". One page query + one
   * count query — no N+1.
   */
  async listTx(
    companyId: string,
    scopeConds: SQL[],
    filters: RemoteRequestListFilters,
    tx: TenantTx,
  ): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const where = and(...this.buildConds(companyId, scopeConds, filters));
    const offset = (filters.page - 1) * filters.pageSize;

    const rows = await tx
      .select(REQUEST_COLUMNS)
      .from(remoteWorkRequests)
      .leftJoin(employeeProfiles, eq(remoteWorkRequests.employeeId, employeeProfiles.id))
      .leftJoin(users, eq(employeeProfiles.userId, users.id))
      .leftJoin(orgUnits, eq(employeeProfiles.orgUnitId, orgUnits.id))
      .where(where)
      .orderBy(desc(remoteWorkRequests.startDate), desc(remoteWorkRequests.createdAt))
      .limit(filters.pageSize)
      .offset(offset);

    const [countRow] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(remoteWorkRequests)
      .leftJoin(employeeProfiles, eq(remoteWorkRequests.employeeId, employeeProfiles.id))
      .where(where);

    return { rows, total: countRow?.total ?? 0 };
  }

  private buildConds(
    companyId: string,
    scopeConds: SQL[],
    filters: RemoteRequestListFilters,
  ): SQL[] {
    const conds: SQL[] = [
      eq(remoteWorkRequests.companyId, companyId),
      isNull(remoteWorkRequests.deletedAt),
      ...scopeConds,
    ];
    if (filters.status) conds.push(eq(remoteWorkRequests.status, filters.status));
    if (filters.requestType) conds.push(eq(remoteWorkRequests.requestType, filters.requestType));
    if (filters.employeeId) conds.push(eq(remoteWorkRequests.employeeId, filters.employeeId));
    if (filters.fromDate) conds.push(gte(remoteWorkRequests.startDate, filters.fromDate));
    if (filters.toDate) conds.push(lte(remoteWorkRequests.endDate, filters.toDate));
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

  /** Same, resolved by the linked user id — used to resolve the caller's OWN employee row. */
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

  /**
   * Every candidate user id (approver + watchers) that DOES belong to `companyId` (via a users row scoped
   * to the tenant) — the caller diffs this against the requested set to fail-closed on any cross-tenant id
   * (done_when: "current_approver_user_id/watcher_user_ids PHẢI cùng company").
   */
  async findUserIdsInCompanyTx(
    companyId: string,
    candidateIds: string[],
    tx: TenantTx,
  ): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, companyId), inArray(users.id, candidateIds)));
    return new Set(rows.map((r) => r.id));
  }

  // ─── remote_work_request_approvals (APPEND-ONLY ledger §7.9) ──────────────────

  /** Append 1 ledger row (INSERT only — BẤT BIẾN #2). company_id from context + explicit. */
  insertApprovalTx(
    companyId: string,
    row: typeof remoteWorkRequestApprovals.$inferInsert,
    tx: TenantTx,
  ) {
    return tx
      .insert(remoteWorkRequestApprovals)
      .values({ ...row, companyId })
      .returning();
  }

  findApprovalsByRequestTx(companyId: string, requestId: string, tx: TenantTx) {
    return tx
      .select()
      .from(remoteWorkRequestApprovals)
      .where(
        and(
          eq(remoteWorkRequestApprovals.companyId, companyId),
          eq(remoteWorkRequestApprovals.remoteWorkRequestId, requestId),
        ),
      )
      .orderBy(remoteWorkRequestApprovals.stepOrder, remoteWorkRequestApprovals.actedAt);
  }

  // ─── attendance_records upsert-by-day (Approved → affects calc, IDEMPOTENT) ───

  /**
   * UPSERT-BY (company_id, employee_id, work_date, shift_id NULL) for a single remote-affected day —
   * re-approve does NOT duplicate a row (done_when idempotent). shift_id stays NULL here (remote days are
   * not tied to a shift) so this always targets the `uq_attendance_records_employee_date_no_shift` unique
   * partial index (mig 0452). userId is required by the legacy NOT NULL column.
   */
  async upsertRemoteAffectedRecordTx(
    companyId: string,
    row: {
      userId: string;
      employeeId: string;
      workDate: string;
      remoteWorkRequestId: string;
      workMode: string;
      attendanceStatus: string;
      actorId: string;
    },
    tx: TenantTx,
  ): Promise<{ id: string }> {
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO attendance_records
        (company_id, user_id, employee_id, work_date, status, attendance_status, work_mode,
         remote_work_request_id, created_by, updated_by)
      VALUES
        (${companyId}, ${row.userId}, ${row.employeeId}, ${row.workDate}, 'present',
         ${row.attendanceStatus}, ${row.workMode}, ${row.remoteWorkRequestId}, ${row.actorId}, ${row.actorId})
      ON CONFLICT (company_id, employee_id, work_date)
        WHERE deleted_at IS NULL AND employee_id IS NOT NULL AND shift_id IS NULL
      DO UPDATE SET
        attendance_status = EXCLUDED.attendance_status,
        work_mode = EXCLUDED.work_mode,
        remote_work_request_id = EXCLUDED.remote_work_request_id,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING id
    `);
    const record = inserted.rows[0];
    if (!record) throw new Error("Failed to upsert remote-affected attendance_records row");
    return record;
  }
}
