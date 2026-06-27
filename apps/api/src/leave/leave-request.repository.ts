import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { leaveBalances, leaveRequests, leaveTypes } from "../db/schema/hr";
import {
  leaveBalanceTransactions,
  leavePolicies,
  leaveRequestApprovals,
  leaveRequestDays,
} from "../db/schema/leave";

/**
 * S3-LEAVE-BE-2 — persistence for the LEAVE request WORKFLOW (draft / submit / cancel). Every method takes
 * the caller's `tx` so the SERVICE owns withTenant (RLS + explicit company_id, BẤT BIẾN #1).
 *
 * BẤT BIẾN #2: leave_balance_transactions + leave_request_approvals = INSERT ONLY (append-only ledger/history,
 * mig 0453 GRANT SELECT,INSERT). KHÔNG có method UPDATE/DELETE cho 2 bảng đó ở đây. leave_request_days dùng
 * soft-delete (status/deleted_at) khi thay nội dung nháp — KHÔNG hard-delete.
 */
@Injectable()
export class LeaveRequestRepository {
  // ─── leave_policies (resolve chính sách áp dụng) ─────────────────────────────

  /**
   * Chính sách Company-scope Active áp dụng cho loại nghỉ tại `refDate` (effective range). Lấy priority cao
   * nhất. Scope hẹp hơn (Department/Employee) DEFERRED — đủ cho default policy seed (DEFAULT_ANNUAL Company).
   */
  async findActivePolicyForTypeTx(
    companyId: string,
    leaveTypeId: string,
    refDate: string,
    tx: TenantTx,
  ) {
    const [row] = await tx
      .select()
      .from(leavePolicies)
      .where(
        and(
          eq(leavePolicies.companyId, companyId),
          eq(leavePolicies.leaveTypeId, leaveTypeId),
          eq(leavePolicies.policyScope, "Company"),
          eq(leavePolicies.status, "Active"),
          isNull(leavePolicies.deletedAt),
          lte(leavePolicies.effectiveFrom, refDate),
          sql`(${leavePolicies.effectiveTo} IS NULL OR ${leavePolicies.effectiveTo} >= ${refDate})`,
        ),
      )
      .orderBy(desc(leavePolicies.priority))
      .limit(1);
    return row;
  }

  // ─── leave_requests ──────────────────────────────────────────────────────────

  /** FOR UPDATE re-read inside the tx → serialize submit/cancel/update on the same request row (TOCTOU). */
  async findRequestForUpdateTx(companyId: string, id: string, tx: TenantTx) {
    const [row] = await tx
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
    return row;
  }

