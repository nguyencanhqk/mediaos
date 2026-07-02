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
  ApproveRemoteWorkRequest,
  CreateRemoteWorkRequest,
  DataScope,
  RejectRemoteWorkRequest,
  RemoteWorkRequestDetail,
  RemoteWorkRequestListQuery,
  RemoteWorkRequestListResponse,
  SubmitRemoteWorkRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService, type ScopeContext } from "../permission/data-scope.service";
import { ATT_RESOURCES } from "./attendance-permissions.const";
import {
  RemoteWorkRequestRepository,
  type RemoteRequestListFilters,
} from "./remote-work-request.repository";
import {
  attendanceStatusForMode,
  dateRangeInclusive,
  isCancellable,
  isDecidable,
  isSubmittable,
  REMOTE_REQUEST_STATUS,
  workModeForRequestType,
} from "./remote-work-request.logic";
import {
  toRemoteWorkRequestDetail,
  toRemoteWorkRequestListItem,
} from "./remote-work-request.mappers";

const REMOTE_REQUEST = ATT_RESOURCES.REMOTE_REQUEST;

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
 * S3-ATT-BE-5 — remote/onsite-work request workflow (DB-04 §7.8/7.9, CO-S4-004).
 *
 * STATE-MACHINE (CHỐT 2026-07-02, owner override): create → Draft (KHÔNG Pending); submit RIÊNG
 * (Draft→Pending, chọn approver + watchers) → Pending → Approved | Rejected (decidable) hoặc Cancelled
 * (Draft/Pending, chủ đơn). Mọi mutation trong MỘT withTenant(tx) (BẤT BIẾN #1) + audit + outbox CÙNG tx
 * (BẤT BIẾN #2 append-only). Approved ảnh hưởng tính công: UPSERT-BY (company_id,employee_id,date)
 * IDEMPOTENT trên attendance_records mỗi ngày trong [startDate,endDate] theo attendanceMode.
 */
@Injectable()
export class RemoteWorkRequestService {
  private readonly logger = new Logger(RemoteWorkRequestService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RemoteWorkRequestRepository,
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── Create (create-own:remote-request → Draft) ────────────────────────────────

  async createRequest(
    actor: Actor,
    dto: CreateRemoteWorkRequest,
  ): Promise<RemoteWorkRequestDetail> {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const target = await this.resolveCreateTarget(actor, dto, tx);
        const [row] = await this.repo.insertRequestTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            employeeId: target.id,
            requestType: dto.requestType,
            startDate: dto.startDate,
            endDate: dto.endDate,
            startTime: dto.startTime ?? null,
            endTime: dto.endTime ?? null,
            attendanceMode: dto.attendanceMode,
            locationText: dto.locationText ?? null,
            reason: dto.reason,
            taskId: dto.taskId ?? null,
            projectId: dto.projectId ?? null,
            status: REMOTE_REQUEST_STATUS.DRAFT,
            requestedBy: actor.id,
            attachmentFileId: dto.attachmentFileId ?? null,
            createdBy: actor.id,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to create remote work request");
        await this.audit.record(tx, {
          action: "RemoteWorkRequestCreated",
          objectType: "remote_work_request",
          objectId: row.id,
          actorUserId: actor.id,
          after: {
            employeeId: target.id,
            requestType: dto.requestType,
            startDate: dto.startDate,
            endDate: dto.endDate,
            attendanceMode: dto.attendanceMode,
          },
        });
        return this.loadDetailTx(actor.companyId, row.id, tx);
      })
      .catch((err: unknown) => this.mapError(err, "createRequest", { companyId: actor.companyId }));
  }

  /** Own employee unless targetEmployeeId is set AND the actor holds a wider-than-Own create scope. */
  private async resolveCreateTarget(
    actor: Actor,
    dto: CreateRemoteWorkRequest,
    tx: TenantTx,
  ): Promise<EmployeeScope> {
    const own = await this.repo.findEmployeeScopeByUserIdTx(actor.companyId, actor.id, tx);
    if (!own) throw new ForbiddenException("Tài khoản chưa liên kết hồ sơ nhân sự");
    if (!dto.targetEmployeeId || dto.targetEmployeeId === own.id) return own;

    const scope = await this.permission.resolveStrongestScope(
      actor.id,
      actor.companyId,
      "create-own",
      REMOTE_REQUEST,
    );
    if (scope == null || scope === "Own") {
      throw new ForbiddenException("Không có quyền tạo đơn remote/công tác thay nhân viên khác");
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

  // ─── Submit (Draft→Pending; create-own:remote-request gate — owner-only lifecycle) ─────────────

  async submit(
    actor: Actor,
    id: string,
    dto: SubmitRemoteWorkRequest,
  ): Promise<RemoteWorkRequestDetail> {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.lockOwnedTx(actor, id, tx);
        if (!isSubmittable(request.status)) {
          throw new ConflictException(
            `Đơn không còn ở trạng thái Draft (status=${request.status})`,
          );
        }
        const approverEmployee = await this.assertApproverAndWatchersInCompany(actor, dto, tx);
        await this.repo.updateRequestTx(
          actor.companyId,
          id,
          {
            status: REMOTE_REQUEST_STATUS.PENDING,
            submittedAt: new Date(),
            currentApproverUserId: dto.currentApproverUserId,
            currentApproverEmployeeId: approverEmployee?.id ?? null,
            watcherUserIds: dto.watcherUserIds,
            updatedBy: actor.id,
          },
          tx,
        );
        await this.repo.insertApprovalTx(
          actor.companyId,
          {
            remoteWorkRequestId: id,
            stepOrder: 1,
            approverUserId: dto.currentApproverUserId,
            approverEmployeeId: approverEmployee?.id ?? null,
            action: "Submitted",
          },
          tx,
        );
        await this.audit.record(tx, {
          action: "RemoteWorkRequestSubmitted",
          objectType: "remote_work_request",
          objectId: id,
          actorUserId: actor.id,
          after: {
            currentApproverUserId: dto.currentApproverUserId,
            watcherUserIds: dto.watcherUserIds,
          },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.remote_request_submitted",
          payload: {
            requestId: id,
            employeeId: request.employeeId,
            currentApproverUserId: dto.currentApproverUserId,
            watcherUserIds: dto.watcherUserIds,
          },
        });
        return this.loadDetailTx(actor.companyId, id, tx);
      })
      .catch((err: unknown) => this.mapError(err, "submit", { companyId: actor.companyId, id }));
  }

  /**
   * Fail-closed: every candidate id (approver + watchers) MUST resolve to a user row of the SAME
   * company_id (done_when cross-tenant deny). Returns the approver's employee scope row (nullable — an
   * approver without a linked employee profile is still a valid user-level approver).
   */
  private async assertApproverAndWatchersInCompany(
    actor: Actor,
    dto: SubmitRemoteWorkRequest,
    tx: TenantTx,
  ): Promise<EmployeeScope | null> {
    const candidateIds = [dto.currentApproverUserId, ...dto.watcherUserIds];
    const inCompany = await this.repo.findUserIdsInCompanyTx(actor.companyId, candidateIds, tx);
    const missing = candidateIds.filter((cid) => !inCompany.has(cid));
    if (missing.length > 0) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: approver/watcher phải thuộc cùng công ty");
    }
    return this.repo.findEmployeeScopeByUserIdTx(actor.companyId, dto.currentApproverUserId, tx);
  }

  // ─── Lists ─────────────────────────────────────────────────────────────────────

  /** view-own: self-locked to the actor's requests (not a data-scope query, mirrors listMy adjustment). */
  async listMy(
    actor: Actor,
    query: RemoteWorkRequestListQuery,
  ): Promise<RemoteWorkRequestListResponse> {
    const ownScopeCond = this.dataScope.buildEmployeeScopeCondition("Own", {
      userId: actor.id,
      companyId: actor.companyId,
      orgUnitId: null,
      managedUserIds: [],
      headedOrgUnitIds: [],
    });
    return this.db.withTenant(actor.companyId, async (tx) => {
      const { rows, total } = await this.repo.listTx(
        actor.companyId,
        [ownScopeCond],
        this.toFilters(query),
        tx,
      );
      return this.toListResponse(rows, total, query);
    });
  }

  async listTeam(actor: Actor, query: RemoteWorkRequestListQuery) {
    return this.listScoped(actor, query, "view-team");
  }

  async listCompany(actor: Actor, query: RemoteWorkRequestListQuery) {
    return this.listScoped(actor, query, "view-company");
  }

  private async listScoped(
    actor: Actor,
    query: RemoteWorkRequestListQuery,
    action: string,
  ): Promise<RemoteWorkRequestListResponse> {
    // GATE (403 if no grant). Sensitive pair → wildcard *:* does NOT satisfy it.
    const scope = await this.dataScope.resolveAndAssert(
      actor.id,
      actor.companyId,
      action,
      REMOTE_REQUEST,
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

  async getDetail(actor: Actor, id: string): Promise<RemoteWorkRequestDetail> {
    const { scope, ctx } = await this.resolveViewScope(actor);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const detail = await this.loadDetailTx(actor.companyId, id, tx);
      if (!detail || !(await this.detailInScope(actor, scope, ctx, detail, tx))) {
        throw new NotFoundException("Remote work request not found");
      }
      return detail;
    });
  }

  // ─── Approve (approve:remote-request; Pending only) ──────────────────────────────

  async approve(
    actor: Actor,
    id: string,
    dto: ApproveRemoteWorkRequest,
  ): Promise<RemoteWorkRequestDetail> {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.lockDecidable(actor, id, "approve", tx);
        await this.repo.updateRequestTx(
          actor.companyId,
          id,
          {
            status: REMOTE_REQUEST_STATUS.APPROVED,
            approvedBy: actor.id,
            approvedAt: new Date(),
            updatedBy: actor.id,
          },
          tx,
        );
        await this.repo.insertApprovalTx(
          actor.companyId,
          {
            remoteWorkRequestId: id,
            stepOrder: 2,
            approverUserId: actor.id,
            action: "Approved",
            note: dto.note ?? null,
          },
          tx,
        );
        await this.applyCalcAffect(actor, tx, request);
        await this.audit.record(tx, {
          action: "RemoteWorkRequestApproved",
          objectType: "remote_work_request",
          objectId: id,
          actorUserId: actor.id,
          after: { note: dto.note ?? null },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.remote_request_approved",
          payload: { requestId: id, employeeId: request.employeeId, approvedBy: actor.id },
        });
        return this.loadDetailTx(actor.companyId, id, tx);
      })
      .catch((err: unknown) => this.mapError(err, "approve", { companyId: actor.companyId, id }));
  }

  /**
   * Approved → calc-affect (DB-04 §7.8 quy tắc 2-4): for each day in [startDate,endDate], UPSERT-BY
   * (company_id,employee_id,work_date) IDEMPOTENT — re-approve does NOT duplicate a row. NO_ATTENDANCE
   * writes nothing (attendanceStatusForMode returns null).
   */
  private async applyCalcAffect(
    actor: Actor,
    tx: TenantTx,
    request: {
      id: string;
      employeeId: string | null;
      startDate: string;
      endDate: string;
      requestType: string;
      attendanceMode: string;
    },
  ): Promise<void> {
    const attendanceStatus = attendanceStatusForMode(request.attendanceMode);
    if (attendanceStatus == null || !request.employeeId) return;
    const employee = await this.repo.findEmployeeScopeByIdTx(
      actor.companyId,
      request.employeeId,
      tx,
    );
    if (!employee?.userId) return;
    const workMode = workModeForRequestType(request.requestType);
    for (const workDate of dateRangeInclusive(request.startDate, request.endDate)) {
      await this.repo.upsertRemoteAffectedRecordTx(
        actor.companyId,
        {
          userId: employee.userId,
          employeeId: employee.id,
          workDate,
          remoteWorkRequestId: request.id,
          workMode,
          attendanceStatus,
          actorId: actor.id,
        },
        tx,
      );
    }
  }

  // ─── Reject (reject:remote-request; Pending only; rejectReason required — Zod) ────────────────

  async reject(
    actor: Actor,
    id: string,
    dto: RejectRemoteWorkRequest,
  ): Promise<RemoteWorkRequestDetail> {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.lockDecidable(actor, id, "reject", tx);
        await this.repo.updateRequestTx(
          actor.companyId,
          id,
          {
            status: REMOTE_REQUEST_STATUS.REJECTED,
            rejectedBy: actor.id,
            rejectedAt: new Date(),
            rejectReason: dto.rejectReason,
            updatedBy: actor.id,
          },
          tx,
        );
        await this.repo.insertApprovalTx(
          actor.companyId,
          {
            remoteWorkRequestId: id,
            stepOrder: 2,
            approverUserId: actor.id,
            action: "Rejected",
            note: dto.rejectReason,
          },
          tx,
        );
        await this.audit.record(tx, {
          action: "RemoteWorkRequestRejected",
          objectType: "remote_work_request",
          objectId: id,
          actorUserId: actor.id,
          after: { rejectReason: dto.rejectReason },
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.remote_request_rejected",
          payload: { requestId: id, employeeId: request.employeeId, rejectedBy: actor.id },
        });
        return this.loadDetailTx(actor.companyId, id, tx);
      })
      .catch((err: unknown) => this.mapError(err, "reject", { companyId: actor.companyId, id }));
  }

  // ─── Cancel-own (Draft/Pending only, owner-only) ─────────────────────────────────

  async cancelOwn(actor: Actor, id: string): Promise<RemoteWorkRequestDetail> {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const request = await this.lockOwnedTx(actor, id, tx);
        if (!isCancellable(request.status)) {
          throw new ConflictException(
            `Đơn không thể huỷ ở trạng thái hiện tại (status=${request.status})`,
          );
        }
        await this.repo.updateRequestTx(
          actor.companyId,
          id,
          {
            status: REMOTE_REQUEST_STATUS.CANCELLED,
            cancelledBy: actor.id,
            cancelledAt: new Date(),
            updatedBy: actor.id,
          },
          tx,
        );
        await this.repo.insertApprovalTx(
          actor.companyId,
          { remoteWorkRequestId: id, stepOrder: 3, approverUserId: actor.id, action: "Cancelled" },
          tx,
        );
        await this.audit.record(tx, {
          action: "RemoteWorkRequestCancelled",
          objectType: "remote_work_request",
          objectId: id,
          actorUserId: actor.id,
        });
        await this.outbox.enqueue(tx, {
          eventType: "attendance.remote_request_cancelled",
          payload: { requestId: id, employeeId: request.employeeId, cancelledBy: actor.id },
        });
        return this.loadDetailTx(actor.companyId, id, tx);
      })
      .catch((err: unknown) => this.mapError(err, "cancelOwn", { companyId: actor.companyId, id }));
  }

  // ─── Scope / lock helpers ───────────────────────────────────────────────────────

  /** Lock a request row that belongs to the caller (requested_by = actor) — 404 otherwise (no leak). */
  private async lockOwnedTx(
    actor: Actor,
    id: string,
    tx: TenantTx,
  ): Promise<{ id: string; status: string; employeeId: string | null }> {
    const [request] = await this.repo.findRequestByIdForUpdateTx(actor.companyId, id, tx);
    if (!request || request.requestedBy !== actor.id) {
      throw new NotFoundException(`Remote work request not found: ${id}`);
    }
    return request;
  }

  /** Lock a Pending request, then enforce the decision-scope membership of its employee. */
  private async lockDecidable(actor: Actor, id: string, action: string, tx: TenantTx) {
    const [request] = await this.repo.findRequestByIdForUpdateTx(actor.companyId, id, tx);
    if (!request) throw new NotFoundException(`Remote work request not found: ${id}`);
    if (!isDecidable(request.status)) {
      throw new ConflictException(
        `Đơn không còn ở trạng thái chờ duyệt (status=${request.status})`,
      );
    }
    // Người tạo đơn KHÔNG được tự duyệt/từ chối đơn của chính mình (mirror SPEC-04 §15.10 quy tắc 6 —
    // hard-rule áp dụng chung cho workflow phê duyệt ATT). Data-scope KHÔNG thay được rule này.
    if (request.requestedBy === actor.id) {
      throw new ForbiddenException({
        code: "ATT-ERR-SELF-APPROVAL",
        message:
          "ATT-ERR-SELF-APPROVAL: người tạo đơn không được tự duyệt/từ chối đơn của chính mình",
      });
    }
    if (!request.employeeId) throw new NotFoundException("Không tìm thấy hồ sơ nhân sự của đơn");
    const target = await this.repo.findEmployeeScopeByIdTx(actor.companyId, request.employeeId, tx);
    if (!target) throw new NotFoundException("Không tìm thấy hồ sơ nhân sự của đơn");
    await this.assertScope(actor, action, target);
    return request;
  }

  private async assertScope(actor: Actor, action: string, target: EmployeeScope): Promise<void> {
    const scope = await this.dataScope.resolveAndAssert(
      actor.id,
      actor.companyId,
      action,
      REMOTE_REQUEST,
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
      REMOTE_REQUEST,
      { isSensitive: true },
    );
    const team = await this.permission.resolveStrongestScope(
      actor.id,
      actor.companyId,
      "view-team",
      REMOTE_REQUEST,
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
    detail: RemoteWorkRequestDetail & { requestedBy?: string | null },
    tx: TenantTx,
  ): Promise<boolean> {
    if (detail.requestedBy === actor.id) return true;
    if (!detail.employeeId) return false;
    const target = await this.repo
      .findEmployeeScopeByIdTx(actor.companyId, detail.employeeId, tx)
      .catch(() => null);
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

  // ─── Ledger / DTO helpers ────────────────────────────────────────────────────────

  private async loadDetailTx(
    companyId: string,
    id: string,
    tx: TenantTx,
  ): Promise<RemoteWorkRequestDetail & { requestedBy?: string | null }> {
    const [row] = await this.repo.findDetailByIdTx(companyId, id, tx);
    if (!row) throw new NotFoundException(`Remote work request not found: ${id}`);
    return toRemoteWorkRequestDetail(row);
  }

  private toFilters(query: RemoteWorkRequestListQuery): RemoteRequestListFilters {
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
    query: RemoteWorkRequestListQuery,
  ): RemoteWorkRequestListResponse {
    const totalPages = query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0;
    return {
      items: rows.map(toRemoteWorkRequestListItem),
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

  private mapError(err: unknown, op: string, ctx: Record<string, unknown>): never {
    if (err instanceof HttpException) throw err;
    this.logger.error(`${op} unexpected error`, { err, ...ctx });
    throw new InternalServerErrorException("Lỗi hệ thống, vui lòng thử lại");
  }
}
