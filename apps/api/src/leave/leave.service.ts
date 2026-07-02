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
  CreateLeaveRequest,
  CreateLeaveTypeRequest,
  UpdateLeaveTypeRequest,
  UpsertLeaveBalanceRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { HrTasksService } from "../tasks/hr-tasks.service";
import { LeaveRepository } from "./leave.repository";
import { countLeaveDays } from "./leave.logic";
import { isUniqueViolation } from "../common/db-error";

interface Actor {
  id: string;
  companyId: string;
}

/** Calendar year of an ISO 'YYYY-MM-DD' date — the quota year a request is deducted from. */
function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

/**
 * G11-2 — Leave application service.
 *
 * BẤT BIẾN: đơn nghỉ duyệt QUA Task Hub (task_type='hr') — leave_requests.task_id trỏ tasks, KHÔNG
 * bảng approval riêng. Trừ phép (used_days) CHỈ xảy ra lúc DUYỆT, trong CÙNG tx với việc đóng đơn +
 * đóng task + audit + outbox. Trừ phép race-safe: `incrementUsedIfEnoughTx` chốt `used ≤ total` ngay
 * trong WHERE nên 2 lần duyệt song song không thể vượt hạn mức. Mọi ghi đi qua `withTenant` (RLS).
 */
@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LeaveRepository,
    private readonly permission: PermissionService,
    private readonly hrTasks: HrTasksService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // ─── leave_types (read:leave; manage:leave to mutate) ────────────────────────

  listTypes(companyId: string) {
    return this.repo.findTypes(companyId).then((rows) => rows.map(toTypeDto));
  }

  async createType(actor: Actor, dto: CreateLeaveTypeRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [row] = await this.repo.createTypeTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            name: dto.name,
            code: dto.code,
            paid: dto.paid,
            annualQuota: dto.annualQuota != null ? String(dto.annualQuota) : null,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to create leave type");
        await this.audit.record(tx, {
          action: "LeaveTypeCreated",
          objectType: "leave_type",
          objectId: row.id,
          actorUserId: actor.id,
          after: { name: row.name, code: row.code, paid: row.paid },
        });
        return toTypeDto(row);
      })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) {
          throw new ConflictException(`Đã có loại nghỉ với mã '${dto.code}'`);
        }
        return this.mapError(err, "createType", { companyId: actor.companyId });
      });
  }

  async updateType(actor: Actor, id: string, dto: UpdateLeaveTypeRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [existing] = await this.repo.findTypeByIdTx(actor.companyId, id, tx);
        if (!existing) throw new NotFoundException(`Leave type not found: ${id}`);
        const [row] = await this.repo.updateTypeTx(
          actor.companyId,
          id,
          {
            name: dto.name,
            paid: dto.paid,
            annualQuota:
              dto.annualQuota === undefined
                ? undefined
                : dto.annualQuota === null
                  ? null
                  : String(dto.annualQuota),
            status: dto.status,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to update leave type");
        await this.audit.record(tx, {
          action: "LeaveTypeUpdated",
          objectType: "leave_type",
          objectId: id,
          actorUserId: actor.id,
          before: { name: existing.name, status: existing.status },
          after: { name: row.name, status: row.status },
        });
        return toTypeDto(row);
      })
      .catch((err: unknown) =>
        this.mapError(err, "updateType", { companyId: actor.companyId, id }),
      );
  }

  // ─── leave_balances (read own; manage:leave to upsert / view others) ─────────

  async listBalances(actor: Actor, query: { scope: "me" | "all"; year?: number }) {
    if (query.scope === "all") {
      // Xem số phép của TẤT CẢ nhân sự cần manage:leave — fail-closed, KHÔNG âm thầm thu hẹp về bản thân.
      await this.assertCan(actor, "manage", "leave", "Không có quyền xem số phép của nhân sự khác");
      return this.repo.findBalances(actor.companyId, { year: query.year });
    }
    return this.repo.findBalances(actor.companyId, { userId: actor.id, year: query.year });
  }

  async upsertBalance(actor: Actor, dto: UpsertLeaveBalanceRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [row] = await this.repo.upsertBalanceTx(
          actor.companyId,
          {
            userId: dto.userId,
            leaveTypeId: dto.leaveTypeId,
            year: dto.year,
            totalDays: String(dto.totalDays),
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to upsert leave balance");
        await this.audit.record(tx, {
          action: "LeaveBalanceSet",
          objectType: "leave_balance",
          objectId: row.id,
          actorUserId: actor.id,
          after: {
            userId: dto.userId,
            leaveTypeId: dto.leaveTypeId,
            year: dto.year,
            totalDays: dto.totalDays,
          },
        });
        return toBalanceDto(row);
      })
      .catch((err: unknown) => this.mapError(err, "upsertBalance", { companyId: actor.companyId }));
  }

  // ─── leave_requests (create own; approve:leave to decide) ────────────────────

  async createRequest(actor: Actor, dto: CreateLeaveRequest) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [type] = await this.repo.findTypeByIdTx(actor.companyId, dto.leaveTypeId, tx);
        if (!type) throw new NotFoundException(`Leave type not found: ${dto.leaveTypeId}`);
        if (type.status !== "active") {
          throw new ConflictException(`Loại nghỉ '${type.name}' đang không hoạt động`);
        }

        const workingDays = await this.repo.resolveWorkingDaysForUserTx(
          actor.companyId,
          actor.id,
          tx,
        );
        const totalDays = countLeaveDays(dto.startDate, dto.endDate, workingDays);
        if (totalDays <= 0) {
          throw new ConflictException("Khoảng nghỉ không có ngày làm việc nào để tính phép");
        }

        const task = await this.hrTasks.createApprovalTaskTx(tx, actor.companyId, {
          title: `Duyệt đơn nghỉ ${dto.startDate} → ${dto.endDate}`,
          assigneeUserId: null,
        });
        const [row] = await this.repo.insertRequestTx(
          actor.companyId,
          {
            companyId: actor.companyId,
            userId: actor.id,
            leaveTypeId: dto.leaveTypeId,
            startDate: dto.startDate,
            endDate: dto.endDate,
            totalDays: String(totalDays),
            reason: dto.reason ?? null,
            status: "pending",
            taskId: task.id,
          },
          tx,
        );
        if (!row) throw new InternalServerErrorException("Failed to create leave request");

        await this.audit.record(tx, {
          action: "LeaveRequested",
          objectType: "leave_request",
          objectId: row.id,
          actorUserId: actor.id,
          after: {
            leaveTypeId: dto.leaveTypeId,
            startDate: dto.startDate,
            endDate: dto.endDate,
            totalDays,
            taskId: task.id,
          },
        });
        await this.outbox.enqueue(tx, {
          eventType: "leave.requested",
          payload: { requestId: row.id, userId: actor.id, totalDays, taskId: task.id },
        });
        return toRequestDto(row);
      })
      .catch((err: unknown) => this.mapError(err, "createRequest", { companyId: actor.companyId }));
  }

  async listRequests(
    actor: Actor,
    query: { status?: string; scope: "me" | "all"; year?: number; limit: number; offset: number },
  ) {
    if (query.scope === "all") {
      await this.assertCan(
        actor,
        "approve",
        "leave",
        "Không có quyền xem đơn nghỉ của nhân sự khác",
      );
      return this.repo.findRequests(actor.companyId, {
        status: query.status,
        year: query.year,
        limit: query.limit,
        offset: query.offset,
      });
    }
    return this.repo.findRequests(actor.companyId, {
      userId: actor.id,
      status: query.status,
      year: query.year,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async approveRequest(actor: Actor, id: string, note?: string) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        // Re-read under FOR UPDATE inside the tx so two concurrent approvals serialize (F1 TOCTOU):
        // chặn double status-write + double trừ phép cho cùng một đơn.
        const [request] = await this.repo.findRequestByIdForUpdateTx(actor.companyId, id, tx);
        if (!request) throw new NotFoundException(`Leave request not found: ${id}`);
        if (request.status !== "pending") {
          throw new ConflictException(
            `Đơn không còn ở trạng thái chờ duyệt (status=${request.status})`,
          );
        }
        const year = yearOf(request.startDate);
        // Trừ phép race-safe: chỉ trừ nếu used + delta ≤ total (chốt trong WHERE).
        const [balance] = await this.repo.incrementUsedIfEnoughTx(
          actor.companyId,
          {
            userId: request.userId,
            leaveTypeId: request.leaveTypeId,
            year,
            delta: request.totalDays,
          },
          tx,
        );
        if (!balance) {
          throw new ConflictException(
            `Không đủ số phép còn lại (hoặc chưa cấp phép năm ${year}) để duyệt đơn ${request.totalDays} ngày`,
          );
        }

        const [updated] = await this.repo.updateRequestTx(
          actor.companyId,
          id,
          {
            status: "approved",
            approvedBy: actor.id,
            approvedAt: new Date(),
            reviewNote: note ?? null,
          },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to close leave request");

        if (request.taskId)
          await this.hrTasks.closeTaskTx(tx, actor.companyId, request.taskId, "approved");

        await this.audit.record(tx, {
          action: "LeaveApproved",
          objectType: "leave_request",
          objectId: id,
          actorUserId: actor.id,
          after: { approvedBy: actor.id, totalDays: request.totalDays },
        });
        await this.audit.record(tx, {
          action: "LeaveBalanceDeducted",
          objectType: "leave_balance",
          objectId: balance.id,
          actorUserId: actor.id,
          after: { fromRequestId: id, usedDays: balance.usedDays, year },
        });
        await this.outbox.enqueue(tx, {
          eventType: "leave.approved",
          payload: {
            requestId: id,
            userId: request.userId,
            approvedBy: actor.id,
            totalDays: request.totalDays,
          },
        });
        return toRequestDto(updated);
      })
      .catch((err: unknown) =>
        this.mapError(err, "approveRequest", { companyId: actor.companyId, id }),
      );
  }

  async rejectRequest(actor: Actor, id: string, note?: string) {
    return this.db
      .withTenant(actor.companyId, async (tx) => {
        // Re-read under FOR UPDATE inside the tx so two concurrent decisions serialize (F1 TOCTOU).
        const [request] = await this.repo.findRequestByIdForUpdateTx(actor.companyId, id, tx);
        if (!request) throw new NotFoundException(`Leave request not found: ${id}`);
        if (request.status !== "pending") {
          throw new ConflictException(
            `Đơn không còn ở trạng thái chờ duyệt (status=${request.status})`,
          );
        }
        const [updated] = await this.repo.updateRequestTx(
          actor.companyId,
          id,
          {
            status: "rejected",
            approvedBy: actor.id,
            approvedAt: new Date(),
            reviewNote: note ?? null,
          },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to reject leave request");
        if (request.taskId)
          await this.hrTasks.closeTaskTx(tx, actor.companyId, request.taskId, "completed");

        await this.audit.record(tx, {
          action: "LeaveRejected",
          objectType: "leave_request",
          objectId: id,
          actorUserId: actor.id,
          after: { reviewNote: note ?? null },
        });
        await this.outbox.enqueue(tx, {
          eventType: "leave.rejected",
          payload: { requestId: id, userId: request.userId, rejectedBy: actor.id },
        });
        return toRequestDto(updated);
      })
      .catch((err: unknown) =>
        this.mapError(err, "rejectRequest", { companyId: actor.companyId, id }),
      );
  }

  async cancelRequest(actor: Actor, id: string) {
    const [request] = await this.loadRequest(actor.companyId, id);
    if (!request) throw new NotFoundException(`Leave request not found: ${id}`);
    if (request.userId !== actor.id) {
      throw new ForbiddenException("Chỉ người gửi đơn mới được huỷ đơn");
    }
    if (request.status !== "pending") {
      throw new ConflictException(`Chỉ huỷ được đơn đang chờ duyệt (status=${request.status})`);
    }

    return this.db
      .withTenant(actor.companyId, async (tx) => {
        const [updated] = await this.repo.updateRequestTx(
          actor.companyId,
          id,
          { status: "cancelled" },
          tx,
        );
        if (!updated) throw new InternalServerErrorException("Failed to cancel leave request");
        if (request.taskId) await this.hrTasks.cancelTaskTx(tx, actor.companyId, request.taskId);

        await this.audit.record(tx, {
          action: "LeaveCancelled",
          objectType: "leave_request",
          objectId: id,
          actorUserId: actor.id,
        });
        return toRequestDto(updated);
      })
      .catch((err: unknown) =>
        this.mapError(err, "cancelRequest", { companyId: actor.companyId, id }),
      );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private loadRequest(companyId: string, id: string) {
    return this.db.withTenant(companyId, (tx) => this.repo.findRequestByIdTx(companyId, id, tx));
  }

  private async assertCan(
    actor: Actor,
    action: string,
    resourceType: string,
    message: string,
  ): Promise<void> {
    const decision = await this.permission.can({
      userId: actor.id,
      companyId: actor.companyId,
      action,
      resourceType,
    });
    if (!decision.allow) throw new ForbiddenException(message);
  }

  private mapError(err: unknown, op: string, ctx: Record<string, unknown>): never {
    // Known HTTP exceptions pass through; unknown infra errors (PG wire, Drizzle) must NOT leak
    // schema/constraint detail to the client — log the original, surface a generic 500.
    if (err instanceof HttpException) throw err;
    this.logger.error(`${op} unexpected error`, { err, ...ctx });
    throw new InternalServerErrorException("Lỗi hệ thống, vui lòng thử lại");
  }
}

// ─── DTO mappers ───────────────────────────────────────────────────────────────

function toTypeDto(row: {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  annualQuota: string | null;
  status: string;
}) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    paid: row.paid,
    annualQuota: row.annualQuota != null ? Number(row.annualQuota) : null,
    status: row.status,
  };
}

function toBalanceDto(row: {
  id: string;
  userId: string;
  leaveTypeId: string;
  year: number;
  totalDays: string;
  usedDays: string;
  remainingDays: string | null;
}) {
  return {
    id: row.id,
    userId: row.userId,
    leaveTypeId: row.leaveTypeId,
    year: row.year,
    totalDays: Number(row.totalDays),
    usedDays: Number(row.usedDays),
    remainingDays:
      row.remainingDays != null
        ? Number(row.remainingDays)
        : Number(row.totalDays) - Number(row.usedDays),
  };
}

function toRequestDto(row: {
  id: string;
  userId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  totalDays: string;
  reason: string | null;
  status: string;
  taskId: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    userId: row.userId,
    leaveTypeId: row.leaveTypeId,
    startDate: row.startDate,
    endDate: row.endDate,
    totalDays: Number(row.totalDays),
    reason: row.reason,
    status: row.status,
    taskId: row.taskId,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    reviewNote: row.reviewNote,
    createdAt: row.createdAt,
  };
}
