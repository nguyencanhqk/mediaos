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
  CreateLeaveRequestDraft,
  LeaveRequestDetailView,
  LeaveRequestListQuery,
  LeaveRequestListResponse,
  UpdateLeaveRequestDraft,
} from "@mediaos/contracts";
import { addDaysToLocalDate, localDateOf } from "../common/tz.util";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { HolidaysService } from "../foundation/holidays/holidays.service";
import { LeaveRepository } from "./leave.repository";
import { LeaveRequestRepository } from "./leave-request.repository";
import { LeaveRevokeService } from "./leave-revoke.service";
import { calculateLeave } from "./leave-calc.logic";
import {
  DEFAULT_COMPANY_TZ,
  LEAVE_ERR,
  assertDurationAllowed,
  buildLeaveHolidayDates,
  daysBetweenLocalDates,
  mapDayType,
  numOrNull,
  round2,
  yearOf,
  type LeavePolicyRow,
  type LeaveRequestRow,
  type LeaveTypeRow,
} from "./leave-request.logic";
import { toDetailView, toListItemView } from "./leave-request.mappers";

interface Actor {
  id: string;
  companyId: string;
}

/**
 * S3-LEAVE-BE-2 — LEAVE request WORKFLOW (employee self-service): tạo nháp → gửi duyệt → huỷ.
 *
 * FSM (status TitleCase): Draft → (submit) Pending → (cancel) Cancelled ; Draft → (cancel) Cancelled.
 * PATCH chỉ khi Draft (else 409). Trừ phép (used_days) KHÔNG xảy ra ở đây — submit chỉ GIỮ CHỖ (RESERVE
 * pending_days); duyệt/từ chối (BE-3) mới trừ/hoàn. approver routing + mã đơn DEFERRED → BE-3.
 *
 * BẤT BIẾN: mọi ghi qua db.withTenant(actor.companyId) (RLS + company_id từ token, KHÔNG từ client). Ledger
 * leave_balance_transactions + history leave_request_approvals = INSERT only (append-only). audit + outbox
 * BÊN TRONG cùng tx (rollback drops everything — không event/audit ma).
 */
@Injectable()
export class LeaveRequestService {
  private readonly logger = new Logger(LeaveRequestService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly leaveRepo: LeaveRepository,
    private readonly reqRepo: LeaveRequestRepository,
    private readonly holidays: HolidaysService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    // S3-INT-1 (additive): Approved-cancel delegates to LeaveRevokeService (ATT-revert + balance refund).
    private readonly revokeService: LeaveRevokeService,
  ) {}

  // ─── POST /leave/requests (create draft; submitNow → submit cùng tx) ──────────

