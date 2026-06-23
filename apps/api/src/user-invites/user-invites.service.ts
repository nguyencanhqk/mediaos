import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  USER_INVITE_TTL_HOURS,
  type AcceptInviteRequest,
  type AcceptInviteResult,
  type CreateUserInviteRequest,
  type CreateUserInviteResult,
  type PendingInvitesDto,
  type UserInviteDto,
} from "@mediaos/contracts";
import { PasswordService } from "../auth/password.service";
import { DatabaseService } from "../db/db.service";
import type { UserInvite } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { SecurityPolicyService } from "../security-policy/security-policy.service";
import { InviteMailService } from "./invite-mail.service";
import { inviteAuditSnapshot, UserInvitesRepository } from "./user-invites.repository";
import {
  generateInviteToken,
  hashInviteToken,
  inviteTokenHashEquals,
} from "./user-invite-token.util";
import { isUniqueViolation } from "../common/db-error";

const MS_PER_HOUR = 60 * 60 * 1000;

/** Lỗi accept ĐỒNG NHẤT — KHÔNG lộ tenant/invite tồn tại hay lý do cụ thể (token sai/hết hạn/domain/đã dùng). */
const UNIFORM_ACCEPT_ERROR = "Liên kết kích hoạt không hợp lệ hoặc đã hết hạn.";

export interface InviteActor {
  id: string;
  companyId: string;
}

