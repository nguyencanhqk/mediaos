import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException, forwardRef } from "@nestjs/common";
import type {
  AuthTokens,
  ForgotPasswordRequest,
  LoginRequest,
  MeResponse,
  ResetPasswordRequest,
  TwoFactorChallenge,
} from "@mediaos/contracts";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { passwordResetTokens, refreshTokens, roles, userRoles, users } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { LoginRateLimiter } from "./login-rate-limiter";
import { PasswordService } from "./password.service";
import { ReplayGuardService } from "./replay-guard.service";
import { SecurityAlertService } from "./security-alert.service";
import { TokenService } from "./token.service";
import { TwoFactorService } from "./two-factor.service";
import { SecretEncryptionService } from "../crypto/secret-encryption.service";
import type { EncryptedColumns } from "../crypto/secret-encryption.types";
import { ACCESS_RESTRICTED_CODE } from "@mediaos/contracts";
import { SecurityPolicyService } from "../security-policy/security-policy.service";

/** Ngữ cảnh request đưa vào audit (ip/user agent). */
export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

const uuidSchema = z.string().uuid();
/** 401 ĐỒNG NHẤT cho mọi lỗi đăng nhập — không lộ user/tenant tồn tại (plan §3b/G2-6). */
const UNIFORM_LOGIN_ERROR = "Thông tin đăng nhập không hợp lệ.";
/**
 * AUTH-FIX-1: ALLOW-LIST trạng thái được phép cấp token (login/refresh/2FA). Fail-closed — CHỈ 'active'
 * mới qua; mọi giá trị khác ('suspended' và mọi trạng thái tương lai vd 'locked'/'pending') bị CHẶN. Dùng
 * allow-list (không deny-list 'suspended') để trạng thái mới mặc định KHÔNG lọt. Khớp users.status DEFAULT
 * 'active' (mig 0002) + CHECK ('active'|'suspended', mig 0430). reason chỉ vào audit, KHÔNG vào HTTP body.
 */
const ACTIVE_USER_STATUS = "active";
function isAuthorizedStatus(status: string): boolean {
  return status === ACTIVE_USER_STATUS;
}
/** AC-0b: id role hệ thống `platform-admin` (mig 0230) — phiên user giữ role này = OPERATOR (aud). */
const PLATFORM_ADMIN_ROLE_ID = "00000000-0000-0000-0000-0000000000f0";

/** Hình dạng envelope reset-token lưu trong outbox payload (Buffer → base64 để truyền JSON). */
const resetEnvelopeSchema = z.object({
  secretCiphertext: z.string(),
  encryptedDek: z.string(),
  dekKeyVersion: z.number().int(),
  kmsKeyId: z.string(),
  ivNonce: z.string(),
  authTag: z.string(),
  encAlgo: z.string(),
});

/** EncryptedColumns → shape JSON-safe (base64 cho 4 cột Buffer; scalar giữ nguyên). */
function serializeResetEnvelope(cols: EncryptedColumns): z.infer<typeof resetEnvelopeSchema> {
  return {
    secretCiphertext: cols.secretCiphertext.toString("base64"),
    encryptedDek: cols.encryptedDek.toString("base64"),
    dekKeyVersion: cols.dekKeyVersion,
    kmsKeyId: cols.kmsKeyId,
    ivNonce: cols.ivNonce.toString("base64"),
    authTag: cols.authTag.toString("base64"),
    encAlgo: cols.encAlgo,
  };
}

/**
 * G6-2f M3 — redact email người gọi khỏi chuỗi chẩn đoán TRƯỚC khi log. `err.stack`/`message` là
 * KHÔNG kiểm soát được (downstream có thể nhúng giá trị email) nên ta giữ stack để quan sát
 * (silent-failure F3) nhưng loại PII. Scrub cả biến lowercase (downstream có thể hạ chữ thường).
 * Token KHÔNG nằm trong scope catch của forgotPassword nên không cần scrub ở đây.
 */
export function redactEmailFromDetail(detail: string, email?: string): string {
  if (!email) return detail;
  let out = detail;
  for (const variant of new Set([email, email.toLowerCase()])) {
    out = out.split(variant).join("[redacted-email]");
  }
  return out;
}

