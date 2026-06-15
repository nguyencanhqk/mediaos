import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  BonusReferenceType,
  CreateBonusPenaltyRequest,
  DecideBonusPenaltyRequest,
  BonusPenaltyListQuery,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import type { CanInput, PermissionDecision } from "../permission/permission.types";
import { BonusPenaltyRepository } from "./bonus-penalty.repository";

const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";

type RequestUser = { id: string; companyId: string };
type BonusAction = "view-bonus-penalty" | "manage-bonus-penalty" | "approve-bonus-penalty";

function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? ((err as Record<string, unknown>)["code"] as string | undefined)
    : undefined;
}

type AmountRow = { amount: unknown };
function toDto<T extends AmountRow>(row: T): Omit<T, "amount"> & { amount: number } {
  return { ...row, amount: Number(row.amount) };
}

/**
 * BonusPenaltyService — CROWN JEWEL (G12-3). Thưởng/phạt = SỐ TIỀN per-person (nhạy cảm, ADR-0010):
 *  - permission.can isSensitive=TRUE (wildcard *:* KHÔNG kế thừa). view/manage/approve tách quyền.
 *  - FSM draft→approved/rejected; self-approve BỊ CHẶN (segregation of duties). Trigger DB (0098) là lớp 2.
 *  - reference (task/defect/kpi_result) validate CÙNG tenant TRƯỚC khi insert (FK không ép tenant).
 *  - audit-in-tx (create/approve/reject/delete ghi 'bonus_penalty' cùng tx — fail ⇒ rollback).
 *  - mapError: PG/infra → 500 generic; check_violation (trigger FSM/freeze) → 409; KHÔNG leak schema/amount.
 */
@Injectable()
export class BonusPenaltyService {
  private readonly logger = new Logger(BonusPenaltyService.name);

