import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  AdjustmentListQuery,
  ApproveAdjustmentRequest,
  AttendanceAdjustmentListResponse,
  AttendanceAdjustmentRequestDetail,
  CreateAdjustmentRequest,
  DataScope,
  DirectAdjustRequest,
  RejectAdjustmentRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService, type ScopeContext } from "../permission/data-scope.service";
import { HrTasksService } from "../tasks/hr-tasks.service";
import { isUniqueViolation } from "../common/db-error";
import { monthOfDate } from "../common/tz.util";
import { ATT_RESOURCES } from "./attendance-permissions.const";
import { AttendanceRepository } from "./attendance.repository";
import {
  AttendanceAdjustmentRepository,
  type AdjustmentListFilters,
} from "./attendance-adjustment.repository";
import {
  ADJUSTMENT_STATUS,
  isDecidable,
  recomputeRecord,
  type AdjustmentItemProposal,
  type AppliedItem,
} from "./attendance-adjustment.logic";
import type { ScheduleCalc } from "./attendance.logic";
import { deriveRequestedTimes, eqUserId, toCalcInput } from "./attendance-adjustment.helpers";
import {
  buildAppliedItemRows,
  buildProposalRows,
  buildRecordValues,
  emitAdjustmentApproved,
  emitAdjustmentRequested,
  emitRecordAdjustedDirect,
  toProposals,
  toScheduleCalc,
} from "./attendance-adjustment.apply";
import { toAdjustmentDetailDto, toAdjustmentListItem } from "./attendance-adjustment.mappers";

const ADJUSTMENT = ATT_RESOURCES.ADJUSTMENT;
const ATTENDANCE = ATT_RESOURCES.ATTENDANCE;

interface Actor {
  id: string;
  companyId: string;
}

type EmployeeScope = {
  id: string;
  userId: string | null;
  companyId: string;
  orgUnitId: string | null;
  directManagerUserId: string | null;
  status: string;
};

/** attendance_records view the recalc reads (id + method columns) — shared by find-by-date/by-id. */
type AttendanceRecordRow = Awaited<
  ReturnType<AttendanceRepository["findRecordByUserDateTx"]>
>[number];

/** Everything applyToRecord needs to recalc + persist a record from an approved/direct adjustment. */
interface ApplyRecordInput {
  userId: string;
  employeeId: string;
  departmentId: string | null;
  workDate: string;
  requestId: string;
  proposals: AdjustmentItemProposal[];
  requestedCheckInAt: Date | null;
  requestedCheckOutAt: Date | null;
  reason: string;
}

/**
 * S3-ATT-BE-4 — canonical adjustment-request application service (ATT-FUNC-018..022).
 *
 * BẤT BIẾN: attendance figures change only via check-in/out or an APPROVED / directly-adjusted request.
 * Every mutation (request + attendance_record + append-only attendance_logs + append-only
 * attendance_adjustment_items + audit + outbox + Task Hub) runs inside ONE withTenant(companyId) tx
 * (RLS+FORCE). Recalc KEEPS attendance_logs — it only APPENDS a log_type='Adjustment' row (never deletes).
 * The approval FSM is Pending → Approved/Rejected (terminal); a row-lock (FOR UPDATE) serialises decisions.
 */