/** Payload không tin cậy (từ outbox durable) → EncryptedColumns đã validate; ném khi shape sai. */
function deserializeResetEnvelope(raw: unknown): EncryptedColumns {
  const e = resetEnvelopeSchema.parse(raw);
  return {
    secretCiphertext: Buffer.from(e.secretCiphertext, "base64"),
    encryptedDek: Buffer.from(e.encryptedDek, "base64"),
    dekKeyVersion: e.dekKeyVersion,
    kmsKeyId: e.kmsKeyId,
    ivNonce: Buffer.from(e.ivNonce, "base64"),
    authTag: Buffer.from(e.authTag, "base64"),
    encAlgo: e.encAlgo,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly dbsvc: DatabaseService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(forwardRef(() => PermissionService)) private readonly permissions: PermissionService,
    private readonly secrets: SecretEncryptionService,
    private readonly twoFactor: TwoFactorService,
    private readonly replayGuard: ReplayGuardService,
    private readonly securityAlerts: SecurityAlertService,
    @Inject(forwardRef(() => SecurityPolicyService))
    private readonly securityPolicy: SecurityPolicyService,
  ) {}

  /**
   * CS-9 — chính sách bảo mật per-company chặn cấp token khi sai IP / ngoài giờ. 403 ĐỒNG NHẤT
   * `code:ACCESS_RESTRICTED` (KHÔNG lộ rule cụ thể). Dùng chung cho login + refresh.
   */
  private accessRestrictedError(): HttpException {
    return new HttpException(
      { code: ACCESS_RESTRICTED_CODE, message: "Truy cập bị hạn chế bởi chính sách bảo mật của công ty." },
      HttpStatus.FORBIDDEN,
    );
  }

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

  async login(req: LoginRequest, meta: RequestMeta): Promise<AuthTokens | TwoFactorChallenge> {
    const ip = meta.ip ?? "unknown";
    if (await this.isLoginRateLimited(req.companySlug, req.email, ip)) {
      throw new HttpException(
        "Quá nhiều lần thử. Vui lòng thử lại sau.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const companyId = await this.resolveCompanyId(req.companySlug);
    if (!companyId) {
      // companySlug sai: burn thời gian băm để cân bằng timing (chống dò tenant), rồi 401 đồng nhất.
      await this.password.hash(req.password);
      await this.recordLoginFailure(req.companySlug, req.email, ip);
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

      // AUTH-FIX-1: mật khẩu ĐÚNG nhưng tài khoản KHÔNG 'active' (suspended/…) → CHẶN cấp token. Đặt SAU
      // verify (timing ~ happy path → không thành oracle timing) và TRƯỚC securityPolicy/2FA/issueTokens.
      // audit deny (cùng tx, append-only; reason CHỈ ở audit_logs) rồi return null → 401 ĐỒNG NHẤT y như
      // bad-password/not-found (anti status-probing). password.hash đã chạy ở nhánh not-found → timing đều.
      if (!isAuthorizedStatus(user.status)) {
        await this.audit.record(tx, {
          action: "auth.login_blocked",
          objectType: "auth",
          actorUserId: user.id,
          objectId: user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          after: { reason: "suspended" },
        });
        return null;
      }

      // CS-9: mật khẩu ĐÚNG → check chính sách bảo mật (IP allowlist + khung giờ) TRƯỚC khi cấp token /
      // phát challenge 2FA. exempt user + người-cấu-hình bỏ qua; kill-switch tắt ⇒ bỏ qua KHÔNG đọc DB.
      // Vi phạm → audit deny (cùng tx) rồi 403 ACCESS_RESTRICTED ngoài tx (KHÔNG cấp token/challenge).
      const access = await this.securityPolicy.evaluateAccessTx(tx, companyId, {
        userId: user.id,
        ip: meta.ip,
        now: new Date(),
      });
      if (!access.allowed) {
        await this.audit.record(tx, {
          action: "auth.login_access_restricted",
          objectType: "auth",
          actorUserId: user.id,
          objectId: user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          after: { reason: access.reason },
        });
        return { kind: "access_restricted" as const };
      }

      // 2FA BẬT → KHÔNG cấp token ở đây; trả sentinel để login() phát hành challenge. Mật khẩu đã đúng nên
      // ghi audit challenge (KHÔNG phải login_success — phiên chưa thành cho tới khi verify mã bước 2).
      if (await this.twoFactor.isEnabledTx(tx, user.id)) {
        await this.audit.record(tx, {
          action: "auth.login_2fa_challenge",
          objectType: "auth",
          actorUserId: user.id,
          objectId: user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        return { kind: "2fa" as const, userId: user.id };
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
      return { kind: "tokens" as const, tokens: issued.tokens, userId: user.id };
    });

    if (!result) {
      await this.recordLoginFailure(req.companySlug, req.email, ip);
      throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    }
    // CS-9: bị chặn bởi chính sách bảo mật (IP/giờ). Mật khẩu ĐÚNG (không phải credential-fail) → KHÔNG
    // đụng rate-limiter (tránh tự khoá account vì chính sách); reset bucket rồi 403 ACCESS_RESTRICTED.
    if (result.kind === "access_restricted") {
      await this.resetLoginRateLimit(req.companySlug, req.email, ip);
      throw this.accessRestrictedError();
    }
    // Mật khẩu đúng (cả nhánh 2FA) → reset bucket login; bước 2 có rate-limit riêng theo user.
    await this.resetLoginRateLimit(req.companySlug, req.email, ip);
    if (result.kind === "2fa") {
      const challengeToken = this.tokens.signTwoFactorChallenge({ sub: result.userId, companyId });
      return { twoFactorRequired: true, challengeToken };
    }
    // CS-7: ghi last_login_at BEST-EFFORT (KHÔNG block login nếu write thất bại — log cảnh báo, không ném).
    // Luôn fire NGOÀI tx login đã commit thành công → write riêng không thể rollback tokens đã cấp.
    this.writeLastLoginAt(companyId, result.userId).catch((err) => {
      this.logger.warn(
        `login: ghi last_login_at thất bại (best-effort, login đã thành công): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return result.tokens;
  }

  /**
   * Bước 2 login (2FA): verify challengeToken + mã (TOTP hoặc recovery). Rate-limit theo userId để chặn
   * brute-force mã 6 số. Đúng → cấp tokens (audit login_success). Sai → 401 + ghi nhận để khoá tạm.
   */
  async completeTwoFactorLogin(
    challengeToken: string,
    code: string,
    meta: RequestMeta,
  ): Promise<AuthTokens> {
    let claims: { sub: string; companyId: string; jti: string };
    try {
      claims = this.tokens.verifyTwoFactorChallenge(challengeToken);
    } catch {
      throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    }
    // Defense-in-depth (G16-1b): challengeToken là SINGLE-USE. Claim jti TRƯỚC khi verify mã — challengeToken
    // dùng lại (replay, kể cả khi mã đúng) → claim trả false → 401 đồng nhất. Fail-closed (ReplayGuard hạ
    // memory khi Valkey rớt, KHÔNG fail-open). TTL phủ trọn cửa sổ challenge (5').
    const firstUse = await this.replayGuard.claim(`2fa-jti:${claims.jti}`, 600);
    if (!firstUse) {
      throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    }
    const rlKey = `2fa|${claims.companyId}|${claims.sub}`;
    if (await this.rateLimiter.isLocked(rlKey)) {
      throw new HttpException("Quá nhiều lần thử. Vui lòng thử lại sau.", HttpStatus.TOO_MANY_REQUESTS);
    }

    const ok = await this.twoFactor.verifyChallenge(claims.sub, claims.companyId, code);
    if (!ok) {
      await this.rateLimiter.recordFailure(rlKey);
      // G16-1b: re-auth fail lặp tới ngưỡng khoá → phát security alert (best-effort, KHÔNG đổi outcome 401).
      // `subject` = userId (định danh trừu tượng) — KHÔNG ghi mã/secret vào detail (BẤT BIẾN #3).
      if (await this.rateLimiter.isLocked(rlKey)) {
        await this.securityAlerts.emit(claims.companyId, {
          alertType: "repeated_reauth_failure",
          severity: "high",
          subject: claims.sub,
          subjectUserId: claims.sub,
          detail: { context: "2fa_challenge", ip: meta.ip },
        });
      }
      throw new UnauthorizedException("Mã xác thực không đúng.");
    }
    await this.rateLimiter.reset(rlKey);

    const { tokens, userId: twoFaUserId } = await this.dbsvc.withTenant(claims.companyId, async (tx) => {
      const [user] = await tx
        .select({ id: users.id, email: users.email, deletedAt: users.deletedAt, status: users.status })
        .from(users)
        .where(eq(users.id, claims.sub))
        .limit(1);
      // AUTH-FIX-1: đóng path login THỨ 3 (2FA bước 2). Trước đây chỉ check deletedAt → user suspended có
      // bật 2FA VẪN cấp token. Cộng allow-list status==='active' (fail-closed) → 401 ĐỒNG NHẤT, KHÔNG cấp token.
      if (!user || user.deletedAt || !isAuthorizedStatus(user.status)) {
        throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
      }
      const issued = await this.issueTokens(tx, claims.companyId, user.id, user.email);
      await this.audit.record(tx, {
        action: "auth.login_success",
        objectType: "auth",
        actorUserId: user.id,
        objectId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        after: { via: "2fa" },
      });
      return { tokens: issued.tokens, userId: user.id };
    });
    // CS-7: ghi last_login_at BEST-EFFORT (2FA path — không block login nếu write thất bại).
    this.writeLastLoginAt(claims.companyId, twoFaUserId).catch((err) => {
      this.logger.warn(
        `completeTwoFactorLogin: ghi last_login_at thất bại (best-effort): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return tokens;
  }

  /** Tắt 2FA của chính user — PHẢI re-auth bằng mật khẩu (chống chiếm phiên gỡ 2FA), có rate-limit. */
  async disableTwoFactor(user: { id: string; companyId: string }, password: string): Promise<void> {
    const rlKey = `2fa-disable|${user.companyId}|${user.id}`;
    if (await this.rateLimiter.isLocked(rlKey)) {
      throw new HttpException("Quá nhiều lần thử. Vui lòng thử lại sau.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const ok = await this.dbsvc.withTenant(user.companyId, async (tx) => {
      const [row] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (!row) return false;
      return this.password.verify(row.passwordHash, password);
    });
    if (!ok) {
      await this.rateLimiter.recordFailure(rlKey);
      throw new UnauthorizedException("Mật khẩu không đúng.");
    }
    await this.rateLimiter.reset(rlKey);
    await this.twoFactor.disable(user.id, user.companyId);
  }

  /**
   * Đổi mật khẩu khi ĐÃ đăng nhập (self-service, Module 2a). Re-auth bằng mật khẩu HIỆN TẠI (chống
   * chiếm phiên đổi pass), rate-limit per-user. Mật khẩu mới PHẢI khác mật khẩu cũ. Thành công → thu hồi
   * MỌI refresh token còn sống của user (đổi pass = đăng xuất mọi phiên, mirror resetPassword) + audit.
   * KHÔNG bao giờ log/return plaintext hay hash (BẤT BIẾN #3).
   */
  async changePassword(
    user: { id: string; companyId: string },
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const rlKey = `change-pw|${user.companyId}|${user.id}`;
    if (await this.rateLimiter.isLocked(rlKey)) {
      throw new HttpException("Quá nhiều lần thử. Vui lòng thử lại sau.", HttpStatus.TOO_MANY_REQUESTS);
    }
    // Khác mật khẩu cũ: chặn no-op + ép xoay thật. So plaintext (chưa chạm DB) → lỗi rõ ràng, không tốn băm.
    if (newPassword === currentPassword) {
      throw new BadRequestException("Mật khẩu mới phải khác mật khẩu hiện tại.");
    }

    const ok = await this.dbsvc.withTenant(user.companyId, async (tx) => {
      const [row] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(and(eq(users.id, user.id), isNull(users.deletedAt)))
        .limit(1);
      if (!row) return false;
      // verify trả false khi SAI mật khẩu; NÉM (PasswordVerificationError) khi hash hỏng → 500 (KHÔNG nuốt thành 401).
      const verified = await this.password.verify(row.passwordHash, currentPassword);
      if (!verified) return false;

      const newHash = await this.password.hash(newPassword);
      await tx
        .update(users)
        .set({ passwordHash: newHash, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      // Đổi mật khẩu = đăng xuất MỌI phiên: thu hồi mọi refresh token còn sống (mirror resetPassword).
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
      await this.audit.record(tx, {
        action: "auth.password_changed",
        objectType: "auth",
        actorUserId: user.id,
        objectId: user.id,
      });
      return true;
    });

    if (!ok) {
      await this.rateLimiter.recordFailure(rlKey);
      throw new UnauthorizedException("Mật khẩu hiện tại không đúng.");
    }
    await this.rateLimiter.reset(rlKey);
  }

  /** Khoá login khi BẤT KỲ bucket nào (per-IP HOẶC per-account) đã chạm ngưỡng. */
  private async isLoginRateLimited(companySlug: string, email: string, ip: string): Promise<boolean> {
    const ipKey = LoginRateLimiter.key(companySlug, email, ip);
    const acctKey = LoginRateLimiter.accountKey(companySlug, email);
    return (await this.rateLimiter.isLocked(ipKey)) || (await this.rateLimiter.isLocked(acctKey));
  }

  /** Ghi 1 lần sai vào CẢ HAI bucket: per-IP (ngưỡng mặc định) + per-account (ngưỡng cao hơn). */
  private async recordLoginFailure(companySlug: string, email: string, ip: string): Promise<void> {
    await this.rateLimiter.recordFailure(LoginRateLimiter.key(companySlug, email, ip));
    await this.rateLimiter.recordFailure(
      LoginRateLimiter.accountKey(companySlug, email),
      this.rateLimiter.accountMaxAttempts,
    );
  }

  /** Xoá cả hai bucket sau login thành công. */
  private async resetLoginRateLimit(companySlug: string, email: string, ip: string): Promise<void> {
    await this.rateLimiter.reset(LoginRateLimiter.key(companySlug, email, ip));
    await this.rateLimiter.reset(LoginRateLimiter.accountKey(companySlug, email));
  }

  /**
   * Refresh token (rotation + REUSE-DETECTION — crown-jewel, FS-1a). Xoay token mỗi lần; token mới KẾ THỪA
   * family_id. Nếu một token ĐÃ bị thu hồi (đã xoay/đã logout) bị TRÌNH LẠI ⇒ replay → THU HỒI CẢ HỌ token
   * (family) + audit, buộc đăng nhập lại (chống replay khi refresh cookie bị lộ — plan §7.4). Hết hạn TỰ
   * NHIÊN (không phải tấn công) → 401 thường, KHÔNG thu hồi họ. Mọi lỗi → 401 ĐỒNG NHẤT (không lộ lý do).
   */
  async refresh(refreshToken: string, meta: RequestMeta = {}): Promise<AuthTokens> {
    const parsed = this.splitScopedToken(refreshToken);
    if (!parsed) throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    const { companyId, full } = parsed;
    const tokenHash = this.tokens.hashToken(full);

    const result = await this.dbsvc.withTenant(companyId, async (tx) => {
      // FOR UPDATE: SERIALIZE refresh đồng thời trên CÙNG token (chống TOCTOU double-spend). Hai request
      // mang cùng refresh token: request thứ 2 chặn tới khi thứ 1 commit, rồi re-read thấy revoked_at đã set
      // (EvaluatePlanQual) → rơi vào nhánh reuse-detection. KHÔNG khoá hàng = cả 2 cùng xoay ⇒ 2 token hợp lệ
      // từ 1 token (bỏ qua reuse-detection). Mirror break-glass/attendance FOR UPDATE.
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1)
        .for("update");
      if (!row) return { kind: "invalid" as const };

      // REUSE-DETECTION: token đã revoke (đã xoay HOẶC family đã thu hồi) mà bị trình lại = replay. Thu hồi
      // MỌI token cùng family_id chưa revoke (RLS tự lọc company_id trong withTenant) + audit. Commit (KHÔNG
      // throw trong tx) để vết thu hồi + audit BỀN VỮNG, rồi caller ném 401 ngoài tx.
      if (row.revokedAt) {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
        await this.audit.record(tx, {
          action: "auth.token_reuse_detected",
          objectType: "auth",
          actorUserId: row.userId,
          objectId: row.userId,
          after: { reason: "refresh_token_reuse", familyRevoked: true },
        });
        return { kind: "reuse" as const };
      }

      // Hết hạn tự nhiên → 401 thường (KHÔNG thu hồi họ — không phải tín hiệu tấn công).
      if (row.expiresAt.getTime() <= Date.now()) return { kind: "invalid" as const };

      const [user] = await tx.select().from(users).where(eq(users.id, row.userId)).limit(1);
      if (!user || user.deletedAt) return { kind: "invalid" as const };

      // AUTH-FIX-1: token còn sống nhưng chủ KHÔNG 'active' (suspended/…) → THU HỒI CẢ HỌ token (family,
      // RLS tự lọc company_id trong withTenant) để token đang lộ không thể refresh tiếp + buộc đăng nhập
      // lại. KHÔNG xoay token mới. audit deny (cùng tx, append-only; reason CHỈ ở audit_logs). Caller ném
      // 401 ĐỒNG NHẤT ngoài tx (controller xoá cookie). Khác reuse-detection: đây là deny do trạng thái.
      if (!isAuthorizedStatus(user.status)) {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
        await this.audit.record(tx, {
          action: "auth.refresh_blocked",
          objectType: "auth",
          actorUserId: user.id,
          objectId: user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          after: { reason: "suspended", familyRevoked: true },
        });
        return { kind: "invalid" as const };
      }

      // CS-9: refresh = 1 lần CẤP TOKEN → enforce chính sách IP/giờ y như login (BẤT BIẾN #2: check tại
      // điểm cấp token, không per-request). Sai IP/ngoài giờ → KHÔNG xoay token; audit deny (cùng tx) +
      // 401 ngoài tx buộc đăng nhập lại (controller xoá cookie). KHÔNG thu hồi family (không phải tấn công).
      const access = await this.securityPolicy.evaluateAccessTx(tx, companyId, {
        userId: user.id,
        ip: meta.ip,
        now: new Date(),
      });
      if (!access.allowed) {
        await this.audit.record(tx, {
          action: "auth.refresh_access_restricted",
          objectType: "auth",
          actorUserId: user.id,
          objectId: user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          after: { reason: access.reason },
        });
        return { kind: "access_restricted" as const };
      }

      // Rotation: token mới KẾ THỪA family_id; revoke token cũ + trỏ replaced_by.
      const issued = await this.issueTokens(tx, companyId, user.id, user.email, row.familyId);
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
      return { kind: "ok" as const, tokens: issued.tokens };
    });

    if (result.kind === "ok") return result.tokens;
    // CS-9: bị chặn chính sách → 403 ACCESS_RESTRICTED (FE phân biệt với 401 hết-hạn/reuse). Controller
    // bắt mọi throw từ refresh để xoá cookie buộc login lại.
    if (result.kind === "access_restricted") throw this.accessRestrictedError();
    throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
  }

  /**
   * Đăng xuất TOÀN CỤC (FS-1a) — thu hồi MỌI refresh token cùng family_id (mọi app/subdomain mất phiên ở
   * lần refresh kế). Idempotent + KHÔNG lộ token tồn tại: token rác/không thấy → trả void êm (controller vẫn
   * xoá cookie). Audit `auth.logout` khi tìm thấy phiên. CSRF được ép Ở CONTROLLER (endpoint cookie-based).
   */
  async logout(refreshToken: string): Promise<void> {
    const parsed = this.splitScopedToken(refreshToken);
    if (!parsed) {
      // Token cookie sai định dạng (truncate/tamper) → idempotent void (controller vẫn xoá cookie), nhưng
      // GHI WARN để bất thường quan sát được (không nuốt câm) — KHÔNG log giá trị token (BẤT BIẾN #3).
      this.logger.warn("logout: refresh token sai định dạng (parse fail) — bỏ qua, không thu hồi family");
      return;
    }
    const { companyId, full } = parsed;
    const tokenHash = this.tokens.hashToken(full);

    await this.dbsvc.withTenant(companyId, async (tx) => {
      // KHÔNG cần FOR UPDATE: logout là TERMINAL (thu hồi tất cả). Đua với refresh đồng thời (refresh xoay
      // A→B trong khi logout đang chạy) cùng lắm thu hồi luôn B vừa cấp — ĐÚNG Ý logout (kết thúc mọi phiên).
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1);
      // CHỈ token CÒN SỐNG mới được uỷ quyền thu hồi family. Token đã revoke/hết hạn = ĐÃ chết → KHÔNG có
      // quyền (chống forced-logout: kẻ giữ token CŨ/đã xoay/lộ-log — vốn vô hại — KHÔNG được dùng để đăng
      // xuất nạn nhân qua body-path @Public). Idempotent: controller vẫn xoá cookie + trả 200.
      if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return;
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      await this.audit.record(tx, {
        action: "auth.logout",
        objectType: "auth",
        actorUserId: row.userId,
        objectId: row.userId,
        after: { scope: "family" },
      });
    });
  }

  async me(accessToken: string): Promise<MeResponse> {
    let claims: ReturnType<typeof this.tokens.verifyAccessToken>;
    try {
      // AC-0b: /me là endpoint định-danh CHÍNH CHỦ — chấp nhận cả phiên operator lẫn tenant ("any").
      claims = this.tokens.verifyAccessToken(accessToken, "any");
    } catch {
      throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    }
    // Chỉ chọn cột công khai → loại password_hash ở TẦNG QUERY (cấu trúc, không dựa kỷ luật map tay).
    // Tính 2FA cùng tx: mustSetupTwoFactor = bị ép 2FA (role) nhưng CHƯA bật → FE buộc enroll (AUTH-003).
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
      if (!row || row.deletedAt) return null;
      const required = await this.twoFactor.requiresTwoFactorTx(tx, row.id);
      const enabled = required ? await this.twoFactor.isEnabledTx(tx, row.id) : false;
      return { ...row, mustSetupTwoFactor: required && !enabled };
    });
    if (!user) throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    const capabilities = await this.permissions.getCapabilities(user.id, user.companyId);
    return {
      id: user.id,
      companyId: user.companyId,
      email: user.email,
      fullName: user.fullName,
      status: user.status,
      capabilities,
      mustSetupTwoFactor: user.mustSetupTwoFactor,
    };
  }

  /** Luôn trả thành công đồng nhất (không lộ email tồn tại). Có user ⇒ tạo reset token + phát event mail. */
  async forgotPassword(req: ForgotPasswordRequest, meta: RequestMeta): Promise<void> {
    const companyId = await this.resolveCompanyId(req.companySlug);
    if (!companyId) return; // im lặng — không lộ tenant

    try {
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
        // G6-2f: reset token được envelope-encrypt (purpose=auth_reset_token) TRƯỚC khi chạm outbox durable.
        // Payload CHỈ mang envelope (resetTokenEnc) — KHÔNG bao giờ plaintext (BẤT BIẾN #3). recordId=user.id
        // bind envelope vào user; mail consumer decrypt JIT qua decryptResetToken.
        const enc = await this.secrets.encryptSecret(scoped, {
          companyId,
          recordId: user.id,
          purpose: "auth_reset_token",
        });
        // G6-2f M3: payload KHÔNG mang email plaintext (outbox durable = data-at-rest). Mail consumer
        // resolve email JIT theo userId qua withTenant(companyId) — mirror pattern JIT-decrypt resetTokenEnc.
        await this.outbox.enqueue(tx, {
          eventType: "auth.password_reset_requested",
          payload: { userId: user.id, resetTokenEnc: serializeResetEnvelope(enc) },
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
    } catch (err) {
      // Uniform-void (không lộ email tồn tại): mọi lỗi xử lý (vd KMS/encrypt down) ⇒ withTenant tx đã rollback
      // (fail-closed — không plaintext, không partial), log ERROR phía server (KHÔNG token/DEK/email) rồi TRẢ
      // VOID như nhánh happy. Đóng oracle 500-vs-200 (FULL-gate 2f silent-failure F3). KHÔNG nuốt im: luôn có
      // ERROR + stack trong log để quan sát. M3: redact email khỏi stack (PII, stack uncontrolled).
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      this.logger.error(
        "forgotPassword: xử lý reset thất bại (đã rollback, không phát event)",
        redactEmailFromDetail(detail, req.email),
      );
    }
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

  /**
   * Giải mã envelope reset-token từ outbox payload — bước JIT của mail consumer (G6-2f). `companyId` lấy
   * từ outbox row, `userId` từ payload; cùng nhau dựng lại AAD (recordId = userId). Trả scoped token; ném
   * lỗi generic khi tamper/corruption (decryptSecret KHÔNG lộ nội tại crypto). KHÔNG log token.
   *
   * @internal CONSUMER-ONLY (G6-2f M2). Method trả plaintext token — chỉ dành cho mail consumer của
   * `auth.password_reset_requested`. AAD bind companyId‖userId nên KHÔNG phải oracle cross-secret
   * (platform_account dùng recordId=account.id khác user.id), và token trả ra vẫn single-use+hashed+TTL ở DB.
   * Khi build mail consumer (deferred — 2f residual), đặt method này SAU boundary của consumer
   * (worker context), KHÔNG để AuthService phơi capability giải mã rộng cho mọi module inject.
   */
  async decryptResetToken(companyId: string, resetTokenEnc: unknown, userId: string): Promise<string> {
    return this.secrets.decryptSecret(deserializeResetEnvelope(resetTokenEnc), {
      companyId,
      recordId: userId,
      purpose: "auth_reset_token",
    });
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

  /**
   * AC-0b: user giữ role hệ thống `platform-admin` (id …f0) CÒN HIỆU LỰC ⇒ phiên OPERATOR (control-plane
   * chéo tenant). Join y hệt requiresTwoFactorTx (userRoles ⋈ roles, lọc deleted_at + expires_at) nhưng
   * khoá theo id role platform-admin cố định. Chạy TRONG tx login (cùng 1 transaction, không round-trip thừa).
   */
  private async isOperatorTx(tx: TenantTx, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ one: sql<number>`1` })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(roles.id, PLATFORM_ADMIN_ROLE_ID),
          isNull(roles.deletedAt),
          or(isNull(userRoles.expiresAt), gt(userRoles.expiresAt, new Date())),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Tạo access token + refresh token (lưu hash). Trả token + id refresh mới (cho rotation).
   *
   * FS-1a: `familyId` — rotation truyền family_id của token cũ để token mới KẾ THỪA cùng họ; login KHÔNG
   * truyền ⇒ DB DEFAULT gen_random_uuid() cấp HỌ MỚI (phiên mới độc lập). Reuse/logout thu hồi theo family_id.
   */
  private async issueTokens(
    tx: TenantTx,
    companyId: string,
    userId: string,
    email: string,
    familyId?: string,
  ): Promise<{ tokens: AuthTokens; newTokenId: string }> {
    // AC-0b: operator (platform-admin) ⇒ aud='operator' + TTL ngắn; còn lại ⇒ aud='tenant' + TTL thường.
    const isOperator = await this.isOperatorTx(tx, userId);
    const aud = isOperator ? ("operator" as const) : ("tenant" as const);
    const accessToken = this.tokens.signAccessToken({ sub: userId, companyId, email, aud });
    const expiresIn = isOperator ? this.tokens.operatorAccessTtlSec : this.tokens.accessTtlSec;
    const plain = this.tokens.generateOpaqueToken();
    const scoped = this.scopeToken(companyId, plain);
    const expiresAt = new Date(Date.now() + this.tokens.refreshTtlSec * 1000);
    const [inserted] = await tx
      .insert(refreshTokens)
      // familyId undefined → bỏ qua khỏi INSERT ⇒ DB DEFAULT (họ mới). Có giá trị → kế thừa (rotation).
      .values({ userId, tokenHash: this.tokens.hashToken(scoped), expiresAt, ...(familyId ? { familyId } : {}) })
      .returning({ id: refreshTokens.id });
    return {
      tokens: {
        accessToken,
        refreshToken: scoped,
        expiresIn,
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

  /**
   * CS-7: cập nhật users.last_login_at = now() sau đăng nhập thành công.
   * BEST-EFFORT stats — KHÔNG throw, KHÔNG block login. Caller phải .catch(log).
   * Chạy NGOÀI tx login đã commit (fire-and-forget pattern) → write riêng, KHÔNG ảnh hưởng tokens đã cấp.
   * RLS: withTenant(companyId) ép company_id; UPDATE(last_login_at) GRANT riêng (mig 0370).
   */
  private async writeLastLoginAt(companyId: string, userId: string): Promise<void> {
    await this.dbsvc.withTenant(companyId, async (tx) => {
      await tx
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, userId));
    });
  }
}