  /** Own request by id (self-locked by user_id) — for detail. Cross-tenant/not-owner → undefined. */
  async findOwnRequestByIdTx(companyId: string, userId: string, id: string, tx: TenantTx) {
    const [row] = await tx
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.companyId, companyId),
          eq(leaveRequests.userId, userId),
          eq(leaveRequests.id, id),
          isNull(leaveRequests.deletedAt),
        ),
      )
      .limit(1);
    return row;
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

  /**
   * Overlap guard: tồn tại đơn KHÁC của user còn hiệu lực (Pending/Approved — TitleCase ∪ lowercase legacy)
   * giao [newStart, newEnd]? Rejected/Cancelled/Revoked KHÔNG chặn. Half-day cùng ngày VẪN coi là chồng lấn
   * (KHÔNG có ngoại lệ buổi). Trả về dòng xung đột đầu tiên (id + start/end) hoặc undefined.
   */
  async findOverlappingRequestTx(
    companyId: string,
    userId: string,
    excludeId: string,
    newStart: string,
    newEnd: string,
    tx: TenantTx,
  ) {
    const [row] = await tx
      .select({
        id: leaveRequests.id,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        status: leaveRequests.status,
      })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.companyId, companyId),
          eq(leaveRequests.userId, userId),
          ne(leaveRequests.id, excludeId),
          isNull(leaveRequests.deletedAt),
          inArray(leaveRequests.status, ["Pending", "Approved", "pending", "approved"]),
          lte(leaveRequests.startDate, newEnd),
          gte(leaveRequests.endDate, newStart),
        ),
      )
      .limit(1);
    return row;
  }

  /** Own requests list (self-locked) + leave-type join. Filters: status / leaveTypeId / [fromDate,toDate]. */
  listOwnRequestsTx(companyId: string, userId: string, filters: OwnRequestFilters, tx: TenantTx) {
    return tx
      .select({
        id: leaveRequests.id,
        leaveTypeId: leaveRequests.leaveTypeId,
        leaveTypeCode: leaveTypes.code,
        leaveTypeName: leaveTypes.name,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        durationType: leaveRequests.durationType,
        totalDays: leaveRequests.totalDays,
        totalHours: leaveRequests.totalHours,
        status: leaveRequests.status,
        reason: leaveRequests.reason,
        balanceEffectStatus: leaveRequests.balanceEffectStatus,
        submittedAt: leaveRequests.submittedAt,
        createdAt: leaveRequests.createdAt,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(and(...ownRequestConds(companyId, userId, filters)))
      .orderBy(desc(leaveRequests.createdAt))
      .limit(filters.limit)
      .offset(filters.offset);
  }

  async countOwnRequestsTx(
    companyId: string,
    userId: string,
    filters: OwnRequestFilters,
    tx: TenantTx,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(leaveRequests)
      .where(and(...ownRequestConds(companyId, userId, filters)));
    return row?.n ?? 0;
  }

  // ─── leave_request_days (soft-delete on replace; status='Cancelled' on cancel) ───

  insertDayTx(companyId: string, data: typeof leaveRequestDays.$inferInsert, tx: TenantTx) {
    return tx.insert(leaveRequestDays).values({ ...data, companyId });
  }

  /** Soft-delete Active day-rows of a request (frees the partial-unique slot before re-inserting fresh). */
  softDeleteActiveDaysTx(companyId: string, requestId: string, actorId: string, tx: TenantTx) {
    return tx
      .update(leaveRequestDays)
      .set({ deletedAt: new Date(), deletedBy: actorId, updatedAt: new Date() })
      .where(
        and(
          eq(leaveRequestDays.companyId, companyId),
          eq(leaveRequestDays.leaveRequestId, requestId),
          eq(leaveRequestDays.status, "Active"),
          isNull(leaveRequestDays.deletedAt),
        ),
      );
  }

  /** Mark Active day-rows Cancelled (request cancelled). KHÔNG hard-delete. */
  cancelActiveDaysTx(companyId: string, requestId: string, actorId: string, tx: TenantTx) {
    return tx
      .update(leaveRequestDays)
      .set({ status: "Cancelled", updatedBy: actorId, updatedAt: new Date() })
      .where(
        and(
          eq(leaveRequestDays.companyId, companyId),
          eq(leaveRequestDays.leaveRequestId, requestId),
          eq(leaveRequestDays.status, "Active"),
          isNull(leaveRequestDays.deletedAt),
        ),
      );
  }

  /** Day-rows of a request (not soft-deleted), oldest first — for detail. */
  findDaysByRequestTx(companyId: string, requestId: string, tx: TenantTx) {
    return tx
      .select()
      .from(leaveRequestDays)
      .where(
        and(
          eq(leaveRequestDays.companyId, companyId),
          eq(leaveRequestDays.leaveRequestId, requestId),
          isNull(leaveRequestDays.deletedAt),
        ),
      )
      .orderBy(asc(leaveRequestDays.workDate));
  }

  // ─── leave_request_approvals (APPEND-ONLY — INSERT only) ─────────────────────

  insertApprovalTx(
    companyId: string,
    data: typeof leaveRequestApprovals.$inferInsert,
    tx: TenantTx,
  ) {
    return tx.insert(leaveRequestApprovals).values({ ...data, companyId });
  }

  /** Approval history of a request, chronological — for detail. */
  findApprovalsByRequestTx(companyId: string, requestId: string, tx: TenantTx) {
    return tx
      .select()
      .from(leaveRequestApprovals)
      .where(
        and(
          eq(leaveRequestApprovals.companyId, companyId),
          eq(leaveRequestApprovals.leaveRequestId, requestId),
        ),
      )
      .orderBy(asc(leaveRequestApprovals.actedAt));
  }

  // ─── leave_balance_transactions (APPEND-ONLY) + pending bookkeeping ──────────

  insertBalanceTransactionTx(
    companyId: string,
    data: typeof leaveBalanceTransactions.$inferInsert,
    tx: TenantTx,
  ) {
    return tx.insert(leaveBalanceTransactions).values({ ...data, companyId });
  }

  /**
   * Cộng `deltaDays` (chuỗi numeric, có thể âm) vào pending_days của 1 balance row. NEVER touch remaining_days
   * (GENERATED total-used) hay used_days (đó là việc của approve, BE-3). Reserve = +days, Release = −days.
   */
  adjustBalancePendingTx(companyId: string, balanceId: string, deltaDays: string, tx: TenantTx) {
    return tx
      .update(leaveBalances)
      .set({
        pendingDays: sql`COALESCE(${leaveBalances.pendingDays}, 0) + ${deltaDays}::numeric`,
        updatedAt: new Date(),
      })
      .where(and(eq(leaveBalances.companyId, companyId), eq(leaveBalances.id, balanceId)))
      .returning();
  }
}

export interface OwnRequestFilters {
  status?: string;
  leaveTypeId?: string;
  fromDate?: string;
  toDate?: string;
  limit: number;
  offset: number;
}

/** WHERE của own-list/count (self-locked by user_id). Tách ra để list + count dùng CHUNG (DRY, không drift). */
function ownRequestConds(companyId: string, userId: string, filters: OwnRequestFilters) {
  const conds = [
    eq(leaveRequests.companyId, companyId),
    eq(leaveRequests.userId, userId),
    isNull(leaveRequests.deletedAt),
  ];
  if (filters.status) conds.push(eq(leaveRequests.status, filters.status));
  if (filters.leaveTypeId) conds.push(eq(leaveRequests.leaveTypeId, filters.leaveTypeId));
  if (filters.fromDate) conds.push(gte(leaveRequests.startDate, filters.fromDate));
  if (filters.toDate) conds.push(lte(leaveRequests.startDate, filters.toDate));
  return conds;
}
