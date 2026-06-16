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
  BREAK_GLASS_MAX_TTL_SECONDS,
  BREAK_GLASS_MIN_APPROVALS,
  BREAK_GLASS_MIN_TTL_SECONDS,
  type BreakGlassGrantDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { PermissionService } from "../permission/permission.service";
import { BreakGlassRepository, type BreakGlassGrantRow } from "./break-glass.repository";

/** Caller identity (mirror PlatformAccountsService.RequestUser). */
export interface RequestUser {
  id: string;
  companyId: string;
}

export interface RequestGrantInput {
  platformAccountId: string;
  reason: string;
  ttlSeconds: number;
}

// ── Permission constants ───────────────────────────────────────────────────────
const RESOURCE_TYPE = "break-glass";
const ACTION_REQUEST = "request-break-glass";
const ACTION_APPROVE = "approve-break-glass";
const ACTION_REVOKE = "revoke-break-glass";

// ── Audit actions (object_type = 'break_glass_access', mig 0200) ─────────────────
const AUDIT_REQUESTED = "break_glass_access.requested";
const AUDIT_APPROVED = "break_glass_access.approved";
const AUDIT_ACTIVATED = "break_glass_access.activated";
const AUDIT_REVOKED = "break_glass_access.revoked";
const AUDIT_DENIED = "break_glass_access.denied";

const PG_UNIQUE_VIOLATION = "23505";

/**
 * BreakGlassGrantService — 🔒 G6-2 PR-B ROUND 1: vòng đời quyền truy cập KHẨN CẤP 1 platform_account secret.
 *
 * request → approve (SoD: ≥2 người duyệt KHÁC NHAU, KHÔNG tự-duyệt) → active → revoke, có TTL.
 * KHÔNG reveal secret ở đây (ROUND 2 tái dùng PlatformAccountsService.revealSecret + break-glass gate).
 *
 * Bất biến (pin bởi RED b5r1 — KHÔNG nới):
 *   request/approve/revoke — sensitive permission gate (exact non-wildcard ALLOW; wildcard *:* KHÔNG thoả).
 *   approve — SoD ÉP Ở DB (UNIQUE chống duyệt-trùng + CHECK chống tự-duyệt) + service COUNT(DISTINCT) ≥
 *             required_approvals mới flip 'active'; grant hết hạn → 410; đã thu hồi → 410; chéo tenant → 404 (RLS).
 *   audit — request/approve/activate/revoke ghi 'break_glass_access' audit-in-tx; deny ghi best-effort
 *           (KHÔNG secret/key material vào before/after — BẤT BIẾN #3; chỉ id/reason nghiệp vụ/status).
 */
@Injectable()
export class BreakGlassGrantService {
  private readonly logger = new Logger(BreakGlassGrantService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BreakGlassRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
  ) {}

  // ── Request ────────────────────────────────────────────────────────────────────

