import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { LeaveRequestDetailView } from "@mediaos/contracts";
import { AttendanceLeaveSyncService } from "../attendance/attendance-leave-sync.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { LeaveRepository } from "./leave.repository";
import { LeaveRequestRepository } from "./leave-request.repository";
import { LeaveApprovalRepository } from "./leave-approval.repository";
import { LEAVE_ERR, round2, yearOf, type LeaveRequestRow } from "./leave-request.logic";
import { toDetailView } from "./leave-request.mappers";

interface Actor {
  id: string;
  companyId: string;
}

/**
 * S3-INT-1 — CANCEL of an APPROVED request (self, owner-only) and REVOKE (manager|HR, `revoke:leave`
 * gate — Company-scope granted ONLY to hr/company-admin; manager NEVER holds it, so PermissionGuard
 * alone 403s a manager's revoke attempt before this service runs). Both paths, for an already-Approved
 * (and possibly ATT-synced) request:
 *   1. AttendanceLeaveSyncService.revertRequestTx — undo the ATT projection INLINE, same tx.
 *   2. refund the balance (used_days -= totalDays, race-safe, append REFUND ledger row) — IDEMPOTENT:
 *      only runs when balanceEffectStatus === 'Used' (a request already Refunded is a no-op retry).
 *   3. status → Cancelled/Revoked + audit + outbox, all in ONE withTenant tx (rollback ⇒ no ghost writes,
 *      no double-refund — BẤT BIẾN #1/#2).
 *
 * Split out of LeaveRequestService/LeaveApprovalService (both already near the 800-line file cap) — this
 * file owns ONLY the "undo an Approved request" surface (S3-SYNC-004 / CO-S4-009).
 */