@Injectable()
export class AttendanceAdjustmentService {
  private readonly logger = new Logger(AttendanceAdjustmentService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AttendanceAdjustmentRepository,
    private readonly attendanceRepo: AttendanceRepository,
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly hrTasks: HrTasksService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The append-only event sinks bundled for the extracted emitter helpers (attendance-adjustment.apply). */
  private get sinks() {
    return { audit: this.audit, outbox: this.outbox };
  }

  // ─── Create (create-own:adjustment; create-thay gated by wider-than-Own scope) ─────

  async createRequest(actor: Actor, dto: CreateAdjustmentRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const target = await this.resolveCreateTarget(actor, dto, tx);
        await this.assertPeriodOpenForDate(actor.companyId, dto.workDate, tx);
        const task = await this.hrTasks.createApprovalTaskTx(tx, actor.companyId, {
          title: `Duyệt điều chỉnh công ${dto.workDate}`,
          assigneeUserId: null,
        });
        const row = await this.insertRequestWithProposals(actor, dto, target, task.id, tx);
        await emitAdjustmentRequested(this.sinks, tx, {
          requestId: row.id,
          employeeId: target.id,
          userId: target.userId ?? actor.id,
          workDate: dto.workDate,
          requestType: dto.requestType,
          taskId: task.id,
          actorId: actor.id,
          onBehalf: (target.userId ?? actor.id) !== actor.id,
        });
        return this.loadDetailTx(actor.companyId, row.id, tx);
      })
      .catch((err: unknown) => this.mapConflict(err, "createRequest", actor, dto.workDate));
  }

  /** Insert the Pending request row + its up-front (is_applied=false) proposal ledger entries. */
  private async insertRequestWithProposals(
    actor: Actor,
    dto: CreateAdjustmentRequest,
    target: EmployeeScope,
    taskId: string,
    tx: TenantTx,
  ): Promise<{ id: string }> {
    const proposals = toProposals(dto.items);
    const requested = deriveRequestedTimes(dto.workDate, {
      explicitIn: dto.requestedCheckInAt,
      explicitOut: dto.requestedCheckOutAt,
      proposals,
    });
    const [row] = await this.repo.insertRequestTx(
      actor.companyId,
      {
        companyId: actor.companyId,
        userId: target.userId ?? actor.id,
        employeeId: target.id,
        workDate: dto.workDate,
        requestType: dto.requestType,
        requestedCheckInAt: requested.checkInAt,
        requestedCheckOutAt: requested.checkOutAt,
        reason: dto.reason,
        status: ADJUSTMENT_STATUS.PENDING,
        submittedAt: new Date(),
        requestedBy: actor.id,
        attachmentFileId: dto.attachmentFileId ?? null,
        taskId,
        createdBy: actor.id,
      },
      tx,
    );
    if (!row) throw new InternalServerErrorException("Failed to create adjustment request");
    await this.repo.insertItemsTx(
      actor.companyId,
      buildProposalRows(row.id, proposals, false, actor.id),
      tx,
    );
    return row;
  }

  /** Own employee unless targetEmployeeId is set AND the actor holds a wider-than-Own create scope. */
  private async resolveCreateTarget(
    actor: Actor,
    dto: CreateAdjustmentRequest,
    tx: TenantTx,
  ): Promise<EmployeeScope> {
    const own = await this.repo.findEmployeeScopeByUserIdTx(actor.companyId, actor.id, tx);
    if (!own) throw new ForbiddenException("Tài khoản chưa liên kết hồ sơ nhân sự");
    if (!dto.targetEmployeeId || dto.targetEmployeeId === own.id) return own;

    // create-thay: needs create-own:adjustment with a scope wider than Own that COVERS the target.
    const scope = await this.permission.resolveStrongestScope(
      actor.id,
      actor.companyId,
      "create-own",
      ADJUSTMENT,
    );
    if (scope == null || scope === "Own") {
      throw new ForbiddenException("Không có quyền tạo đơn điều chỉnh thay nhân viên khác");
    }
    const target = await this.repo.findEmployeeScopeByIdTx(
      actor.companyId,
      dto.targetEmployeeId,
      tx,
    );
    if (!target) throw new NotFoundException("Không tìm thấy hồ sơ nhân sự");
    const ctx = await this.dataScope.resolveContext(actor.id, actor.companyId);
    if (!this.inScope(scope, ctx, target)) {
      throw new ForbiddenException("Nhân viên nằm ngoài phạm vi quản lý");
    }
    return target;
  }

  // ─── Lists ─────────────────────────────────────────────────────────────────────

  /** view-own: self-locked to the actor's requests (not a data-scope query). */
  async listMy(
    actor: Actor,
    query: AdjustmentListQuery,
  ): Promise<AttendanceAdjustmentListResponse> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const { rows, total } = await this.repo.listTx(
        actor.companyId,
        [eqUserId(actor.id)],
        this.toFilters(query),
        tx,
      );
      return this.toListResponse(rows, total, query);
    });
  }

  async listTeam(actor: Actor, query: AdjustmentListQuery) {
    return this.listScoped(actor, query, "view-team");
  }

  async listCompany(actor: Actor, query: AdjustmentListQuery) {
    return this.listScoped(actor, query, "view-company");
  }

  private async listScoped(
    actor: Actor,
    query: AdjustmentListQuery,
    action: string,
  ): Promise<AttendanceAdjustmentListResponse> {
    // GATE (403 if no grant). Sensitive pair → wildcard *:* does NOT satisfy it.
    const scope = await this.dataScope.resolveAndAssert(
      actor.id,
      actor.companyId,
      action,
      ADJUSTMENT,
      {
        isSensitive: true,
      },
    );
    const ctx = await this.dataScope.resolveContext(actor.id, actor.companyId);
    const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const { rows, total } = await this.repo.listTx(
        actor.companyId,
        [scopeCond],
        this.toFilters(query),
        tx,
      );
      return this.toListResponse(rows, total, query);
    });
  }

  // ─── Detail (view-own gate → strongest view scope → 404 if out) ──────────────────

  async getDetail(actor: Actor, id: string): Promise<AttendanceAdjustmentRequestDetail> {
    const { scope, ctx } = await this.resolveViewScope(actor);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const detail = await this.loadDetailTx(actor.companyId, id, tx);
      if (!detail || !(await this.detailInScope(actor, scope, ctx, detail, tx))) {
        throw new NotFoundException("Adjustment request not found");
      }
      return detail;
    });
  }

  // ─── Approve (approve:adjustment) ────────────────────────────────────────────────

  async approve(actor: Actor, id: string, dto: ApproveAdjustmentRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.lockDecidable(actor, id, "approve", tx);
        await this.assertPeriodOpenForDate(actor.companyId, request.workDate, tx);
        const target = await this.resolveRequestEmployee(actor.companyId, request, tx);
        const { recordId } = await this.applyToRecord(actor, tx, {
          userId: request.userId,
          employeeId: target.id,
          departmentId: target.orgUnitId,
          workDate: request.workDate,
          requestId: request.id,
          proposals: await this.storedProposals(actor.companyId, request.id, tx),
          requestedCheckInAt: request.requestedCheckInAt,
          requestedCheckOutAt: request.requestedCheckOutAt,
          reason: request.reason,
        });
        await this.finalizeApproval(actor, tx, request, recordId, dto);
        return this.loadDetailTx(actor.companyId, id, tx);
      })
      .catch((err: unknown) => this.mapError(err, "approve", { companyId: actor.companyId, id }));
  }

  /** Persist the Approved transition + close the task + audit/outbox — all inside the approve tx. */
  private async finalizeApproval(
    actor: Actor,
    tx: TenantTx,
    request: { id: string; workDate: string; userId: string; taskId: string | null },
    recordId: string,
    dto: ApproveAdjustmentRequest,
  ): Promise<void> {
    await this.repo.updateRequestTx(
      actor.companyId,
      request.id,
      {
        status: ADJUSTMENT_STATUS.APPROVED,
        attendanceRecordId: recordId,
        approvedBy: actor.id,
        approvedAt: new Date(),
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        reviewNote: dto.note ?? null,
        updatedBy: actor.id,
      },
      tx,
    );
    if (request.taskId)
      await this.hrTasks.closeTaskTx(tx, actor.companyId, request.taskId, "approved");
    await emitAdjustmentApproved(this.sinks, tx, {
      requestId: request.id,
      recordId,
      userId: request.userId,
      workDate: request.workDate,
      actorId: actor.id,
    });
  }

  // ─── Reject (reject:adjustment; reason required — Zod) ───────────────────────────

  async reject(actor: Actor, id: string, dto: RejectAdjustmentRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.lockDecidable(actor, id, "reject", tx);
        await this.repo.updateRequestTx(
          actor.companyId,
          id,
          {
            status: ADJUSTMENT_STATUS.REJECTED,
            reviewedBy: actor.id,
            reviewedAt: new Date(),
            reviewNote: dto.reason,
            updatedBy: actor.id,
          },
          tx,
        );
        if (request.taskId)
          await this.hrTasks.closeTaskTx(tx, actor.companyId, request.taskId, "completed");

        await this.audit.record(tx, {
          action: "AttendanceAdjustmentRejected",
          objectType: "attendance_adjustment_request",
          objectId: id,
          actorUserId: actor.id,
          after: { reviewNote: dto.reason },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.adjustment_rejected",
          payload: { requestId: id, userId: request.userId, rejectedBy: actor.id },
        });
        return this.loadDetailTx(actor.companyId, id, tx);
      })
      .catch((err: unknown) => this.mapError(err, "reject", { companyId: actor.companyId, id }));
  }

  // ─── Direct adjust (adjust-direct:attendance — no approval round) ─────────────────

  async adjustDirect(actor: Actor, recordId: string, dto: DirectAdjustRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const record = await this.lockRecord(actor.companyId, recordId, tx);
        await this.assertPeriodOpenForDate(actor.companyId, record.workDate, tx);
        const target = await this.resolveRecordEmployee(actor.companyId, record, tx);
        await this.assertScope(actor, "adjust-direct", ATTENDANCE, target);

        const proposals = toProposals(dto.items);
        const request = await this.insertDirectRequest(actor, record, target, dto, proposals, tx);
        await this.applyToRecord(actor, tx, {
          userId: record.userId,
          employeeId: target.id,
          departmentId: target.orgUnitId,
          workDate: record.workDate,
          requestId: request.id,
          proposals,
          requestedCheckInAt: null,
          requestedCheckOutAt: null,
          reason: dto.reason,
        });
        await emitRecordAdjustedDirect(this.sinks, tx, {
          recordId: record.id,
          requestId: request.id,
          userId: record.userId,
          workDate: record.workDate,
          actorId: actor.id,
        });
        return this.loadDetailTx(actor.companyId, request.id, tx);
      })
      .catch((err: unknown) =>
        this.mapError(err, "adjustDirect", { companyId: actor.companyId, recordId }),
      );
  }

  /** Lock the record row (FOR UPDATE) or 404 — the anchor for a direct adjustment. */
  private async lockRecord(
    companyId: string,
    recordId: string,
    tx: TenantTx,
  ): Promise<AttendanceRecordRow> {
    const [record] = await this.attendanceRepo.findRecordByIdForUpdateTx(companyId, recordId, tx);
    if (!record) throw new NotFoundException("Attendance record not found");
    return record;
  }

  /** adjust-direct anchors its ledger to an auto-approved request row (items.request_id is NOT NULL). */
  private async insertDirectRequest(
    actor: Actor,
    record: { id: string; userId: string; workDate: string; checkInAt: Date | null },
    target: EmployeeScope,
    dto: DirectAdjustRequest,
    proposals: AdjustmentItemProposal[],
    tx: TenantTx,
  ): Promise<{ id: string }> {
    const requested = deriveRequestedTimes(record.workDate, {
      proposals,
      existingCheckIn: record.checkInAt,
    });
    const [request] = await this.repo.insertRequestTx(
      actor.companyId,
      {
        companyId: actor.companyId,
        userId: record.userId,
        employeeId: target.id,
        attendanceRecordId: record.id,
        workDate: record.workDate,
        requestType: "OTHER",
        reason: dto.reason,
        status: ADJUSTMENT_STATUS.APPROVED,
        submittedAt: new Date(),
        requestedBy: actor.id,
        approvedBy: actor.id,
        approvedAt: new Date(),
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        requestedCheckInAt: requested.checkInAt,
        requestedCheckOutAt: requested.checkOutAt,
        createdBy: actor.id,
      },
      tx,
    );
    if (!request) throw new InternalServerErrorException("Failed to record direct adjustment");
    return request;
  }

  // ─── Shared apply (recalc record + append log + append applied items) ─────────────

  private async applyToRecord(
    actor: Actor,
    tx: TenantTx,
    input: ApplyRecordInput,
  ): Promise<{ recordId: string }> {
    const [existing] = await this.attendanceRepo.findRecordByUserDateTx(
      actor.companyId,
      input.userId,
      input.workDate,
      tx,
    );
    // Load the subject's schedule so late/early are RECOMPUTED when check-in/out moves (SPEC-04 §14) —
    // otherwise a UPDATE_CHECK_IN would leave a stale lateness while status flips to Adjusted.
    const schedule = await this.loadScheduleCalc(actor.companyId, input.userId, input.workDate, tx);
    const { patch, appliedItems } = recomputeRecord(toCalcInput(existing), input.proposals, {
      requestedCheckInAt: input.requestedCheckInAt,
      requestedCheckOutAt: input.requestedCheckOutAt,
      workDate: input.workDate,
      schedule,
    });
    const record = await this.persistRecord(actor, tx, existing, input, patch);
    await this.appendAdjustmentArtifacts(actor, tx, record.id, input, appliedItems);
    return { recordId: record.id };
  }

  /**
   * Resolve the subject user's work schedule → pure ScheduleCalc. A missing schedule is a SAFE
   * fallback: we log a warning and return null so recomputeRecord keeps the stored late/early (never
   * swallowed, never a 500). Assigned schedule wins, else the company default (repo-side).
   */
  private async loadScheduleCalc(
    companyId: string,
    userId: string,
    workDate: string,
    tx: TenantTx,
  ): Promise<ScheduleCalc | null> {
    const row = await this.attendanceRepo.resolveScheduleForUserTx(companyId, userId, tx);
    if (!row) {
      this.logger.warn(
        `No work schedule for user=${userId} on ${workDate}; late/early recompute skipped (stored figures kept)`,
      );
      return null;
    }
    return toScheduleCalc(row);
  }

  private async persistRecord(
    actor: Actor,
    tx: TenantTx,
    existing: AttendanceRecordRow | undefined,
    input: ApplyRecordInput,
    patch: Parameters<typeof buildRecordValues>[0],
  ): Promise<{ id: string }> {
    const recordValues = buildRecordValues(patch, existing, {
      employeeId: input.employeeId,
      departmentId: input.departmentId,
      actorId: actor.id,
    });
    const [record] = existing
      ? await this.attendanceRepo.updateRecordTx(actor.companyId, existing.id, recordValues, tx)
      : await this.attendanceRepo.insertRecordTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            userId: input.userId,
            workDate: input.workDate,
            createdBy: actor.id,
            ...recordValues,
          },
          tx,
        );
    if (!record) throw new InternalServerErrorException("Failed to apply adjustment to record");
    return record;
  }

  /** APPEND the log_type='Adjustment' row + the applied (is_applied=true) ledger — append-only. */
  private async appendAdjustmentArtifacts(
    actor: Actor,
    tx: TenantTx,
    recordId: string,
    input: ApplyRecordInput,
    appliedItems: AppliedItem[],
  ): Promise<void> {
    await this.attendanceRepo.insertAttendanceLogTx(
      actor.companyId,
      {
        attendanceRecordId: recordId,
        employeeId: input.employeeId,
        userId: input.userId,
        workDate: input.workDate,
        logType: "Adjustment",
        source: "MANUAL",
        isValid: true,
        note: input.reason,
        createdBy: actor.id,
      },
      tx,
    );
    await this.repo.insertItemsTx(
      actor.companyId,
      buildAppliedItemRows(appliedItems, {
        companyId: actor.companyId,
        requestId: input.requestId,
        actorId: actor.id,
      }),
      tx,
    );
  }

  // ─── Scope helpers ───────────────────────────────────────────────────────────────

  /** Lock a Pending request, then enforce the decision-scope membership of its employee. */
  private async lockDecidable(actor: Actor, id: string, action: string, tx: TenantTx) {
    const [request] = await this.repo.findRequestByIdForUpdateTx(actor.companyId, id, tx);
    if (!request) throw new NotFoundException(`Adjustment request not found: ${id}`);
    if (!isDecidable(request.status)) {
      throw new ConflictException(
        `Đơn không còn ở trạng thái chờ duyệt (status=${request.status})`,
      );
    }
    // SPEC-04 §15.10 quy tắc 6 — HARD-RULE (cấm tuyệt đối, SAU isDecidable, TRƯỚC assertScope):
    // người tạo đơn KHÔNG được tự duyệt/từ chối đơn của chính mình (requested_by ≠ approver_id).
    // Data-scope KHÔNG thay được rule này — manager có scope Team/Company trùm chính họ vẫn phải bị
    // chặn khi tự xử lý đơn của mình (deny-path test RED-trước ở service.spec + int.spec).
    if (request.requestedBy === actor.id) {
      throw new ForbiddenException({
        code: "ATT-ERR-SELF-APPROVAL",
        message:
          "ATT-ERR-SELF-APPROVAL: người tạo đơn không được tự duyệt/từ chối đơn của chính mình",
      });
    }
    const target = await this.resolveRequestEmployee(actor.companyId, request, tx);
    await this.assertScope(actor, action, ADJUSTMENT, target);
    return request;
  }

  /** 403 when the actor's granted scope for (action,resource) does NOT cover the target employee. */
  private async assertScope(
    actor: Actor,
    action: string,
    resourceType: string,
    target: EmployeeScope,
  ): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(
      actor.id,
      actor.companyId,
      action,
      resourceType,
      { isSensitive: true },
    );
    const ctx = await this.dataScope.resolveContext(actor.id, actor.companyId);
    if (!this.inScope(scope, ctx, target)) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: đối tượng nằm ngoài phạm vi");
    }
  }

  /** Strongest view scope across view-own/team/company (view-own gate already passed at controller). */
  private async resolveViewScope(actor: Actor): Promise<{ scope: DataScope; ctx: ScopeContext }> {
    const company = await this.permission.resolveStrongestScope(
      actor.id,
      actor.companyId,
      "view-company",
      ADJUSTMENT,
      { isSensitive: true },
    );
    const team = await this.permission.resolveStrongestScope(
      actor.id,
      actor.companyId,
      "view-team",
      ADJUSTMENT,
      { isSensitive: true },
    );
    const scope: DataScope = company ?? team ?? "Own";
    const ctx = await this.dataScope.resolveContext(actor.id, actor.companyId);
    return { scope, ctx };
  }

  private async detailInScope(
    actor: Actor,
    scope: DataScope,
    ctx: ScopeContext,
    detail: AttendanceAdjustmentRequestDetail & { userId?: string },
    tx: TenantTx,
  ): Promise<boolean> {
    // Own: the actor's own request (by requestedBy or the subject user) is always visible.
    if (detail.requestedBy === actor.id) return true;
    // Team/Company: resolve the REAL target employee (orgUnitId/directManagerUserId) — a hardcoded
    // null here always fails Team-scope membership, 404-ing managers viewing their reports' requests.
    const userId = (detail as { userId?: string | null }).userId;
    if (!userId) return false;
    const target = await this.resolveRequestEmployee(
      actor.companyId,
      { employeeId: detail.employeeId ?? null, userId },
      tx,
    ).catch(() => null);
    if (!target) return false;
    return this.inScope(scope, ctx, target);
  }

  private inScope(scope: DataScope | null, ctx: ScopeContext, target: EmployeeScope): boolean {
    return this.dataScope.isEmployeeInScope(scope, ctx, {
      userId: target.userId,
      companyId: target.companyId,
      orgUnitId: target.orgUnitId,
      directManagerUserId: target.directManagerUserId,
    });
  }

  private async resolveRequestEmployee(
    companyId: string,
    request: { employeeId: string | null; userId: string },
    tx: TenantTx,
  ): Promise<EmployeeScope> {
    const emp = request.employeeId
      ? await this.repo.findEmployeeScopeByIdTx(companyId, request.employeeId, tx)
      : await this.repo.findEmployeeScopeByUserIdTx(companyId, request.userId, tx);
    if (!emp) throw new NotFoundException("Không tìm thấy hồ sơ nhân sự của đơn");
    return emp;
  }

  private async resolveRecordEmployee(
    companyId: string,
    record: { employeeId: string | null; userId: string },
    tx: TenantTx,
  ): Promise<EmployeeScope> {
    const emp = record.employeeId
      ? await this.repo.findEmployeeScopeByIdTx(companyId, record.employeeId, tx)
      : await this.repo.findEmployeeScopeByUserIdTx(companyId, record.userId, tx);
    if (!emp) throw new NotFoundException("Không tìm thấy hồ sơ nhân sự của bản ghi");
    return emp;
  }

  // ─── Ledger / DTO helpers ────────────────────────────────────────────────────────

  private async storedProposals(
    companyId: string,
    requestId: string,
    tx: TenantTx,
  ): Promise<AdjustmentItemProposal[]> {
    const rows = await this.repo.findItemsByRequestTx(companyId, requestId, tx);
    return rows
      .filter((r) => r.isApplied === false)
      .map((r) => ({ fieldName: r.fieldName, newValue: r.newValue, note: r.note }));
  }

  private async loadDetailTx(companyId: string, id: string, tx: TenantTx) {
    const [row] = await this.repo.findDetailByIdTx(companyId, id, tx);
    if (!row) throw new NotFoundException(`Adjustment request not found: ${id}`);
    const items = await this.repo.findItemsByRequestTx(companyId, id, tx);
    const dto = toAdjustmentDetailDto(row, items);
    // Carry the subject user id for the detail-scope test (not part of the public DTO shape).
    return Object.assign(dto, { userId: (row as { userId?: string }).userId });
  }

  private toFilters(query: AdjustmentListQuery): AdjustmentListFilters {
    return {
      status: query.status,
      requestType: query.requestType,
      employeeId: query.employeeId,
      fromDate: query.fromDate,
      toDate: query.toDate,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private toListResponse(
    rows: Record<string, unknown>[],
    total: number,
    query: AdjustmentListQuery,
  ): AttendanceAdjustmentListResponse {
    const totalPages = query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0;
    return {
      items: rows.map(toAdjustmentListItem),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages,
        hasNext: query.page < totalPages,
        hasPrev: query.page > 1,
      },
    };
  }

  // ─── Error mapping ────────────────────────────────────────────────────────────────

  /** 409 if the attendance period covering `workDate` is locked (create/approve/adjust-direct guard). */
  private async assertPeriodOpenForDate(
    companyId: string,
    workDate: string,
    tx: TenantTx,
  ): Promise<void> {
    const locked = await this.attendanceRepo.isPeriodLockedTx(companyId, monthOfDate(workDate), tx);
    this.assertPeriodOpen(locked, workDate);
  }

  private assertPeriodOpen(locked: boolean, workDate: string): void {
    if (locked) {
      throw new ConflictException(
        `Kỳ công ${monthOfDate(workDate)} đã khoá — không thể ghi/sửa công`,
      );
    }
  }

  private mapConflict(err: unknown, op: string, actor: Actor, workDate: string): never {
    if (isUniqueViolation(err)) {
      throw new ConflictException(`Đã có đơn điều chỉnh đang chờ duyệt cho ngày ${workDate}`);
    }
    return this.mapError(err, op, { companyId: actor.companyId });
  }

  private mapError(err: unknown, op: string, ctx: Record<string, unknown>): never {
    if (err instanceof HttpException) throw err;
    this.logger.error(`${op} unexpected error`, { err, ...ctx });
    throw new InternalServerErrorException("Lỗi hệ thống, vui lòng thử lại");
  }
}