  async requestGrant(user: RequestUser, input: RequestGrantInput): Promise<BreakGlassGrantDto> {
    await this.assertCan(user, ACTION_REQUEST, "request-break-glass");

    // Defense-in-depth (controller validates via Zod too): TTL trong biên [5 phút .. 24 giờ].
    if (
      !Number.isInteger(input.ttlSeconds) ||
      input.ttlSeconds < BREAK_GLASS_MIN_TTL_SECONDS ||
      input.ttlSeconds > BREAK_GLASS_MAX_TTL_SECONDS
    ) {
      throw new BadRequestException(
        `ttlSeconds phải trong [${BREAK_GLASS_MIN_TTL_SECONDS}..${BREAK_GLASS_MAX_TTL_SECONDS}].`,
      );
    }
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException("reason là bắt buộc cho break-glass.");
    }

    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);

    const grant = await this.db.withTenant(user.companyId, async (tx) => {
      // Account PHẢI thuộc tenant (RLS-filtered) — chống mở break-glass trỏ account chéo tenant qua FK.
      const exists = await this.repo.platformAccountExistsTx(
        tx,
        user.companyId,
        input.platformAccountId,
      );
      if (!exists) {
        throw new NotFoundException("Platform account not found.");
      }
      const row = await this.repo.insertGrantTx(tx, user.companyId, {
        platformAccountId: input.platformAccountId,
        requesterUserId: user.id,
        reason,
        requiredApprovals: BREAK_GLASS_MIN_APPROVALS,
        expiresAt,
      });
      await this.audit.record(tx, {
        action: AUDIT_REQUESTED,
        objectType: "break_glass_access",
        objectId: row.id,
        actorUserId: user.id,
        after: {
          platformAccountId: row.platformAccountId,
          reason: row.reason,
          expiresAt: row.expiresAt,
        },
      });
      return row;
    });

    return this.toDto(grant, 0);
  }

  // ── Approve (SoD 2-người) ────────────────────────────────────────────────────────

  async approveGrant(approver: RequestUser, grantId: string): Promise<BreakGlassGrantDto> {
    await this.assertCan(approver, ACTION_APPROVE, "approve-break-glass", grantId);

    // Deny-audit cho expired/self-approval PHẢI sống sót qua rollback của tx duyệt → ghi Ở NGOÀI tx (sau khi
    // withTenant đã rollback + nhả connection). KHÔNG ghi qua `tx` (sẽ rollback CÙNG throw, mất vết) cũng KHÔNG
    // mở tx LỒNG khi đang giữ FOR UPDATE (tránh nested-connection cạn pool). Lý do deny gắn vào biến closure.
    let denyReason: string | null = null;
    try {
      return await this.db.withTenant(approver.companyId, async (tx) => {
        // FOR UPDATE: serialize approve/revoke đồng thời trên cùng grant (count→activate atomic per grant).
        const grant = await this.repo.findGrantByIdForUpdateTx(tx, approver.companyId, grantId);
        if (!grant) {
          // null = vắng HOẶC chéo tenant (RLS) → 404 (không lộ tồn tại chéo tenant).
          throw new NotFoundException("Break-glass grant not found.");
        }
        if (grant.status === "revoked") {
          throw new GoneException("Break-glass grant đã bị thu hồi.");
        }
        if (grant.status === "active") {
          throw new ConflictException("Break-glass grant đã ở trạng thái active.");
        }
        if (grant.expiresAt.getTime() <= Date.now()) {
          denyReason = "expired";
          throw new GoneException("Break-glass grant đã hết hạn.");
        }
        // SoD ở SERVICE (DB CHECK approver<>requester là defense-in-depth): tự-duyệt → 403.
        if (grant.requesterUserId === approver.id) {
          denyReason = "self-approval";
          throw new ForbiddenException("Người yêu cầu không được tự duyệt break-glass (SoD).");
        }

        // Phiếu duyệt APPEND-ONLY. UNIQUE(company,grant,approver) → duyệt-trùng ném 23505 → 409 (KHÔNG nuốt).
        try {
          await this.repo.insertApprovalTx(
            tx,
            approver.companyId,
            grantId,
            approver.id,
            grant.requesterUserId,
          );
        } catch (err: unknown) {
          if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
            throw new ConflictException("Người duyệt này đã duyệt grant này rồi.");
          }
          throw err;
        }

        const count = await this.repo.countDistinctApproversTx(tx, approver.companyId, grantId);
        let activated = false;
        if (count >= grant.requiredApprovals) {
          // WHERE status='pending' → idempotent dưới đua (approver thứ 2 thấy đã active = no-op).
          const flipped = await this.repo.activateGrantTx(tx, approver.companyId, grantId);
          activated = flipped > 0;
        }

        await this.audit.record(tx, {
          action: AUDIT_APPROVED,
          objectType: "break_glass_access",
          objectId: grantId,
          actorUserId: approver.id,
          after: { approvalCount: count, requiredApprovals: grant.requiredApprovals, activated },
        });
        if (activated) {
          await this.audit.record(tx, {
            action: AUDIT_ACTIVATED,
            objectType: "break_glass_access",
            objectId: grantId,
            actorUserId: approver.id,
            after: { approvalCount: count },
          });
        }

        const fresh = await this.repo.findGrantByIdTx(tx, approver.companyId, grantId);
        return this.toDto(fresh ?? grant, count);
      });
    } catch (err) {
      // Deny path (expired/self-approval): tx đã rollback → ghi audit best-effort Ở NGOÀI, rồi ném lại lỗi gốc.
      // Các throw khác (404/409/410-revoked/duyệt-trùng) có denyReason=null → bỏ qua, chỉ re-throw.
      if (denyReason) {
        await this.recordBestEffortDenyAudit(approver, grantId, denyReason);
      }
      throw err;
    }
  }

  // ── Revoke ───────────────────────────────────────────────────────────────────────

  async revokeGrant(actor: RequestUser, grantId: string): Promise<BreakGlassGrantDto> {
    await this.assertCan(actor, ACTION_REVOKE, "revoke-break-glass", grantId);

    return this.db.withTenant(actor.companyId, async (tx) => {
      const grant = await this.repo.findGrantByIdForUpdateTx(tx, actor.companyId, grantId);
      if (!grant) {
        throw new NotFoundException("Break-glass grant not found.");
      }
      if (grant.status === "revoked") {
        throw new ConflictException("Break-glass grant đã bị thu hồi trước đó.");
      }
      const affected = await this.repo.revokeGrantTx(tx, actor.companyId, grantId, actor.id);
      if (affected === 0) {
        // Pre-check dưới FOR UPDATE đã loại 'revoked' → 0 hàng = trạng thái bất thường. KHÔNG ghi audit
        // "đã revoke" (sẽ sai sự thật) — ném 409 để rollback toàn bộ tx.
        throw new ConflictException("Thu hồi break-glass không có hiệu lực (trạng thái không hợp lệ).");
      }
      await this.audit.record(tx, {
        action: AUDIT_REVOKED,
        objectType: "break_glass_access",
        objectId: grantId,
        actorUserId: actor.id,
        before: { status: grant.status },
        after: { status: "revoked" },
      });
      const count = await this.repo.countDistinctApproversTx(tx, actor.companyId, grantId);
      const fresh = await this.repo.findGrantByIdTx(tx, actor.companyId, grantId);
      return this.toDto(fresh ?? grant, count);
    });
  }

  // ── List (caller's own grants — for the break-glass screen / reveal button) ──────

  /**
   * Liệt kê grant break-glass của CHÍNH caller (requester = caller), kèm approvalCount (tiến độ SoD). Chỉ
   * metadata vòng đời (KHÔNG secret — BẤT BIẾN #3). RLS lọc tenant. Không cần permission gate: đây là "yêu cầu
   * của tôi" (đọc hàng của chính mình, không lộ gì nhạy cảm); nút Reveal trên từng grant mới gated thật ở
   * reveal-path. FE bật Reveal CHỈ khi status='active' (server vẫn ép cổng (a)+(b) khi reveal — phòng thủ sâu).
   */
  async listMyGrants(user: RequestUser): Promise<BreakGlassGrantDto[]> {
    const rows = await this.db.withTenant(user.companyId, (tx) =>
      this.repo.listGrantsForRequesterTx(tx, user.companyId, user.id),
    );
    return rows.map((row) => this.toDto(row, row.approvalCount));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────

  /**
   * Sensitive permission gate (company-tier, exact non-wildcard ALLOW). resourceId=null → object-tier skip
   * + needsObjectGrant=false (objectGrantRequired ?? (isSensitive && requiresReauth=false) = false) ⇒ chỉ
   * cần company exact ALLOW. Deny → best-effort audit (nếu có grantId) + ForbiddenException. Fail-closed.
   */
  private async assertCan(
    user: RequestUser,
    action: string,
    label: string,
    grantId?: string,
  ): Promise<void> {
    const decision = await this.permissions.can({
      userId: user.id,
      companyId: user.companyId,
      action,
      resourceType: RESOURCE_TYPE,
      isSensitive: true,
    });
    if (!decision.allow) {
      if (decision.auditRequired) {
        await this.recordBestEffortDenyAudit(user, grantId ?? null, `${label}:${decision.reason}`);
      }
      throw new ForbiddenException(`Permission denied: ${decision.reason}`);
    }
  }

  /** Map hàng grant + số phiếu duyệt → DTO (KHÔNG company_id, KHÔNG secret). */
  private toDto(row: BreakGlassGrantRow, approvalCount: number): BreakGlassGrantDto {
    return {
      id: row.id,
      platformAccountId: row.platformAccountId,
      requesterUserId: row.requesterUserId,
      reason: row.reason,
      requiredApprovals: row.requiredApprovals,
      approvalCount,
      status: row.status as BreakGlassGrantDto["status"],
      expiresAt: row.expiresAt,
      activatedAt: row.activatedAt,
      createdAt: row.createdAt,
    };
  }

  /**
   * Audit deny ở tx RIÊNG. Dùng cho MỌI deny break-glass (permission-deny TRƯỚC withTenant; expired/
   * self-approval SAU khi tx duyệt đã rollback). Best-effort: lỗi ghi audit KHÔNG được biến security-deny
   * thành lỗi khác — log (không nuốt thầm) rồi caller vẫn ném lỗi gốc. Mở tx RIÊNG nên audit COMMIT độc lập.
   */
  private async recordBestEffortDenyAudit(
    user: RequestUser,
    grantId: string | null,
    reason: string,
  ): Promise<void> {
    try {
      await this.db.withTenant(user.companyId, async (tx) => {
        await this.audit.record(tx, {
          action: AUDIT_DENIED,
          objectType: "break_glass_access",
          objectId: grantId ?? undefined,
          actorUserId: user.id,
          after: { reason },
        });
      });
    } catch (err) {
      this.logger.error("Ghi audit deny break-glass thất bại (kết quả deny KHÔNG đổi)", {
        userId: user.id,
        grantId,
        reason,
        error: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
    }
  }
}
