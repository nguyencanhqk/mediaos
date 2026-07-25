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
  CreateLeaveTypeRequest,
  UpdateLeaveTypeRequest,
  UpsertLeaveBalanceRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PermissionService } from "../permission/permission.service";
import { LeaveRepository } from "./leave.repository";
import { isUniqueViolation } from "../common/db-error";

interface Actor {
  id: string;
  companyId: string;
}

/**
 * G11-2 — Leave application service (leave_types + leave_balances admin surface).
 *
 * S5-LEAVE-DEADCODE-1: khối đơn-nghỉ (createRequest/approveRequest/rejectRequest/cancelRequest) đã bị XOÁ —
 * di sản G11 KHÔNG route HTTP nào tới (POST /leave/requests đi LeaveRequestService.createDraft; approve/
 * reject/cancel đi LeaveApprovalService/LeaveRevokeService). Service này giờ chỉ còn CRUD leave_types +
 * leave_balances (đường sống qua LeaveController). KHÔNG còn phụ thuộc Task Hub (HrTasksService) hay Outbox.
 */
@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: LeaveRepository,
    private readonly permission: PermissionService,
    private readonly audit: AuditService,
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

  // ─── leave_requests LIST (read own / approve:leave to see all) ───────────────

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

  // ─── Helpers ─────────────────────────────────────────────────────────────────

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
