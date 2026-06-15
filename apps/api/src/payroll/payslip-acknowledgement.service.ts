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
  DisputePayslipRequest,
  PayslipAckListQuery,
  ResolvePayslipDisputeRequest,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import type { CanInput, PermissionDecision } from "../permission/permission.types";
import { PayslipAcknowledgementRepository } from "./payslip-acknowledgement.repository";

const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";

type RequestUser = { id: string; companyId: string };
type AckAction = "acknowledge-own-payslip" | "resolve-payslip-dispute";

function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? ((err as Record<string, unknown>)["code"] as string | undefined)
    : undefined;
}

/**
 * PayslipAcknowledgementService (G12-4) — nhân viên XÁC NHẬN / KHIẾU NẠI bảng lương ĐÃ PHÁT HÀNH.
 *  - acknowledge/dispute: quyền 'acknowledge-own-payslip' (không nhạy cảm) + OWNERSHIP (payslip của CHÍNH MÌNH)
 *    + kỳ phải 'published'. 1 ack/phiếu/người (unique → 23505 → 409).
 *  - resolve: quyền 'resolve-payslip-dispute' (NHẠY CẢM — chạm dữ liệu lương) → HR/admin; chỉ disputed→resolved.
 *  - Mọi hành động ghi audit_logs (object_type='payslip_acknowledgement') TRONG cùng tx (atomic).
 *  - mapError: PG/infra → 500 generic; check_violation (trigger FSM) → 409; KHÔNG leak schema.
 */
@Injectable()
export class PayslipAcknowledgementService {
  private readonly logger = new Logger(PayslipAcknowledgementService.name);

  constructor(
    private readonly repo: PayslipAcknowledgementRepository,
    private readonly db: DatabaseService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  private decision(
    user: RequestUser,
    action: AckAction,
    targetId: string | null,
    isSensitive: boolean,
  ): Promise<PermissionDecision> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action,
      resourceType: "payslip",
      resourceId: targetId,
      isSensitive,
    };
    return this.permissionService.can(input);
  }

  acknowledge(user: RequestUser, payslipId: string) {
    return this.submit(user, payslipId, "acknowledged");
  }

  dispute(user: RequestUser, payslipId: string, dto: DisputePayslipRequest) {
    return this.submit(user, payslipId, "disputed", dto.reason);
  }

  /** Nhân viên xác nhận/khiếu nại phiếu CỦA MÌNH, kỳ đã 'published'. */
  private async submit(
    user: RequestUser,
    payslipId: string,
    status: "acknowledged" | "disputed",
    reason?: string,
  ) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "acknowledge-own-payslip", payslipId, false);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to acknowledge payslip");
        }

        const ownership = await this.repo.findPayslipOwnershipTx(tx, user.companyId, payslipId);
        if (!ownership) throw new NotFoundException("Payslip not found");
        // OWNERSHIP: chỉ thao tác trên phiếu CỦA MÌNH (FK không ép — kiểm tay).
        if (ownership.payslipUserId !== user.id) {
          throw new ForbiddenException("You can only acknowledge your own payslip");
        }
        // Chỉ sau khi PHÁT HÀNH nhân viên mới xác nhận/khiếu nại được.
        if (ownership.periodStatus !== "published") {
          throw new ConflictException("Payslip is not published yet");
        }

        const rows = await this.repo.insertTx(tx, user.companyId, {
          payslipId,
          userId: user.id,
          status,
          reason: reason ?? null,
        });
        const row = rows[0];
        if (!row) throw new Error("Failed to record payslip acknowledgement");

        await this.auditService.record(tx, {
          action: status === "acknowledged" ? "payslip_acknowledged" : "payslip_disputed",
          objectType: "payslip_acknowledgement",
          objectId: row.id,
          actorUserId: user.id,
          after: { payslip_id: payslipId, status: row.status },
        });
        return row;
      });
    } catch (err) {
      throw this.mapError(err, "Failed to record payslip acknowledgement");
    }
  }

  /** HR xử lý khiếu nại (disputed→resolved). Quyền nhạy cảm resolve-payslip-dispute. */
  async resolve(user: RequestUser, ackId: string, dto: ResolvePayslipDisputeRequest) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "resolve-payslip-dispute", ackId, true);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to resolve payslip dispute");
        }
        const before = await this.repo.findByIdTx(tx, user.companyId, ackId);
        if (!before) throw new NotFoundException("Payslip acknowledgement not found");
        if (before.status !== "disputed") {
          throw new ConflictException("Only a disputed acknowledgement can be resolved");
        }

        const rows = await this.repo.resolveTx(
          tx,
          user.companyId,
          ackId,
          user.id,
          dto.resolutionNote ?? null,
        );
        const row = rows[0];
        if (!row) throw new ConflictException("Acknowledgement is no longer disputed");

        await this.auditService.record(tx, {
          action: "payslip_dispute_resolved",
          objectType: "payslip_acknowledgement",
          objectId: ackId,
          actorUserId: user.id,
          before: { status: before.status },
          after: { status: row.status, resolved_by: row.resolvedBy },
        });
        return row;
      });
    } catch (err) {
      throw this.mapError(err, "Failed to resolve payslip dispute");
    }
  }

  /** Danh sách ack của 1 payslip — chủ phiếu xem của mình HOẶC HR (resolve-payslip-dispute) xem tất cả. */
  async listForPayslip(user: RequestUser, payslipId: string, filters: PayslipAckListQuery) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const base = await this.decision(user, "acknowledge-own-payslip", payslipId, false);
        if (!base.allow) {
          throw new ForbiddenException("Insufficient permission to view payslip acknowledgements");
        }
        const ownership = await this.repo.findPayslipOwnershipTx(tx, user.companyId, payslipId);
        if (!ownership) throw new NotFoundException("Payslip not found");
        // Không phải chủ phiếu → cần quyền HR (resolve) mới xem ack người khác.
        if (ownership.payslipUserId !== user.id) {
          const hr = await this.decision(user, "resolve-payslip-dispute", payslipId, true);
          if (!hr.allow) {
            throw new ForbiddenException("You can only view your own payslip acknowledgements");
          }
        }
        return await this.repo.listByPayslipTx(tx, user.companyId, payslipId, {
          status: filters.status,
        });
      });
    } catch (err) {
      throw this.mapError(err, "Failed to list payslip acknowledgements");
    }
  }

  /**
   * Domain HttpExceptions pass through. unique-violation (1 ack/phiếu/người) → 409.
   * check-violation (trigger FSM) → 409. Khác → 500 generic (log PG detail server-side ONLY — không leak).
   */
  private mapError(err: unknown, context: string): Error {
    if (err instanceof HttpException) return err;
    const code = pgCode(err);
    if (code === PG_UNIQUE_VIOLATION) {
      return new ConflictException("You have already responded to this payslip");
    }
    if (code === PG_CHECK_VIOLATION) {
      return new ConflictException("Invalid payslip acknowledgement state");
    }
    this.logger.error(context, {
      error: err instanceof Error ? err.message : String(err),
      code,
    });
    return new InternalServerErrorException("Internal server error");
  }
}
