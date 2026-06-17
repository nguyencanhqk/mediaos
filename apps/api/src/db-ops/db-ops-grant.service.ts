import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  DB_OPS_MAX_TTL_SECONDS,
  DB_OPS_MIN_APPROVALS,
  DB_OPS_MIN_TTL_SECONDS,
  type DbOpsGrantDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import { OperatorActionAuditService } from "../platform/operator-action-audit.service";
import {
  AUDIT_DB_GRANT_ACTIVATED,
  AUDIT_DB_GRANT_APPROVED,
  AUDIT_DB_GRANT_DENIED,
  AUDIT_DB_GRANT_REQUESTED,
  AUDIT_DB_GRANT_REVOKED,
  DB_OPS_ACTION_MANAGE,
  DB_OPS_RESOURCE,
  PG_UNIQUE_VIOLATION,
} from "./db-ops.constants";
import { DbOpsGrantRepository, type DbOpsGrantRow } from "./db-ops-grant.repository";

/** Operator identity (platform-admin). companyId = home tenant (nơi audit all-tenant op ghi). */
export interface OperatorUser {
  id: string;
  companyId: string;
}

export interface RequestGrantInput {
  targetTenantId: string | null;
  reason: string;
  ttlSeconds: number;
}

/**
 * DbOpsGrantService (🔴 AC-9 break-glass SoD, mirror G6-2 break-glass-grant.service) — vòng đời quyền
 * KHẨN CẤP data-ops: request → approve (SoD ≥2 KHÁC NHAU, KHÔNG tự-duyệt) → active → revoke, có TTL.
 *
 * Bảng GLOBAL no-RLS operator-scoped (db_ops_grants/approvals) ⇒ KHÔNG withTenant cho grant FSM (dùng
 * withTransaction). Audit operator-action ghi RIÊNG trong tx withTenant(target tenant hoặc home nếu all)
 * REUSE object_type='company' (KHÔNG đổi audit CHECK). SoD ÉP Ở DB (UNIQUE + CHECK) + service COUNT(DISTINCT).
 *
 * Deny-audit (expired/self-approval) ghi NGOÀI tx sau rollback (KHÔNG nested-tx khi giữ FOR UPDATE) —
 * verbatim approveGrant precedent.
 */
@Injectable()
export class DbOpsGrantService {
  private readonly logger = new Logger(DbOpsGrantService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DbOpsGrantRepository,
    private readonly permissions: PermissionService,
    private readonly operatorAudit: OperatorActionAuditService,
  ) {}

  // ── Request ────────────────────────────────────────────────────────────────────
  async requestGrant(operator: OperatorUser, input: RequestGrantInput): Promise<DbOpsGrantDto> {
    await this.assertCan(operator);

    if (
      !Number.isInteger(input.ttlSeconds) ||
      input.ttlSeconds < DB_OPS_MIN_TTL_SECONDS ||
      input.ttlSeconds > DB_OPS_MAX_TTL_SECONDS
    ) {
      throw new BadRequestException(
        `ttlSeconds phải trong [${DB_OPS_MIN_TTL_SECONDS}..${DB_OPS_MAX_TTL_SECONDS}].`,
      );
    }
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException("reason là bắt buộc cho break-glass db-ops.");

    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    const grant = await this.db.withTransaction((tx) =>
      this.repo.insertGrantTx(tx, {
        requesterUserId: operator.id,
        targetTenantId: input.targetTenantId,
        reason,
        requiredApprovals: DB_OPS_MIN_APPROVALS,
        expiresAt,
      }),
    );

    await this.recordGrantAudit(operator, grant, AUDIT_DB_GRANT_REQUESTED, {
      targetTenantId: grant.targetTenantId,
      expiresAt: grant.expiresAt.toISOString(),
    });
    return this.toDto(grant, 0);
  }

