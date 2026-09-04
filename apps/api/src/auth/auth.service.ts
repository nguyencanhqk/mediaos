import { randomUUID } from "node:crypto";
import { rlKey as rateLimitKey } from "../common/valkey/valkey-key";
import { tooManyRequests } from "../common/filters/retry-after";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
  forwardRef,
} from "@nestjs/common";
import type {
  AuthTokens,
  ForgotPasswordRequest,
  LoginRequest,
  MeResponse,
  ResetPasswordRequest,
  SessionListItem,
  TwoFactorChallenge,
} from "@mediaos/contracts";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index";
import { DatabaseService, type TenantTx } from "../db/db.service";
import {
  companies,
  employeeProfiles,
  loginLogs,
  passwordResetTokens,
  refreshTokens,
  roles,
  userRoles,
  userSessions,
  users,
} from "../db/schema";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { ModuleCatalogService } from "../foundation/module-catalog/module-catalog.service";
import { PermissionService } from "../permission/permission.service";
import { LoginRateLimiter } from "./login-rate-limiter";
import { PasswordService } from "./password.service";
import { ReplayGuardService } from "./replay-guard.service";
import { ResetPasswordMailService } from "./reset-password-mail.service";
import { SecurityAlertService } from "./security-alert.service";
import { SecurityEventWriter } from "./security-event-writer.service";
import { TokenService } from "./token.service";
import { TWO_FACTOR_ENFORCED, TwoFactorService } from "./two-factor.service";
import { SecretEncryptionService } from "../crypto/secret-encryption.service";
import type { EncryptedColumns } from "../crypto/secret-encryption.types";
import { ACCESS_RESTRICTED_CODE } from "@mediaos/contracts";
import { SecurityPolicyService } from "../security-policy/security-policy.service";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";

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

/**
 * S2-AUTH-HARDEN-1 — sàn thời gian phản hồi đồng nhất cho forgotPassword (anti-timing-enumeration). Mọi
 * return-path chờ tối thiểu FLOOR + jitter[0..JITTER] ms ⇒ nhánh email-tồn-tại ≈ nhánh ghost. Là GIẢM THIỂU
 * (reduce, done_when #2), KHÔNG phải constant-time tuyệt đối.
 */
const FORGOT_PW_FLOOR_MS = 250;
const FORGOT_PW_JITTER_MS = 80;

/**
 * S6-SEC-LOGINLOG-2 — sàn thời gian cho nhánh 429 của login. Cùng cơ chế/giá trị với forgot, nhưng hằng
 * số RIÊNG vì lý do tồn tại khác: sau KI-044, nhánh 429 ghi log qua HAI hình dạng khác nhau — slug hợp lệ
 * đi `withTenant` (BEGIN + set_config + INSERT + COMMIT = 4 round-trip), slug sai đi `db.insert` trần
 * (1 round-trip). Nhánh này KHÔNG có `password.hash` burn như :219 nên chênh lệch đó lộ thành oracle
 * "slug này có tồn tại". Xem docs/plans/S6-SEC-LOGINLOG-2.md §2.3.
 */
const BLOCKED_LOGIN_FLOOR_MS = 250;

/**
 * S10-SEC-LOGINLOG429-1 — bucket rate-limit NÀO đang khoá một lượt login. Không phải trang trí:
 * khoá GỘP hàng nhật ký phải soi gương đúng bucket này, vì `acct` và `ip` có hình dạng khoá KHÁC
 * nhau (`acct` không chứa ip). Xem `isLoginRateLimited`.
 */
type LockedLoginBucket = "acct" | "ip";

/**
 * ⟲ S18-AUTH-RETRYAFTER-1 — `isLoginRateLimited` trả CHÍNH KHOÁ đang khoá, không chỉ tên bucket.
 * Nhánh 429 cần đọc TTL của đúng bucket đó; dựng khoá lần thứ hai bằng tay ở `login()` là thứ
 * `valkey-key-census.spec.ts` cấm, và hai bản sao sẽ lệch CÂM ngay khi builder khoá đổi.
 */
type LockedLogin = { bucket: LockedLoginBucket; key: string };

/**
 * S10-SEC-LOGINLOG429-1 — TTL khoá gộp hàng nhật ký của nhánh REPLAY challengeToken.
 * Bằng TTL marker single-use của `ReplayGuard` (`claim("2fa-jti", …, 600)` ngay trong hàm này) ⇒
 * đúng một hàng cho mỗi token trong suốt thời gian token đó còn bị coi là "đã tiêu".
 */
