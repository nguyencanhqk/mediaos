import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type {
  LeaveManagementListResponse,
  LeaveRequestDetailView,
  PendingLeaveRequestListQuery,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { DataScopeService } from "../permission/data-scope.service";
import { LeaveRepository } from "./leave.repository";
import { LeaveRequestRepository } from "./leave-request.repository";
import { LeaveApprovalRepository } from "./leave-approval.repository";
import { LEAVE_ERR, numOrNull, round2, yearOf, type LeaveRequestRow } from "./leave-request.logic";
import { toDetailView } from "./leave-request.mappers";
import { toManagementListItemView } from "./leave-approval.mappers";

interface Actor {
  id: string;
  companyId: string;
}

/**
 * S3-LEAVE-BE-3 — LEAVE APPROVAL WORKFLOW (manager / HR): duyệt / từ chối đơn Pending + danh sách quản lý.
 *
 * FSM (TitleCase): Pending → (approve) Approved · Pending → (reject) Rejected. CHỈ Pending mới quyết được
 * (else 409). BẤT BIẾN chống double-approve: findRequestForUpdateTx (FOR UPDATE row-lock) + status-guard.
 *
 * PHÂN QUYỀN (2 tầng): controller PermissionGuard là cổng thô (approve/reject/view:leave). Ở service:
 *   1. resolveContext + isEmployeeInScope trên OWNER employee (manager=Team direct_manager/EMR · hr=Company,
 *      tái dùng S2-INT-2) — ngoài scope → 403; cross-tenant → 404 (RLS, KHÔNG lộ tồn tại).
 *   2. Self-approval: approver.id === request.userId → 422 LEAVE-ERR-APPROVER-INVALID (SPEC-05 §14.9 MUST).
 * Cả 2 chạy TRƯỚC mọi mutation.
 *
 * BALANCE: approve chuyển Reserved→Used (pending -= totalDays, used += totalDays race-safe qua
 * convertReserveToUseByBalanceIdTx — WHERE used+delta<=total ⇒ 2 duyệt song song KHÔNG trừ 2 lần), ghi
 * ledger RELEASE + USE. reject hoàn giữ-chỗ (pending -= totalDays, RELEASE, used KHÔNG đổi). Ledger
 * (leave_balance_transactions) + history (leave_request_approvals) = INSERT-only (append-only, BẤT BIẾN #2).
 * audit + outbox BÊN TRONG cùng tx withTenant (rollback ⇒ không audit/event ma, BẤT BIẾN #1).
 */
@Injectable()
export class LeaveApprovalService {
  private readonly logger = new Logger(LeaveApprovalService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly leaveRepo: LeaveRepository,
    private readonly reqRepo: LeaveRequestRepository,
    private readonly approvalRepo: LeaveApprovalRepository,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── GET /leave/requests (management list — scoped) ──────────────────────────

  async listPending(
    actor: Actor,
    query: PendingLeaveRequestListQuery,
  ): Promise<LeaveManagementListResponse> {
    // GATE + SCOPE: strongest granted scope for view:leave (sensitive → wildcard does not satisfy). 403 if
    // none. Then translate to a query predicate (manager=Team / hr=Company) ANDed into the list SELECT.
    const scope = await this.dataScope.resolveAndAssert(
      actor.id,
      actor.companyId,
      "view",
      "leave",
      {
        isSensitive: true,
      },
    );
    const ctx = await this.dataScope.resolveContext(actor.id, actor.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);

    const limit = query.pageSize;
    const offset = (query.page - 1) * query.pageSize;
    const filters = {
      status: query.status,
      leaveTypeId: query.leaveTypeId,
      employeeId: query.employeeId,
      departmentId: query.departmentId,
      fromDate: query.fromDate,
      toDate: query.toDate,
      limit,
      offset,
    };

    return this.db.withTenant(actor.companyId, async (tx) => {
      const total = await this.approvalRepo.countPendingScopedTx(
        actor.companyId,
        scopeCond,
        filters,
        tx,
      );
      const rows = await this.approvalRepo.listPendingScopedTx(
        actor.companyId,
        scopeCond,
        filters,
        tx,
      );
      const totalPages = query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0;
      return {
        items: rows.map(toManagementListItemView),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages,
          hasNext: query.page < totalPages,
          hasPrev: query.page > 1,
        },
      };
    });
  }

  // ─── POST /leave/requests/:id/approve (Pending → Approved) ───────────────────

  async approve(actor: Actor, id: string, note?: string): Promise<LeaveRequestDetailView> {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.loadPendingForDecision(tx, actor, id);

        // BALANCE: Reserved → Used (race-safe). Non-deduct / no-reserve request keeps effect unchanged.
        let balanceEffectStatus = request.balanceEffectStatus ?? "None";
        if (request.balanceEffectStatus === "Reserved") {
          balanceEffectStatus = await this.convertReserveToUsed(tx, actor, request);
        }

        const [updated] = await this.reqRepo.updateRequestTx(
          actor.companyId,
          id,
          {
            status: "Approved",
            approvedAt: new Date(),
            approvedBy: actor.id,
            balanceEffectStatus,
            updatedBy: actor.id,
          },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to approve leave request");

        // ATT-sync handoff (S3-INT-1): flag working day-rows Pending. We do NOT build the sync here.
        await this.approvalRepo.markDaysSyncPendingTx(actor.companyId, id, actor.id, tx);

        await this.reqRepo.insertApprovalTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            leaveRequestId: id,
            approvalStep: 1,
            approverUserId: actor.id,
            approverEmployeeId: request.currentApproverEmployeeId ?? null,
            action: "APPROVE",
            fromStatus: "Pending",
            toStatus: "Approved",
            comment: note ?? null,
            actedAt: new Date(),
          },
          tx,
        );
        await this.audit.record(tx, {
          action: "LeaveApproved",
          objectType: "leave_request",
          objectId: id,
          actorUserId: actor.id,
          before: { status: "Pending", balanceEffectStatus: request.balanceEffectStatus },
          after: { status: "Approved", approvedBy: actor.id, balanceEffectStatus },
        });
        await this.outbox.enqueue(tx, {
          eventType: "leave.request.approved",
          payload: {
            requestId: id,
            userId: request.userId,
            employeeId: request.employeeId,
            approvedBy: actor.id,
            totalDays: Number(request.totalDays),
            totalHours: numOrNull(request.totalHours),
            // S4-INT-3: actor-exclusion — approver (actor) không tự nhận noti
            actorUserId: actor.id,
            eventCode: "LEAVE_REQUEST_APPROVED",
          },
        });
        return this.buildDetail(tx, actor.companyId, updated);
      })
      .catch((err: unknown) => this.mapError(err, "approve", { companyId: actor.companyId, id }));
  }

  // ─── POST /leave/requests/:id/reject (Pending → Rejected) ────────────────────

  async reject(actor: Actor, id: string, reason: string): Promise<LeaveRequestDetailView> {
    const trimmed = reason?.trim();
    if (!trimmed) {
      throw new UnprocessableEntityException({
        code: LEAVE_ERR.REASON_MISSING,
        message: "Lý do từ chối là bắt buộc",
      });
    }
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.loadPendingForDecision(tx, actor, id);

        // BALANCE: release the reservation (pending -= totalDays). used_days NEVER changes on reject.
        let balanceEffectStatus = request.balanceEffectStatus ?? "None";
        if (request.balanceEffectStatus === "Reserved") {
          balanceEffectStatus = await this.releaseReserve(tx, actor, request);
        }

        const [updated] = await this.reqRepo.updateRequestTx(
          actor.companyId,
          id,
          {
            status: "Rejected",
            rejectedAt: new Date(),
            rejectedBy: actor.id,
            rejectionReason: trimmed,
            balanceEffectStatus,
            updatedBy: actor.id,
          },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to reject leave request");

        // NO attendance sync mark, NO attendance record created — a rejected leave never touches ATT.
        await this.reqRepo.insertApprovalTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            leaveRequestId: id,
            approvalStep: 1,
            approverUserId: actor.id,
            approverEmployeeId: request.currentApproverEmployeeId ?? null,
            action: "REJECT",
            fromStatus: "Pending",
            toStatus: "Rejected",
            comment: trimmed,
            rejectionReason: trimmed,
            actedAt: new Date(),
          },
          tx,
        );
        await this.audit.record(tx, {
          action: "LeaveRejected",
          objectType: "leave_request",
          objectId: id,
          actorUserId: actor.id,
          before: { status: "Pending", balanceEffectStatus: request.balanceEffectStatus },
          after: { status: "Rejected", rejectedBy: actor.id, balanceEffectStatus },
        });
        await this.outbox.enqueue(tx, {
          eventType: "leave.request.rejected",
          payload: {
            requestId: id,
            userId: request.userId,
            employeeId: request.employeeId,
            rejectedBy: actor.id,
            // S4-INT-3: actor-exclusion — approver (actor) không tự nhận noti
            actorUserId: actor.id,
            eventCode: "LEAVE_REQUEST_REJECTED",
          },
        });
        return this.buildDetail(tx, actor.companyId, updated);
      })
      .catch((err: unknown) => this.mapError(err, "reject", { companyId: actor.companyId, id }));
  }

  // ─── Shared: load + authorize + status-guard (FOR UPDATE) ────────────────────

  /**
   * FOR UPDATE re-read → cross-tenant/absent → 404 (RLS, no leak). Then, BEFORE any mutation:
   * (1) scope-check the OWNER employee (out-of-scope → 403), (2) block self-approval (422), (3) require
   * status = Pending (else 409). Returns the locked request row for the caller to mutate.
   */
  private async loadPendingForDecision(
    tx: TenantTx,
    actor: Actor,
    id: string,
  ): Promise<LeaveRequestRow> {
    const request = await this.reqRepo.findRequestForUpdateTx(actor.companyId, id, tx);
    if (!request) {
      throw new NotFoundException({
        code: LEAVE_ERR.NOT_FOUND,
        message: "Không tìm thấy đơn nghỉ",
      });
    }

    await this.assertOwnerInScope(tx, actor, request);

    // Self-approval block (crown, SPEC-05 §14.9 MUST) — the requester may never decide their own request.
    if (request.userId === actor.id) {
      throw new UnprocessableEntityException({
        code: LEAVE_ERR.APPROVER_INVALID,
        message: "Người tạo đơn không được tự duyệt/từ chối đơn của mình",
      });
    }

    if (request.status !== "Pending") {
      throw new ConflictException({
        code: LEAVE_ERR.INVALID_STATE,
        message: `Chỉ xử lý được đơn đang chờ duyệt (hiện tại: ${request.status})`,
      });
    }
    return request;
  }

  /** Resolve approve:leave scope + owner scope-target, then in-memory membership check → 403 if outside. */
  private async assertOwnerInScope(
    tx: TenantTx,
    actor: Actor,
    request: LeaveRequestRow,
  ): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(
      actor.id,
      actor.companyId,
      "approve",
      "leave",
    );
    const ctx = await this.dataScope.resolveContext(actor.id, actor.companyId);
    const owner = await this.approvalRepo.findOwnerScopeTargetTx(
      actor.companyId,
      { employeeId: request.employeeId, userId: request.userId },
      tx,
    );
    // No owner profile row → cannot prove membership → fail-closed (out of scope).
    const inScope =
      owner != null &&
      this.dataScope.isEmployeeInScope(scope, ctx, {
        userId: owner.userId,
        companyId: owner.companyId,
        orgUnitId: owner.orgUnitId,
        directManagerUserId: owner.directManagerUserId,
      });
    if (!inScope) {
      throw new ForbiddenException({
        code: LEAVE_ERR.OUT_OF_SCOPE,
        message: "Đơn nghỉ nằm ngoài phạm vi quản lý của bạn",
      });
    }
  }

  // ─── Balance mutations ───────────────────────────────────────────────────────

  /**
   * Reserved → Used: race-safe used_days += totalDays / pending_days -= totalDays (WHERE guard), then
   * append RELEASE (pending ledger) + USE (used ledger). Returns 'Used'. If the atomic guard fails
   * (would exceed quota) → 409 (whole tx rolls back). Balance row absent (unreachable when Reserved) →
   * keep 'Reserved' without a ghost ledger.
   */
  private async convertReserveToUsed(
    tx: TenantTx,
    actor: Actor,
    request: LeaveRequestRow,
  ): Promise<string> {
    const employeeId = request.employeeId;
    if (!employeeId) return request.balanceEffectStatus ?? "Reserved";
    const usedDays = Number(request.totalDays);
    const year = yearOf(request.startDate);
    const [balance] = await this.leaveRepo.findBalanceTx(
      actor.companyId,
      request.userId,
      request.leaveTypeId,
      year,
      tx,
    );
    if (!balance) return request.balanceEffectStatus ?? "Reserved";

    const usedBefore = balance.usedDays != null ? Number(balance.usedDays) : 0;
    const pendingBefore = balance.pendingDays != null ? Number(balance.pendingDays) : 0;

    const updated = await this.approvalRepo.convertReserveToUseByBalanceIdTx(
      actor.companyId,
      { balanceId: balance.id, delta: String(usedDays) },
      tx,
    );
    if (!updated) {
      // used + delta > total → concurrent double-use / over-quota. Fail-closed (rollback).
      throw new ConflictException({
        code: LEAVE_ERR.BALANCE_NOT_ENOUGH,
        message: "Số dư phép không đủ để duyệt (đã bị trừ hoặc vượt hạn mức)",
      });
    }

    const usedAfter = round2(usedBefore + usedDays);
    const pendingAfter = round2(pendingBefore - usedDays);
    // RELEASE the reservation on pending, then record USE on used — double-entry, append-only ledger.
    await this.reqRepo.insertBalanceTransactionTx(
      actor.companyId,
      {
        companyId: actor.companyId,
        leaveBalanceId: balance.id,
        employeeId,
        leaveTypeId: request.leaveTypeId,
        leaveRequestId: request.id,
        transactionType: "RELEASE",
        transactionDate: request.startDate,
        amountDays: String(usedDays),
        balanceBeforeDays: String(pendingBefore),
        balanceAfterDays: String(pendingAfter),
        createdByType: "User",
        createdBy: actor.id,
      },
      tx,
    );
    await this.reqRepo.insertBalanceTransactionTx(
      actor.companyId,
      {
        companyId: actor.companyId,
        leaveBalanceId: balance.id,
        employeeId,
        leaveTypeId: request.leaveTypeId,
        leaveRequestId: request.id,
        transactionType: "USE",
        transactionDate: request.startDate,
        amountDays: String(usedDays),
        balanceBeforeDays: String(usedBefore),
        balanceAfterDays: String(usedAfter),
        createdByType: "User",
        createdBy: actor.id,
      },
      tx,
    );
    await this.audit.record(tx, {
      action: "LeaveBalanceDeducted",
      objectType: "leave_balance",
      objectId: balance.id,
      actorUserId: actor.id,
      before: { usedDays: usedBefore, pendingDays: pendingBefore },
      after: { usedDays: usedAfter, pendingDays: pendingAfter, fromRequestId: request.id },
    });
    return "Used";
  }

  /** Release a reservation on reject: pending -= totalDays, append RELEASE, used untouched. Returns 'Released'. */
  private async releaseReserve(
    tx: TenantTx,
    actor: Actor,
    request: LeaveRequestRow,
  ): Promise<string> {
    const employeeId = request.employeeId;
    if (!employeeId) return request.balanceEffectStatus ?? "Reserved";
    const reservedDays = Number(request.totalDays);
    const year = yearOf(request.startDate);
    const [balance] = await this.leaveRepo.findBalanceTx(
      actor.companyId,
      request.userId,
      request.leaveTypeId,
      year,
      tx,
    );
    if (!balance) return request.balanceEffectStatus ?? "Reserved";

    const pendingBefore = balance.pendingDays != null ? Number(balance.pendingDays) : 0;
    const pendingAfter = round2(pendingBefore - reservedDays);
    await this.reqRepo.insertBalanceTransactionTx(
      actor.companyId,
      {
        companyId: actor.companyId,
        leaveBalanceId: balance.id,
        employeeId,
        leaveTypeId: request.leaveTypeId,
        leaveRequestId: request.id,
        transactionType: "RELEASE",
        transactionDate: request.startDate,
        amountDays: String(reservedDays),
        balanceBeforeDays: String(pendingBefore),
        balanceAfterDays: String(pendingAfter),
        createdByType: "User",
        createdBy: actor.id,
      },
      tx,
    );
    await this.reqRepo.adjustBalancePendingTx(
      actor.companyId,
      balance.id,
      String(-reservedDays),
      tx,
    );
    await this.audit.record(tx, {
      action: "LeaveBalanceReleased",
      objectType: "leave_balance",
      objectId: balance.id,
      actorUserId: actor.id,
      before: { pendingDays: pendingBefore },
      after: { pendingDays: pendingAfter, fromRequestId: request.id },
    });
    return "Released";
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async buildDetail(
    tx: TenantTx,
    companyId: string,
    request: LeaveRequestRow,
  ): Promise<LeaveRequestDetailView> {
    const [type] = await this.leaveRepo.findTypeByIdTx(companyId, request.leaveTypeId, tx);
    const days = await this.reqRepo.findDaysByRequestTx(companyId, request.id, tx);
    const approvals = await this.reqRepo.findApprovalsByRequestTx(companyId, request.id, tx);
    return toDetailView(request, type ?? null, days, approvals);
  }

  private mapError(err: unknown, op: string, ctx: Record<string, unknown>): never {
    if (err instanceof HttpException) throw err;
    this.logger.error(`${op} unexpected error`, { err, ...ctx });
    throw new InternalServerErrorException("Lỗi hệ thống, vui lòng thử lại");
  }
}
