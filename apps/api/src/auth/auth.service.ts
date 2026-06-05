import { HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import type {
  AuthTokens,
  ForgotPasswordRequest,
  LoginRequest,
  MeResponse,
  ResetPasswordRequest,
} from "@mediaos/contracts";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { passwordResetTokens, refreshTokens, users } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { LoginRateLimiter } from "./login-rate-limiter";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

/** Ngữ cảnh request đưa vào audit (ip/user agent). */
export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

const uuidSchema = z.string().uuid();
/** 401 ĐỒNG NHẤT cho mọi lỗi đăng nhập — không lộ user/tenant tồn tại (plan §3b/G2-6). */
const UNIFORM_LOGIN_ERROR = "Thông tin đăng nhập không hợp lệ.";

@Injectable()
export class AuthService {
  constructor(
    private readonly dbsvc: DatabaseService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Resolve companySlug → companyId qua hàm SECURITY DEFINER (lỗ RLS có kiểm soát, §3b). */
  private async resolveCompanyId(companySlug: string): Promise<string | null> {
    if (!db) return null;
    const res = await db.execute(
      sql`SELECT id, status FROM resolve_company_by_slug(${companySlug})`,
    );
    const row = res.rows[0] as { id: string; status: string } | undefined;
    if (!row || row.status !== "active") return null;
    return row.id;
  }

  async login(req: LoginRequest, meta: RequestMeta): Promise<AuthTokens> {
    const ip = meta.ip ?? "unknown";
    const rlKey = LoginRateLimiter.key(req.companySlug, req.email, ip);
    if (this.rateLimiter.isLocked(rlKey)) {
      throw new HttpException(
        "Quá nhiều lần thử. Vui lòng thử lại sau.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const companyId = await this.resolveCompanyId(req.companySlug);
    if (!companyId) {
      // companySlug sai: burn thời gian băm để cân bằng timing (chống dò tenant), rồi 401 đồng nhất.
      await this.password.hash(req.password);
      this.rateLimiter.recordFailure(rlKey);
      throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    }

    const result = await this.dbsvc.withTenant(companyId, async (tx) => {
      const user = await this.findActiveUserByEmail(tx, req.email);
      if (!user) {
        // user không tồn tại: vẫn băm để cân bằng timing (chống user-enumeration).
        await this.password.hash(req.password);
        await this.audit.record(tx, {
          action: "auth.login_failed",
          objectType: "auth",
          ip: meta.ip,
          userAgent: meta.userAgent,
          after: { reason: "user_not_found", email: req.email },
        });
        return null;
      }

      const ok = await this.password.verify(user.passwordHash, req.password);
      if (!ok) {
        await this.audit.record(tx, {
          action: "auth.login_failed",
          objectType: "auth",
          actorUserId: user.id,
          objectId: user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          after: { reason: "bad_password" },
        });
        return null;
      }

      const issued = await this.issueTokens(tx, companyId, user.id, user.email);
      await this.audit.record(tx, {
        action: "auth.login_success",
        objectType: "auth",
        actorUserId: user.id,
        objectId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return issued.tokens;
    });

    if (!result) {
      this.rateLimiter.recordFailure(rlKey);
      throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    }
    this.rateLimiter.reset(rlKey);
    return result;
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const parsed = this.splitScopedToken(refreshToken);
    if (!parsed) throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    const { companyId, full } = parsed;
    const tokenHash = this.tokens.hashToken(full);

    const result = await this.dbsvc.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1);
      if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
        return null;
      }
      const [user] = await tx.select().from(users).where(eq(users.id, row.userId)).limit(1);
      if (!user || user.deletedAt) return null;

      const issued = await this.issueTokens(tx, companyId, user.id, user.email);
      // Rotation: revoke token cũ + trỏ replaced_by token mới.
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), replacedBy: issued.newTokenId })
        .where(eq(refreshTokens.id, row.id));
      await this.audit.record(tx, {
        action: "auth.token_refreshed",
        objectType: "auth",
        actorUserId: user.id,
        objectId: user.id,
      });
      return issued.tokens;
    });

    if (!result) throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    return result;
  }

  async me(accessToken: string): Promise<MeResponse> {
    let claims;
    try {
      claims = this.tokens.verifyAccessToken(accessToken);
    } catch {
      throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    }
    // Chỉ chọn cột công khai → loại password_hash ở TẦNG QUERY (cấu trúc, không dựa kỷ luật map tay).
    const user = await this.dbsvc.withTenant(claims.companyId, async (tx) => {
      const [row] = await tx
        .select({
          id: users.id,
          companyId: users.companyId,
          email: users.email,
          fullName: users.fullName,
          status: users.status,
          deletedAt: users.deletedAt,
        })
        .from(users)
        .where(eq(users.id, claims.sub))
        .limit(1);
      return row && !row.deletedAt ? row : null;
    });
    if (!user) throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    return {
      id: user.id,
      companyId: user.companyId,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
    };
  }

  /** Luôn trả thành công đồng nhất (không lộ email tồn tại). Có user ⇒ tạo reset token + phát event mail. */
  async forgotPassword(req: ForgotPasswordRequest, meta: RequestMeta): Promise<void> {
    const companyId = await this.resolveCompanyId(req.companySlug);
    if (!companyId) return; // im lặng — không lộ tenant

    await this.dbsvc.withTenant(companyId, async (tx) => {
      const user = await this.findActiveUserByEmail(tx, req.email);
      if (!user) return; // im lặng — không lộ email

      const plain = this.tokens.generateOpaqueToken();
      const scoped = this.scopeToken(companyId, plain);
      const expiresAt = new Date(Date.now() + this.tokens.resetTtlSec * 1000);
      await tx.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: this.tokens.hashToken(scoped),
        expiresAt,
      });
      // ⚠️ HARDEN TRƯỚC PROD (review G2 CRITICAL · BẤT BIẾN #3): resetToken plaintext nằm trong
      // outbox_events.payload (durable). Đường giao token cho mailer là async (chưa có consumer mail ở
      // G2). PHẢI envelope-encrypt payload (G6-2) + purge outbox đã xử lý trước khi lên prod. KHÔNG log.
      await this.outbox.enqueue(tx, {
        eventType: "auth.password_reset_requested",
        payload: { userId: user.id, email: user.email, resetToken: scoped },
      });
      await this.audit.record(tx, {
        action: "auth.password_reset_requested",
        objectType: "auth",
        actorUserId: user.id,
        objectId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  async resetPassword(req: ResetPasswordRequest): Promise<void> {
    const parsed = this.splitScopedToken(req.token);
    if (!parsed) throw new UnauthorizedException("Token không hợp lệ hoặc đã hết hạn.");
    const { companyId, full } = parsed;
    const tokenHash = this.tokens.hashToken(full);

    const ok = await this.dbsvc.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);
      if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return false;

      const newHash = await this.password.hash(req.newPassword);
      await tx.update(users).set({ passwordHash: newHash, updatedAt: new Date() }).where(eq(users.id, row.userId));
      // single-use: đánh dấu đã dùng.
      await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
      // Thu hồi mọi refresh token còn sống của user (đổi mật khẩu = đăng xuất mọi phiên).
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
      await this.audit.record(tx, {
        action: "auth.password_reset",
        objectType: "auth",
        actorUserId: row.userId,
        objectId: row.userId,
      });
      return true;
    });

    if (!ok) throw new UnauthorizedException("Token không hợp lệ hoặc đã hết hạn.");
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private async findActiveUserByEmail(tx: TenantTx, email: string) {
    const [row] = await tx
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /** Tạo access token + refresh token (lưu hash). Trả token + id refresh mới (cho rotation). */
  private async issueTokens(
    tx: TenantTx,
    companyId: string,
    userId: string,
    email: string,
  ): Promise<{ tokens: AuthTokens; newTokenId: string }> {
    const accessToken = this.tokens.signAccessToken({ sub: userId, companyId, email });
    const plain = this.tokens.generateOpaqueToken();
    const scoped = this.scopeToken(companyId, plain);
    const expiresAt = new Date(Date.now() + this.tokens.refreshTtlSec * 1000);
    const [inserted] = await tx
      .insert(refreshTokens)
      .values({ userId, tokenHash: this.tokens.hashToken(scoped), expiresAt })
      .returning({ id: refreshTokens.id });
    return {
      tokens: {
        accessToken,
        refreshToken: scoped,
        expiresIn: this.tokens.accessTtlSec,
      },
      newTokenId: inserted.id,
    };
  }

  /** Gắn companyId làm tiền tố token (không phải secret — có sẵn trong JWT) để mở withTenant khi refresh/reset. */
  private scopeToken(companyId: string, opaque: string): string {
    return `${companyId}.${opaque}`;
  }

  private splitScopedToken(token: string): { companyId: string; full: string } | null {
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const companyId = token.slice(0, dot);
    if (!uuidSchema.safeParse(companyId).success) return null;
    return { companyId, full: token };
  }
}