const TWO_FACTOR_CHALLENGE_REPLAY_TTL_SEC = 600;

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
  // S2-AUTH-BE-8: writer timeline user_security_events (dual-write cạnh audit). Field + default-construct
  // trong body (mirror AuditService.masker) để int-spec dựng AuthService bằng tay (không truyền) vẫn ghi event.
  private readonly securityEvents: SecurityEventWriter;

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
    // S2-AUTH-BE-1: /auth/me TÁI DÙNG getMyApps() cho `modules` (KHÔNG re-implement). ModuleCatalogModule
    // KHÔNG import AuthModule → acyclic (không cần forwardRef).
    private readonly modules: ModuleCatalogService,
    // S2-AUTH-BE-4: gửi email "đặt lại mật khẩu" (mock MVP). Optional để các int-spec dựng AuthService bằng
    // tay (KHÔNG truyền) vẫn chạy — vắng ⇒ forgotPassword bỏ qua bước gửi mail (đường outbox durable vẫn còn).
    private readonly resetMail?: ResetPasswordMailService,
    // S2-AUTH-BE-8: optional-với-default (mirror AuditService.masker) — DI luôn truyền instance đã đăng ký ở
    // AuthModule; hand-built int-spec (không truyền) → default-construct (cùng logic mask/severity).
    securityEvents?: SecurityEventWriter,
    // S7-CHAT-BE-GATE-3 (L2 HIGH): cắt phiên WS khi thu hồi phiên (SPEC-15 §18). Đi qua
    // `RealtimeEmitterModule` — module LÁ dựng riêng để phá vòng `Realtime → Chat → Realtime`, nên cạnh
    // `Auth → RealtimeEmitter` KHÔNG sinh cycle (RealtimeModule mới là bên import AuthModule).
    // `@Optional()` theo đúng khuôn 2 tham số trên: hàng chục int-spec dựng AuthService bằng tay theo vị
    // trí; vắng ⇒ chỉ mất lớp cắt socket, đường thu hồi ở DB vẫn nguyên.
    @Optional() private readonly realtime?: RealtimeEmitterService,
  ) {
    this.securityEvents = securityEvents ?? new SecurityEventWriter();
  }

  /**
   * CS-9 — chính sách bảo mật per-company chặn cấp token khi sai IP / ngoài giờ. 403 ĐỒNG NHẤT
   * `code:ACCESS_RESTRICTED` (KHÔNG lộ rule cụ thể). Dùng chung cho login + refresh.
   */
  private accessRestrictedError(): HttpException {
    return new HttpException(
      {
        code: ACCESS_RESTRICTED_CODE,
        message: "Truy cập bị hạn chế bởi chính sách bảo mật của công ty.",
      },
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

  /**
   * S6-SEC-LOGINLOG-2 · KI-044 — resolve chủ sở hữu CHỈ để gắn cho MỘT DÒNG NHẬT KÝ của nhánh 429.
   * KHÔNG phải quyết định auth (đường đó là `resolveCompanyId` gọi thẳng ở `login`, không qua đây).
   *
   * FAIL-SOFT NHƯNG KHÔNG CÂM: trục trặc DB → trả `null` (thoái lui đúng hành vi trước WO này: hàng ghi
   * vô chủ) và 429 KHÔNG được biến thành 500. Nhưng phải LOG — nuốt câm ở đây nghĩa là một sự cố hạ hàng
   * CÓ CHỦ xuống vô chủ trong im lặng, tức là tái tạo đúng lớp mù mà KI-044 đang vá.
   * Thông điệp KHÔNG nội suy `companySlug` — log không được trở thành nguồn liệt kê tenant. Lưu ý giới
   * hạn: `err.message` là chuỗi truyền thẳng từ driver, ta không kiểm soát nội dung nó; trên đường này
   * slug đi vào như bind-param của `resolve_company_by_slug` nên PG không dội giá trị ra lỗi, và bản thân
   * slug là do client gửi (không phải bí mật). Rủi ro còn lại là log-injection, không phải rò tenant.
   */
  private async resolveBlockedLogOwner(companySlug: string): Promise<string | null> {
    try {
      return await this.resolveCompanyId(companySlug);
    } catch (err) {
      this.logger.warn(
        `resolveBlockedLogOwner thất bại — hàng login_logs 'blocked' sẽ ghi vô chủ (company_id NULL), ` +
          `admin của tenant đó KHÔNG thấy lần bị chặn này: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async login(req: LoginRequest, meta: RequestMeta): Promise<AuthTokens | TwoFactorChallenge> {
    const ip = meta.ip ?? "unknown";
    const locked = await this.isLoginRateLimited(req.companySlug, req.email, ip);
    if (locked) {
      // ⟲ S6-SEC-LOGINLOG-2 · KI-044 — GẮN ĐÚNG CHỦ cho hàng bị chặn.
      // Trước: luôn ghi company_id NULL vì bộ chặn tần suất chạy TRƯỚC resolveCompanyId(). Sau mig 0532
      // (USING chỉ còn tenant hiện tại) hàng NULL KHÔNG tenant nào đọc được ⇒ company-admin mất hẳn quan
      // sát brute-force nhắm vào chính công ty mình (đo PROD: 165/268 hàng NULL thực ra CÓ CHỦ).
      // KHÔNG đảo thứ tự đường login: chỉ resolve BÊN TRONG nhánh đã-bị-chặn ⇒ request KHÔNG bị chặn
      // không tốn thêm một lượt tra DB nào. Slug sai/inactive vẫn ra NULL (hàng thực sự vô chủ).
      const startedAt = Date.now();
      let retryAfterSec: number | null = null;
      try {
        // ⟲ S18-AUTH-RETRYAFTER-1 — đọc TTL PHẢI nằm TRONG `try`, tức TRƯỚC `finally` áp sàn.
        // `applyUniformResponseFloor` chờ tới MỐC TUYỆT ĐỐI `startedAt + 250 + jitter`, nên một
        // round-trip Valkey thêm vào đây bị NUỐT TRỌN miễn còn ngân sách. Đặt nó sau `finally` (giữa
        // sàn và `throw`) là cộng thẳng thời gian Valkey vào SAU mốc ⇒ tự tay đẻ lại đúng oracle mà
        // sàn sinh ra để che. Dùng khoá do `isLoginRateLimited` trả về — KHÔNG dựng lại bằng tay.
        retryAfterSec = await this.rateLimiter.remainingLockSecOrNull(locked.key);

        // ⟲ S10-SEC-LOGINLOG429-1 · KI-048 — GỘP: ghi ĐÚNG MỘT hàng cho mỗi cửa sổ khoá.
        //
        // VÌ SAO. Nhánh này không có `password.hash` burn, nên chi phí server mỗi hàng gần bằng 0 ⇒
        // tốc độ sinh hàng do KẺ TẤN CÔNG điều khiển, đổ vào `login_logs` — bảng ∈ PROTECTED_TABLES,
        // KHÔNG BAO GIỜ thu hồi. Chính bản vá KI-044 (gắn đúng chủ) làm những hàng đó HIỆN LÊN màn
        // admin, nên nó vừa phình lưu trữ vừa chôn mọi tín hiệu khác dưới nhiễu. Đó là KI-048.
        //
        // ⚠️ GỘP = KHÔNG GHI THÊM. Tuyệt đối KHÔNG phải UPDATE hàng cũ: `login_logs` bị REVOKE
        // UPDATE/DELETE (mig 0443, BẤT BIẾN #2).
        //
        // ⚠️ VỊ TRÍ LÀ HỢP ĐỒNG: kiểm gộp nằm TRONG `try` và SAU `startedAt` ⇒ `finally` bên dưới
        // vẫn áp sàn thời gian cho CẢ lượt bị gộp. Nhấc nó ra ngoài/lên trên là trả về gần-tức-thì
        // ⇒ phân biệt được lần-đầu-cửa-sổ với lần-sau, và đẻ lại đúng oracle mà sàn sinh ra để che.
        //
        // Mất mát ĐÃ CÂN NHẮC: sổ trả lời "CÓ bị chặn trong cửa sổ này", không trả lời "BAO NHIÊU
        // lần". Ghi được số đếm cần UPDATE ⇒ cấm; đẻ hàng tổng kết lại là hàng do kẻ tấn công điều
        // khiển. Số đếm sống ở bucket rate-limit, không phải ở forensics.
        const firstOfWindow = await this.claimBlockedLogSlot(
          locked.bucket,
          req.companySlug,
          req.email,
          ip,
        );
        if (firstOfWindow) {
          const ownerCompanyId = await this.resolveBlockedLogOwner(req.companySlug);
          await this.recordLoginAttempt({
            companyId: ownerCompanyId,
            // GIỮ NGUYÊN: bất biến `company_id IS NULL ⟹ user_id IS NULL` (ghim bởi auth-me-bootstrap
            // int-spec). Ta chỉ nâng companyId từ NULL lên chủ thật, KHÔNG gắn user cho hàng pre-auth.
            userId: null,
            email: req.email,
            status: "blocked",
            reason: "TooManyAttempts",
            meta,
          });
        }
      } finally {
        // SÀN THỜI GIAN — bắt buộc, không phải tô điểm. Hai nhánh trên ghi log bằng HAI hình dạng khác
        // nhau (withTenant 4 round-trip vs insert trần 1 round-trip) và nhánh 429 không có password.hash
        // burn để che ⇒ không có sàn thì chính bản vá này đẻ ra oracle "slug tenant có tồn tại".
        // Đặt trong `finally` để áp cho CẢ nhánh ném. Transaction đã commit + trả connection về pool
        // TRƯỚC khi ngủ ⇒ chờ ở đây KHÔNG giữ slot DB (chỉ giữ socket). Xem plan §2.3 + số đo §6.
        await this.applyUniformResponseFloor(startedAt, BLOCKED_LOGIN_FLOOR_MS);
      }
      throw tooManyRequests(retryAfterSec);
    }

    // ⚠️ Đường QUYẾT ĐỊNH AUTH — TUYỆT ĐỐI KHÔNG cache/tái dùng kết quả resolve của nhánh 429 ở trên.
    // Công ty bị đình chỉ phải chặn được đăng nhập NGAY; một lớp cache dù chỉ vài chục giây ở ĐÂY nghĩa
    // là đình chỉ xong vẫn đăng nhập được trong khoảng đó. (Nhánh 429 chỉ gắn chủ cho một dòng nhật ký,
    // sai lệch ở đó vô hại — nên nó mới được phép fail-soft, còn đường này thì không.)
    const companyId = await this.resolveCompanyId(req.companySlug);
    if (!companyId) {
      // companySlug sai/không active: burn thời gian băm để cân bằng timing (chống dò tenant), rồi 401 đồng
      // nhất. login_logs PRE-AUTH company_id NULL (KHÔNG lộ tenant tồn tại — reason chung CompanyInactive).
      await this.password.hash(req.password);
      await this.recordLoginFailure(req.companySlug, req.email, ip);
      await this.recordLoginAttempt({
        companyId: null,
        userId: null,
        email: req.email,
        status: "failed",
        reason: "CompanyInactive",
        meta,
      });
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
        return { kind: "fail" as const, reason: "UserNotFound" as const, userId: null };
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
        return { kind: "fail" as const, reason: "WrongPassword" as const, userId: user.id };
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
        return { kind: "blocked" as const, reason: "Inactive" as const, userId: user.id };
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

      const issued = await this.issueTokens(tx, companyId, user.id, user.email, undefined, meta);
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

    if (result.kind === "fail" || result.kind === "blocked") {
      // GIỮ NGUYÊN hành vi cũ: cả credential-fail lẫn blocked đều bump rate-limit bucket (AUTH-FIX-1).
      await this.recordLoginFailure(req.companySlug, req.email, ip);
      // S2-AUTH-BE-1: ghi login_logs (failed/blocked + failure_reason) + tăng failed_login_count (chỉ sai
      // mật khẩu). BEST-EFFORT-NHƯNG-QUAN-SÁT: lỗi ghi log KHÔNG đổi 401 ĐỒNG NHẤT (reason CHỈ ở DB row, KHÔNG
      // vào body — anti status-probing) và KHÔNG được nuốt câm (logger.error bên trong helper).
      await this.recordLoginAttempt({
        companyId,
        userId: result.userId,
        email: req.email,
        status: result.kind === "blocked" ? "blocked" : "failed",
        reason: result.reason,
        meta,
      });
      if (result.reason === "WrongPassword" && result.userId) {
        await this.bumpFailedLoginCount(companyId, result.userId);
        // S4-INT-5 (crown-AUTH) — producer thông báo "tài khoản bị khoá tạm". EDGE-ONLY: login() đã 429 ở
        // ĐẦU (L199, isLoginRateLimited) khi bucket per-account ĐÃ khoá ⇒ tới được đây nghĩa là bucket CHƯA
        // khoá lúc vào; recordLoginFailure (ngay trên) vừa bump nó. Nếu isLocked(accountKey) GIỜ = true ⇒
        // CHÍNH lần sai NÀY vừa vượt ngưỡng → phát ĐÚNG 1 lần (mọi lần sau bị 429 ở L199, không chạm nhánh
        // này). Chỉ WrongPassword + userId THẬT: ghost email (UserNotFound, userId=null) KHÔNG vào nhánh này
        // ⇒ anti-enumeration (không lộ "account tồn tại" qua việc phát/không-phát notify).
        const accountKey = LoginRateLimiter.accountKey(req.companySlug, req.email);
        if (await this.rateLimiter.isLocked(accountKey)) {
          await this.emitAccountLocked(companyId, result.userId, meta);
        }
      }
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
    // CS-7: ghi last_login_at + reset failed_login_count BEST-EFFORT (KHÔNG block login nếu write thất bại —
    // log cảnh báo, không ném). Luôn fire NGOÀI tx login đã commit thành công → write riêng không thể rollback
    // tokens đã cấp (login_logs success cũng ngoài tx vì lỗi ghi log KHÔNG được làm hỏng phiên đã cấp).
    this.writeLastLoginAt(companyId, result.userId).catch((err) => {
      this.logger.warn(
        `login: ghi last_login_at thất bại (best-effort, login đã thành công): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    await this.recordLoginAttempt({
      companyId,
      userId: result.userId,
      email: req.email,
      status: "success",
      meta,
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
    const firstUse = await this.replayGuard.claim("2fa-jti", claims.jti, 600);
    if (!firstUse) {
      // ⟲ S10-SEC-LOGINLOG429-1 · KI-047 — challengeToken DÙNG LẠI là tín hiệu token bị đánh cắp/chia
      // sẻ, không phải "gõ sai". Trước WO này nhánh này ghi 0 dòng.
      //
      // GỘP theo `jti` (TTL = TTL của challenge): replay KHÔNG tốn argon2 — cùng một token cũ gửi lại
      // N lần là MIỄN PHÍ ⇒ ghi trần là bồi hàng vô hạn vào bảng không thu hồi được. Trần đúng ở đây là
      // 1 hàng / 1 token bị lộ, và đó CHÍNH LÀ hạt thông tin muốn có; lặp thêm không thêm bit nào.
      //
      // ⚠️ TỔN THẤT ĐÃ CÂN NHẮC: gộp theo `jti` che mất "cùng token bị replay từ NHIỀU IP" — dấu hiệu
      // token bị chia sẻ/bán. Vẫn chọn `jti`: khoá `jti|ip` cho kẻ tấn công quyền bơm hàng vô hạn chỉ
      // bằng cách đổi IP. Đừng "cải tiến" theo hướng đó.
      if (
        await this.rateLimiter.claimFirstOfWindow(
          rateLimitKey("logdedup", `2fa-replay:${claims.jti}`),
          TWO_FACTOR_CHALLENGE_REPLAY_TTL_SEC,
        )
      ) {
        await this.recordLoginAttemptForUser({
          companyId: claims.companyId,
          userId: claims.sub,
          status: "failed",
          reason: "TwoFactorChallengeReplay",
          meta,
        });
      }
      throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    }
    // Dựng qua BUILDER dùng chung: đường gỡ khoá của admin xoá đúng khoá này, và hai bản sao viết tay
    // sẽ lệch trong im lặng (clear no-op nhưng vẫn trả 204 + audit ok:true).
    const rlKey = LoginRateLimiter.twoFactorKey(claims.companyId, claims.sub);
    if (await this.rateLimiter.isLocked(rlKey)) {
      // ⟲ S10-SEC-LOGINLOG429-1 · KI-047 — đây là NGOẠI LỆ CÓ CHỦ Ý của luật "đường đang bị khoá ghi
      // 0 hàng" (luật đó giữ nguyên cho `disableTwoFactor`/`changePassword`/`confirmEnable`/`stepUp`).
      //
      // MÔ HÌNH CHI PHÍ ký cho ngoại lệ này: `replayGuard.claim` ở ngay TRÊN đứng TRƯỚC `isLocked`, nên
      // mỗi lần chạm được nhánh này kẻ tấn công phải TIÊU một challengeToken MỚI — mà token chỉ cấp
      // sau một lượt bước-1 ĐÚNG MẬT KHẨU, tức một lượt argon2 đầy đủ. Hệ số ≈ 1 hàng : 1 argon2,
      // khác hẳn `stepUp`/`change-pw` (lặp miễn phí bằng access token). `signTwoFactorChallenge` có
      // ĐÚNG MỘT call-site production nên không có đường vòng nào lấy token mà không trả giá đó.
      //
      // ⚠️ ĐIỀU KIỆN CỨNG: kiểm khoá gộp đứng TRƯỚC mọi lời gọi DB ⇒ lượt bị gộp không chạm DB một
      // round-trip nào, giữ nguyên đặc tính "đường đã khoá thì rẻ" của hiện trạng.
      if (
        await this.rateLimiter.claimFirstOfWindow(
          rateLimitKey("logdedup", `2fa:${claims.companyId}|${claims.sub}`),
          this.rateLimiter.lockoutSec,
        )
      ) {
        await this.recordLoginAttemptForUser({
          companyId: claims.companyId,
          userId: claims.sub,
          status: "blocked",
          reason: "TooManyAttempts",
          meta,
        });
      }
      throw tooManyRequests(await this.rateLimiter.remainingLockSecOrNull(rlKey));
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
      // ⟲ S10-SEC-LOGINLOG429-1 · KI-047 — ĐÂY là đường DỰNG NÊN cái khoá, và trước WO này nó ghi
      // 0 dòng. Hệ quả đo được: với tài khoản BẬT 2FA, `login_logs` (AUTH-API-401) chỉ chứa THÀNH
      // CÔNG — toàn bộ chiến dịch dò mã 6 số vô hình với admin, kể cả khi chưa chạm ngưỡng khoá.
      // Vá riêng nhánh 429 mà bỏ nhánh này là để lại lỗ LỚN HƠN cái vừa vá: 429 chỉ xuất hiện SAU
      // `LOGIN_MAX_ATTEMPTS` lần sai mà không lần nào để lại vết.
      //
      // KHÔNG gộp ở đây: trần đã là `LOGIN_MAX_ATTEMPTS` hàng/cửa sổ (lần sai thứ N+1 bị chặn ở
      // nhánh 429 bên trên), và mỗi lần còn tốn một argon2 của bước-1. Đây là dữ liệu, không phải nhiễu.
      await this.recordLoginAttemptForUser({
        companyId: claims.companyId,
        userId: claims.sub,
        status: "failed",
        reason: "TwoFactorInvalid",
        meta,
      });
      throw new UnauthorizedException("Mã xác thực không đúng.");
    }
    await this.rateLimiter.reset(rlKey);

    // S2-AUTH-BE-10 (PLAN-FIX #3): khối withTenant trả DISCRIMINATED UNION sentinel THAY VÌ ném trong tx.
    // Nhánh company-inactive PHẢI ghi audit login_blocked TRONG tx rồi COMMIT (ném 401 NGOÀI block) — nếu
    // ném-trong-tx thì db.service rollback nuốt luôn audit (int-spec b2 chứng minh audit COMMIT không rollback).
    const result = await this.dbsvc.withTenant(claims.companyId, async (tx) => {
      const [user] = await tx
        .select({
          id: users.id,
          email: users.email,
          deletedAt: users.deletedAt,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, claims.sub))
        .limit(1);
      // AUTH-FIX-1: đóng path login THỨ 3 (2FA bước 2). user suspended/deleted có bật 2FA → 401 ĐỒNG NHẤT,
      // KHÔNG cấp token. Nhánh này KHÔNG ghi audit (không có vết cần commit) → return sentinel, ném ngoài block.
      if (!user || user.deletedAt || !isAuthorizedStatus(user.status)) {
        return { kind: "invalid" as const };
      }
      // S2-AUTH-BE-10: cổng COMPANY-active cho path login THỨ 3. user active nhưng CÔNG TY 'suspended' (hoặc
      // row companies VẮNG do RLS lọc/soft-delete/race) ⇒ CHẶN cấp token. Đọc companies bằng PREDICATE TƯỜNG
      // MINH eq(companies.id, claims.companyId) (mirror me()). FAIL-CLOSED: company undefined ⇒ inactive. GHI
      // audit login_blocked reason='company_inactive' TRONG tx (append-only) + return sentinel → ném 401 NGOÀI
      // block để tx COMMIT KÈM audit. Login MỚI: KHÔNG có family refresh để thu hồi (chưa cấp token bước-2).
      const [company] = await tx
        .select({ status: companies.status })
        .from(companies)
        .where(eq(companies.id, claims.companyId))
        .limit(1);
      if (!company || !isAuthorizedStatus(company.status)) {
        await this.audit.record(tx, {
          action: "auth.login_blocked",
          objectType: "auth",
          actorUserId: user.id,
          objectId: user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          after: { reason: "company_inactive" },
        });
        return { kind: "blocked_company" as const };
      }
      const issued = await this.issueTokens(
        tx,
        claims.companyId,
        user.id,
        user.email,
        undefined,
        meta,
      );
      await this.audit.record(tx, {
        action: "auth.login_success",
        objectType: "auth",
        actorUserId: user.id,
        objectId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        after: { via: "2fa" },
      });
      return { kind: "ok" as const, tokens: issued.tokens, userId: user.id, email: user.email };
    });

    // Ném 401 ĐỒNG NHẤT NGOÀI tx: với blocked_company, tx đã COMMIT kèm audit login_blocked (bằng chứng ở
    // int-spec b2); với invalid, tx rỗng nên commit vô hại. reason KHÔNG lộ vào HTTP body (anti status-probing).
    if (result.kind === "invalid" || result.kind === "blocked_company") {
      throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);
    }
    const { tokens, userId: twoFaUserId, email: twoFaEmail } = result;
    // CS-7: ghi last_login_at + reset failed_login_count BEST-EFFORT (2FA path — không block login nếu lỗi).
    this.writeLastLoginAt(claims.companyId, twoFaUserId).catch((err) => {
      this.logger.warn(
        `completeTwoFactorLogin: ghi last_login_at thất bại (best-effort): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    // S2-AUTH-BE-1: login_logs success cho phiên 2FA bước-2 (đường cấp token THỨ 3). Best-effort-quan-sát.
    await this.recordLoginAttempt({
      companyId: claims.companyId,
      userId: twoFaUserId,
      email: twoFaEmail,
      status: "success",
      meta,
    });
    return tokens;
  }

  /** Tắt 2FA của chính user — PHẢI re-auth bằng mật khẩu (chống chiếm phiên gỡ 2FA), có rate-limit. */
  async disableTwoFactor(user: { id: string; companyId: string }, password: string): Promise<void> {
    // FAIL-FAST (S2-AUTH-BE-11): user bị ÉP 2FA (role HOẶC per-user, mig 0466) → 409 TWO_FACTOR_ENFORCED
    // TRƯỚC re-auth mật khẩu (không tiêu rate-limit/verify vô ích, deny sớm cho FE). twoFactor.disable()
    // fail-closed LẦN 2 trong cùng tx (defense-in-depth) — kể cả khi role đổi giữa 2 lần đọc.
    if (await this.twoFactor.requiresTwoFactor(user.id, user.companyId)) {
      throw new ConflictException({
        code: TWO_FACTOR_ENFORCED,
        message: "Tài khoản của bạn bị bắt buộc bật xác thực 2 bước (2FA) — không thể tắt.",
      });
    }
    const rlKey = rateLimitKey("2fa-disable", `${user.companyId}|${user.id}`);
    if (await this.rateLimiter.isLocked(rlKey)) {
      throw tooManyRequests(await this.rateLimiter.remainingLockSecOrNull(rlKey));
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
      await this.recordReauthFailure(user.companyId, user.id, "2fa_disable");
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
    const rlKey = rateLimitKey("change-pw", `${user.companyId}|${user.id}`);
    if (await this.rateLimiter.isLocked(rlKey)) {
      throw tooManyRequests(await this.rateLimiter.remainingLockSecOrNull(rlKey));
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
        // S2-FND-SEED-3: clear cờ ép-đổi TRONG CÙNG statement/tx với password_hash mới ⇒ nguyên tử
        // (rollback ⇒ cả hai không đổi). Đổi mật khẩu = hết bị ép; /auth/me sau đó trả mustChangePassword=false.
        .set({ passwordHash: newHash, updatedAt: new Date(), mustChangePassword: false })
        .where(eq(users.id, user.id));
      // Đổi mật khẩu = đăng xuất MỌI phiên: thu hồi mọi refresh token còn sống (mirror resetPassword).
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
      await this.revokeAllSessionsForUserTx(tx, user.companyId, user.id, "password_changed");
      await this.audit.record(tx, {
        action: "auth.password_changed",
        objectType: "auth",
        actorUserId: user.id,
        objectId: user.id,
      });
      // S2-AUTH-BE-8: dual-write timeline bảo mật TRONG cùng tx (rollback ⇒ 0 orphan). subject=actor=user.
      await this.securityEvents.record(tx, {
        eventType: "PASSWORD_CHANGED",
        userId: user.id,
        actorUserId: user.id,
      });
      return true;
    });

    if (!ok) {
      await this.rateLimiter.recordFailure(rlKey);
      await this.recordReauthFailure(user.companyId, user.id, "change_password");
      throw new UnauthorizedException("Mật khẩu hiện tại không đúng.");
    }
    await this.rateLimiter.reset(rlKey);
  }

  /**
   * Khoá login khi BẤT KỲ bucket nào (per-IP HOẶC per-account) đã chạm ngưỡng.
   *
   * ⟲ S10-SEC-LOGINLOG429-1 (KI-048) — trả **BUCKET NÀO** đang khoá thay vì `boolean`. Khoá gộp hàng
   * nhật ký phải SOI GƯƠNG đúng bucket đó: `accountKey` KHÔNG chứa `ip`
   * (`login-rate-limiter.ts:46-48`), nên nếu gộp theo `{slug}|{email}|{ip}` trong khi cái đang khoá
   * là bucket `acct` thì credential-stuffing rải nhiều nguồn vẫn bồi **mỗi IP một hàng** — đúng ca
   * nặng nhất của KI-048, và là ca `TRUST_PROXY=loopback` (18/08) làm cho có thật vì `ip` giờ là IP
   * THẬT chứ không còn là `::1` đồng loạt.
   *
   * Khoá CẢ HAI ⇒ trả `"acct"`: dạng THÔ hơn thắng (1 hàng/tài khoản/cửa sổ, không phải 1 hàng/IP).
   */
  private async isLoginRateLimited(
    companySlug: string,
    email: string,
    ip: string,
  ): Promise<LockedLogin | null> {
    // ⚠️ THỨ TỰ LÀ HỢP ĐỒNG — `acct` PHẢI đứng trước `ip`, vì HAI lý do độc lập:
    //  (a) gộp hàng `login_logs` theo dạng THÔ hơn (KI-048, docblock trên) — có int-spec canh
    //      (`login-blocked-attribution.int-spec.ts:297`);
    //  (b) ⟲ S18-AUTH-RETRYAFTER-1: TTL trả về phải là "khi nào THẬT SỰ vào lại được". Khi cả hai
    //      bucket cùng khoá thì TTL của `acct` luôn ≥ TTL của `ip`, nên lấy `acct` là đúng chiều —
    //      mọi bucket dùng chung một độ dài khoá (`recordFailure` set `:lock` bằng `LOGIN_LOCKOUT_SEC`
    //      bất kể `maxAttempts`), và khi `acct` đã khoá thì KHÔNG khoá per-IP mới nào hình thành được
    //      nữa vì `login()` ném 429 TRƯỚC `recordLoginFailure` ⇒ khoá `ip` chỉ có thể sinh ra TRƯỚC.
    //      Ràng buộc (b) sống nhờ thứ tự "chặn TRƯỚC khi đếm" ở `login()`: ai đảo thứ tự đó phải xét
    //      lại đoạn này, nếu không `retryAfterSec` sẽ nói một con số NGẮN HƠN thực tế.
    const acctKey = LoginRateLimiter.accountKey(companySlug, email);
    if (await this.rateLimiter.isLocked(acctKey)) return { bucket: "acct", key: acctKey };
    const ipKey = LoginRateLimiter.key(companySlug, email, ip);
    if (await this.rateLimiter.isLocked(ipKey)) return { bucket: "ip", key: ipKey };
    return null;
  }

  /**
   * Khoá GỘP hàng `login_logs` "blocked" của một cửa sổ khoá — `rest` soi gương bucket đang khoá.
   * Trả `true` nếu ĐÂY là request đầu tiên của cửa sổ (⇒ được ghi hàng), `false` nếu đã có hàng rồi.
   */
  private async claimBlockedLogSlot(
    bucket: LockedLoginBucket,
    companySlug: string,
    email: string,
    ip: string,
  ): Promise<boolean> {
    // S18-AUTH-UNLOCK429-1 — slug đi qua `normSlug` y như bucket mà khoá này soi gương. Nếu không,
    // `Funtime` và `funtime` (slug là citext ở DB ⇒ CÙNG một công ty) cho hai khoá gộp khác nhau và
    // `login_logs` — append-only, KHÔNG thu hồi được — lại bị bồi mỗi biến thể một hàng (đúng KI-048).
    const slug = LoginRateLimiter.normSlug(companySlug);
    const rest =
      bucket === "acct" ? `${slug}|${email.toLowerCase()}` : `${slug}|${email.toLowerCase()}|${ip}`;
    return this.rateLimiter.claimFirstOfWindow(
      rateLimitKey("logdedup", `login:${bucket}:${rest}`),
      this.rateLimiter.lockoutSec,
    );
  }

  /** Ghi 1 lần sai vào CẢ HAI bucket: per-IP (ngưỡng mặc định) + per-account (ngưỡng cao hơn). */
  private async recordLoginFailure(companySlug: string, email: string, ip: string): Promise<void> {
    await this.rateLimiter.recordFailure(LoginRateLimiter.key(companySlug, email, ip));
    await this.rateLimiter.recordFailure(
      LoginRateLimiter.accountKey(companySlug, email),
      this.rateLimiter.accountMaxAttempts,
    );
    // S18-AUTH-UNLOCK429-1 — ghi `ip` vào chỉ mục để đường GỠ khoá của admin biết phải xoá khoá nào
    // (khoá per-IP nhúng ip vào chuỗi khoá, và SCAN theo pattern bị CẤM — Valkey dùng chung 4 môi trường).
    // Đặt ở ĐÂY vì đây là chỗ duy nhất trong luồng login biết đủ (slug, email, ip) và LUÔN chạy khi một
    // lượt sai được ghi nhận — kể cả nhánh slug không resolve được và nhánh email không tồn tại, nên
    // không tạo chênh lệch quan sát được giữa email-ma và email-thật.
    await this.rateLimiter.noteFailureSource("login", companySlug, email, ip);
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
        await this.revokeAllSessionsForUserTx(tx, companyId, row.userId, "reuse_detected");
        await this.audit.record(tx, {
          action: "auth.token_reuse_detected",
          objectType: "auth",
          actorUserId: row.userId,
          objectId: row.userId,
          after: { reason: "refresh_token_reuse", familyRevoked: true },
        });
        // S2-AUTH-BE-8: REFRESH_TOKEN_REUSE_DETECTED = 'critical' (map). actor=null (hệ thống phát hiện replay —
        // KHÔNG quy cho chủ tài khoản). Ghi TRONG tx đã revoke family (commit, caller ném 401 ngoài tx).
        await this.securityEvents.record(tx, {
          eventType: "REFRESH_TOKEN_REUSE_DETECTED",
          userId: row.userId,
          actorUserId: null,
          ip: meta.ip,
          userAgent: meta.userAgent,
          payload: { reason: "refresh_token_reuse", familyRevoked: true },
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
        await this.revokeAllSessionsForUserTx(tx, companyId, user.id, "suspended");
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

      // S2-AUTH-BE-10: cổng COMPANY-active. Token còn sống + user active nhưng CÔNG TY 'suspended' (hoặc
      // row companies VẮNG do RLS lọc / soft-delete / race) ⇒ CHẶN xoay token y như user-suspended. Đọc
      // companies bằng PREDICATE TƯỜNG MINH eq(companies.id, companyId) trong CÙNG tx (mirror me()) —
      // defense-in-depth, KHÔNG dựa thuần RLS. FAIL-CLOSED: company undefined ⇒ coi như inactive (KHÔNG
      // dereference row undefined → tránh TypeError/500). Thu hồi CẢ HỌ token (family, RLS tự lọc company_id)
      // + user_sessions (revoked_reason='company_inactive') + audit deny (cùng tx, append-only; reason CHỈ ở
      // audit_logs). return invalid → caller ném 401 ĐỒNG NHẤT ngoài tx (controller xoá cookie).
      const [company] = await tx
        .select({ status: companies.status })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);
      if (!company || !isAuthorizedStatus(company.status)) {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
        await this.revokeAllSessionsForUserTx(tx, companyId, user.id, "company_inactive");
        await this.audit.record(tx, {
          action: "auth.refresh_blocked",
          objectType: "auth",
          actorUserId: user.id,
          objectId: user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          after: { reason: "company_inactive", familyRevoked: true },
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
      const issued = await this.issueTokens(tx, companyId, user.id, user.email, row.familyId, meta);
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), replacedBy: issued.newTokenId })
        .where(eq(refreshTokens.id, row.id));
      // S2-AUTH-BE-7: rotation = phiên CŨ kết thúc (user_sessions song song refreshTokens) — revoke hàng
      // session cũ (khớp theo tokenHash vừa xoay, KHÔNG phải id — user_sessions.id ≠ refreshTokens.id).
      await tx
        .update(userSessions)
        .set({ revokedAt: new Date(), revokedReason: "rotated" })
        .where(and(eq(userSessions.refreshTokenHash, tokenHash), isNull(userSessions.revokedAt)));
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
      this.logger.warn(
        "logout: refresh token sai định dạng (parse fail) — bỏ qua, không thu hồi family",
      );
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
      await this.revokeAllSessionsForUserTx(tx, companyId, row.userId, "logout");
      await this.audit.record(tx, {
        action: "auth.logout",
        objectType: "auth",
        actorUserId: row.userId,
        objectId: row.userId,
        after: { scope: "family" },
      });
      // S2-AUTH-BE-8: logout = thu hồi phiên (family) → SESSION_REVOKED (dual-write cùng tx).
      await this.securityEvents.record(tx, {
        eventType: "SESSION_REVOKED",
        userId: row.userId,
        actorUserId: row.userId,
        payload: { scope: "family" },
      });
    });
  }

  // ── S2-AUTH-BE-7: session self-service (CHỈ Authenticated + owner-check, KHÔNG permission pair riêng —
  //    pattern giống /auth/me, CHỐT 2026-07-02) ──────────────────────────────────────────────────────

  /**
   * Liệt kê phiên ACTIVE (chưa revoke, chưa hết hạn) của CHÍNH user gọi API — Own scope tuyệt đối (userId
   * lấy từ req.user đã qua JwtAuthGuard, KHÔNG nhận tham số từ client). KHÔNG bao giờ chọn refresh_token_hash/
   * access_token_jti thô ra DTO (BẤT BIẾN #3) — chỉ trả field forensic an toàn. `currentSessionId` (từ jti
   * access-token của request hiện tại) đánh dấu `is_current` — KHÔNG suy đoán theo thiết bị/IP.
   */
  async listSessions(
    companyId: string,
    userId: string,
    currentSessionId: string | undefined,
  ): Promise<SessionListItem[]> {
    const rows = await this.dbsvc.withTenant(companyId, async (tx) =>
      tx
        .select({
          id: userSessions.id,
          deviceName: userSessions.deviceName,
          platform: userSessions.platform,
          ipAddress: userSessions.ipAddress,
          userAgent: userSessions.userAgent,
          lastUsedAt: userSessions.lastUsedAt,
          createdAt: userSessions.createdAt,
          expiredAt: userSessions.expiredAt,
        })
        .from(userSessions)
        .where(
          and(
            eq(userSessions.userId, userId),
            isNull(userSessions.revokedAt),
            gt(userSessions.expiredAt, new Date()),
          ),
        )
        .orderBy(desc(userSessions.createdAt)),
    );
    return rows.map((r) => ({
      id: r.id,
      device_name: r.deviceName,
      platform: r.platform,
      ip_address: r.ipAddress,
      user_agent: r.userAgent,
      last_used_at: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
      created_at: r.createdAt.toISOString(),
      expired_at: r.expiredAt.toISOString(),
      is_current: r.id === currentSessionId,
    }));
  }

  /**
   * Thu hồi 1 phiên của CHÍNH user (deny-path: phiên KHÔNG tồn tại/thuộc user khác → 404 — KHÔNG lộ
   * tồn-tại-hay-không của phiên user khác qua 403 vs 404, mirror UserNotFound style). Owner-check ở
   * WHERE (userId=… AND id=…) — RLS chỉ ép company_id, KHÔNG ép owner; app PHẢI tự khoanh Own scope.
   * revoke = UPDATE revoked_at (KHÔNG hard-delete, BẤT BIẾN #2 mirror — session mutable theo thiết kế DB-02).
   */
  async revokeSession(companyId: string, userId: string, sessionId: string): Promise<void> {
    const parsed = uuidSchema.safeParse(sessionId);
    if (!parsed.success) throw new NotFoundException("Không tìm thấy phiên đăng nhập.");

    await this.dbsvc.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .select({
          id: userSessions.id,
          revokedAt: userSessions.revokedAt,
          refreshTokenHash: userSessions.refreshTokenHash,
        })
        .from(userSessions)
        .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)))
        .limit(1);
      if (!row) throw new NotFoundException("Không tìm thấy phiên đăng nhập.");
      if (row.revokedAt) return; // idempotent — phiên đã thu hồi trước đó.

      await tx
        .update(userSessions)
        .set({ revokedAt: new Date(), revokedBy: userId, revokedReason: "self_revoke" })
        .where(eq(userSessions.id, sessionId));
      // S7-CHAT-BE-GATE-3: cắt socket của user. Không map được socket→session (socket chỉ mang userId),
      // nên cắt TẤT CẢ rồi để thiết bị còn phiên hợp lệ tự reconnect — mất realtime vài giây ở thiết bị
      // đang dùng còn hơn để thiết bị vừa bị thu hồi tiếp tục nhận nội dung tin nhắn.
      this.realtime?.severUserSessions(companyId, userId);
      // Fail-closed thật sự: khoá luôn refresh token tương ứng (revoke session KHÔNG chỉ ẩn khỏi list —
      // request refresh KẾ TIẾP bằng token của phiên này PHẢI 401, mirror logout/reuse-detection).
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(refreshTokens.tokenHash, row.refreshTokenHash), isNull(refreshTokens.revokedAt)),
        );
      await this.audit.record(tx, {
        action: "auth.session_revoked",
        objectType: "user_session",
        actorUserId: userId,
        objectId: sessionId,
        after: { scope: "single" },
      });
      // S2-AUTH-BE-8: self-revoke 1 phiên → SESSION_REVOKED (dual-write cùng tx). subject=actor=user (Own).
      await this.securityEvents.record(tx, {
        eventType: "SESSION_REVOKED",
        userId,
        actorUserId: userId,
        payload: { scope: "single", sessionId },
      });
    });
  }

  /**
   * Thu hồi MỌI phiên khác của CHÍNH user, GIỮ phiên hiện tại (currentSessionId — từ jti access-token của
   * request đã auth). currentSessionId undefined (token legacy thiếu jti) → thu hồi TẤT CẢ (fail-closed:
   * KHÔNG có phiên nào để loại trừ an toàn) + audit ghi rõ. Trả revoked_count cho FE hiển thị.
   */
  async revokeOtherSessions(
    companyId: string,
    userId: string,
    currentSessionId: string | undefined,
  ): Promise<number> {
    return this.dbsvc.withTenant(companyId, async (tx) => {
      const conds = [eq(userSessions.userId, userId), isNull(userSessions.revokedAt)];
      if (currentSessionId) conds.push(sql`${userSessions.id} <> ${currentSessionId}`);

      const targets = await tx
        .select({ id: userSessions.id, refreshTokenHash: userSessions.refreshTokenHash })
        .from(userSessions)
        .where(and(...conds));
      if (targets.length === 0) return 0;

      const targetIds = targets.map((t) => t.id);
      await tx
        .update(userSessions)
        .set({ revokedAt: new Date(), revokedBy: userId, revokedReason: "self_revoke_others" })
        .where(and(eq(userSessions.userId, userId), inArray(userSessions.id, targetIds)));
      // S7-CHAT-BE-GATE-3: xem ghi chú ở `self_revoke` — cắt tất cả rồi để thiết bị hiện tại reconnect.
      this.realtime?.severUserSessions(companyId, userId);

      const hashes = targets.map((t) => t.refreshTokenHash);
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(inArray(refreshTokens.tokenHash, hashes), isNull(refreshTokens.revokedAt)));

      await this.audit.record(tx, {
        action: "auth.session_revoked",
        objectType: "user_session",
        actorUserId: userId,
        objectId: userId,
        after: {
          scope: "others",
          count: targets.length,
          hadCurrentSession: currentSessionId != null,
        },
      });
      // S2-AUTH-BE-8: self-revoke phiên khác → SESSION_REVOKED (dual-write cùng tx). count non-sensitive.
      await this.securityEvents.record(tx, {
        eventType: "SESSION_REVOKED",
        userId,
        actorUserId: userId,
        payload: {
          scope: "others",
          count: targets.length,
          hadCurrentSession: currentSessionId != null,
        },
      });
      return targets.length;
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
    // S2-AUTH-BE-1 — bootstrap context (BACKEND-03 §15): user/company/employee/roles trong 1 withTenant.
    // Chỉ chọn cột công khai → loại password_hash ở TẦNG QUERY. employee KHÔNG bao giờ chọn base_salary
    // (nhạy cảm). mustSetupTwoFactor = bị ép 2FA (role) nhưng CHƯA bật → FE buộc enroll (AUTH-003).
    const ctx = await this.dbsvc.withTenant(claims.companyId, async (tx) => {
      const [row] = await tx
        .select({
          id: users.id,
          companyId: users.companyId,
          email: users.email,
          fullName: users.fullName,
          status: users.status,
          deletedAt: users.deletedAt,
          // S2-FND-SEED-3: cờ ép đổi mật khẩu lần đầu (mig 0469). Cột công khai (KHÔNG nhạy cảm) → an toàn
          // trả cho chính chủ; FE dùng để điều hướng ép đổi. KHÔNG bao giờ chọn password_hash (BẤT BIẾN #3).
          mustChangePassword: users.mustChangePassword,
        })
        .from(users)
        .where(eq(users.id, claims.sub))
        .limit(1);
      if (!row || row.deletedAt) return null;
      const required = await this.twoFactor.requiresTwoFactorTx(tx, row.id);
      const enabled = required ? await this.twoFactor.isEnabledTx(tx, row.id) : false;

      const [company] = await tx
        .select({ id: companies.id, name: companies.name, status: companies.status })
        .from(companies)
        .where(eq(companies.id, row.companyId))
        .limit(1);

      // employee mapping (nullable — operator/super-admin không có hồ sơ). full_name lấy từ users.full_name;
      // departmentId = org_unit_id; employmentStatus = profile.status. KHÔNG chọn base_salary.
      const [emp] = await tx
        .select({
          id: employeeProfiles.id,
          employeeCode: employeeProfiles.employeeCode,
          departmentId: employeeProfiles.orgUnitId,
          directManagerId: employeeProfiles.directManagerId,
          employmentStatus: employeeProfiles.status,
        })
        .from(employeeProfiles)
        .where(and(eq(employeeProfiles.userId, row.id), isNull(employeeProfiles.deletedAt)))
        .limit(1);

      // roles active (mirror RBAC §16.2: chưa xoá + chưa hết hạn). S2-AUTH-DB-3: lọc CẢ assignment
      // (userRoles.deleted_at — gỡ role = soft-delete, mig 0471) LẪN role (roles.deleted_at). roles không
      // có cột code → name = code.
      const roleRows = await tx
        .select({ id: roles.id, name: roles.name })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(
          and(
            eq(userRoles.userId, row.id),
            eq(userRoles.companyId, row.companyId),
            isNull(userRoles.deletedAt),
            isNull(roles.deletedAt),
            or(isNull(userRoles.expiresAt), gt(userRoles.expiresAt, new Date())),
          ),
        );

      return {
        base: {
          id: row.id,
          companyId: row.companyId,
          email: row.email,
          fullName: row.fullName,
          status: row.status,
        },
        mustSetupTwoFactor: required && !enabled,
        // S2-FND-SEED-3: expose cờ ép đổi mật khẩu lần đầu (ADDITIVE, mẫu mustSetupTwoFactor).
        mustChangePassword: row.mustChangePassword,
        company: company ?? undefined,
        employee: emp
          ? {
              id: emp.id,
              employeeCode: emp.employeeCode,
              fullName: row.fullName,
              departmentId: emp.departmentId,
              directManagerId: emp.directManagerId,
              employmentStatus: emp.employmentStatus,
            }
          : null,
        roles: roleRows,
      };
    });
    if (!ctx) throw new UnauthorizedException(UNIFORM_LOGIN_ERROR);

    // capabilities + scopes fail-safe ({} khi lỗi — chỉ gợi ý FE; guard BE-2 là cổng thật). modules TÁI DÙNG
    // getMyApps → {code,name}; lỗi → [] (best-effort, FE còn /foundation/modules/my-apps). Tất cả NGOÀI tx.
    const [nonSensitiveCaps, allowlistedSensitiveCaps, scopes] = await Promise.all([
      this.permissions.getCapabilities(ctx.base.id, ctx.base.companyId),
      this.permissions.getAllowlistedSensitiveCapabilities(ctx.base.id, ctx.base.companyId),
      this.permissions.getCapabilityScopes(ctx.base.id, ctx.base.companyId),
    ]);
    // FIX-1-CAP-EXPOSE: hợp nhất cặp NHẠY CẢM trong allowlist ('view:audit-log') vào capabilities — ADDITIVE.
    // getCapabilities() (non-sensitive) là nguồn CHÍNH; spread SAU nên non-sensitive THẮNG khi trùng key (không
    // ghi đè). Cho phép FE useCan('view','audit-log') hoạt động THẬT (trước fix: sensitive bị lọc ⇒ viewer luôn
    // forbidden). KHÔNG đổi semantics getCapabilities() (module-catalog giữ nguyên); enforcement vẫn ở guard.
    const capabilities = { ...allowlistedSensitiveCaps, ...nonSensitiveCaps };
    let modules: Array<{ code: string; name: string }> = [];
    try {
      const apps = await this.modules.getMyApps({ id: ctx.base.id, companyId: ctx.base.companyId });
      modules = apps.map((a) => ({ code: a.module_code, name: a.name }));
    } catch (err) {
      this.logger.warn(
        `me: getMyApps thất bại (best-effort, /me vẫn trả): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      ...ctx.base,
      capabilities,
      mustSetupTwoFactor: ctx.mustSetupTwoFactor,
      // S2-FND-SEED-3: cờ ép đổi mật khẩu lần đầu (ADDITIVE — /auth/me không phá contract S2-AUTH-BE-1).
      // TODO(FE-enforcement, follow-up FE WO): apps/app đọc cờ này để REDIRECT ép đổi mật khẩu trước khi
      // vào nghiệp vụ (chặn ở router guard). CỐ Ý KHÔNG dựng nút/route chết ở đây — chỉ phơi dữ liệu.
      mustChangePassword: ctx.mustChangePassword,
      company: ctx.company,
      employee: ctx.employee,
      roles: ctx.roles,
      scopes,
      modules,
    };
  }

  /** Luôn trả thành công đồng nhất (không lộ email tồn tại). Có user ⇒ tạo reset token + phát event mail.
   *  S2-AUTH-HARDEN-1: bọc SÀN thời gian phản hồi đồng nhất (anti-timing-enumeration) quanh thân thật. */
  async forgotPassword(req: ForgotPasswordRequest, meta: RequestMeta): Promise<void> {
    // startedAt ở public boundary; finally áp sàn cho MỌI return-path của forgotPasswordImpl
    // (unknown-tenant · locked · ghost · existing · error) ⇒ thời gian phản hồi ~đồng nhất.
    const startedAt = Date.now();
    try {
      await this.forgotPasswordImpl(req, meta);
    } finally {
      await this.applyUniformResponseFloor(startedAt);
    }
  }

  /** Thân forgot thật — LUÔN gọi qua wrapper forgotPassword (đã áp sàn thời gian). */
  private async forgotPasswordImpl(req: ForgotPasswordRequest, meta: RequestMeta): Promise<void> {
    const companyId = await this.resolveCompanyId(req.companySlug);
    if (!companyId) return; // im lặng — không lộ tenant

    // S2-AUTH-HARDEN-1: rate-limit forgot dùng NAMESPACE RIÊNG (rl:forgot:*) — TÁCH HẲN bucket login
    // (rl:ip/rl:acct). Trước đây dùng CHUNG ⇒ spam forgot cho email victim khoá luôn LOGIN của victim (DoS
    // qua endpoint công khai). LOCKED → trả VOID ĐỒNG NHẤT y như happy/ghost (anti-enumeration). Bucket forgot
    // tự HẾT HẠN theo TTL (LOGIN_LOCKOUT_SEC) — KHÔNG reset ở resetPassword. KHÔNG ghi login_logs (không phải login).
    const ip = meta.ip ?? "unknown";
    const ipKey = LoginRateLimiter.forgotKey(req.companySlug, req.email, ip);
    const acctKey = LoginRateLimiter.forgotAccountKey(req.companySlug, req.email);
    if ((await this.rateLimiter.isLocked(ipKey)) || (await this.rateLimiter.isLocked(acctKey))) {
      return; // im lặng — không lộ "account tồn tại"
    }
    await this.rateLimiter.recordFailure(ipKey);
    await this.rateLimiter.recordFailure(acctKey, this.rateLimiter.accountMaxAttempts);
    // S18-AUTH-UNLOCK429-1 — nuôi chỉ mục IP của họ `forgot` (TÁCH khỏi chỉ mục login, giữ nguyên ranh
    // giới namespace ký ở trên). Đứng ĐÚNG chỗ này — sau lượt recordFailure, TRƯỚC nhánh rẽ theo
    // "email có tồn tại không" — nên email-ma và email-thật đi qua cùng số round-trip: không thêm oracle.
    await this.rateLimiter.noteFailureSource("forgot", req.companySlug, req.email, ip);

    // Plaintext token tồn tại NGOÀI tx (để gửi mail sau commit). null khi email không tồn tại.
    let mailToken: { email: string; token: string } | null = null;
    try {
      await this.dbsvc.withTenant(companyId, async (tx) => {
        const user = await this.findActiveUserByEmail(tx, req.email);
        if (!user) return; // im lặng — không lộ email

        const plain = this.tokens.generateOpaqueToken();
        const scoped = this.scopeToken(companyId, plain);
        const expiresAt = new Date(Date.now() + this.tokens.resetTtlSec * 1000);
        mailToken = { email: user.email, token: scoped };
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
        // S2-AUTH-BE-8: PASSWORD_RESET_REQUESTED (dual-write cùng tx). KHÔNG payload token/envelope (BẤT BIẾN #3).
        await this.securityEvents.record(tx, {
          eventType: "PASSWORD_RESET_REQUESTED",
          userId: user.id,
          actorUserId: user.id,
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
      return; // tx rollback → KHÔNG gửi mail (không có token hợp lệ).
    }

    // S2-AUTH-BE-4: gửi email reset NGOÀI tx (sau commit), BEST-EFFORT. Lỗi gửi mail KHÔNG được đổi 200-vs-500
    // (oracle enumeration) → .catch redact + nuốt-CÓ-log. Token CHỈ trong RAM ở đây; service KHÔNG log token.
    // `mailToken` null khi email không tồn tại (uniform-void giữ nguyên). Đường outbox durable (G6-2f) vẫn còn
    // cho consumer bền vững — mock này là đường gửi đồng bộ cho MVP/test, KHÔNG nhân đôi decrypt/log token.
    if (mailToken && this.resetMail) {
      const { email, token } = mailToken;
      try {
        await this.resetMail.sendResetEmail({ companyId, email, token });
      } catch (err) {
        const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
        this.logger.error(
          "forgotPassword: gửi email reset thất bại (best-effort, KHÔNG đổi outcome)",
          redactEmailFromDetail(detail, req.email),
        );
      }
    }
  }

  /**
   * S2-AUTH-HARDEN-1 — chờ tới SÀN thời gian (+ jitter ngẫu nhiên) để MỌI nhánh của một đường phản hồi
   * trong khoảng ~đồng nhất, làm mờ timing-oracle. GIẢM THIỂU, KHÔNG constant-time tuyệt đối: nếu công
   * việc trước đó vượt sàn thì chênh lệch lộ lại ⇒ phải ĐO, đừng chỉ tin lập luận.
   *
   * Hai người dùng, hai oracle khác nhau (⟲ S6-SEC-LOGINLOG-2 tổng quát hoá `floorMs`):
   *   • `forgotPassword` (FORGOT_PW_FLOOR_MS) — "email tồn tại?". KMS chậm (vd Vault transit) có thể vượt
   *     sàn → cân nhắc nâng hằng hoặc dời crypto/mail sang outbox-consumer (deferred) khi có.
   *   • nhánh 429 của `login` (BLOCKED_LOGIN_FLOOR_MS) — "slug tenant tồn tại?" (KI-044, xem hằng đó).
   *
   * ⚠️ CHỈ dùng hằng module + setTimeout: KHÔNG tham chiếu field inject (`this.<dep>`), KHÔNG log.
   * `forgot-password-rate-limit.spec.ts` và `auth.service.spec.ts` dựng AuthService bằng
   * `Object.create(prototype)` + gán MỘT PHẦN field — chạm field khác là vỡ hai spec đó.
   */
  private async applyUniformResponseFloor(
    startedAtMs: number,
    floorMs: number = FORGOT_PW_FLOOR_MS,
  ): Promise<void> {
    const target = floorMs + Math.floor(Math.random() * (FORGOT_PW_JITTER_MS + 1));
    const remaining = target - (Date.now() - startedAtMs);
    if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }

  async resetPassword(req: ResetPasswordRequest): Promise<void> {
    const parsed = this.splitScopedToken(req.token);
    if (!parsed) throw new UnauthorizedException("Token không hợp lệ hoặc đã hết hạn.");
    const { companyId, full } = parsed;
    const tokenHash = this.tokens.hashToken(full);

    const target = await this.dbsvc.withTenant(companyId, async (tx) => {
      const [row] = await tx
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);
      if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;

      const newHash = await this.password.hash(req.newPassword);
      // S18-AUTH-RESETCLEARS-1: `.returning()` thay vì một SELECT phụ — bớt một điểm hỏng trên đường
      // tới hạn, và lấy luôn `deletedAt` (xem nhánh chặn ở dưới) từ chính hàng vừa ghi.
      const [updated] = await tx
        .update(users)
        .set({ passwordHash: newHash, updatedAt: new Date(), mustChangePassword: false })
        .where(eq(users.id, row.userId))
        .returning({ email: users.email, deletedAt: users.deletedAt });
      // single-use: đánh dấu đã dùng.
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, row.id));
      // Thu hồi mọi refresh token còn sống của user (đổi mật khẩu = đăng xuất mọi phiên).
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
      await this.revokeAllSessionsForUserTx(tx, companyId, row.userId, "password_reset");
      await this.audit.record(tx, {
        action: "auth.password_reset",
        objectType: "auth",
        actorUserId: row.userId,
        objectId: row.userId,
      });
      // S2-AUTH-BE-8: reset hoàn tất = đổi mật khẩu + thu hồi MỌI phiên → 2 event (dual-write cùng tx).
      await this.securityEvents.record(tx, {
        eventType: "PASSWORD_RESET_COMPLETED",
        userId: row.userId,
        actorUserId: row.userId,
      });
      await this.securityEvents.record(tx, {
        eventType: "ALL_SESSIONS_REVOKED",
        userId: row.userId,
        actorUserId: row.userId,
        payload: { reason: "password_reset" },
      });
      // S18-AUTH-RESETCLEARS-1 — slug đọc SAU mọi lệnh ghi, KHÔNG bọc try/catch: một statement lỗi đã
      // abort tx (PG 25P02) nên "bắt rồi đi tiếp" chỉ đổi một lỗi rõ thành 500 mù. "Không có hàng
      // công ty" là ca 0 HÀNG, và ca đó chỉ làm mất bước gỡ khoá — KHÔNG được làm hỏng reset.
      const companyRow = await tx.execute(
        sql`SELECT slug FROM companies WHERE id = ${companyId} AND deleted_at IS NULL LIMIT 1`,
      );
      const slug = (companyRow.rows[0] as { slug: string } | undefined)?.slug ?? null;
      return {
        userId: row.userId,
        email: updated?.email ?? null,
        deletedAt: updated?.deletedAt ?? null,
        slug,
      };
    });

    if (!target) throw new UnauthorizedException("Token không hợp lệ hoặc đã hết hạn.");

    await this.clearLoginLocksAfterReset(companyId, target);
  }

  /**
   * S18-AUTH-RESETCLEARS-1 — gỡ khoá đăng nhập 429 SAU KHI đặt lại mật khẩu thành công.
   *
   * NGOÀI tx, SAU commit, và **không bao giờ ném**. Ba ràng buộc, mỗi cái có lý do riêng:
   *
   * • **Ngoài tx** — Valkey không transactional; rollback DB không hoàn tác được `DEL`. Gỡ trong tx rồi
   *   tx hỏng = khoá đã mất mà mật khẩu chưa đổi.
   * • **Không ném** — tới đây thì mật khẩu ĐÃ đổi và token đã `used_at` (single-use). Một 5xx làm người
   *   dùng tưởng thất bại và bấm lại, mà lần hai chắc chắn "Token không hợp lệ" ⇒ ta biến một thao tác
   *   THÀNH CÔNG thành ngõ cụt. Cửa thoát khi gỡ hỏng vẫn còn: nút admin (503 thật) + TTL tự hết.
   * • **`includeForgot: false`** — trần `rl:forgot:*` gác một endpoint CÔNG KHAI không cần xác thực.
   *   Xoá nó ở đây nghĩa là ai cầm một token reset hợp lệ của chính hòm thư mình sẽ tự cấp lại hạn
   *   mức forgot vô hạn lần (quyết định đã ký ở docblock `forgotPasswordImpl`).
   *
   * KHÔNG truyền `subject` ⇒ bucket `2fa` bước-2 KHÔNG bị gỡ. Đặt lại mật khẩu không chứng minh quyền
   * kiểm soát yếu tố thứ hai — đó chính là lý do 2FA tồn tại; `rl:2fa` là control DUY NHẤT chặn dò TOTP.
   *
   * ⚠️ User đã XOÁ MỀM thì DỪNG. Unique email là PARTIAL (`WHERE deleted_at IS NULL`) nên email của họ
   * có thể đã được cấp lại cho NGƯỜI KHÁC, mà khoá rate-limit dựng theo `(slug,email)` chứ không theo
   * `userId` ⇒ gỡ ở đây là gỡ khoá của người đang dùng email đó.
   */
  private async clearLoginLocksAfterReset(
    companyId: string,
    target: { userId: string; email: string | null; deletedAt: Date | null; slug: string | null },
  ): Promise<void> {
    const { userId, email, deletedAt, slug } = target;
    // Ba nhánh dừng KHÁC HẲN nhau về mức bất thường — gộp chung một `if` sẽ che nhau khi đọc log:
    //  • `deletedAt` — ca NGHIỆP VỤ bình thường (xem docblock trên), im lặng là đúng.
    //  • `!slug` — BẤT THƯỜNG HỆ THỐNG: token được cấp cho `companyId` này thì hàng công ty phải tồn
    //    tại. Null nghĩa là công ty vừa bị xoá mềm giữa lúc cấp token và lúc reset, hoặc lệch dữ liệu.
    //  • `!email` — gần như bất khả (UPDATE chạy trong cùng tx trên đúng `row.userId` vừa đọc được),
    //    nhưng nếu xảy ra thì cũng là lệch dữ liệu, không phải nghiệp vụ.
    if (deletedAt) return;
    if (!slug || !email) {
      this.logger.warn(
        `resetPassword: KHÔNG gỡ được khoá đăng nhập vì thiếu dữ kiện dựng khoá ` +
          `(company=${companyId} user=${userId} slug=${slug ? "có" : "THIẾU"} ` +
          `email=${email ? "có" : "THIẾU"}) — mật khẩu ĐÃ đổi, người dùng có thể vẫn bị 429`,
      );
      return;
    }
    try {
      const result = await this.rateLimiter.clearLoginLocks(slug, email, undefined, {
        includeForgot: false,
      });
      if (result.degraded) {
        // Log Ở ĐÂY, không chỉ trong `recordFailedLockClear`: nhánh này KHÔNG ném, nên nếu chỉ ghi vào
        // audit thì kênh quan sát chính (log/APM) im lặng đúng lúc hệ thống bất thường nhất — mật khẩu
        // đã đổi mà khoá thì không kết luận được đã gỡ hay chưa.
        this.logger.error(
          `resetPassword: gỡ khoá đăng nhập KHÔNG kết luận được (degraded) cho user ${userId} — ` +
            `mật khẩu ĐÃ đổi nhưng người dùng có thể vẫn bị 429`,
        );
        await this.recordFailedLockClear(companyId, userId, userId, email);
      }
    } catch (err) {
      // Hợp đồng của ValkeyService là "never throws", nên tới được đây nghĩa là BUG (namespace khoá sai
      // ⇒ ValkeyKeyScopeError, hoặc field DI vắng). Phải KÊU chứ không nuốt — ERROR, không warn.
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      this.logger.error(
        "resetPassword: gỡ khoá đăng nhập thất bại (mật khẩu ĐÃ đổi — người dùng có thể vẫn bị 429)",
        redactEmailFromDetail(detail, email),
      );
      await this.recordFailedLockClear(companyId, userId, userId, email);
    }
  }

  /**
   * S18-AUTH-RESETCLEARS-1 — ghi vết CHỈ khi gỡ khoá THẤT BẠI.
   *
   * Ca thành công KHÔNG ghi hàng nào: hàng audit của chính thao tác reset đã đủ, và bồi `USER_UNLOCKED`
   * cho tài khoản chưa từng bị khoá là món nợ WO-1 đã ghi. Ca THẤT BẠI thì ngược lại — hàng
   * `auth.password_reset` / `user.password_reset_by_admin` khi đó hàm ý "vào lại được ngay" trong khi
   * khoá còn sống, tức suy luận từ hàng đã có bị GÃY. Đó là chỗ duy nhất cần vết riêng.
   *
   * Bọc try/catch: đây là tx THỨ HAI sau commit — nó hỏng thì thao tác chính vẫn đúng, không được kéo
   * theo. `email` KHÔNG vào payload (khoá `rl:*` nhúng email; `objectId` đã định danh đủ).
   */
  private async recordFailedLockClear(
    companyId: string,
    actorUserId: string,
    targetUserId: string,
    email: string,
  ): Promise<void> {
    try {
      await this.dbsvc.withTenant(companyId, async (tx) => {
        await this.audit.record(tx, {
          action: "user.login_throttle_cleared",
          objectType: "user",
          actorUserId,
          objectId: targetUserId,
          after: { ok: false, reason: "password_reset" },
        });
        await this.securityEvents.record(tx, {
          eventType: "USER_UNLOCKED",
          userId: targetUserId,
          actorUserId,
          payload: { reason: "password_reset", ok: false },
        });
      });
    } catch (err) {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      this.logger.error(
        "resetPassword: ghi vết 'gỡ khoá thất bại' KHÔNG thành công — mất dấu forensics",
        redactEmailFromDetail(detail, email),
      );
    }
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
  async decryptResetToken(
    companyId: string,
    resetTokenEnc: unknown,
    userId: string,
  ): Promise<string> {
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
   * chéo tenant). Join y hệt requiresTwoFactorTx (userRoles ⋈ roles, lọc deleted_at CẢ assignment + role +
   * expires_at) nhưng khoá theo id role platform-admin cố định. S2-AUTH-DB-3 (round-2 #6): gỡ assignment
   * platform-admin = soft-delete (userRoles.deleted_at, mig 0471) ⇒ login SAU KHÔNG mint token operator.
   * Chạy TRONG tx login (cùng 1 transaction, không round-trip thừa).
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
          isNull(userRoles.deletedAt),
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
   *
   * S2-AUTH-BE-7: dual-write `user_sessions` CÙNG tx (BE-1 deferred, hoàn tất ở đây) — mỗi lần cấp token
   * MỚI (login/2fa/refresh-rotation) = 1 hàng session mới (refresh_token_hash UNIQUE khớp refreshTokens
   * đang xoay). `accessTokenJti` = id hàng session (gen TRƯỚC insert để nhúng vào access token claim `jti`
   * — currentSessionId lấy TỪ claim này, KHÔNG suy đoán theo thiết bị/IP, CHỐT 2026-07-02). meta (ip/
   * userAgent) optional — refresh() default {} nên vẫn ghi hàng session (ip/userAgent null khi thiếu).
   */
  private async issueTokens(
    tx: TenantTx,
    companyId: string,
    userId: string,
    email: string,
    familyId?: string,
    meta: RequestMeta = {},
  ): Promise<{ tokens: AuthTokens; newTokenId: string }> {
    // AC-0b: operator (platform-admin) ⇒ aud='operator' + TTL ngắn; còn lại ⇒ aud='tenant' + TTL thường.
    const isOperator = await this.isOperatorTx(tx, userId);
    const aud = isOperator ? ("operator" as const) : ("tenant" as const);
    const expiresIn = isOperator ? this.tokens.operatorAccessTtlSec : this.tokens.accessTtlSec;
    const plain = this.tokens.generateOpaqueToken();
    const scoped = this.scopeToken(companyId, plain);
    const tokenHash = this.tokens.hashToken(scoped);
    const expiresAt = new Date(Date.now() + this.tokens.refreshTtlSec * 1000);

    // sessionId sinh TRƯỚC insert (uuid app-side) để dùng làm PK user_sessions VÀ jti access-token trong
    // CÙNG 1 lần ký (tránh round-trip 2 bước). randomUUID native — KHÔNG phải secret, chỉ định danh.
    const sessionId = randomUUID();
    const accessToken = this.tokens.signAccessToken({
      sub: userId,
      companyId,
      email,
      aud,
      jti: sessionId,
    });

    const [inserted] = await tx
      .insert(refreshTokens)
      // familyId undefined → bỏ qua khỏi INSERT ⇒ DB DEFAULT (họ mới). Có giá trị → kế thừa (rotation).
      .values({
        userId,
        tokenHash,
        expiresAt,
        ...(familyId ? { familyId } : {}),
      })
      .returning({ id: refreshTokens.id });

    await tx.insert(userSessions).values({
      id: sessionId,
      userId,
      refreshTokenHash: tokenHash,
      accessTokenJti: sessionId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      expiredAt: expiresAt,
      lastUsedAt: new Date(),
    });

    return {
      tokens: {
        accessToken,
        refreshToken: scoped,
        expiresIn,
      },
      newTokenId: inserted.id,
    };
  }

  /**
   * S2-AUTH-BE-7: thu hồi TOÀN BỘ hàng `user_sessions` còn sống của 1 user — mirror các nhánh bulk-revoke
   * `refreshTokens` sẵn có (đổi/reset mật khẩu, reuse-detection, suspended, logout). `user_sessions` KHÔNG
   * có cột family_id (khác refreshTokens) nên thu hồi theo userId (khớp phạm vi "đăng xuất MỌI phiên" —
   * rộng hơn 1 family nhưng ĐÚNG Ý các nhánh này, KHÔNG hẹp hơn = fail-closed).
   */
  /**
   * Thu hồi mọi `user_sessions` còn sống + CẮT mọi phiên WS đang mở.
   *
   * ⚠️ ĐIỂM CHỐT DUY NHẤT của việc cắt socket — cả 7 đường thu hồi (đổi mật khẩu · reuse-detected ·
   * suspended · company-inactive · logout · password-reset · và `revokeAllForUserTx` cho lock/suspend)
   * đều đi qua đây. CẤM rải `severUserSessions` ra từng call-site: bất biến kiểu này phải chốt ở method
   * dùng chung, nếu không đường thu hồi thứ 8 thêm sau sẽ lặng lẽ bỏ sót (bài học đã trả giá ở
   * `S5-TASK-SUBTASK-1` — bất biến phải kèm DANH SÁCH WRITER và chốt ở một chỗ).
   *
   * Vì sao cần cắt socket chứ không chỉ revoke ở DB: access token là STATELESS và cổng quyền WS chỉ
   * chạy lúc handshake ⇒ socket đang mở KHÔNG bao giờ tự biết phiên đã bị thu hồi (xem jsdoc
   * `RealtimeEmitterService.severUserSessions`).
   */
  private async revokeAllSessionsForUserTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    await tx
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
    this.realtime?.severUserSessions(companyId, userId);
  }

  /**
   * S2-AUTH-BE-9 (PUBLIC helper cho lock/suspend) — thu hồi MỌI phiên còn sống của 1 user TRONG tx caller:
   *   (a) refresh_tokens (mọi họ) → revoked_at set (TÁI DÙNG pattern bulk-revoke theo userId sẵn có), và
   *   (b) user_sessions còn sống → revoked_at set qua revokeAllSessionsForUserTx (KHÔNG nhân bản match).
   * Trả `revoked_session_count` = số user_sessions active ĐẾM TRƯỚC khi thu hồi (cùng tx, không có ghi
   * đồng thời trên phiên của user này ⇒ = đúng số phiên bị thu hồi). Gọi TRONG cùng withTenant(companyId)
   * tx của caller ⇒ RLS lọc company_id (BẤT BIẾN #1) + cùng commit/rollback với đổi status. Chỉ UPDATE
   * revoked_at — KHÔNG hard-delete (BẤT BIẾN #2 mirror). Sau khi thu hồi, refresh token cũ trình lại
   * /auth/refresh → 401 NGAY (đã revoked).
   *
   * OUT-OF-SCOPE: access token STATELESS đã cấp còn hiệu lực tối đa ACCESS_TOKEN_TTL_SEC (~900s / ≤15');
   * chặn tức thì hoàn toàn cần denylist theo `jti` (Valkey) — DEFER sang follow-up WO, KHÔNG làm ở đây.
   */
  async revokeAllForUserTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    reason: string,
  ): Promise<number> {
    const [counted] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userSessions)
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    await this.revokeAllSessionsForUserTx(tx, companyId, userId, reason);
    return counted?.count ?? 0;
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
      // S2-AUTH-BE-1: login thành công cũng reset failed_login_count về 0 (chuỗi sai bị xoá). UPDATE toàn-bảng
      // mediaos_app đã có (mig 0002) → set nhiều cột OK. Vẫn best-effort (caller .catch) — KHÔNG block login.
      await tx
        .update(users)
        .set({ lastLoginAt: new Date(), failedLoginCount: 0 })
        .where(eq(users.id, userId));
    });
  }

  /**
   * S2-AUTH-BE-1 — ghi login_logs (success/failed/blocked + failure_reason). BEST-EFFORT-NHƯNG-QUAN-SÁT:
   * lỗi ghi log KHÔNG ném (KHÔNG đổi outcome HTTP — chống biến lỗi-log thành status oracle) NHƯNG cũng KHÔNG
   * nuốt câm (logger.error). normalized_email NOT NULL & KHÔNG generated → tính lower(email) ở app. Append-only
   * (grant chỉ SELECT,INSERT). company_id: có tenant → withTenant + company_id (WITH CHECK = current_setting);
   * pre-auth (companyId null) → module `db` KHÔNG GUC → company_id NULL (WITH CHECK nhánh NULL, mig 0443).
   * KHÔNG bao giờ ghi password/token (BẤT BIẾN #3).
   */
  /**
   * S10-SEC-LOGINLOG429-1 (KI-047) — ghi `REAUTH_FAILED` cho một lượt xác thực lại THẤT BẠI trên
   * đường POST-AUTH self-service (`disableTwoFactor` · `changePassword`).
   *
   * ĐÂY là đường DỰNG NÊN cái khoá, và trước WO này nó ghi 0 hàng: chuỗi thử dựng nên khoá tạm hoàn
   * toàn vô hình với cả chủ tài khoản lẫn admin, còn 429 chỉ xuất hiện SAU khi khoá đã dựng xong.
   *
   * ⚠️ VÁ Ở NHÁNH SAI, KHÔNG Ở NHÁNH ĐÃ-KHOÁ. Hai đường này post-auth, bucket theo `(companyId|userId)`
   * lấy từ JWT ⇒ lời gọi lặp là MIỄN PHÍ (chỉ cần access token). Ghi ở nhánh đã-khoá cho kẻ bồi quyền
   * đẩy vô hạn hàng vào bảng append-only — đúng cái `step-up.service.ts` đã phải vá bằng A09. Ở nhánh
   * SAI thì trần là `LOGIN_MAX_ATTEMPTS` hàng/cửa sổ, và `N` lần đó đã đủ để suy ra cái khoá.
   *
   * ⚠️ TX RIÊNG, KHÔNG ghi trong tx nghiệp vụ. `SecurityEventWriter.record` NÉM khi `event_type` sai,
   * và lỗi trong tx sẽ rollback rồi nổi lên thành **500** — nhánh này PHẢI trả 401. Biến nhật ký thành
   * đường ném là biến mất-tầm-nhìn thành mất-đăng-nhập. Tiền lệ cùng cây: `StepUpService.writeOutcome`.
   * Không có thay đổi nghiệp vụ nào để rollback cùng ⇒ không có orphan.
   */
  private async recordReauthFailure(
    companyId: string,
    userId: string,
    context: "2fa_disable" | "change_password",
  ): Promise<void> {
    try {
      await this.dbsvc.withTenant(companyId, async (tx) => {
        await this.securityEvents.record(tx, {
          eventType: "REAUTH_FAILED",
          userId,
          actorUserId: userId,
          // CHỈ ngữ cảnh — KHÔNG mật khẩu, KHÔNG mã (BẤT BIẾN #3): không truyền vào thì không có gì để lộ.
          payload: { context },
        });
      });
    } catch (err) {
      this.logger.error(
        `recordReauthFailure thất bại (best-effort, KHÔNG đổi outcome 401): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * S10-SEC-LOGINLOG429-1 (KI-047) — ghi `login_logs` cho một lượt mà ta ĐÃ BIẾT tenant + user nhưng
   * CHƯA có email (ba nhánh từ chối của bước-2 2FA: `claims` đã verify nên có `companyId`+`sub`,
   * nhưng chưa đọc hàng `users` lần nào).
   *
   * ⚠️ VÌ SAO LÀ METHOD RIÊNG chứ không nới `args.email` của `recordLoginAttempt` thành
   * `string | { fromUserId }`. Union trên chữ ký phẳng cho phép tổ hợp thứ tư
   * `{ companyId: null, email: { fromUserId } }`; khi đó một object rơi vào cột `text` NOT NULL ⇒
   * INSERT ném ⇒ **bị nuốt bởi `catch` best-effort** bên dưới ⇒ mất log trong IM LẶNG. Đó đúng là
   * lớp KI-035 mà chính docblock của nhánh pre-auth đã trả giá một lần. Ở đây `companyId`/`userId`
   * là NOT NULL **trong KIỂU** ⇒ tổ hợp sai không biểu diễn được, không cần ai nhớ kỷ luật.
   *
   * MỘT TX CHO MỘT HÀNG: SELECT email và INSERT nằm trong CÙNG `withTenant`. (Không mở tx đọc riêng
   * rồi gọi `recordLoginAttempt` — thế là 2 tx cho 1 dòng nhật ký, trên đúng đường đang muốn giữ rẻ.)
   *
   * BẤT BIẾN giữ nguyên: BEST-EFFORT (không ném, không đổi outcome HTTP); user không còn (vừa bị
   * xoá) ⇒ bỏ ghi + `logger.error`, KHÔNG bịa email; ⛔ KHÔNG `.returning()`.
   */
  private async recordLoginAttemptForUser(args: {
    companyId: string;
    userId: string;
    status: "success" | "failed" | "blocked";
    reason?: string;
    meta: RequestMeta;
  }): Promise<void> {
    try {
      await this.dbsvc.withTenant(args.companyId, async (tx) => {
        const [user] = await tx
          .select({ email: users.email })
          .from(users)
          .where(eq(users.id, args.userId))
          .limit(1);
        if (!user) {
          this.logger.error(
            `recordLoginAttemptForUser: bỏ ghi login_logs (status=${args.status}, reason=${args.reason ?? "-"}) ` +
              `vì không đọc được email của user ${args.userId} — mất dấu vết lần thử này`,
          );
          return;
        }
        await tx.insert(loginLogs).values({
          companyId: args.companyId,
          ...this.buildLoginLogRow({
            userId: args.userId,
            email: user.email,
            status: args.status,
            reason: args.reason,
            meta: args.meta,
          }),
        });
      });
    } catch (err) {
      this.logger.error(
        `recordLoginAttemptForUser thất bại (best-effort, KHÔNG đổi outcome): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Hình dạng hàng `login_logs` — MỘT nguồn sự thật dùng chung cho cả hai đường ghi. */
  private buildLoginLogRow(args: {
    userId: string | null;
    email: string;
    status: "success" | "failed" | "blocked";
    reason?: string;
    meta: RequestMeta;
  }) {
    return {
      userId: args.userId ?? undefined,
      email: args.email,
      // normalized_email NOT NULL & KHÔNG generated → tính lower(email) ở app.
      normalizedEmail: args.email.toLowerCase(),
      loginStatus: args.status,
      failureReason: args.reason,
      ipAddress: args.meta.ip,
      userAgent: args.meta.userAgent,
    };
  }

  private async recordLoginAttempt(args: {
    companyId: string | null;
    userId: string | null;
    email: string;
    status: "success" | "failed" | "blocked";
    reason?: string;
    meta: RequestMeta;
  }): Promise<void> {
    const row = this.buildLoginLogRow({
      userId: args.userId,
      email: args.email,
      status: args.status,
      reason: args.reason,
      meta: args.meta,
    });
    try {
      if (args.companyId) {
        const companyId = args.companyId;
        await this.dbsvc.withTenant(companyId, async (tx) => {
          await tx.insert(loginLogs).values({ companyId, ...row });
        });
      } else {
        // PRE-AUTH: KHÔNG ngữ cảnh tenant → module db (không set GUC) → company_id NULL.
        // S6-SEC-1 · KI-035: trước đây là `if (!db) return;` — bỏ ghi HOÀN TOÀN IM LẶNG, không một dòng
        // log nào. Nhánh này chỉ chạy cho login THẤT BẠI pre-auth mà KHÔNG resolve được tenant — hai
        // đường login THÀNH CÔNG đều có companyId thật nên đi nhánh withTenant ở trên. Vì vậy đây KHÔNG
        // phải "cấp token mà không có log"; nó là mất dấu vết forensics của các lần dò tenant. Vẫn
        // không được im lặng: mất log bảo mật phải nhìn thấy được.
        // ⟲ S6-SEC-LOGINLOG-2 · KI-044 — thu hẹp: hàng bị chặn (`TooManyAttempts`) với slug HỢP LỆ
        // KHÔNG còn rơi vào nhánh này nữa (đã resolve được chủ ⇒ đi withTenant). Nhánh NULL giờ chỉ còn
        // cho: slug sai/inactive, và nhánh fail-soft khi chính lượt resolve đó lỗi.
        if (!db) {
          this.logger.warn(
            `recordLoginAttempt: bỏ ghi login_logs pre-auth (status=${args.status}) vì module db chưa sẵn sàng — mất dấu vết lần thử này`,
          );
          return;
        }
        // ⚠️ S6-SEC-LOGINLOG-1 (mig 0532) — TUYỆT ĐỐI KHÔNG thêm `.returning()` vào câu này.
        // Sau khi vế USING của policy `tenant_isolation` hết cho `company_id IS NULL`, Postgres áp
        // policy SELECT lên mệnh đề RETURNING ⇒ INSERT ... RETURNING cho hàng NULL sẽ ném
        // "new row violates row-level security policy", và lỗi đó bị nuốt vào nhánh catch best-effort
        // bên dưới (chỉ còn một dòng logger.error) ⇒ MẤT TOÀN BỘ log pre-auth trong im lặng.
        // INSERT không RETURNING thì không đụng policy SELECT — đã đo trên DB thật.
        // Ghim bởi test: login-logs-rls.int-spec (c) + (c2).
        await db.insert(loginLogs).values({ companyId: null, ...row });
      }
    } catch (err) {
      this.logger.error(
        `recordLoginAttempt thất bại (best-effort, KHÔNG đổi outcome): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * S2-AUTH-BE-1 — tăng users.failed_login_count (sai mật khẩu). BEST-EFFORT (KHÔNG block 401). Khoá tài khoản
   * theo ngưỡng (locked_at) là WO RIÊNG — đây chỉ đếm. UPDATE toàn-bảng mediaos_app (mig 0002).
   */
  private async bumpFailedLoginCount(companyId: string, userId: string): Promise<void> {
    try {
      await this.dbsvc.withTenant(companyId, async (tx) => {
        await tx
          .update(users)
          .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
          .where(eq(users.id, userId));
      });
    } catch (err) {
      this.logger.warn(
        `bumpFailedLoginCount thất bại (best-effort): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * S4-INT-5 (STORY-098 / crown-AUTH) — producer thông báo "tài khoản bị khoá tạm" (NOTI-EVENT AUTH_USER_LOCKED,
   * SPEC-08 §15). CHỈ gọi ở edge sạch (lần sai vừa đẩy bucket per-account qua ngưỡng — xem login()).
   *
   * tx RIÊNG (mirror bumpFailedLoginCount) — enqueue outbox + audit + security-event CÙNG commit/rollback (không
   * ghi nửa vời). BẤT BIẾN #1: withTenant(companyId) → RLS+FORCE cô lập tenant, company_id từ DB DEFAULT.
   *
   * Outbox payload CHỈ mang { eventCode, userId } — TUYỆT ĐỐI KHÔNG IP/attempts/chi tiết bảo mật: payload durable
   * = data-at-rest và là NGUỒN DUY NHẤT của nội dung notification (bridge resolve recipient = payload.userId).
   * KHÔNG set actorUserId ở event/mapping ⇒ actor-exclusion ở bridge KHÔNG loại chủ TK (nếu actor=owner ⇒ 0
   * notification). audit/security-event là forensic server-side (append-only, BẤT BIẾN #2) — được phép mang
   * ip/userAgent để điều tra; hành động do HỆ THỐNG kích hoạt (sai mật khẩu lặp) nên actorUserId = null (System).
   *
   * SILENT-FAILURE: lỗi tx → logger.error (KHÔNG nuốt câm) NHƯNG KHÔNG re-throw — notify là COURTESY, KHÔNG phải
   * security-control; đường login PHẢI trả 401 ĐỒNG NHẤT bất kể notify thành/bại (không biến lỗi-notify thành
   * oracle / không chặn phản hồi login).
   */
  private async emitAccountLocked(
    companyId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
    try {
      await this.dbsvc.withTenant(companyId, async (tx) => {
        // Outbox → bridge (auth.user_locked → AUTH_USER_LOCKED). Payload TỐI THIỂU: eventCode (bridge map) +
        // userId (recipient). KHÔNG IP/attempts (data-at-rest tối thiểu + không lộ chi tiết bảo mật ra notify).
        await this.outbox.enqueue(tx, {
          eventType: "auth.user_locked",
          payload: { eventCode: "AUTH_USER_LOCKED", userId },
        });
        // audit append-only (DoD §8). objectId = chủ TK. actorUserId KHÔNG set (khoá do hệ thống kích hoạt).
        // after CHỈ mang reason định danh — KHÔNG IP-attacker/attempts (không lộ chi tiết bảo mật).
        await this.audit.record(tx, {
          action: "auth.user_locked",
          objectType: "auth",
          objectId: userId,
          ip: meta.ip,
          userAgent: meta.userAgent,
          after: { reason: "too_many_failed_logins" },
        });
        // timeline security (dual-write cạnh audit). USER_LOCKED = mã CANONICAL trong contracts (severity
        // "high") cho "khoá tài khoản" — KHÔNG có mã ACCOUNT_LOCKED (writer fail-closed sẽ throw). subject =
        // chủ TK; actorUserId null = hệ thống. payload rỗng (KHÔNG attempts/IP trong nội dung sự kiện).
        await this.securityEvents.record(tx, {
          eventType: "USER_LOCKED",
          userId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      });
    } catch (err) {
      // KHÔNG nuốt câm (silent-failure): log ERROR đầy đủ để quan sát. NHƯNG KHÔNG re-throw — login PHẢI trả
      // 401 ĐỒNG NHẤT bất kể notify thành/bại (courtesy, không phải security-control).
      this.logger.error(
        `emitAccountLocked: phát thông báo khoá tài khoản thất bại (best-effort, KHÔNG đổi 401): ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    }
  }
}