  constructor(
    private readonly repo: BonusPenaltyRepository,
    private readonly db: DatabaseService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  private decision(
    user: RequestUser,
    action: BonusAction,
    targetId: string | null,
  ): Promise<PermissionDecision> {
    const input: CanInput = {
      userId: user.id,
      companyId: user.companyId,
      action,
      resourceType: "bonus_penalty",
      resourceId: targetId,
      isSensitive: true,
    };
    return this.permissionService.can(input);
  }

  async list(user: RequestUser, filters: BonusPenaltyListQuery) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "view-bonus-penalty", null);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to view bonus/penalty");
        }
        const rows = await this.repo.listTx(tx, user.companyId, filters);
        return rows.map(toDto);
      });
    } catch (err) {
      throw this.mapError(err, "Failed to list bonus/penalty");
    }
  }

  async getOne(user: RequestUser, id: string) {
    try {
      return await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "view-bonus-penalty", id);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to view bonus/penalty");
        }
        const row = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!row) throw new NotFoundException("Bonus/penalty not found");
        return toDto(row);
      });
    } catch (err) {
      throw this.mapError(err, "Failed to read bonus/penalty");
    }
  }

  async create(user: RequestUser, dto: CreateBonusPenaltyRequest) {
    try {
      const created = await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "manage-bonus-penalty", null);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to manage bonus/penalty");
        }

        // Payee user_id PHẢI thuộc CÙNG tenant — FK users(id) không ép tenant (chống gán payee tenant khác).
        const payeeOk = await this.repo.userBelongsToCompanyTx(tx, user.companyId, dto.userId);
        if (!payeeOk) throw new BadRequestException("User not found in this company");

        // Reference (nếu có) PHẢI thuộc cùng tenant — FK không ép tenant, check tay TRƯỚC khi ghi.
        // referenceType set nhưng thiếu id → báo rõ (thay vì để CHECK DB ném 409 mơ hồ).
        const refId = this.referenceId(dto);
        if (dto.referenceType) {
          if (!refId) {
            throw new BadRequestException(
              `referenceType '${dto.referenceType}' requires a matching reference id`,
            );
          }
          const ok = await this.repo.referenceExistsTx(
            tx,
            user.companyId,
            dto.referenceType,
            refId,
          );
          if (!ok) throw new BadRequestException("Referenced object not found in this company");
        }

        const rows = await this.repo.createTx(tx, user.companyId, {
          userId: dto.userId,
          kind: dto.kind,
          amount: String(dto.amount),
          currency: dto.currency ?? "VND",
          periodMonth: dto.periodMonth,
          reason: dto.reason ?? null,
          source: dto.source,
          referenceType: dto.referenceType ?? null,
          taskId: dto.referenceType === "task" ? (dto.taskId ?? null) : null,
          defectId: dto.referenceType === "defect" ? (dto.defectId ?? null) : null,
          kpiResultId: dto.referenceType === "kpi_result" ? (dto.kpiResultId ?? null) : null,
          createdBy: user.id,
        });
        const row = rows[0];
        if (!row) throw new Error("Failed to create bonus/penalty");

        await this.auditService.record(tx, {
          action: "bonus_penalty_created",
          objectType: "bonus_penalty",
          objectId: row.id,
          actorUserId: user.id,
          after: this.auditPayload(row),
        });
        return row;
      });
      return toDto(created);
    } catch (err) {
      throw this.mapError(err, "Failed to create bonus/penalty");
    }
  }

  async approve(user: RequestUser, id: string) {
    return this.decide(user, id, "approve");
  }

  async reject(user: RequestUser, id: string, dto: DecideBonusPenaltyRequest) {
    return this.decide(user, id, "reject", dto.reason);
  }

  /** Duyệt/từ chối — quyền approve-bonus-penalty + CHẶN self-approve + FSM (chỉ draft). */
  private async decide(user: RequestUser, id: string, mode: "approve" | "reject", reason?: string) {
    try {
      const updated = await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "approve-bonus-penalty", id);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to approve bonus/penalty");
        }

        const before = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!before) throw new NotFoundException("Bonus/penalty not found");
        // Segregation of duties: người tạo KHÔNG được tự duyệt/từ chối khoản của chính mình.
        if (before.createdBy === user.id) {
          throw new ForbiddenException("You cannot decide on a bonus/penalty you created");
        }
        if (before.status !== "draft") {
          throw new ConflictException("Only a draft bonus/penalty can be approved or rejected");
        }

        const rows =
          mode === "approve"
            ? await this.repo.approveTx(tx, user.companyId, id, user.id)
            : await this.repo.rejectTx(tx, user.companyId, id, user.id, reason);
        const row = rows[0];
        // Mất draft giữa lúc đọc và ghi (đua) → 409 (đã được người khác xử lý).
        if (!row) throw new ConflictException("Bonus/penalty is no longer a draft");

        await this.auditService.record(tx, {
          action: mode === "approve" ? "bonus_penalty_approved" : "bonus_penalty_rejected",
          objectType: "bonus_penalty",
          objectId: id,
          actorUserId: user.id,
          before: this.auditPayload(before),
          after: this.auditPayload(row),
        });
        return row;
      });
      return toDto(updated);
    } catch (err) {
      throw this.mapError(err, `Failed to ${mode} bonus/penalty`);
    }
  }

  async remove(user: RequestUser, id: string) {
    try {
      await this.db.withTenant(user.companyId, async (tx) => {
        const decision = await this.decision(user, "manage-bonus-penalty", id);
        if (!decision.allow) {
          throw new ForbiddenException("Insufficient permission to manage bonus/penalty");
        }
        const before = await this.repo.findByIdTx(tx, user.companyId, id);
        if (!before) throw new NotFoundException("Bonus/penalty not found");
        if (before.status !== "draft") {
          throw new ConflictException("Only a draft bonus/penalty can be deleted");
        }
        const rows = await this.repo.softDeleteTx(tx, user.companyId, id);
        if (rows.length === 0) throw new ConflictException("Bonus/penalty is no longer a draft");

        await this.auditService.record(tx, {
          action: "bonus_penalty_deleted",
          objectType: "bonus_penalty",
          objectId: id,
          actorUserId: user.id,
          before: this.auditPayload(before),
        });
      });
    } catch (err) {
      throw this.mapError(err, "Failed to delete bonus/penalty");
    }
  }

  private referenceId(dto: CreateBonusPenaltyRequest): string | null {
    switch (dto.referenceType as BonusReferenceType | undefined) {
      case "task":
        return dto.taskId ?? null;
      case "defect":
        return dto.defectId ?? null;
      case "kpi_result":
        return dto.kpiResultId ?? null;
      default:
        return null;
    }
  }

  /** Snapshot cho audit trail (append-only, RLS) — số tiền chỉ vào audit có kiểm soát, không log nơi khác. */
  private auditPayload(row: {
    kind: unknown;
    amount: unknown;
    userId?: unknown;
    periodMonth?: unknown;
    status?: unknown;
    referenceType?: unknown;
  }) {
    return {
      kind: row.kind,
      amount: row.amount != null ? Number(row.amount) : null,
      ...(row.userId !== undefined ? { user_id: row.userId } : {}),
      ...(row.periodMonth !== undefined ? { period_month: row.periodMonth } : {}),
      ...(row.status !== undefined ? { status: row.status } : {}),
      ...(row.referenceType !== undefined ? { reference_type: row.referenceType } : {}),
    };
  }

  /**
   * Domain HttpExceptions pass through. unique-violation → 409. check_violation (trigger FSM/freeze
   * hoặc CHECK constraint) → 409 (trạng thái không hợp lệ). Khác → 500 generic (log PG detail
   * server-side ONLY — KHÔNG leak schema/constraint/amount).
   */
  private mapError(err: unknown, context: string): Error {
    if (err instanceof HttpException) return err;
    const code = pgCode(err);
    if (code === PG_UNIQUE_VIOLATION) {
      return new ConflictException("Bonus/penalty conflict");
    }
    if (code === PG_CHECK_VIOLATION) {
      return new ConflictException("Invalid bonus/penalty state or value");
    }
    this.logger.error(context, {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined, // server-side ONLY (MTTR) — không gửi client
      code,
    });
    return new InternalServerErrorException("Internal server error");
  }
}
