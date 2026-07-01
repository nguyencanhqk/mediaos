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
import { eq } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { attendanceAdjustmentRequests } from "../db/schema/hr";
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
  type RecordCalcInput,
} from "./attendance-adjustment.logic";
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

  // ─── Create (create-own:adjustment; create-thay gated by wider-than-Own scope) ─────

  async createRequest(actor: Actor, dto: CreateAdjustmentRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const target = await this.resolveCreateTarget(actor, dto, tx);
        this.assertPeriodOpen(
          await this.attendanceRepo.isPeriodLockedTx(
            actor.companyId,
            monthOfDate(dto.workDate),
            tx,
          ),
          dto.workDate,
        );

        const task = await this.hrTasks.createApprovalTaskTx(tx, actor.companyId, {
          title: `Duyệt điều chỉnh công ${dto.workDate}`,
          assigneeUserId: null,
        });
        const proposals = this.proposals(dto);
        const requested = this.deriveRequestedTimes(dto.workDate, {
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
            taskId: task.id,
            createdBy: actor.id,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to create adjustment request");

        // Proposed items are recorded up-front as NOT-yet-applied ledger rows (is_applied=false).
        await this.repo.insertItemsTx(
          actor.companyId,
          this.proposalRows(row.id, proposals, false, actor.id),
          tx,
        );

        await this.audit.record(tx, {
          action: "AttendanceAdjustmentRequested",
          objectType: "attendance_adjustment_request",
          objectId: row.id,
          actorUserId: actor.id,
          after: {
            employeeId: target.id,
            workDate: dto.workDate,
            requestType: dto.requestType,
            onBehalf: (target.userId ?? actor.id) !== actor.id,
          },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.adjustment_requested",
          payload: {
            requestId: row.id,
            employeeId: target.id,
            userId: target.userId ?? actor.id,
            workDate: dto.workDate,
            requestType: dto.requestType,
            taskId: task.id,
          },
        });
        return this.loadDetailTx(actor.companyId, row.id, tx);
      })
      .catch((err: unknown) => this.mapConflict(err, "createRequest", actor, dto.workDate));
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
      if (!detail || !this.detailInScope(actor, scope, ctx, detail)) {
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
        this.assertPeriodOpen(
          await this.attendanceRepo.isPeriodLockedTx(
            actor.companyId,
            monthOfDate(request.workDate),
            tx,
          ),
          request.workDate,
        );

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

        await this.repo.updateRequestTx(
          actor.companyId,
          id,
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

        await this.audit.record(tx, {
          action: "AttendanceAdjustmentApproved",
          objectType: "attendance_adjustment_request",
          objectId: id,
          actorUserId: actor.id,
          after: { recordId, workDate: request.workDate },
        });
        await this.audit.record(tx, {
          action: "AttendanceRecordAdjusted",
          objectType: "attendance_record",
          objectId: recordId,
          actorUserId: actor.id,
          after: { fromRequestId: id, workDate: request.workDate },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.adjustment_approved",
          payload: { requestId: id, recordId, userId: request.userId, approvedBy: actor.id },
        });
        return this.loadDetailTx(actor.companyId, id, tx);
      })
      .catch((err: unknown) => this.mapError(err, "approve", { companyId: actor.companyId, id }));
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
        const [record] = await this.attendanceRepo.findRecordByIdForUpdateTx(
          actor.companyId,
          recordId,
          tx,
        );
        if (!record) throw new NotFoundException("Attendance record not found");
        this.assertPeriodOpen(
          await this.attendanceRepo.isPeriodLockedTx(
            actor.companyId,
            monthOfDate(record.workDate),
            tx,
          ),
          record.workDate,
        );

        const target = await this.resolveRecordEmployee(actor.companyId, record, tx);
        await this.assertScope(actor, "adjust-direct", ATTENDANCE, target);

        const proposals = dto.items.map((i) => ({
          fieldName: i.fieldName,
          newValue: i.newValue,
          note: i.note,
        }));
        const requested = this.deriveRequestedTimes(record.workDate, {
          proposals,
          existingCheckIn: record.checkInAt,
        });
        // adjust-direct anchors its ledger to an auto-approved request row (items.request_id is NOT NULL).
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

        await this.audit.record(tx, {
          action: "AttendanceRecordAdjusted",
          objectType: "attendance_record",
          objectId: record.id,
          actorUserId: actor.id,
          after: { fromRequestId: request.id, workDate: record.workDate, direct: true },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.record_adjusted",
          payload: {
            requestId: request.id,
            recordId: record.id,
            userId: record.userId,
            adjustedBy: actor.id,
          },
        });
        return this.loadDetailTx(actor.companyId, request.id, tx);
      })
      .catch((err: unknown) =>
        this.mapError(err, "adjustDirect", { companyId: actor.companyId, recordId }),
      );
  }

  // ─── Shared apply (recalc record + append log + append applied items) ─────────────

  private async applyToRecord(
    actor: Actor,
    tx: TenantTx,
    input: {
      userId: string;
      employeeId: string;
      departmentId: string | null;
      workDate: string;
      requestId: string;
      proposals: AdjustmentItemProposal[];
      requestedCheckInAt: Date | null;
      requestedCheckOutAt: Date | null;
      reason: string;
    },
  ): Promise<{ recordId: string }> {
    const [existing] = await this.attendanceRepo.findRecordByUserDateTx(
      actor.companyId,
      input.userId,
      input.workDate,
      tx,
    );
    const calcInput = toCalcInput(existing);
    const { patch, appliedItems } = recomputeRecord(calcInput, input.proposals, {
      requestedCheckInAt: input.requestedCheckInAt,
      requestedCheckOutAt: input.requestedCheckOutAt,
    });

    const recordValues = {
      ...patch,
      checkInMethod: patch.checkInAt ? "adjustment" : (existing?.checkInMethod ?? null),
      checkOutMethod: patch.checkOutAt ? "adjustment" : (existing?.checkOutMethod ?? null),
      employeeId: input.employeeId,
      departmentId: input.departmentId,
      updatedBy: actor.id,
    };
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

    // APPEND a log_type='Adjustment' row — attendance_logs is APPEND-ONLY, existing logs are untouched.
    await this.attendanceRepo.insertAttendanceLogTx(
      actor.companyId,
      {
        attendanceRecordId: record.id,
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

    // APPEND the applied ledger entries (is_applied=true) — proposal rows from create stay as history.
    await this.repo.insertItemsTx(
      actor.companyId,
      appliedItems.map((item) => ({
        companyId: actor.companyId,
        requestId: input.requestId,
        fieldName: item.fieldName,
        oldValue: item.oldValue,
        newValue: item.newValue,
        appliedValue: item.appliedValue,
        isApplied: true,
        note: item.note,
        createdBy: actor.id,
      })),
      tx,
    );
    return { recordId: record.id };
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

  private detailInScope(
    actor: Actor,
    scope: DataScope,
    ctx: ScopeContext,
    detail: AttendanceAdjustmentRequestDetail & { userId?: string },
  ): boolean {
    // Own: the actor's own request (by requestedBy or the subject user) is always visible.
    if (detail.requestedBy === actor.id) return true;
    return this.inScope(scope, ctx, {
      id: detail.employeeId ?? "",
      userId: (detail as { userId?: string | null }).userId ?? null,
      companyId: actor.companyId,
      orgUnitId: null,
      directManagerUserId: null,
      status: "active",
    });
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

  /**
   * A request row must carry ≥1 requested time (att_adj_has_request_check, mig 0061 — NOT dropped by
   * 0457). We take the explicit dto times, else derive from a checkInAt/checkOutAt item, else fall back
   * to the existing record's check-in or a start-of-workday sentinel so an explanation-only request still
   * persists. FOLLOW-UP (db-migration lane): drop att_adj_has_request_check to store purely-explanatory
   * requests without a sentinel.
   */
  private deriveRequestedTimes(
    workDate: string,
    opts: {
      explicitIn?: string | null;
      explicitOut?: string | null;
      proposals: AdjustmentItemProposal[];
      existingCheckIn?: Date | null;
    },
  ): { checkInAt: Date | null; checkOutAt: Date | null } {
    const inAt = opts.explicitIn
      ? new Date(opts.explicitIn)
      : itemDate(opts.proposals, "checkInAt");
    const outAt = opts.explicitOut
      ? new Date(opts.explicitOut)
      : itemDate(opts.proposals, "checkOutAt");
    if (inAt || outAt) return { checkInAt: inAt, checkOutAt: outAt };
    return {
      checkInAt: opts.existingCheckIn ?? new Date(`${workDate}T00:00:00.000Z`),
      checkOutAt: null,
    };
  }

  private proposals(dto: CreateAdjustmentRequest): AdjustmentItemProposal[] {
    return (dto.items ?? []).map((i) => ({
      fieldName: i.fieldName,
      newValue: i.newValue,
      note: i.note,
    }));
  }

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

  private proposalRows(
    requestId: string,
    proposals: AdjustmentItemProposal[],
    isApplied: boolean,
    actorId: string,
  ) {
    return proposals.map((p) => ({
      requestId,
      fieldName: p.fieldName,
      oldValue: null,
      newValue: p.newValue,
      appliedValue: null,
      isApplied,
      note: p.note ?? null,
      createdBy: actorId,
    }));
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

/** attendanceAdjustmentRequests.userId self-lock predicate for the "my" list. */
function eqUserId(userId: string) {
  return eq(attendanceAdjustmentRequests.userId, userId);
}

/** Pull a Date from a checkInAt/checkOutAt proposal (ISO string / Date), or null when absent/invalid. */
function itemDate(proposals: AdjustmentItemProposal[], field: string): Date | null {
  const item = proposals.find((p) => p.fieldName === field);
  if (!item || item.newValue == null) return null;
  const d = item.newValue instanceof Date ? item.newValue : new Date(String(item.newValue));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** attendance_records row (or absent) → the minimal view the recalc reads. Absent = a fresh record. */
function toCalcInput(row: RecordCalcSource | undefined): RecordCalcInput {
  return {
    checkInAt: row?.checkInAt ?? null,
    checkOutAt: row?.checkOutAt ?? null,
    lateMinutes: row?.lateMinutes ?? 0,
    earlyLeaveMinutes: row?.earlyLeaveMinutes ?? 0,
    workingMinutes: row?.workingMinutes ?? null,
    requiredWorkingMinutes: row?.requiredWorkingMinutes ?? null,
    breakMinutes: row?.breakMinutes ?? null,
    missingMinutes: row?.missingMinutes ?? null,
    note: row?.note ?? null,
  };
}

interface RecordCalcSource {
  checkInAt: Date | null;
  checkOutAt: Date | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  workingMinutes: number | null;
  requiredWorkingMinutes: number | null;
  breakMinutes: number | null;
  missingMinutes: number | null;
  note: string | null;
}