/** Map row → DTO view (KHÔNG token_hash / password_hash — BẤT BIẾN #3). */
function toDto(row: UserInvite): UserInviteDto {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    status: row.status as UserInviteDto["status"],
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    createdUserId: row.createdUserId,
    invitedBy: row.invitedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class UserInvitesService {
  private readonly logger = new Logger(UserInvitesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: UserInvitesRepository,
    private readonly password: PasswordService,
    private readonly audit: AuditService,
    private readonly securityPolicy: SecurityPolicyService,
    private readonly mail: InviteMailService,
  ) {}

  /**
   * Mời (admin). Tạo lời mời `pending` + token + audit (cùng tx), rồi gửi email kích hoạt BEST-EFFORT
   * NGOÀI tx (SMTP chậm/ngoại vi — không giữ DB tx mở). `emailSent` báo cho admin biết để xử lý nếu false.
   */
  async invite(actor: InviteActor, dto: CreateUserInviteRequest): Promise<CreateUserInviteResult> {
    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + USER_INVITE_TTL_HOURS * MS_PER_HOUR);

    const created = await this.db.withTenant(actor.companyId, async (tx) => {
      // Chặn mời trùng: đã có lời mời đang hoạt động (pending|accepted) hoặc tài khoản users đang sống.
      const dupInvite = await this.repo.findActiveByEmailTx(tx, actor.companyId, dto.email);
      if (dupInvite) {
        throw new ConflictException("Đã tồn tại lời mời đang chờ xử lý cho email này.");
      }
      const liveUser = await this.repo.findLiveUserByEmailTx(tx, actor.companyId, dto.email);
      if (liveUser) {
        throw new ConflictException("Email này đã có tài khoản trong hệ thống.");
      }

      const company = await this.repo.findCompanyTx(tx, actor.companyId);

      let row: UserInvite;
      try {
        row = await this.repo.insertTx(tx, actor.companyId, {
          email: dto.email,
          fullName: dto.fullName,
          tokenHash,
          expiresAt,
          invitedBy: actor.id,
        });
      } catch (err) {
        // Partial-unique (company, lower(email)) WHERE status='pending' → mời trùng đua → 409 (KHÔNG nuốt).
        if (isUniqueViolation(err)) {
          throw new ConflictException("Đã tồn tại lời mời đang chờ xử lý cho email này.");
        }
        throw err;
      }

      await this.audit.record(tx, {
        action: "invite.created",
        objectType: "user_invite",
        objectId: row.id,
        actorUserId: actor.id,
        after: inviteAuditSnapshot(row),
      });

      return { row, company };
    });

    // Gửi email NGOÀI tx (best-effort). Thiếu slug công ty (không nên xảy ra) → bỏ qua gửi.
    let emailSent = false;
    if (created.company) {
      const result = await this.mail.sendActivationEmail({
        companyId: actor.companyId,
        companySlug: created.company.slug,
        companyName: created.company.name,
        email: created.row.email,
        fullName: created.row.fullName,
        token,
      });
      emailSent = result.sent;
    }

    return { invite: toDto(created.row), emailSent };
  }

  /**
   * Kích hoạt (người được mời, SESSIONLESS — token là auth). Resolve company từ slug → withTenant → tìm
   * invite theo token_hash → validate (pending + chưa hết hạn + chưa dùng) → email-domain (CS-9) → hash
   * password → mark accepted (single-use qua UPDATE-guard). MỌI lỗi → UNIFORM (chống dò tenant/invite).
   *
   * HAI tx CỐ Ý: hash argon2 (CPU-bound, tens–hundreds ms) chạy NGOÀI tx để KHÔNG ghim một connection
   * PgBouncer trong suốt thời gian băm trên route @Public (giảm bề mặt DoS amplification). Khoảng hở giữa
   * tx1 (validate) và tx2 (chốt) VÔ HẠI: `markAcceptedTx` UPDATE WHERE status='pending' AND accepted_at IS NULL
   * → re-validate NGUYÊN TỬ ở DB ⇒ single-use vẫn đúng (đúng 1 winner, kẻ thua thấy 0 row → uniform error).
   */
  async accept(dto: AcceptInviteRequest): Promise<AcceptInviteResult> {
    const companyId = await this.resolveActiveCompanyId(dto.companySlug);
    if (!companyId) {
      throw new BadRequestException(UNIFORM_ACCEPT_ERROR);
    }

    const tokenHash = hashInviteToken(dto.token);

    // tx1 — validate token (RLS, READ-ONLY). KHÔNG hash ở đây (tránh giữ DB tx trong lúc băm CPU-bound).
    const invite = await this.db.withTenant(companyId, async (tx) => {
      const row = await this.repo.findByTokenHashTx(tx, companyId, tokenHash);
      // Phòng thủ kép: so khớp hằng-thời-gian + ràng buộc trạng thái/hết-hạn/dùng-rồi.
      if (
        !row ||
        !inviteTokenHashEquals(row.tokenHash, tokenHash) ||
        row.status !== "pending" ||
        row.acceptedAt !== null ||
        row.expiresAt.getTime() <= Date.now()
      ) {
        throw new BadRequestException(UNIFORM_ACCEPT_ERROR);
      }

      // CS-9 email-domain: tài khoản tạo từ lời mời phải thuộc tên miền allowlist (rỗng/tắt ⇒ cho qua).
      const domainOk = await this.securityPolicy.assertEmailDomainAllowedTx(
        tx,
        companyId,
        row.email,
      );
      if (!domainOk) {
        throw new BadRequestException(UNIFORM_ACCEPT_ERROR);
      }
      return row;
    });

    // Băm NGOÀI tx (argon2 CPU-bound — KHÔNG ghim connection trên route @Public).
    const passwordHash = await this.password.hash(dto.password);

    // tx2 — chốt single-use NGUYÊN TỬ (UPDATE WHERE pending AND accepted_at IS NULL) + audit. Đua giữa tx1/tx2
    // (token bị dùng) → 0 row → uniform error (KHÔNG tạo state mới).
    await this.db.withTenant(companyId, async (tx) => {
      const accepted = await this.repo.markAcceptedTx(
        tx,
        companyId,
        invite.id,
        passwordHash,
        new Date(),
      );
      if (!accepted) {
        throw new BadRequestException(UNIFORM_ACCEPT_ERROR);
      }

      await this.audit.record(tx, {
        action: "invite.accepted",
        objectType: "user_invite",
        objectId: accepted.id,
        // KHÔNG actorUserId: người được mời CHƯA có tài khoản users (audit_logs.actor_user_id FK → users.id).
        // objectId = invite id đã đủ tham chiếu. Tài khoản thật được tạo ở bước approve (audit kèm actor admin).
        before: inviteAuditSnapshot(invite),
        after: inviteAuditSnapshot(accepted),
      });
    });

    return { status: "accepted" };
  }

  /** Hàng đợi (pending + accepted). FE chia tab theo status. */
  async listPending(companyId: string): Promise<PendingInvitesDto> {
    const rows = await this.repo.listQueue(companyId);
    return { invites: rows.map(toDto) };
  }

  /**
   * Duyệt (admin). CHỈ hợp lệ khi status 'accepted'. Tạo tài khoản users ACTIVE (email/fullName/password_hash
   * từ invite) → mark approved + gắn created_user_id. Cổng-duyệt THẬT: users row chỉ sinh ở đây.
   */
  async approve(actor: InviteActor, inviteId: string): Promise<UserInviteDto> {
    const approved = await this.db.withTenant(actor.companyId, async (tx) => {
      const invite = await this.repo.findByIdTx(tx, actor.companyId, inviteId);
      if (!invite) throw new NotFoundException("Không tìm thấy lời mời.");
      if (invite.status !== "accepted") {
        throw new BadRequestException("Lời mời chưa được kích hoạt hoặc đã được xử lý.");
      }
      if (!invite.passwordHash) {
        // Bất biến: accepted ⇒ luôn có password_hash. Phòng thủ — KHÔNG tạo tài khoản không mật khẩu.
        throw new BadRequestException("Lời mời thiếu thông tin kích hoạt.");
      }

      let createdUser: { id: string } | undefined;
      try {
        createdUser = await this.repo.createUserTx(tx, actor.companyId, {
          email: invite.email,
          fullName: invite.fullName,
          passwordHash: invite.passwordHash,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException("Email này đã có tài khoản trong hệ thống.");
        }
        throw err;
      }
      if (!createdUser) throw new Error("Tạo tài khoản từ lời mời thất bại.");

      const row = await this.repo.markApprovedTx(tx, actor.companyId, inviteId, createdUser.id);
      if (!row) {
        // Đua double-approve (status không còn 'accepted') → 409.
        throw new ConflictException("Lời mời đã được xử lý.");
      }

      await this.audit.record(tx, {
        action: "invite.approved",
        objectType: "user_invite",
        objectId: row.id,
        actorUserId: actor.id,
        before: inviteAuditSnapshot(invite),
        after: inviteAuditSnapshot(row),
      });

      return row;
    });

    return toDto(approved);
  }

  /** Từ chối (admin). Hợp lệ khi pending|accepted → rejected. */
  async reject(actor: InviteActor, inviteId: string): Promise<UserInviteDto> {
    const rejected = await this.db.withTenant(actor.companyId, async (tx) => {
      const invite = await this.repo.findByIdTx(tx, actor.companyId, inviteId);
      if (!invite) throw new NotFoundException("Không tìm thấy lời mời.");
      if (invite.status !== "pending" && invite.status !== "accepted") {
        throw new BadRequestException("Lời mời đã được xử lý.");
      }

      const row = await this.repo.markRejectedTx(tx, actor.companyId, inviteId);
      if (!row) throw new ConflictException("Lời mời đã được xử lý.");

      await this.audit.record(tx, {
        action: "invite.rejected",
        objectType: "user_invite",
        objectId: row.id,
        actorUserId: actor.id,
        before: inviteAuditSnapshot(invite),
        after: inviteAuditSnapshot(row),
      });

      return row;
    });

    return toDto(rejected);
  }

  /** Resolve companySlug → companyId (chỉ công ty ACTIVE) qua function SECURITY DEFINER (như auth.service). */
  private async resolveActiveCompanyId(companySlug: string): Promise<string | null> {
    try {
      const rows = await this.db.runRaw<{ id: string; status: string }>(
        sql`SELECT id, status FROM resolve_company_by_slug(${companySlug})`,
      );
      const row = rows[0];
      if (!row || row.status !== "active") return null;
      return row.id;
    } catch (err) {
      this.logger.warn(
        `resolveActiveCompanyId thất bại: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