  async createDraft(actor: Actor, dto: CreateLeaveRequestDraft): Promise<LeaveRequestDetailView> {
    const holidayDates = await this.loadHolidayDates(actor.companyId, dto.startDate, dto.endDate);
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const ctx = await this.validateAndCompute(tx, actor, dto, holidayDates);
        const [request] = await this.reqRepo.insertRequestTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            userId: actor.id,
            leaveTypeId: dto.leaveTypeId,
            startDate: dto.startDate,
            endDate: dto.endDate,
            totalDays: String(ctx.calc.calculatedDays),
            totalHours: String(ctx.calc.calculatedHours),
            reason: dto.reason ?? null,
            status: "Draft",
            employeeId: ctx.profile.id,
            leavePolicyId: ctx.policy?.id ?? null,
            durationType: dto.durationType,
            halfDaySession: dto.halfDaySession ?? null,
            startTime: dto.startTime ?? null,
            endTime: dto.endTime ?? null,
            handoverNote: dto.handoverNote ?? null,
            contactDuringLeave: dto.contactDuringLeave ?? null,
            balanceEffectStatus: "None",
            createdBy: actor.id,
            updatedBy: actor.id,
          },
          tx,
        );
        if (!request) throw new InternalServerErrorException("Failed to create leave request");

        await this.writeDayRows(tx, actor, request, ctx.profile.id, ctx.calc.days);
        await this.audit.record(tx, {
          action: "leave.request.create",
          objectType: "leave_request",
          objectId: request.id,
          actorUserId: actor.id,
          after: {
            leaveTypeId: dto.leaveTypeId,
            startDate: dto.startDate,
            endDate: dto.endDate,
            durationType: dto.durationType,
            totalDays: ctx.calc.calculatedDays,
            status: "Draft",
          },
        });

        const current = dto.submitNow
          ? await this.runSubmitCore(tx, actor, request, ctx.type, ctx.policy, undefined)
          : request;
        return this.buildDetail(tx, actor.companyId, current);
      })
      .catch((err: unknown) => this.mapError(err, "createDraft", { companyId: actor.companyId }));
  }

  // ─── PATCH /leave/requests/:id (update draft) ────────────────────────────────

  async updateDraft(
    actor: Actor,
    id: string,
    dto: UpdateLeaveRequestDraft,
  ): Promise<LeaveRequestDetailView> {
    const holidayDates = await this.loadHolidayDates(actor.companyId, dto.startDate, dto.endDate);
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.reqRepo.findRequestForUpdateTx(actor.companyId, id, tx);
        if (!request || request.userId !== actor.id) {
          throw new NotFoundException({
            code: LEAVE_ERR.NOT_FOUND,
            message: "Không tìm thấy đơn nghỉ",
          });
        }
        if (request.status !== "Draft") {
          throw new ConflictException({
            code: LEAVE_ERR.INVALID_STATE,
            message: `Chỉ sửa được đơn ở trạng thái nháp (hiện tại: ${request.status})`,
          });
        }

        const ctx = await this.validateAndCompute(tx, actor, dto, holidayDates);
        const [updated] = await this.reqRepo.updateRequestTx(
          actor.companyId,
          id,
          {
            leaveTypeId: dto.leaveTypeId,
            startDate: dto.startDate,
            endDate: dto.endDate,
            totalDays: String(ctx.calc.calculatedDays),
            totalHours: String(ctx.calc.calculatedHours),
            reason: dto.reason ?? null,
            employeeId: ctx.profile.id,
            leavePolicyId: ctx.policy?.id ?? null,
            durationType: dto.durationType,
            halfDaySession: dto.halfDaySession ?? null,
            startTime: dto.startTime ?? null,
            endTime: dto.endTime ?? null,
            handoverNote: dto.handoverNote ?? null,
            contactDuringLeave: dto.contactDuringLeave ?? null,
            updatedBy: actor.id,
          },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to update leave request");

        await this.writeDayRows(tx, actor, updated, ctx.profile.id, ctx.calc.days);
        await this.audit.record(tx, {
          action: "leave.request.update",
          objectType: "leave_request",
          objectId: id,
          actorUserId: actor.id,
          after: {
            leaveTypeId: dto.leaveTypeId,
            startDate: dto.startDate,
            endDate: dto.endDate,
            durationType: dto.durationType,
            totalDays: ctx.calc.calculatedDays,
          },
        });
        return this.buildDetail(tx, actor.companyId, updated);
      })
      .catch((err: unknown) =>
        this.mapError(err, "updateDraft", { companyId: actor.companyId, id }),
      );
  }

  // ─── POST /leave/requests/:id/submit (Draft → Pending) ───────────────────────

  async submit(actor: Actor, id: string, note?: string): Promise<LeaveRequestDetailView> {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.reqRepo.findRequestForUpdateTx(actor.companyId, id, tx);
        if (!request || request.userId !== actor.id) {
          throw new NotFoundException({
            code: LEAVE_ERR.NOT_FOUND,
            message: "Không tìm thấy đơn nghỉ",
          });
        }
        if (request.status !== "Draft") {
          throw new ConflictException({
            code: LEAVE_ERR.INVALID_STATE,
            message: `Chỉ gửi được đơn ở trạng thái nháp (hiện tại: ${request.status})`,
          });
        }
        const [type] = await this.leaveRepo.findTypeByIdTx(
          actor.companyId,
          request.leaveTypeId,
          tx,
        );
        if (!type) {
          throw new UnprocessableEntityException({
            code: LEAVE_ERR.TYPE_NOT_FOUND,
            message: "Loại nghỉ không còn khả dụng",
          });
        }
        if (type.status !== "active") {
          throw new UnprocessableEntityException({
            code: LEAVE_ERR.TYPE_INACTIVE,
            message: `Loại nghỉ '${type.name}' đang không hoạt động`,
          });
        }
        const policy = await this.reqRepo.findActivePolicyForTypeTx(
          actor.companyId,
          request.leaveTypeId,
          request.startDate,
          tx,
        );
        const updated = await this.runSubmitCore(tx, actor, request, type, policy, note);
        return this.buildDetail(tx, actor.companyId, updated);
      })
      .catch((err: unknown) => this.mapError(err, "submit", { companyId: actor.companyId, id }));
  }

  // ─── POST /leave/requests/:id/cancel (Draft|Pending → Cancelled ; Approved → LeaveRevokeService) ──

  /**
   * S3-INT-1: thin dispatcher. Approved requests need ATT-revert + balance refund (LeaveRevokeService,
   * its OWN withTenant tx — nesting `db.transaction()` calls is unsafe, so this is a SEPARATE read then
   * a SEPARATE write tx, not one nested transaction). Draft/Pending keep the original single-tx FSM
   * below. OWNERSHIP gate is 403 (NOT 404) in BOTH branches — "exists but not mine" must deny explicitly
   * (cancel-own:leave is Own-scope self-service); cross-tenant stays 404 (RLS, never leaks existence).
   */
  async cancel(actor: Actor, id: string, cancelReason?: string): Promise<LeaveRequestDetailView> {
    const peeked = await this.db.withTenant(actor.companyId, (tx) =>
      this.reqRepo.findRequestForUpdateTx(actor.companyId, id, tx),
    );
    if (!peeked) {
      throw new NotFoundException({
        code: LEAVE_ERR.NOT_FOUND,
        message: "Không tìm thấy đơn nghỉ",
      });
    }
    if (peeked.userId !== actor.id) {
      throw new ForbiddenException({
        code: LEAVE_ERR.OUT_OF_SCOPE,
        message: "Chỉ người tạo đơn mới được huỷ đơn của mình",
      });
    }
    if (peeked.status === "Approved") {
      return this.revokeService.cancelApproved(actor, id, cancelReason);
    }

    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.reqRepo.findRequestForUpdateTx(actor.companyId, id, tx);
        if (!request || request.userId !== actor.id) {
          // Re-checked under the FOR UPDATE lock (TOCTOU) — same 404/403 split as the peek above.
          throw new NotFoundException({
            code: LEAVE_ERR.NOT_FOUND,
            message: "Không tìm thấy đơn nghỉ",
          });
        }
        const prevStatus = request.status;
        if (prevStatus !== "Draft" && prevStatus !== "Pending") {
          throw new ConflictException({
            code: LEAVE_ERR.INVALID_STATE,
            message: `Chỉ huỷ được đơn nháp hoặc đang chờ duyệt (hiện tại: ${prevStatus})`,
          });
        }

        let balanceEffectStatus = request.balanceEffectStatus;
        if (prevStatus === "Pending" && request.balanceEffectStatus === "Reserved") {
          await this.releaseReserve(tx, actor, request);
          balanceEffectStatus = "Released";
        }

        const [updated] = await this.reqRepo.updateRequestTx(
          actor.companyId,
          id,
          {
            status: "Cancelled",
            cancelledAt: new Date(),
            cancelledBy: actor.id,
            cancelReason: cancelReason ?? null,
            balanceEffectStatus,
            updatedBy: actor.id,
          },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to cancel leave request");

        await this.reqRepo.cancelActiveDaysTx(actor.companyId, id, actor.id, tx);
        await this.reqRepo.insertApprovalTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            leaveRequestId: id,
            approvalStep: 1,
            approverUserId: actor.id,
            approverEmployeeId: request.employeeId,
            action: "CANCEL",
            fromStatus: prevStatus,
            toStatus: "Cancelled",
            comment: cancelReason ?? null,
            cancelReason: cancelReason ?? null,
            actedAt: new Date(),
          },
          tx,
        );
        await this.audit.record(tx, {
          action: "leave.request.cancel",
          objectType: "leave_request",
          objectId: id,
          actorUserId: actor.id,
          before: { status: prevStatus, balanceEffectStatus: request.balanceEffectStatus },
          after: { status: "Cancelled", balanceEffectStatus },
        });
        await this.outbox.enqueue(tx, {
          eventType: "leave.request.cancelled",
          payload: {
            requestId: id,
            userId: request.userId,
            employeeId: request.employeeId,
            fromStatus: prevStatus,
            // S4-INT-3: actor-exclusion — engine loại người khởi tạo khỏi recipients
            actorUserId: actor.id,
            eventCode: "LEAVE_REQUEST_CANCELLED",
          },
        });
        return this.buildDetail(tx, actor.companyId, updated);
      })
      .catch((err: unknown) => this.mapError(err, "cancel", { companyId: actor.companyId, id }));
  }

  // ─── GET /leave/me/requests (own list) ───────────────────────────────────────

  async listMine(actor: Actor, query: LeaveRequestListQuery): Promise<LeaveRequestListResponse> {
    const limit = query.pageSize;
    const offset = (query.page - 1) * query.pageSize;
    const filters = {
      status: query.status,
      leaveTypeId: query.leaveTypeId,
      fromDate: query.fromDate,
      toDate: query.toDate,
      limit,
      offset,
    };
    return this.db.withTenant(actor.companyId, async (tx) => {
      const total = await this.reqRepo.countOwnRequestsTx(actor.companyId, actor.id, filters, tx);
      const rows = await this.reqRepo.listOwnRequestsTx(actor.companyId, actor.id, filters, tx);
      const totalPages = query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0;
      return {
        items: rows.map(toListItemView),
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

  // ─── GET /leave/me/requests/:id (own detail) ─────────────────────────────────

  async getMineDetail(actor: Actor, id: string): Promise<LeaveRequestDetailView> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const request = await this.reqRepo.findOwnRequestByIdTx(actor.companyId, actor.id, id, tx);
      if (!request) {
        throw new NotFoundException({
          code: LEAVE_ERR.NOT_FOUND,
          message: "Không tìm thấy đơn nghỉ",
        });
      }
      return this.buildDetail(tx, actor.companyId, request);
    });
  }

  // ─── Core: submit (shared by createDraft+submitNow and standalone submit) ────

  private async runSubmitCore(
    tx: TenantTx,
    actor: Actor,
    request: LeaveRequestRow,
    type: LeaveTypeRow,
    policy: LeavePolicyRow | undefined,
    note: string | undefined,
  ): Promise<LeaveRequestRow> {
    const companyId = actor.companyId;
    const employeeId = request.employeeId;
    if (!employeeId) {
      throw new UnprocessableEntityException({
        code: LEAVE_ERR.EMPLOYEE_NOT_ELIGIBLE,
        message: "Đơn chưa gắn hồ sơ nhân viên — không thể gửi",
      });
    }
    const calculatedDays = Number(request.totalDays);

    // MIN-NOTICE (today in company tz).
    const today = localDateOf(new Date(), DEFAULT_COMPANY_TZ);
    const noticeDays = type.minNoticeDays ?? 0;
    if (daysBetweenLocalDates(today, request.startDate) < noticeDays) {
      throw new UnprocessableEntityException({
        code: LEAVE_ERR.MIN_NOTICE,
        message: `Cần gửi đơn trước tối thiểu ${noticeDays} ngày so với ngày nghỉ`,
      });
    }

    // OVERLAP (Pending/Approved — TitleCase ∪ lowercase legacy block; Rejected/Cancelled/Revoked don't).
    const conflict = await this.reqRepo.findOverlappingRequestTx(
      companyId,
      request.userId,
      request.id,
      request.startDate,
      request.endDate,
      tx,
    );
    if (conflict) {
      throw new UnprocessableEntityException({
        code: LEAVE_ERR.REQUEST_OVERLAP,
        message: `Đơn nghỉ trùng khoảng thời gian với đơn ${conflict.id} (${conflict.startDate} → ${conflict.endDate})`,
      });
    }

    // BALANCE + RESERVE.
    const balanceEffectStatus = await this.reserveIfNeeded(
      tx,
      actor,
      request,
      type,
      policy,
      employeeId,
      calculatedDays,
    );

    const [updated] = await this.reqRepo.updateRequestTx(
      companyId,
      request.id,
      {
        status: "Pending",
        submittedAt: new Date(),
        submittedBy: actor.id,
        balanceEffectStatus,
        updatedBy: actor.id,
      },
      tx,
    );
    if (!updated) throw new InternalServerErrorException("Failed to submit leave request");

    await this.reqRepo.insertApprovalTx(
      companyId,
      {
        companyId,
        leaveRequestId: request.id,
        approvalStep: 1,
        approverUserId: actor.id,
        approverEmployeeId: employeeId,
        action: "SUBMIT",
        fromStatus: "Draft",
        toStatus: "Pending",
        comment: note ?? null,
        actedAt: new Date(),
      },
      tx,
    );
    await this.audit.record(tx, {
      action: "leave.request.submit",
      objectType: "leave_request",
      objectId: request.id,
      actorUserId: actor.id,
      before: { status: "Draft" },
      after: { status: "Pending", totalDays: calculatedDays, balanceEffectStatus },
    });
    await this.outbox.enqueue(tx, {
      eventType: "leave.request.submitted",
      payload: {
        requestId: request.id,
        userId: request.userId,
        employeeId,
        totalDays: calculatedDays,
        totalHours: numOrNull(request.totalHours),
        // S4-INT-3: actor-exclusion — engine loại người khởi tạo khỏi recipients
        actorUserId: actor.id,
        eventCode: "LEAVE_REQUEST_SUBMITTED",
      },
    });
    return updated;
  }

  /**
   * Reserve pending_days nếu loại nghỉ trừ phép + chính sách giữ-chỗ. Trả về balance_effect_status mới.
   * Chặn vượt số dư (422) TRƯỚC khi giữ chỗ. NEVER chạm remaining_days (GENERATED) hay used_days (BE-3 approve).
   */
  private async reserveIfNeeded(
    tx: TenantTx,
    actor: Actor,
    request: LeaveRequestRow,
    type: LeaveTypeRow,
    policy: LeavePolicyRow | undefined,
    employeeId: string,
    calculatedDays: number,
  ): Promise<string> {
    const isDeduct = type.deductBalance === true;
    if (!isDeduct) return "None";

    const allowNegative = policy?.allowNegativeBalance ?? type.allowNegativeBalance ?? false;
    const reserveOnPending = policy?.reserveBalanceOnPending ?? isDeduct;
    const year = yearOf(request.startDate);
    const [balance] = await this.leaveRepo.findBalanceTx(
      actor.companyId,
      request.userId,
      request.leaveTypeId,
      year,
      tx,
    );

    if (!allowNegative) {
      const remaining = balance?.remainingDays != null ? Number(balance.remainingDays) : 0;
      const pending = balance?.pendingDays != null ? Number(balance.pendingDays) : 0;
      const available = round2(remaining - pending);
      if (calculatedDays > available) {
        throw new UnprocessableEntityException({
          code: LEAVE_ERR.BALANCE_NOT_ENOUGH,
          message: `Số dư phép không đủ: cần ${calculatedDays} ngày, còn khả dụng ${available} ngày`,
        });
      }
    }

    if (!reserveOnPending) return "None";
    // reserveOnPending nhưng KHÔNG có balance row: chỉ tới đây khi allowNegative (else đã 422). Không bịa số
    // dư — bỏ qua tx, giữ effect 'None' (BE-3 sẽ xử lý khi duyệt/cấp phép).
    if (!balance) return "None";

    const pendingBefore = balance.pendingDays != null ? Number(balance.pendingDays) : 0;
    const pendingAfter = round2(pendingBefore + calculatedDays);
    await this.reqRepo.insertBalanceTransactionTx(
      actor.companyId,
      {
        companyId: actor.companyId,
        leaveBalanceId: balance.id,
        employeeId,
        leaveTypeId: request.leaveTypeId,
        leaveRequestId: request.id,
        transactionType: "RESERVE",
        transactionDate: request.startDate,
        amountDays: String(calculatedDays),
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
      String(calculatedDays),
      tx,
    );
    return "Reserved";
  }

  /** Hoàn giữ-chỗ khi huỷ đơn Pending đã RESERVE: ghi RELEASE + giảm pending_days. */
  private async releaseReserve(
    tx: TenantTx,
    actor: Actor,
    request: LeaveRequestRow,
  ): Promise<void> {
    const employeeId = request.employeeId;
    if (!employeeId) return;
    const reservedDays = Number(request.totalDays);
    const year = yearOf(request.startDate);
    const [balance] = await this.leaveRepo.findBalanceTx(
      actor.companyId,
      request.userId,
      request.leaveTypeId,
      year,
      tx,
    );
    if (!balance) return;

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
  }

  // ─── Validation + day computation (create / update) ──────────────────────────

  private async validateAndCompute(
    tx: TenantTx,
    actor: Actor,
    dto: CreateLeaveRequestDraft | UpdateLeaveRequestDraft,
    holidayDates: ReadonlySet<string>,
  ): Promise<{
    type: LeaveTypeRow;
    policy: LeavePolicyRow | undefined;
    profile: { id: string };
    calc: ReturnType<typeof calculateLeave>;
  }> {
    const [type] = await this.leaveRepo.findTypeByIdTx(actor.companyId, dto.leaveTypeId, tx);
    if (!type) {
      throw new NotFoundException({
        code: LEAVE_ERR.TYPE_NOT_FOUND,
        message: `Không tìm thấy loại nghỉ: ${dto.leaveTypeId}`,
      });
    }
    if (type.status !== "active") {
      throw new UnprocessableEntityException({
        code: LEAVE_ERR.TYPE_INACTIVE,
        message: `Loại nghỉ '${type.name}' đang không hoạt động`,
      });
    }
    assertDurationAllowed(type, dto.durationType);
    if (type.requireReason === true && !dto.reason?.trim()) {
      throw new UnprocessableEntityException({
        code: LEAVE_ERR.REASON_REQUIRED,
        message: "Loại nghỉ này yêu cầu nhập lý do",
      });
    }
    // require_attachment DEFERRED (file upload BE riêng) — note gap.

    const [profile] = await this.leaveRepo.resolveEmployeeByUserIdTx(actor.companyId, actor.id, tx);
    if (!profile) {
      throw new UnprocessableEntityException({
        code: LEAVE_ERR.EMPLOYEE_NOT_ELIGIBLE,
        message: "Tài khoản chưa gắn hồ sơ nhân viên — không thể tạo đơn nghỉ",
      });
    }

    const policy = await this.reqRepo.findActivePolicyForTypeTx(
      actor.companyId,
      dto.leaveTypeId,
      dto.startDate,
      tx,
    );
    const workingDays = await this.leaveRepo.resolveWorkingDaysForUserTx(
      actor.companyId,
      actor.id,
      tx,
    );
    const calc = calculateLeave(
      {
        startDate: dto.startDate,
        endDate: dto.endDate,
        durationType: dto.durationType,
        halfDaySession: dto.halfDaySession,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
      workingDays,
      holidayDates,
    );
    if (calc.calculatedDays <= 0 && calc.calculatedHours <= 0) {
      throw new UnprocessableEntityException({
        code: LEAVE_ERR.NO_WORKING_DAY,
        message: "Khoảng nghỉ không có ngày làm việc nào (toàn cuối tuần/ngày lễ)",
      });
    }
    return { type, policy, profile, calc };
  }

  /** Ghi lại day-rows: soft-delete Active cũ rồi INSERT mới, CHỈ ngày có đóng góp công (leave_days/hours > 0). */
  private async writeDayRows(
    tx: TenantTx,
    actor: Actor,
    request: LeaveRequestRow,
    employeeId: string,
    days: ReturnType<typeof calculateLeave>["days"],
  ): Promise<void> {
    await this.reqRepo.softDeleteActiveDaysTx(actor.companyId, request.id, actor.id, tx);
    const isHourly = request.durationType === "Hourly";
    for (const day of days) {
      if (day.leave_days <= 0 && day.leave_hours <= 0) continue;
      await this.reqRepo.insertDayTx(
        actor.companyId,
        {
          companyId: actor.companyId,
          leaveRequestId: request.id,
          employeeId,
          leaveTypeId: request.leaveTypeId,
          workDate: day.date,
          dayType: mapDayType(request.durationType),
          halfDaySession: request.halfDaySession ?? null,
          startTime: request.startTime ?? null,
          endTime: request.endTime ?? null,
          leaveDays: String(day.leave_days),
          leaveHours: String(day.leave_hours),
          leaveMinutes: isHourly ? Math.round(day.leave_hours * 60) : 0,
          isWorkingDay: day.is_working_day,
          isPublicHoliday: day.is_public_holiday,
          status: "Active",
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      );
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Batch holiday set (affects-leave) cho [start, end] — 1 query, tenant tx riêng (đọc trước tx ghi). */
  private async loadHolidayDates(
    companyId: string,
    startDate: string,
    endDate: string,
  ): Promise<Set<string>> {
    const rows = await this.holidays.getHolidaysInRange(
      companyId,
      startDate,
      addDaysToLocalDate(endDate, 1),
    );
    return buildLeaveHolidayDates(rows);
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
