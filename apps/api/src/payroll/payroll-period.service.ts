import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { CreatePayrollPeriodRequest, PayrollPeriodListQuery } from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import type { CanInput, PermissionDecision } from "../permission/permission.types";
import { PayrollPeriodRepository } from "./payroll-period.repository";

const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";

type RequestUser = { id: string; companyId: string };

function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? ((err as Record<string, unknown>)["code"] as string | undefined)
    : undefined;
}

/**
 * PayrollPeriodService — kỳ lương MUTABLE (draft→locked, ADR-0005).
 *  - manage-payroll-period (không nhạy cảm): tạo/khoá/xoá-mềm kỳ.
 *  - Mọi hành động ghi audit_logs (object_type='payroll_period') TRONG cùng tx (atomic).
 *  - mapError: lỗi PG/infra → 500 generic; check_violation (trigger lock-guard) → 409; KHÔNG leak schema.
 * Mirror salary-profile.service (audit-in-tx, permission gate, mapError no-leak).
 */
@Injectable()
export class PayrollPeriodService {
  private readonly logger = new Logger(PayrollPeriodService.name);

  constructor(
    private readonly repo: PayrollPeriodRepository,
    private readonly db: DatabaseService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  private decision(
    user: RequestUser,
    action: "manage-payroll-period",
    targetId: string | null,
  ): Promise<PermissionDecision> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action,
      resourceType: "payroll_period",
      resourceId: targetId,
      isSensitive: false,
    };
    return this.permissionService.can(input);
  }

  async list(user: RequestUser, filters: PayrollPeriodListQuery) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "manage-payroll-period", null);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to manage payroll period");
        }
        return await this.repo.listTx(tx, user.companyId, { status: filters.status });
      });
    } catch (err) {
      throw this.mapError(err, "Failed to list payroll periods");
    }
  }

  async create(user: RequestUser, dto: CreatePayrollPeriodRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "manage-payroll-period", null);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to manage payroll period");
        }
        const rows = await this.repo.createTx(tx, user.companyId, {
          periodMonth: dto.periodMonth,
          attendancePeriodId: dto.attendancePeriodId ?? null,
        });
        const period = rows[0];
        if (!period) throw new Error("Failed to create payroll period");
        await this.auditService.record(tx, {
          action: "payroll_period_created",
          objectType: "payroll_period",
          objectId: period.id,
          actorUserId: user.id,
          after: { period_month: period.periodMonth, status: period.status },
        });
        return period;
      });
    } catch (err) {
      throw this.mapError(err, "Failed to create payroll period");
    }
  }

  async lock(user: RequestUser, id: string) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "manage-payroll-period", id);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to manage payroll period");
        }
        const before = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!before) throw new NotFoundException("Payroll period not found");

        const rows = await this.repo.lockTx(tx, user.companyId, id, user.id);
        const row = rows[0];
        if (!row) throw new NotFoundException("Payroll period not found");

        await this.auditService.record(tx, {
          action: "payroll_period_locked",
          objectType: "payroll_period",
          objectId: id,
          actorUserId: user.id,
          before: { status: before.status },
          after: { status: row.status },
        });
        return row;
      });
    } catch (err) {
      throw this.mapError(err, "Failed to lock payroll period");
    }
  }

  async remove(user: RequestUser, id: string) {
    try {
      await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "manage-payroll-period", id);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to manage payroll period");
        }
        const before = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!before) throw new NotFoundException("Payroll period not found");
        if (before.status === "locked") {
          throw new ConflictException("Cannot delete a locked payroll period");
        }
        const rows = await this.repo.softDeleteTx(tx, user.companyId, id);
        if (rows.length === 0) throw new NotFoundException("Payroll period not found");
        await this.auditService.record(tx, {
          action: "payroll_period_deleted",
          objectType: "payroll_period",
          objectId: id,
          actorUserId: user.id,
          before: { period_month: before.periodMonth, status: before.status },
        });
      });
    } catch (err) {
      throw this.mapError(err, "Failed to delete payroll period");
    }
  }

  /**
   * Domain HttpExceptions pass through. unique-violation (1 kỳ/(company,month)) → 409.
   * check-violation (trigger lock-guard locked→draft) → 409 với message an toàn. Khác → 500 generic
   * (log PG detail server-side ONLY — không leak schema/constraint/code).
   */
  private mapError(err: unknown, context: string): Error {
    if (err instanceof HttpException) return err;
    const code = pgCode(err);
    if (code === PG_UNIQUE_VIOLATION) {
      return new ConflictException("A payroll period already exists for this month");
    }
    if (code === PG_CHECK_VIOLATION) {
      return new ConflictException("Invalid payroll period state transition");
    }
    this.logger.error(context, {
      error: err instanceof Error ? err.message : String(err),
      code,
    });
    return new InternalServerErrorException("Internal server error");
  }
}
