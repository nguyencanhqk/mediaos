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
type PeriodAction = "manage-payroll-period" | "approve-payroll-period" | "publish-payroll-period";

function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? ((err as Record<string, unknown>)["code"] as string | undefined)
    : undefined;
}

/**
 * PayrollPeriodService — kỳ lương MUTABLE vòng duyệt (draft→approved→published, ADR-0005, G12-4).
 *  - manage-payroll-period (không nhạy cảm): tạo/xoá-mềm kỳ.
 *  - approve-payroll-period / publish-payroll-period (không nhạy cảm): vòng duyệt.
 *    · approve: SoD — người duyệt ≠ người chạy lương kỳ này (đọc payslips.created_by); kỳ phải có ≥1 payslip.
 *    · publish: kỳ phải đã approved.
 *  - Mọi hành động ghi audit_logs (object_type='payroll_period') TRONG cùng tx (atomic).
 *  - mapError: lỗi PG/infra → 500 generic; check_violation (trigger FSM) → 409; KHÔNG leak schema.
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
    action: PeriodAction,
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
          createdBy: user.id,
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

  /** Duyệt bảng lương (draft→approved). SoD: người duyệt ≠ người chạy lương; kỳ phải có ≥1 payslip. */
  async approve(user: RequestUser, id: string) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "approve-payroll-period", id);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to approve payroll period");
        }
        const before = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!before) throw new NotFoundException("Payroll period not found");
        if (before.status !== "draft") {
          throw new ConflictException("Only a draft payroll period can be approved");
        }

        // SoD (segregation of duties): không duyệt bảng lương mình tự chạy. Kỳ rỗng (chưa chạy lương)
        // KHÔNG được duyệt (vô nghĩa + lỗ hổng SoD: tập người chạy rỗng ⇒ ai cũng qua).
        const creators = await this.repo.listPayslipCreatorsTx(tx, user.companyId, id);
        if (creators.length === 0) {
          throw new ConflictException("Cannot approve a payroll period that has no payslips");
        }
        if (creators.includes(user.id)) {
          throw new ForbiddenException("You cannot approve a payroll period you ran");
        }

        const rows = await this.repo.approveTx(tx, user.companyId, id, user.id);
        const row = rows[0];
        // Mất draft giữa đọc & ghi (đua) → 409.
        if (!row) throw new ConflictException("Payroll period is no longer a draft");

        await this.auditService.record(tx, {
          action: "payroll_period_approved",
          objectType: "payroll_period",
          objectId: id,
          actorUserId: user.id,
          before: { status: before.status },
          after: { status: row.status, approved_by: row.approvedBy },
        });
        return row;
      });
    } catch (err) {
      throw this.mapError(err, "Failed to approve payroll period");
    }
  }

  /** Phát hành bảng lương (approved→published). Sau đó nhân viên xem/xác nhận/khiếu nại payslip của mình. */
  async publish(user: RequestUser, id: string) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "publish-payroll-period", id);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to publish payroll period");
        }
        const before = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!before) throw new NotFoundException("Payroll period not found");
        if (before.status !== "approved") {
          throw new ConflictException("Only an approved payroll period can be published");
        }

        const rows = await this.repo.publishTx(tx, user.companyId, id, user.id);
        const row = rows[0];
        if (!row) throw new ConflictException("Payroll period is no longer approved");

        await this.auditService.record(tx, {
          action: "payroll_period_published",
          objectType: "payroll_period",
          objectId: id,
          actorUserId: user.id,
          before: { status: before.status },
          after: { status: row.status, published_by: row.publishedBy },
        });
        return row;
      });
    } catch (err) {
      throw this.mapError(err, "Failed to publish payroll period");
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
        // Chỉ kỳ draft mới được xoá mềm (approved/published = sổ duyệt, không biến mất). Trigger 0130 là lớp 2.
        if (before.status !== "draft") {
          throw new ConflictException("Only a draft payroll period can be deleted");
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
   * check-violation (trigger FSM transition sai) → 409 với message an toàn. Khác → 500 generic
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