@Injectable()
export class LeaveRevokeService {
  private readonly logger = new Logger(LeaveRevokeService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly leaveRepo: LeaveRepository,
    private readonly reqRepo: LeaveRequestRepository,
    private readonly approvalRepo: LeaveApprovalRepository,
    private readonly attSync: AttendanceLeaveSyncService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── POST /leave/requests/:id/cancel on an APPROVED request (owner-only) ─────

  /**
   * Cancel an Approved request. ONLY the owner (request.userId === actor.id) may call this — a
   * different actor gets 403 (NOT 404: cancel-own:leave is an Own-scope self-service action, so
   * "exists but not mine" must deny, not pretend not-found — distinct from the manager/HR approve path
   * which legitimately hides cross-scope existence). Cross-tenant still 404 (RLS, no leak).
   */
  async cancelApproved(
    actor: Actor,
    id: string,
    cancelReason?: string,
  ): Promise<LeaveRequestDetailView> {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.reqRepo.findRequestForUpdateTx(actor.companyId, id, tx);
        if (!request) {
          throw new NotFoundException({
            code: LEAVE_ERR.NOT_FOUND,
            message: "Không tìm thấy đơn nghỉ",
          });
        }
        if (request.userId !== actor.id) {
          throw new ForbiddenException({
            code: LEAVE_ERR.OUT_OF_SCOPE,
            message: "Chỉ người tạo đơn mới được huỷ đơn của mình",
          });
        }
        if (request.status !== "Approved") {
          throw new ConflictException({
            code: LEAVE_ERR.INVALID_STATE,
            message: `Chỉ huỷ được đơn đã duyệt ở trạng thái Approved (hiện tại: ${request.status})`,
          });
        }
        return this.undoApprovedTx(tx, actor, request, {
          toStatus: "Cancelled",
          action: "CANCEL",
          reasonField: "cancelReason",
          reason: cancelReason,
          auditAction: "leave.request.cancel",
          eventType: "leave.request.cancelled",
          eventCode: "LEAVE_REQUEST_CANCELLED",
        });
      })
      .catch((err: unknown) =>
        this.mapError(err, "cancelApproved", { companyId: actor.companyId, id }),
      );
  }

  // ─── POST /leave/requests/:id/revoke (manager|HR — revoke:leave, Company-scope) ──

  /**
   * Revoke an Approved request. Gate is the CONTROLLER's @RequirePermission(revoke:leave) — granted
   * ONLY to hr/company-admin @ Company (mig 0455); manager holds NO revoke:leave grant, so
   * PermissionGuard already 403s before this method runs (done_when "REVOKE chỉ manager|HR" — manager
   * denied BY THE GRANT, not by extra in-service logic). Any actor who reaches here already passed that
   * gate — the requester revoking their OWN request is still allowed (HR/company-admin acting on
   * themselves is a legitimate admin action, unlike approve's self-approval block).
   */
  async revoke(actor: Actor, id: string, revokeReason?: string): Promise<LeaveRequestDetailView> {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.reqRepo.findRequestForUpdateTx(actor.companyId, id, tx);
        if (!request) {
          throw new NotFoundException({
            code: LEAVE_ERR.NOT_FOUND,
            message: "Không tìm thấy đơn nghỉ",
          });
        }
        if (request.status !== "Approved") {
          throw new ConflictException({
            code: LEAVE_ERR.INVALID_STATE,
            message: `Chỉ thu hồi được đơn đã duyệt ở trạng thái Approved (hiện tại: ${request.status})`,
          });
        }
        return this.undoApprovedTx(tx, actor, request, {
          toStatus: "Revoked",
          action: "REVOKE",
          reasonField: "revokeReason",
          reason: revokeReason,
          auditAction: "leave.request.revoke",
          eventType: "leave.request.revoked",
          eventCode: "LEAVE_REQUEST_REVOKED",
        });
      })
      .catch((err: unknown) => this.mapError(err, "revoke", { companyId: actor.companyId, id }));
  }

  // ─── Shared: revert ATT + refund balance + status transition (same tx) ───────

  private async undoApprovedTx(
    tx: TenantTx,
    actor: Actor,
    request: LeaveRequestRow,
    opts: {
      toStatus: "Cancelled" | "Revoked";
      action: "CANCEL" | "REVOKE";
      reasonField: "cancelReason" | "revokeReason";
      reason: string | undefined;
      auditAction: string;
      eventType: string;
      eventCode: string;
    },
  ): Promise<LeaveRequestDetailView> {
    // 1) ATT revert FIRST (inside the same tx) — undo the Leave projection before touching balance/status
    // so a revert failure rolls back the WHOLE undo (never a half-reverted ATT + refunded balance state).
    await this.attSync.revertRequestTx(tx, actor.companyId, request.id, actor.id);

    // 2) balance refund — IDEMPOTENT: only when the approve path actually deducted (balanceEffectStatus
    // === 'Used'). A request already 'Refunded' (retry of the same cancel/revoke) is a safe no-op.
    let balanceEffectStatus = request.balanceEffectStatus;
    if (request.balanceEffectStatus === "Used") {
      balanceEffectStatus = await this.refundUsed(tx, actor, request);
    }

    // 3) status transition + FSM row + audit + event (all in-tx — BẤT BIẾN #1).
    const updateData: Record<string, unknown> = {
      status: opts.toStatus,
      balanceEffectStatus,
      updatedBy: actor.id,
    };
    if (opts.toStatus === "Cancelled") {
      updateData.cancelledAt = new Date();
      updateData.cancelledBy = actor.id;
      updateData.cancelReason = opts.reason ?? null;
    } else {
      updateData.revokedAt = new Date();
      updateData.revokedBy = actor.id;
      updateData.revokeReason = opts.reason ?? null;
    }
    const [updated] = await this.reqRepo.updateRequestTx(
      actor.companyId,
      request.id,
      updateData,
      tx,
    );
    if (!updated)
      throw new InternalServerErrorException(
        `Failed to ${opts.action.toLowerCase()} leave request`,
      );

    await this.reqRepo.cancelActiveDaysTx(actor.companyId, request.id, actor.id, tx);
    await this.reqRepo.insertApprovalTx(
      actor.companyId,
      {
        companyId: actor.companyId,
        leaveRequestId: request.id,
        approvalStep: 1,
        approverUserId: actor.id,
        approverEmployeeId: request.employeeId,
        action: opts.action,
        fromStatus: "Approved",
        toStatus: opts.toStatus,
        comment: opts.reason ?? null,
        [opts.reasonField]: opts.reason ?? null,
        actedAt: new Date(),
      },
      tx,
    );
    await this.audit.record(tx, {
      action: opts.auditAction,
      objectType: "leave_request",
      objectId: request.id,
      actorUserId: actor.id,
      before: { status: "Approved", balanceEffectStatus: request.balanceEffectStatus },
      after: { status: opts.toStatus, balanceEffectStatus },
    });
    await this.outbox.enqueue(tx, {
      eventType: opts.eventType,
      payload: {
        requestId: request.id,
        userId: request.userId,
        employeeId: request.employeeId,
        fromStatus: "Approved",
        eventCode: opts.eventCode,
      },
    });
    return this.buildDetail(tx, actor.companyId, updated);
  }

  /** used_days -= totalDays (race-safe, append REFUND). Returns the new balanceEffectStatus. */
  private async refundUsed(tx: TenantTx, actor: Actor, request: LeaveRequestRow): Promise<string> {
    const employeeId = request.employeeId;
    if (!employeeId) return request.balanceEffectStatus ?? "Used";
    const refundDays = Number(request.totalDays);
    const year = yearOf(request.startDate);
    const [balance] = await this.leaveRepo.findBalanceTx(
      actor.companyId,
      request.userId,
      request.leaveTypeId,
      year,
      tx,
    );
    if (!balance) return request.balanceEffectStatus ?? "Used";

    const usedBefore = balance.usedDays != null ? Number(balance.usedDays) : 0;
    const updated = await this.approvalRepo.refundUsedByBalanceIdTx(
      actor.companyId,
      { balanceId: balance.id, delta: String(refundDays) },
      tx,
    );
    if (!updated) {
      // used_days - delta < 0 → already refunded (idempotent retry) or corrupted data. Fail-closed: keep
      // the CURRENT effect status rather than silently double-refunding or inventing a negative balance.
      this.logger.warn("refundUsed guard rejected — treating as already-refunded (idempotent)", {
        companyId: actor.companyId,
        requestId: request.id,
        balanceId: balance.id,
      });
      return request.balanceEffectStatus ?? "Used";
    }

    const usedAfter = round2(usedBefore - refundDays);
    await this.reqRepo.insertBalanceTransactionTx(
      actor.companyId,
      {
        companyId: actor.companyId,
        leaveBalanceId: balance.id,
        employeeId,
        leaveTypeId: request.leaveTypeId,
        leaveRequestId: request.id,
        transactionType: "REFUND",
        transactionDate: request.startDate,
        amountDays: String(refundDays),
        balanceBeforeDays: String(usedBefore),
        balanceAfterDays: String(usedAfter),
        createdByType: "User",
        createdBy: actor.id,
      },
      tx,
    );
    await this.audit.record(tx, {
      action: "LeaveBalanceRefunded",
      objectType: "leave_balance",
      objectId: balance.id,
      actorUserId: actor.id,
      before: { usedDays: usedBefore },
      after: { usedDays: usedAfter, fromRequestId: request.id },
    });
    return "Refunded";
  }

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