  // ── Approve (SoD 2-người) ────────────────────────────────────────────────────────
  async approveGrant(approver: OperatorUser, grantId: string): Promise<DbOpsGrantDto> {
    await this.assertCan(approver);

    let denyReason: string | null = null;
    let activatedGrant: DbOpsGrantRow | null = null;
    try {
      const out = await this.db.withTransaction(async (tx) => {
        const grant = await this.repo.findGrantByIdForUpdateTx(tx, grantId);
        if (!grant) throw new NotFoundException("Db-ops grant not found.");
        if (grant.status === "revoked") throw new GoneException("Db-ops grant đã bị thu hồi.");
        if (grant.status === "active")
          throw new ConflictException("Db-ops grant đã ở trạng thái active.");
        if (grant.expiresAt.getTime() <= Date.now()) {
          denyReason = "expired";
          throw new GoneException("Db-ops grant đã hết hạn.");
        }
        if (grant.requesterUserId === approver.id) {
          denyReason = "self-approval";
          throw new ForbiddenException("Người yêu cầu không được tự duyệt (SoD).");
        }

        try {
          await this.repo.insertApprovalTx(tx, grantId, approver.id, grant.requesterUserId);
        } catch (err: unknown) {
          if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
            throw new ConflictException("Người duyệt này đã duyệt grant này rồi.");
          }
          throw err;
        }

        const count = await this.repo.countDistinctApproversTx(tx, grantId);
        let activated = false;
        if (count >= grant.requiredApprovals) {
          activated = (await this.repo.activateGrantTx(tx, grantId)) > 0;
        }
        const fresh = await this.repo.findGrantByIdTx(tx, grantId);
        return { grant: fresh ?? grant, count, activated };
      });

      // Audit-after-commit (audit ghi vào tenant tx RIÊNG — KHÔNG nested trong tx grant để né cross-context).
      await this.recordGrantAudit(approver, out.grant, AUDIT_DB_GRANT_APPROVED, {
        approvalCount: out.count,
        requiredApprovals: out.grant.requiredApprovals,
        activated: out.activated,
      });
      if (out.activated) {
        activatedGrant = out.grant;
        await this.recordGrantAudit(approver, out.grant, AUDIT_DB_GRANT_ACTIVATED, {
          approvalCount: out.count,
        });
      }
      void activatedGrant;
      return this.toDto(out.grant, out.count);
    } catch (err) {
      if (denyReason) {
        await this.recordBestEffortDenyAudit(approver, grantId, denyReason);
      }
      throw err;
    }
  }

  // ── Revoke ───────────────────────────────────────────────────────────────────────
  async revokeGrant(operator: OperatorUser, grantId: string): Promise<DbOpsGrantDto> {
    await this.assertCan(operator);

    const out = await this.db.withTransaction(async (tx) => {
      const grant = await this.repo.findGrantByIdForUpdateTx(tx, grantId);
      if (!grant) throw new NotFoundException("Db-ops grant not found.");
      if (grant.status === "revoked")
        throw new ConflictException("Db-ops grant đã bị thu hồi trước đó.");
      const affected = await this.repo.revokeGrantTx(tx, grantId, operator.id);
      if (affected === 0) {
        throw new ConflictException("Thu hồi db-ops grant không có hiệu lực (trạng thái không hợp lệ).");
      }
      const count = await this.repo.countDistinctApproversTx(tx, grantId);
      const fresh = await this.repo.findGrantByIdTx(tx, grantId);
      return { grant: fresh ?? grant, count, prevStatus: grant.status };
    });

    await this.recordGrantAudit(operator, out.grant, AUDIT_DB_GRANT_REVOKED, {
      before: out.prevStatus,
      after: "revoked",
    });
    return this.toDto(out.grant, out.count);
  }

  // ── List (operator's own grants) ─────────────────────────────────────────────────
  async listMyGrants(operator: OperatorUser): Promise<DbOpsGrantDto[]> {
    const rows = await this.db.withTransaction((tx) =>
      this.repo.listGrantsForRequesterTx(tx, operator.id),
    );
    return rows.map((row) => this.toDto(row, row.approvalCount));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────
  /** Sensitive permission gate (operator manage:db-ops, exact non-wildcard ALLOW). Fail-closed. */
  private async assertCan(operator: OperatorUser): Promise<void> {
    const decision = await this.permissions.can({
      userId: operator.id,
      companyId: operator.companyId,
      action: DB_OPS_ACTION_MANAGE,
      resourceType: DB_OPS_RESOURCE,
      isSensitive: true,
    });
    if (!decision.allow) {
      throw new ForbiddenException(`Permission denied: ${decision.reason}`);
    }
  }

  /**
   * Ghi 1 operator-action audit cho 1 sự kiện grant. company_id của audit row = target tenant (nếu có) hoặc
   * home tenant của operator (all-tenant grant). REUSE object_type='company' (KHÔNG đổi audit CHECK). KHÔNG
   * secret vào after (chỉ metadata vòng đời — BẤT BIẾN #3; reason KHÔNG đưa vào after).
   */
  private async recordGrantAudit(
    operator: OperatorUser,
    grant: DbOpsGrantRow,
    action: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    const auditTenant = grant.targetTenantId ?? operator.companyId;
    await this.db.withTenant(auditTenant, async (tx) => {
      await this.operatorAudit.recordOperatorAction(tx, {
        operatorId: operator.id,
        targetTenantId: auditTenant,
        action,
        objectId: grant.id,
        after,
      });
    });
  }

  /** Deny-audit ở tx RIÊNG (best-effort). Ghi vào home tenant (deny không có target chắc chắn). */
  private async recordBestEffortDenyAudit(
    operator: OperatorUser,
    grantId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.db.withTenant(operator.companyId, async (tx) => {
        await this.operatorAudit.recordOperatorAction(tx, {
          operatorId: operator.id,
          targetTenantId: operator.companyId,
          action: AUDIT_DB_GRANT_DENIED,
          objectId: grantId,
          after: { reason },
        });
      });
    } catch (err) {
      this.logger.error("Ghi audit deny db-ops grant thất bại (kết quả deny KHÔNG đổi)", {
        operatorId: operator.id,
        grantId,
        reason,
        error: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
    }
  }

  private toDto(row: DbOpsGrantRow, approvalCount: number): DbOpsGrantDto {
    return {
      id: row.id,
      requesterUserId: row.requesterUserId,
      targetTenantId: row.targetTenantId,
      reason: row.reason,
      requiredApprovals: row.requiredApprovals,
      approvalCount,
      status: row.status as DbOpsGrantDto["status"],
      expiresAt: row.expiresAt.toISOString(),
      activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
