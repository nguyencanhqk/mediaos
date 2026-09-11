import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomInt } from "node:crypto";
import { eq, sql, type SQL } from "drizzle-orm";
import type {
  AuthUserDetailDto,
  AuthUserLoginThrottleDto,
  AuthUserDto,
  AuthUserListDto,
  AuthUserPasswordResetResultDto,
  AuthUserTwoFactorResetDto,
  CreateAuthUserRequest,
  DataScope,
  ListAuthUsersQuery,
  UpdateAuthUserRequest,
} from "@mediaos/contracts";
import { AUTH_USER } from "@mediaos/contracts";
import { isUniqueViolation } from "../common/db-error";
import { DatabaseService } from "../db/db.service";
import { users, type User } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { AuthService, redactEmailFromDetail, type RequestMeta } from "../auth/auth.service";
import { PasswordService } from "../auth/password.service";
import { LoginRateLimiter } from "../auth/login-rate-limiter";
import { rlKey, type RlBucket } from "../common/valkey/valkey-key";

/**
 * S18-AUTH-490DEBT-1 (D3b) — hai bucket rate-limit gác ĐƯỜNG THIẾT LẬP 2FA; cả hai phải được gỡ khi
 * khôi phục tài khoản. Đây là một CẶP, không phải hai thứ rời: sau A2 (`require_two_factor=true`),
 * `TwoFactorEnforcementGuard` chỉ tha khi `isEnabled`, mà muốn `isEnabled` thì phải đi HẾT
 * `enroll` → `confirmEnable`. Khoá một trong hai là nhốt nạn nhân khỏi MỌI route.
 * Cố ý KHÔNG gồm `2fa-disable`/`change-pw`: chúng không nằm trên đường thoát khỏi guard.
 */
const TWO_FACTOR_SETUP_BUCKETS: readonly RlBucket[] = ["2fa-enroll", "2fa-enable"];
import { SecurityEventWriter } from "../auth/security-event-writer.service";
import { PermissionService } from "../permission/permission.service";
import { LmsSyncProducer } from "../integrations/lms/lms-sync-producer.service";
import { AuthUsersRepository, authUserSnapshot } from "./auth-users.repository";

/** Actor = admin đang thao tác (id/companyId từ JWT — KHÔNG nhận từ body — BẤT BIẾN #1). */
export interface AuthUserActor {
  id: string;
  companyId: string;
}

/** Map row → DTO view. KHÔNG passwordHash/normalizedEmail (mask ở SERVER — BẤT BIẾN #3). */
function toDto(row: User): AuthUserDto {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    status: row.status as AuthUserDto["status"],
    lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
    lockedReason: row.lockedReason ?? null,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

const USER_NOT_FOUND = "Không tìm thấy người dùng.";
const CANNOT_TARGET_SELF = "Không thể khoá/mở khoá chính tài khoản của bạn.";
const CANNOT_DELETE_SELF = "Không thể xóa chính tài khoản của bạn.";
const CANNOT_RESET_SELF = "Dùng chức năng đổi mật khẩu cho tài khoản của chính bạn.";
const EMAIL_TAKEN = "Email đã tồn tại trong công ty.";
const EMAIL_TAKEN_RESTORE = "Không thể khôi phục: đã có tài khoản đang dùng email này.";
const ALREADY_LOCKED = "Tài khoản đã bị khoá.";
const NOT_LOCKED = "Tài khoản chưa bị khoá.";

const VIEW_ACTION = "view";
const USER_RESOURCE = "user";

/**
 * S2-AUTH-USEROPS-1 — sinh mật khẩu tạm 16 ký tự CHẮC CHẮN đạt policy newPasswordSchema (≥1 thường +
 * ≥1 hoa + ≥1 số) bằng crypto randomInt (KHÔNG Math.random). Bỏ ký tự dễ nhầm (i/l/o/I/L/O/0/1).
 * Plaintext CHỈ tồn tại trong RAM → hash → response 1 lần; KHÔNG log/audit (BẤT BIẾN #3).
 */
const TEMP_PASSWORD_LENGTH = 16;
const TEMP_LOWER = "abcdefghjkmnpqrstuvwxyz";
const TEMP_UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const TEMP_DIGITS = "23456789";
const TEMP_ALL = TEMP_LOWER + TEMP_UPPER + TEMP_DIGITS;

function generateTempPassword(): string {
  const pick = (alphabet: string) => alphabet[randomInt(alphabet.length)];
  const chars = [pick(TEMP_LOWER), pick(TEMP_UPPER), pick(TEMP_DIGITS)];
  while (chars.length < TEMP_PASSWORD_LENGTH) chars.push(pick(TEMP_ALL));
  // Fisher–Yates (crypto randomInt) — trộn để 3 ký tự bắt buộc không luôn đứng đầu.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/**
 * S2-AUTH-BE-3 AuthUsersService — user admin (list/get/create/update/lock/unlock). MỌI thao tác qua
 * db.withTenant(companyId) + repo WHERE company_id (BẤT BIẾN #1). Audit ghi TRONG cùng tx (append-only,
 * cùng commit/rollback — BẤT BIẾN #2). create hash mật khẩu (argon2, BẤT BIẾN #3). lock/unlock self-guard
 * chống lockout. Cross-tenant / không tồn tại → NotFound (RLS che, KHÔNG lộ tồn tại — no-op, 0 audit rác).
 *
 * data-scope-aware (BACKEND-03 §18): list resolve strongest scope (view:user) rồi BOUND rows theo scope
 * trên BẢNG users (Company/System=tenant, Own=self) — fail-closed sql`false` khi scope null hoặc scope
 * cần org-mapping (Team/Department) chưa hỗ trợ cho users (§13 chỉ cấp Company cho view:user).
 */
@Injectable()
export class AuthUsersService {
  private readonly logger = new Logger(AuthUsersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AuthUsersRepository,
    private readonly audit: AuditService,
    private readonly password: PasswordService,
    private readonly permissions: PermissionService,
    // S2-AUTH-BE-9: lock = thu hồi MỌI phiên qua AuthService.revokeAllForUserTx. Cùng cách inject
    // PasswordService (AuthModule forwardRef + export) — KHÔNG cần forwardRef param (AuthModule KHÔNG
    // import UsersModule ⇒ không có vòng thật).
    private readonly auth: AuthService,
    // S2-AUTH-BE-8: writer timeline user_security_events (dual-write cạnh audit). SecurityEventWriter
    // stateless, chỉ phụ thuộc AuditMaskerService (@Global) → đăng ký LÀM PROVIDER ở UsersModule (tránh
    // import-cycle với AuthModule đã forwardRef). Optional theo convention `resetMail?` của codebase: Nest
    // LUÔN inject (provider đã đăng ký) ⇒ production luôn emit; chỉ vắng khi unit-spec dựng service bằng
    // tay (mock `tx` không có `.insert`) → guard bỏ qua để KHÔNG vỡ test — KHÔNG phải nuốt lỗi.
    private readonly securityEvents?: SecurityEventWriter,
    // S5-LMS-BE-1: auto-sync tài khoản→LMS khi admin khoá/mở user. Optional theo convention securityEvents
    // (Nest LUÔN inject — LmsSyncProducer export từ LmsSyncModule, UsersModule import; chỉ vắng khi unit-spec
    // dựng tay). ZERO HTTP trong tx (fail-soft cấu trúc); company-gated bên trong producer.
    private readonly lmsSync?: LmsSyncProducer,
    // S18-AUTH-UNLOCK429-1 — bộ chặn tần suất đăng nhập (khoá 429), để admin GỠ được từ giao diện.
    //
    // ⚠️ PHẢI đứng CUỐI danh sách, không chèn vào giữa: ba chỗ trong `auth-users.service.spec.ts` dựng
    // service THEO VỊ TRÍ với `as never`, nên một tham số chèn giữa sẽ làm lệch mock đúng một ô mà
    // TypeScript vẫn biên dịch sạch. Optional theo convention `securityEvents`/`lmsSync` (Nest LUÔN
    // inject — provider có trong AuthModule đã import; chỉ vắng khi unit-spec dựng tay) — nhưng KHÔNG
    // đi kèm `?.` no-op ở call-site: xem `requireRateLimiter`.
    private readonly rateLimiter?: LoginRateLimiter,
  ) {}

  /**
   * Fail-fast thay cho `?.`. Với dual-write timeline, `?.` là đúng (mất một hàng phụ trợ). Ở đây thì
   * KHÔNG: no-op nghĩa là admin bấm "Gỡ khoá đăng nhập", nhận 204, audit ghi "đã gỡ" — mà không có khoá
   * nào bị xoá và người dùng vẫn 429. Thà 500 rõ ràng còn hơn một nút bấm giả vờ hoạt động.
   */
  private requireRateLimiter(): LoginRateLimiter {
    if (!this.rateLimiter) {
      throw new Error(
        "AuthUsersService: LoginRateLimiter chưa được inject — đường gỡ khoá đăng nhập (429) sẽ no-op " +
          "trong khi vẫn trả 204 + ghi audit. Kiểm tra AuthModule export / UsersModule imports.",
      );
    }
    return this.rateLimiter;
  }

  /**
   * GET /auth/users — danh sách LIVE + tổng (data-scope-aware). Chỉ đọc (không audit). PermissionGuard
   * đã gate view:user TRƯỚC; ở đây resolve scope MẠNH NHẤT để bound rows (KHÔNG match-all). Scope null
   * (về lý thuyết guard đã chặn) → predicate false (0 rows, fail-closed).
   */
  async listUsers(actor: AuthUserActor, query: ListAuthUsersQuery): Promise<AuthUserListDto> {
    const scope = await this.permissions.resolveStrongestScope(
      actor.id,
      actor.companyId,
      VIEW_ACTION,
      USER_RESOURCE,
    );
    const predicate = this.buildUserScopeCondition(scope, actor);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const { rows, total } = await this.repo.findManyTx(tx, actor.companyId, predicate, {
        status: query.status,
        q: query.q,
        limit: query.limit,
        offset: query.offset,
        // S2-AUTH-USEROPS-1: deleted=true → CHỈ user đã xóa mềm (view Đã xóa / khôi phục).
        deleted: query.deleted === true,
        // Đối soát AUTH↔HR: bound theo có/chưa hồ sơ nhân sự (undefined = tất cả).
        linkedProfile: query.linkedProfile,
      });
      return {
        users: rows.map((row) => ({ ...toDto(row), hasEmployeeProfile: row.hasEmployeeProfile })),
        total,
      };
    });
  }

  /**
   * GET /auth/users/:id — 1 user LIVE + khối 2FA (S2-AUTH-BE-12). Không thấy / cross-tenant (RLS) → NotFound.
   * twoFactor 3 CỜ TÁCH NGUỒN: enabled (user_totp.enabled_at), requiredByRole (join roles-only), requiredByUser
   * (cột 0466 đọc thẳng từ row). KHÔNG lộ secret TOTP (repo SELECT cột tường minh + không kéo user_totp secret).
   */
  async getUserDetail(actor: AuthUserActor, id: string): Promise<AuthUserDetailDto> {
    const scope = await this.permissions.resolveStrongestScope(
      actor.id,
      actor.companyId,
      VIEW_ACTION,
      USER_RESOURCE,
    );
    return this.db.withTenant(actor.companyId, async (tx) => {
      const row = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!row) throw new NotFoundException(USER_NOT_FOUND);
      // data-scope: Own-scope chỉ thấy chính mình; cross-scope target → NotFound (KHÔNG lộ tồn tại).
      if (!this.isInScope(scope, actor, row)) throw new NotFoundException(USER_NOT_FOUND);
      const { enabled, requiredByRole } = await this.repo.getTwoFactorStateTx(tx, id);
      return {
        ...toDto(row),
        twoFactor: { enabled, requiredByRole, requiredByUser: row.requireTwoFactor },
      };
    });
  }

  /**
   * POST /auth/users — tạo user (hash mật khẩu). Email trùng tenant → 409. Audit 'user.created' TRONG tx
   * (snapshot KHÔNG passwordHash — BẤT BIẾN #3). Plaintext CHỈ tới PasswordService.hash, KHÔNG vào audit.
   */
  async createUser(actor: AuthUserActor, dto: CreateAuthUserRequest): Promise<AuthUserDto> {
    const passwordHash = await this.password.hash(dto.password);
    return this.db.withTenant(actor.companyId, async (tx) => {
      if (await this.repo.emailExistsTx(tx, actor.companyId, dto.email)) {
        throw new ConflictException(EMAIL_TAKEN);
      }
      const created = await this.repo.createTx(tx, actor.companyId, {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        createdBy: actor.id,
      });
      await this.audit.record(tx, {
        action: "user.created",
        objectType: "user",
        actorUserId: actor.id,
        objectId: created.id,
        after: authUserSnapshot(created),
      });
      return toDto(created);
    });
  }

  /**
   * PATCH /auth/users/:id — sửa hồ sơ (fullName) + cờ ép 2FA per-user (requireTwoFactor, mig 0466). Không
   * khớp → NotFound, KHÔNG audit rác. S2-AUTH-BE-12 no-op guard: chỉ ghi DB + audit khi có field THỰC SỰ đổi
   * (body rỗng / giá trị == cũ → trả trạng thái hiện tại, 0 audit rác — mẫu lock đã-locked). audit diff cờ.
   */
  async updateUser(
    actor: AuthUserActor,
    id: string,
    dto: UpdateAuthUserRequest,
  ): Promise<AuthUserDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!before) throw new NotFoundException(USER_NOT_FOUND);

      // Lọc field THỰC SỰ thay đổi (so before/after). Object rỗng ⇒ no-op.
      const patch: { fullName?: string; requireTwoFactor?: boolean } = {};
      if (dto.fullName !== undefined && dto.fullName !== before.fullName) {
        patch.fullName = dto.fullName;
      }
      if (dto.requireTwoFactor !== undefined && dto.requireTwoFactor !== before.requireTwoFactor) {
        patch.requireTwoFactor = dto.requireTwoFactor;
      }
      if (Object.keys(patch).length === 0) return toDto(before); // no-op: KHÔNG chạm DB, KHÔNG audit

      const updated = await this.repo.updateProfileTx(tx, actor.companyId, id, patch, actor.id);
      if (!updated) throw new NotFoundException(USER_NOT_FOUND);
      await this.audit.record(tx, {
        action: "user.updated",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: authUserSnapshot(before),
        after: authUserSnapshot(updated),
      });
      return toDto(updated);
    });
  }

  /**
   * POST /auth/users/:id/2fa/reset — admin gỡ 2FA của target (privileged, gate reset-2fa:user is_sensitive).
   * Trong CÙNG withTenant tx: (1) xoá user_totp + user_recovery_codes; (2) TÁI DÙNG AuthService.revokeAllForUserTx
   * thu hồi mọi phiên (refresh cũ → 401); (3) audit 'user.2fa_reset' kèm revoked_session_count (KHÔNG secret);
   * (4) dual-write timeline TOTP_RESET. Self-reset CHO PHÉP (KHÔNG assertNotSelf — owner chốt 2026-07-03).
   * Cross-tenant / không tồn tại → NotFound TRƯỚC mọi mutation (RLS che, no-op, 0 audit + 0 security-event).
   */
  async resetTwoFactor(
    actor: AuthUserActor,
    id: string,
    // S18-AUTH-SECEVENTREST-1 (D1/D2): `meta` là tham số RIÊNG đặt CUỐI, KHÔNG nhét vào
    // `AuthUserActor` — type đó dùng chung 15 method. Bắt buộc (không `= {}`) để "caller quên" là
    // lỗi lúc BIÊN DỊCH, không phải một hàng vết vô danh lúc chạy.
    meta: RequestMeta,
  ): Promise<AuthUserTwoFactorResetDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const target = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!target) throw new NotFoundException(USER_NOT_FOUND);

      await this.repo.deleteTwoFactorTx(tx, actor.companyId, id);
      const revokedSessionCount = await this.auth.revokeAllForUserTx(
        tx,
        actor.companyId,
        id,
        "2fa_reset",
      );
      await this.audit.record(tx, {
        action: "user.2fa_reset",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        after: { revokedSessionCount },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await this.securityEvents?.record(tx, {
        eventType: "TOTP_RESET",
        userId: id,
        actorUserId: actor.id,
        payload: { revokedSessionCount },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { revokedSessionCount };
    });
  }

  /**
   * POST /auth/users/:id/lock — status='locked' (chặn login). Self-guard (chống lockout). Đã 'locked'
   * → 400 (no-op, KHÔNG audit rác). Không thấy / cross-tenant → NotFound TRƯỚC khi audit.
   */
  async lockUser(
    actor: AuthUserActor,
    id: string,
    // S18-AUTH-SECEVENTREST-1 (D2): `reason?:` → `reason: string | undefined`. TS cấm tham số BẮT
    // BUỘC đứng sau tham số optional (TS1016), và đảo thứ tự để `meta` lên trước sẽ phá quy ước
    // «meta luôn CUỐI» của cả 9 method. `dto.reason` vốn đã là `string | undefined` ⇒ 0 đổi kiểu ở
    // controller.
    reason: string | undefined,
    meta: RequestMeta,
  ): Promise<AuthUserDto> {
    this.assertNotSelf(actor, id);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!before) throw new NotFoundException(USER_NOT_FOUND);
      if (before.status === "locked") throw new BadRequestException(ALREADY_LOCKED);
      const updated = await this.repo.setLockTx(tx, actor.companyId, id, actor.id, reason ?? null);
      if (!updated) throw new NotFoundException(USER_NOT_FOUND);
      // S2-AUTH-BE-9: khoá tài khoản = thu hồi MỌI phiên (refresh_tokens + user_sessions) NGAY trong CÙNG
      // tx (cùng commit/rollback với status). Refresh token cũ trình lại → 401 tức thì. count vào audit.
      const revokedSessionCount = await this.auth.revokeAllForUserTx(
        tx,
        actor.companyId,
        id,
        "locked",
      );
      await this.audit.record(tx, {
        action: "user.locked",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: authUserSnapshot(before),
        after: { ...authUserSnapshot(updated), revokedSessionCount },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      // S2-AUTH-BE-8: dual-write timeline bảo mật TRONG cùng tx (rollback ⇒ 0 orphan). subject=target,
      // actor=admin. payload CHỈ reason-code (KHÔNG PII của subject — email/fullName/hash không đưa vào);
      // masker vẫn che phòng thủ theo tên khóa nhạy cảm.
      await this.securityEvents?.record(tx, {
        eventType: "USER_LOCKED",
        userId: id,
        actorUserId: actor.id,
        payload: { reason: reason ?? null },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      // S5-LMS-BE-1: enqueue LMS auto-sync CÙNG tx (SAU setLockTx ⇒ active=false). eventType RIÊNG
      // hr.employee_status_changed — KHÔNG re-emit auth.user_locked (né consumer notification). User không
      // hồ sơ nhân viên / ngoài LMS-company → producer no-op sạch.
      await this.lmsSync?.enqueueSync(tx, actor.companyId, id);
      return toDto(updated);
    });
  }

  /**
   * POST /auth/users/:id/unlock — đòi status hiện='locked' → 'active' + clear lockedAt. Self-guard.
   * Không 'locked' → 400. Không thấy / cross-tenant → NotFound TRƯỚC khi audit.
   */
  async unlockUser(actor: AuthUserActor, id: string, meta: RequestMeta): Promise<AuthUserDto> {
    this.assertNotSelf(actor, id);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!before) throw new NotFoundException(USER_NOT_FOUND);
      if (before.status !== "locked") throw new BadRequestException(NOT_LOCKED);
      const updated = await this.repo.setUnlockTx(tx, actor.companyId, id, actor.id);
      if (!updated) throw new NotFoundException(USER_NOT_FOUND);
      await this.audit.record(tx, {
        action: "user.unlocked",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: authUserSnapshot(before),
        after: authUserSnapshot(updated),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      // S2-AUTH-BE-8: dual-write timeline bảo mật TRONG cùng tx (rollback ⇒ 0 orphan). subject=target,
      // actor=admin. Không có reason cho unlock → payload rỗng (writer default {}), KHÔNG PII.
      await this.securityEvents?.record(tx, {
        eventType: "USER_UNLOCKED",
        userId: id,
        actorUserId: actor.id,
        // payload GIỮ NGUYÊN vắng: đó là thứ phân biệt họ này với hai họ `USER_UNLOCKED` còn lại
        // (`login_throttle` · `password_reset`) khi đọc timeline.
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      // S5-LMS-BE-1: enqueue LMS auto-sync CÙNG tx (SAU setUnlockTx ⇒ active theo ep.status). Mở khoá user
      // → LMS mở lại NẾU nhân viên vẫn active. Ngoài LMS-company / không hồ sơ → no-op.
      await this.lmsSync?.enqueueSync(tx, actor.companyId, id);
      return toDto(updated);
    });
  }

  /**
   * S18-AUTH-UNLOCK429-1 — GET /auth/users/:id/login-throttle: người này có đang bị BỘ CHẶN TẦN SUẤT
   * (429) khoá đăng nhập không, và còn bao lâu.
   *
   * KHÔNG `assertNotSelf`: đọc trạng thái khoá của chính mình là vô hại và đúng thứ admin cần khi tự
   * chẩn đoán. Chặn tự-thao-tác chỉ áp cho đường GHI (`clearLoginThrottle`), mirror `lock`/`unlock`.
   *
   * Chỉ đọc ⇒ KHÔNG audit (đúng luật của `listUsers`/`getUserDetail`). Người gọi đã qua gate
   * `unlock:user`, cặp có scope `Company` ⇒ thấy được mọi user trong tenant — chấp nhận có ý thức,
   * ghi ra đây để review sau không tưởng là sót vị từ scope.
   */
  async getLoginThrottle(actor: AuthUserActor, id: string): Promise<AuthUserLoginThrottleDto> {
    const limiter = this.requireRateLimiter();
    const { slug, email } = await this.resolveThrottleTarget(actor, id);
    const state = await limiter.loginThrottleState(slug, email, {
      companyId: actor.companyId,
      userId: id,
    });
    // KHÔNG trả "không bị khoá" khi thật ra là "không biết": FE chỉ dựng nút gỡ khi thấy khoá, nên một
    // `locked:false` sai sẽ làm CỬA THOÁT biến mất đúng lúc Valkey hỏng — ca duy nhất cần nó nhất.
    if (state.unknown && !state.locked) {
      throw new ServiceUnavailableException(
        "Chưa đọc được trạng thái khoá đăng nhập (bộ nhớ đệm không phản hồi). Vui lòng thử lại.",
      );
    }
    return { locked: state.locked, remainingSec: state.remainingSec, buckets: state.buckets };
  }

  /**
   * S18-AUTH-UNLOCK429-1 — POST /auth/users/:id/login-throttle/clear: GỠ khoá 429 của người này.
   *
   * ⚠️ KHÁC `unlockUser`: đó là khoá TÀI KHOẢN (`users.status='locked'`, do admin đặt). Người bị 429 vẫn
   * `status='active'` nên `unlockUser` còn ném 400 NOT_LOCKED — đây là lý do đường này phải tồn tại
   * riêng, không phải một biến thể của nút cũ.
   *
   * THỨ TỰ có chủ ý — gỡ TRƯỚC, ghi vết SAU:
   *   Valkey không transactional, rollback DB không hoàn tác được `DEL`. Ghi audit trong tx rồi gỡ sau
   *   commit sẽ để lại VẾT NÓI DỐI khi việc gỡ hỏng. Gỡ trước ⇒ hàng audit mô tả KẾT QUẢ ĐO ĐƯỢC
   *   (`before`/`after` đọc thật, `ok`), không phải ý định. Đánh đổi còn lại: nếu bước ghi vết ném thì
   *   khoá đã gỡ mà mất dấu — hẹp hơn hẳn rủi ro ngược lại, và lúc đó cả request đã 500 có log.
   *
   * Ghi vết CẢ KHI không có khoá nào để gỡ: đường DỰNG/GỠ khoá phải để lại dấu (`hadLock` phân biệt hai
   * ca trong payload) — "admin đã thử gỡ" là dữ kiện forensics, không phải nhiễu.
   */
  async clearLoginThrottle(actor: AuthUserActor, id: string, meta: RequestMeta): Promise<void> {
    this.assertNotSelf(actor, id);
    const limiter = this.requireRateLimiter();
    const { slug, email } = await this.resolveThrottleTarget(actor, id);
    const subject = (await this.canClearTwoFactorBucket(actor))
      ? { companyId: actor.companyId, userId: id }
      : undefined;

    const before = await limiter.loginThrottleState(slug, email, subject);
    // Đường admin: ĐÃ xác thực + ĐÃ audit ⇒ xoá cả trần `forgot:*` (khác đường công khai).
    const result = await limiter.clearLoginLocks(slug, email, subject, { includeForgot: true });
    const after = await limiter.loginThrottleState(slug, email, subject);
    // `after.unknown` cũng chặn "ok": một phép đọc không kết luận được thì KHÔNG được coi là bằng chứng
    // đã gỡ xong — đó chính là hình dạng của vết nói dối mà đường này sinh ra để chặn.
    const ok = !result.degraded && !after.locked && !after.unknown;

    await this.db.withTenant(actor.companyId, async (tx) => {
      await this.audit.record(tx, {
        action: "user.login_throttle_cleared",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        // KHÔNG đưa email vào payload: khoá `rl:*` nhúng email, và audit đã định danh đủ bằng objectId.
        before: {
          locked: before.locked,
          buckets: before.buckets,
          remainingSec: before.remainingSec,
        },
        after: {
          locked: after.locked,
          buckets: after.buckets,
          clearedKeys: result.clearedKeys,
          ok,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await this.securityEvents?.record(tx, {
        eventType: "USER_UNLOCKED",
        userId: id,
        actorUserId: actor.id,
        // Phân biệt với unlock TÀI KHOẢN (payload rỗng) khi đọc timeline — hai hành động khác nhau.
        // `ok` phải có mặt: `hadLock` chỉ nói "trước đó có khoá không", KHÔNG nói "gỡ được hay không".
        // Thiếu nó, timeline bảo mật ghi USER_UNLOCKED cho một thao tác 503 không mở được gì.
        payload: { reason: "login_throttle", hadLock: before.locked, ok },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    if (!ok) {
      // Valkey bật nhưng một phép đọc/xoá không kết luận được, HOẶC khoá vẫn còn sau khi gỡ. 204 ở đây
      // là nói dối với người bấm nút — và họ sẽ bảo người dùng "thử lại đi" trong khi vẫn bị chặn.
      throw new ServiceUnavailableException(
        "Chưa gỡ được khoá đăng nhập (bộ nhớ đệm không phản hồi hoặc khoá vẫn còn). Vui lòng thử lại.",
      );
    }
  }

  /**
   * Bộ đôi `(slug, email)` để dựng khoá rate-limit — LẤY TỪ DB, không từ input.
   *
   * `findByIdTx` company-scoped + RLS ⇒ cross-tenant/không tồn tại đều 404 TRƯỚC khi chạm một byte nào
   * của không gian khoá; không có đường nào để một tenant xoá khoá của tenant khác. `slug` đọc trong
   * cùng tenant tx (khuôn `dashboard-company-tz.util.ts`).
   */
  /**
   * Người này có được phép gỡ bucket bước-2 (TOTP) không — gate bằng CẶP NHẠY CẢM `reset-2fa:user`,
   * KHÔNG phải bằng `unlock:user`.
   *
   * Lý do (FULL gate 03/09, HIGH-2): `unlock:user` là `is_sensitive=false` (mig 0450) ⇒ một grant
   * wildcard `*:*` thoả nó. Bucket `rl:2fa:{companyId}|{userId}` là control DUY NHẤT giới hạn dò mã
   * TOTP ở bước-2; nếu gỡ được nó bằng cặp non-sensitive thì người giữ wildcard — vốn bị
   * `POST /:id/2fa/reset` TỪ CHỐI vì cặp đó khai `isSensitive` — lại reset được ngưỡng 5 tuỳ ý và dò
   * 10⁶ mã. Ràng buộc đúng là: ai gỡ được 2FA của người khác thì mới được gỡ khoá dò 2FA của họ.
   *
   * Fail-closed: quyết định `allow=false` (kể cả khi engine lỗi) ⇒ chỉ gỡ khoá mật khẩu, phần còn lại
   * của thao tác vẫn chạy. Người dùng vẫn được cứu khỏi 429 của bucket `ip`/`acct`.
   */
  private async canClearTwoFactorBucket(actor: AuthUserActor): Promise<boolean> {
    const decision = await this.permissions.can({
      userId: actor.id,
      companyId: actor.companyId,
      action: AUTH_USER.RESET_2FA.action,
      resourceType: AUTH_USER.RESET_2FA.resource,
      isSensitive: true,
    });
    return decision.allow;
  }

  private async resolveThrottleTarget(
    actor: AuthUserActor,
    id: string,
  ): Promise<{ slug: string; email: string }> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const target = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!target) throw new NotFoundException(USER_NOT_FOUND);
      const r = await tx.execute(
        sql`SELECT slug FROM companies WHERE id = ${actor.companyId} AND deleted_at IS NULL LIMIT 1`,
      );
      const slug = (r.rows[0] as { slug: string } | undefined)?.slug;
      // Không có hàng công ty ⇒ không dựng được khoá. Ném thay vì đoán một slug: đoán sai nghĩa là gỡ
      // nhầm khoá của người khác, hoặc báo "đã gỡ" mà không chạm gì.
      if (!slug) throw new NotFoundException(USER_NOT_FOUND);
      return { slug, email: target.email };
    });
  }

  /**
   * S2-AUTH-USEROPS-1 — DELETE /auth/users/:id: XÓA MỀM (deleted_at + deleted_by, GIỮ NGUYÊN status —
   * khôi phục trả về đúng trạng thái trước xóa; login đã bị chặn bởi lọc deleted_at ở AuthService).
   * Self-guard 400 (chống tự xóa lockout). Thu hồi MỌI phiên CÙNG tx (mirror lock — refresh token cũ
   * → 401 tức thì). Audit 'user.deleted' + dual-write USER_DELETED. Không thấy / cross-tenant / ĐÃ xóa
   * → NotFound TRƯỚC mọi mutation (no-op, 0 audit rác).
   */
  async deleteUser(actor: AuthUserActor, id: string, meta: RequestMeta): Promise<AuthUserDto> {
    if (actor.id === id) throw new BadRequestException(CANNOT_DELETE_SELF);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!before) throw new NotFoundException(USER_NOT_FOUND);
      const deleted = await this.repo.softDeleteTx(tx, actor.companyId, id, actor.id);
      if (!deleted) throw new NotFoundException(USER_NOT_FOUND);
      const revokedSessionCount = await this.auth.revokeAllForUserTx(
        tx,
        actor.companyId,
        id,
        "deleted",
      );
      await this.audit.record(tx, {
        action: "user.deleted",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: authUserSnapshot(before),
        after: { ...authUserSnapshot(deleted), revokedSessionCount },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await this.securityEvents?.record(tx, {
        eventType: "USER_DELETED",
        userId: id,
        actorUserId: actor.id,
        payload: { revokedSessionCount },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toDto(deleted);
    });
  }

  /**
   * S2-AUTH-USEROPS-1 — POST /auth/users/:id/restore: KHÔI PHỤC user đã xóa mềm (clear deleted_at/
   * deleted_by; status GIỮ NGUYÊN như trước xóa). Đòi row ĐANG deleted (lookup riêng) — row live/lạ/
   * cross-tenant → NotFound. Email đã có user LIVE trùng (tạo mới sau khi xóa) → 409 TRƯỚC khi chạm
   * unique (company_id, normalized_email). KHÔNG revoke phiên (user deleted không còn phiên sống —
   * delete đã thu hồi). Audit 'user.restored' + dual-write USER_RESTORED.
   *
   * S18-AUTH-RESTORE2FA-1 (D3) — KHÔI PHỤC PHẢI SOÁT LẠI 2FA. Quyết định owner (2 vòng, plan §2):
   *
   *  • **A1 — xoá sạch VÔ ĐIỀU KIỆN.** Sau restore, `user_totp` + `user_recovery_codes` của user đó
   *    0 hàng. Đây là vế đóng lỗ: mọi yếu tố cài trong cửa sổ đã-xoá biến mất, KỂ CẢ khi vế chặn ở
   *    `TwoFactorService.enroll` hồi quy về sau. Defence-in-depth CỐ Ý, không phải thừa.
   *  • **A2 — set `require_two_factor = true` CHỈ KHI** trước lúc xoá sạch user ĐANG BẬT 2FA
   *    (`enabled_at IS NOT NULL`). Hàng enroll PENDING KHÔNG tính — restore không được siết chính
   *    sách của user chưa từng bật 2FA.
   *
   * ⚠️ HỆ QUẢ ĐÃ ĐƯỢC OWNER KÝ, ghi ra để không im lặng: `users.require_two_factor` DÍNH VĨNH VIỄN.
   * `TwoFactorService.disable` fail-closed 409 `TWO_FACTOR_ENFORCED` dựa trên cờ đó BẤT KỂ
   * `TWO_FACTOR_ENFORCEMENT_ENABLED`, và `confirmEnable` KHÔNG clear cờ ⇒ user từng TỰ NGUYỆN bật
   * 2FA, bị xoá mềm rồi khôi phục, vĩnh viễn mất quyền TỰ tắt 2FA. Đường gỡ DUY NHẤT là admin
   * `PATCH /auth/users/:id`. Lập luận chấp nhận: tài khoản vừa khôi phục là tài khoản rủi ro cao
   * hơn, và admin gỡ được nên không phải một chiều. Ghim bằng `§sticky-409`
   * (`test/integration/auth-s18-restore2fa-1.int-spec.ts`).
   *
   * ⚠️ KHÔNG tái dùng `TwoFactorService.disable()` cho A1: nó mang chính sách self-disable
   * (`requiresTwoFactorTx` → 409) ⇒ sẽ GIẾT CẢ LỆNH restore với đúng nhóm user bị ép 2FA
   * (`reused-method-must-be-actor-scoped`). Dùng primitive repo — đúng cái admin-reset đang dùng.
   */
  async restoreUser(actor: AuthUserActor, id: string, meta: RequestMeta): Promise<AuthUserDto> {
    // S18-AUTH-490DEBT-1 (D3b) — fail-fast TRƯỚC mọi mutation, mirror `resetPassword`.
    //
    // ⚠️ ĐỪNG dời xuống cạnh lời gọi `reset()` ở cuối hàm. `requireRateLimiter()` NÉM; ném SAU khi tx
    // đã COMMIT nghĩa là: hàng đã được khôi phục THẬT, admin nhận 500, bấm lại thì `findDeletedByIdTx`
    // không còn thấy hàng deleted nữa ⇒ 404. Vận hành kết luận "restore hỏng" trong khi nó đã thành
    // công — đúng cái nút-nói-dối mà `requireRateLimiter` sinh ra để chặn.
    const limiter = this.requireRateLimiter();
    const dto = await this.db.withTenant(actor.companyId, async (tx) => {
      const before = await this.repo.findDeletedByIdTx(tx, actor.companyId, id);
      if (!before) throw new NotFoundException(USER_NOT_FOUND);
      if (await this.repo.emailExistsTx(tx, actor.companyId, before.email)) {
        throw new ConflictException(EMAIL_TAKEN_RESTORE);
      }
      // Phòng thủ đua (plan-review 2026-07-07): precheck ↔ restore vẫn có thể thua CREATE song song
      // cùng email ⇒ partial-unique (company_id, normalized_email) WHERE deleted_at IS NULL nổ 23505.
      // Map về 409 rõ nghĩa thay vì 500.
      let restored: User | undefined;
      try {
        restored = await this.repo.restoreTx(tx, actor.companyId, id, actor.id);
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException(EMAIL_TAKEN_RESTORE);
        throw err;
      }
      if (!restored) throw new NotFoundException(USER_NOT_FOUND);

      // ── D3: soát lại 2FA TRONG CÙNG TX (nguyên tử — không có cửa sổ nào tài khoản sống lại mà
      //    2FA cũ còn). Thứ tự BẮT BUỘC: đọc trạng thái → xoá sạch → set cờ → audit.
      const { enabled: twoFactorWasEnabled } = await this.repo.getTwoFactorStateTx(tx, id);
      await this.repo.deleteTwoFactorTx(tx, actor.companyId, id); // A1 — vô điều kiện
      let finalRow: User = restored;
      if (twoFactorWasEnabled) {
        // A2. `updateProfileTx` lọc `isNull(users.deletedAt)` — chạy được vì `restoreTx` đã clear
        // trong CÙNG tx này.
        const afterRow = await this.repo.updateProfileTx(
          tx,
          actor.companyId,
          id,
          { requireTwoFactor: true },
          actor.id,
        );
        // 🔴 CẤM `afterRow ?? restored`. `updateProfileTx` trả `User | undefined`; với `??`, một
        // lượt trả `undefined` (0 hàng khớp) bị NUỐT LẶNG: audit ghi snapshot cũ, `toDto` trả row
        // cũ, HTTP 200 — và A2 ĐÃ KHÔNG XẢY RA, không tín hiệu nào. Đúng hình
        // `empty-success-is-the-fail-open-shape`. Tệ hơn: `authUserSnapshot(undefined)` trả `null`
        // và `{...null}` = `{}` ⇒ `after` co lại còn hai khoá 2FA, MẤT SẠCH snapshot user trong
        // bảng append-only mà không ai đỏ. Ném ⇒ rollback CẢ lệnh restore (fail-closed) thay vì
        // restore-không-ép. Tiền lệ cùng hàm: `if (!restored) throw NotFound` ở trên.
        if (!afterRow) {
          throw new Error("restoreUser: A2 set require_two_factor khớp 0 hàng");
        }
        finalRow = afterRow;
      }

      await this.audit.record(tx, {
        action: "user.restored",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        before: authUserSnapshot(before),
        // ⚠️ `finalRow`, KHÔNG phải `restored`. `authUserSnapshot` CÓ trường `requireTwoFactor` ⇒
        // snapshot row cũ sẽ ghi `false` trong khi DB là `true` — một hàng APPEND-ONLY NÓI DỐI.
        after: {
          ...authUserSnapshot(finalRow),
          // `twoFactorReset` là HẰNG SỐ, đọc cho đúng: `deleteTwoFactorTx` trả `void` nên vết này
          // nghĩa là "ĐÃ CHẠY bước reset", KHÔNG phải "đã có gì để xoá". Muốn số hàng thì phải đổi
          // `deleteTwoFactorTx` — dùng chung với admin-reset ⇒ nợ riêng, không làm ở đây.
          twoFactorReset: true,
          twoFactorWasEnabled,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await this.securityEvents?.record(tx, {
        eventType: "USER_RESTORED",
        userId: id,
        actorUserId: actor.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      // ── S18-AUTH-490DEBT-1 (D3a — nợ §8.7 của #490, owner chốt 11/09/2026) ────────────────────
      //
      // A1 ở trên vừa GỠ yếu tố thứ hai của người này. Đường anh em làm ĐÚNG cùng mutation —
      // `resetTwoFactor` — phát `TOTP_RESET`; trước WO này `restoreUser` thì không, nên dòng thời
      // gian bảo mật của CHÍNH nạn nhân chỉ thấy `USER_RESTORED`. Câu "yếu tố thứ hai của bạn đã bị
      // gỡ" sống duy nhất ở `audit_logs.after.twoFactorReset` — thứ người dùng cuối KHÔNG đọc.
      //
      // CÓ ĐIỀU KIỆN (owner chốt), khác A1 vốn vô điều kiện: cờ là `twoFactorWasEnabled` — đọc ở
      // TRƯỚC `deleteTwoFactorTx`. Đừng suy từ kết quả xoá: `deleteTwoFactorTx` trả `void`.
      //
      // LỆCH CÓ CHỦ Ý so với `resetTwoFactor` (đừng "hài hoà hoá" hai đường): ở đó hàng mang
      // `payload:{revokedSessionCount}` và kèm thu hồi phiên. Ở đây KHÔNG cần — phiên của user này
      // đã bị thu hồi từ lượt `deleteUser`. Không payload cũng là BẤT BIẾN #3 (không secret/recovery
      // code lọt vào bảng append-only).
      if (twoFactorWasEnabled) {
        await this.securityEvents?.record(tx, {
          eventType: "TOTP_RESET",
          userId: id,
          actorUserId: actor.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      // `toDto` KHÔNG mang `requireTwoFactor` ⇒ response admin không đổi hình.
      return toDto(finalRow);
    });
    // ── S18-AUTH-490DEBT-1 (D3b) — gỡ khoá `2fa-enroll` mà chính bản vá §8.2 có thể đã dựng ──────
    //
    // ⚠️ ĐÂY LÀ ĐƯỜNG GỠ DUY NHẤT của bucket đó, và nó tồn tại vì HAI quyết định đã ký va vào nhau:
    //   · `clearLoginLocks` (nút "Gỡ khoá đăng nhập" của admin) CỐ Ý chỉ đụng họ login —
    //     `2fa-enable`/`2fa-disable`/`change-pw`/`2fa-enroll` đều nằm ngoài;
    //   · A2 ở trên set `require_two_factor = true` ⇒ `TwoFactorEnforcementGuard` ÉP người vừa được
    //     khôi phục phải enroll.
    // Kẻ tấn công giữ access token cũ chỉ cần gọi `POST /auth/2fa/enroll` đủ `LOGIN_MAX_ATTEMPTS`
    // lượt là nhốt nạn nhân 900s NGAY SAU khi được khôi phục, và admin không có nút nào gỡ.
    //
    // ⚠️ Vị trí: SAU khi tx COMMIT (Valkey không nằm trong tx DB). Còn `requireRateLimiter()` thì
    // đứng ở ĐẦU hàm — xem lý do ở đó.
    //
    // ⚠️ PHẢI GỠ CẢ HAI BUCKET, không chỉ `2fa-enroll` (security-reviewer FULL gate 11/09, HIGH).
    // Bản vá đầu chỉ gỡ `2fa-enroll` vì tin rằng `2fa-enable` "không bị guard ép". SAI, đo được:
    //   · `confirmEnable` (`two-factor.service.ts:336`) là nơi DUY NHẤT set `user_totp.enabled_at`
    //     (`grep -rn "enabledAt: new Date()" src --include=*.ts` → đúng 1 kết quả);
    //   · `TwoFactorEnforcementGuard` tha đúng khi `isEnabled`, tức đúng khi cờ ấy được set.
    // ⇒ `2fa-enable` KHÔNG phải bề mặt phụ — nó là NỬA SAU của cửa thoát duy nhất sau A2.
    // Và D2 vừa làm nó khoá được từ đường tấn công: nhánh `account_gone` của `confirmEnable` đứng
    // TRƯỚC `loadTotp`, nên kẻ giữ access token của tài khoản đã xoá mềm gọi 5 lượt
    // `POST /auth/2fa/enable` là dựng xong khoá 900s — KHÔNG cần hàng enroll nào. Nạn nhân sau khi
    // được khôi phục enroll được (200) rồi kẹt 429 ở bước bật, và ăn 403 mọi route tới khi khoá hết
    // hạn. HỒI QUY do chính WO này đẻ ra: trên master nhánh đó không `recordFailure`.
    //
    // Gỡ counter đoán-mã của `2fa-enable` ở đây KHÔNG nới bảo mật: A1 ngay trên đã xoá sạch
    // `user_totp`, nên không còn bí mật nào để đoán.
    //
    // ⚠️ GIỚI HẠN đã biết: đây là best-effort CÂM. `reset()` trả `void` và `ValkeyService.del` nuốt
    // lỗi ⇒ Valkey degraded đúng lúc này thì khoá sống hết `LOGIN_LOCKOUT_SEC` mà KHÔNG tín hiệu nào.
    // Cố ý không dựng vế `ok`/`degraded` như `clearLoginThrottle`: đó là bề mặt API riêng, ngoài
    // phạm vi WO này. Ghi ra để lượt sau biết đây là quyết định, không phải bỏ sót.
    for (const bucket of TWO_FACTOR_SETUP_BUCKETS) {
      await limiter.reset(rlKey(bucket, `${actor.companyId}|${id}`));
    }
    return dto;
  }

  /**
   * S2-AUTH-USEROPS-1 — POST /auth/users/:id/password/reset: admin ĐẶT LẠI mật khẩu (privileged, gate
   * reset-password:user is_sensitive mig 0476). Server sinh temp password (crypto, đạt policy) → hash
   * argon2 NGOÀI tx (mirror createUser) → set password_hash + must_change_password=true CÙNG update
   * (user bị ép đổi ở lần login kế — flow mig 0469) → thu hồi MỌI phiên CÙNG tx. Self-guard 400 (tự
   * đổi → change-password, giữ nguyên re-auth bằng mật khẩu cũ). Audit 'user.password_reset_by_admin'
   * + dual-write PASSWORD_RESET_BY_ADMIN — TUYỆT ĐỐI KHÔNG chứa temp password/hash (BẤT BIẾN #3);
   * plaintext CHỈ trả 1 lần trong response.
   */
  async resetPassword(
    actor: AuthUserActor,
    id: string,
    // S18-AUTH-SECEVENTMETA-1 — ip/UA của ADMIN (người BẤM NÚT), KHÔNG phải của nạn nhân. Tham số
    // riêng cho method này chứ KHÔNG nhét vào `AuthUserActor`: type đó dùng chung cho 15 method,
    // sửa nó là ripple 15 chữ ký + mọi builder trong spec cho đúng MỘT method trong phạm vi.
    // BẮT BUỘC (không `= {}`) — mirror D1 của #484.
    meta: RequestMeta,
  ): Promise<AuthUserPasswordResetResultDto> {
    // Self-guard giữ NGUYÊN vị trí đầu hàm: `requireRateLimiter` đứng sau nó để thứ tự lỗi không đổi
    // (tự-reset-mình vẫn là 400, không biến thành 500 khi DI sai).
    if (actor.id === id) throw new BadRequestException(CANNOT_RESET_SELF);
    // S18-AUTH-RESETCLEARS-1 — fail-fast TRƯỚC mọi mutation. `?.` no-op ở đây nghĩa là admin đặt lại
    // mật khẩu hộ, nhận `tempPassword`, mà người dùng vẫn 429 — đúng cái nút-giả-vờ-hoạt-động mà
    // `requireRateLimiter` sinh ra để chặn.
    const limiter = this.requireRateLimiter();
    const tempPassword = generateTempPassword();
    const passwordHash = await this.password.hash(tempPassword);
    const outcome = await this.db.withTenant(actor.companyId, async (tx) => {
      const target = await this.repo.findByIdTx(tx, actor.companyId, id);
      if (!target) throw new NotFoundException(USER_NOT_FOUND);
      const updated = await this.repo.setPasswordTx(
        tx,
        actor.companyId,
        id,
        passwordHash,
        actor.id,
      );
      if (!updated) throw new NotFoundException(USER_NOT_FOUND);
      const revokedSessionCount = await this.auth.revokeAllForUserTx(
        tx,
        actor.companyId,
        id,
        "admin_password_reset",
      );
      await this.audit.record(tx, {
        action: "user.password_reset_by_admin",
        objectType: "user",
        actorUserId: actor.id,
        objectId: id,
        after: { revokedSessionCount, mustChangePassword: true },
        // S18-AUTH-SECEVENTMETA-1 (nợ N3 của #484) — ip/UA của ADMIN. Đây là thao tác privileged sau
        // cặp sensitive `reset-password:user`; vết không định danh được người thao tác thì cặp đó chỉ
        // chặn được lúc bấm, không truy được về sau.
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await this.securityEvents?.record(tx, {
        eventType: "PASSWORD_RESET_BY_ADMIN",
        userId: id,
        actorUserId: actor.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
        payload: { revokedSessionCount },
      });
      // Slug đọc SAU mọi lệnh ghi, KHÔNG try/catch (statement lỗi đã abort tx — PG 25P02). 0 hàng ⇒
      // mất bước gỡ khoá, KHÔNG được làm hỏng việc đặt lại mật khẩu.
      const companyRow = await tx.execute(
        sql`SELECT slug FROM companies WHERE id = ${actor.companyId} AND deleted_at IS NULL LIMIT 1`,
      );
      const slug = (companyRow.rows[0] as { slug: string } | undefined)?.slug ?? null;
      return { tempPassword, revokedSessionCount, slug, email: target.email };
    });

    // SAU commit, KHÔNG ném: `tempPassword` là plaintext trả MỘT LẦN DUY NHẤT và không lưu ở đâu — ném
    // ở đây là vứt mất nó, admin phải reset lần nữa. `includeForgot: true`: đường này đã xác thực + đã
    // audit, khác hẳn endpoint công khai (cùng lập luận nút "Gỡ khoá đăng nhập" của WO-1). KHÔNG truyền
    // `subject` ⇒ bucket `2fa` không bị gỡ: `reset-password:user` không phải `reset-2fa:user`.
    if (!outcome.slug) {
      // BẤT THƯỜNG HỆ THỐNG, không phải ca nghiệp vụ: actor vừa thao tác THÀNH CÔNG trong tenant này
      // nên hàng `companies` phải tồn tại. Không đoán slug (đoán sai = gỡ khoá của người khác) — nhưng
      // cũng KHÔNG được im: đây là ca "không gỡ vì chưa từng thử gỡ", ít dấu vết hơn cả ca degraded.
      this.logger.warn(
        `resetPassword: KHÔNG gỡ được khoá đăng nhập cho user ${id} — không đọc được slug của công ty ` +
          `${actor.companyId}; mật khẩu ĐÃ đổi, người dùng có thể vẫn bị 429`,
      );
    } else {
      try {
        const result = await limiter.clearLoginLocks(outcome.slug, outcome.email, undefined, {
          includeForgot: true,
        });
        if (result.degraded) {
          // Log Ở ĐÂY chứ không chỉ trong `recordFailedLockClear`: nhánh này KHÔNG ném, nên chỉ ghi
          // audit là để kênh quan sát chính (log/APM) im lặng đúng lúc bất thường nhất.
          this.logger.error(
            `resetPassword: gỡ khoá đăng nhập KHÔNG kết luận được (degraded) cho user ${id} — ` +
              `mật khẩu ĐÃ đổi nhưng người dùng có thể vẫn bị 429`,
          );
          await this.recordFailedLockClear(actor, id, meta);
        }
      } catch (err) {
        // ValkeyService là "never throws" ⇒ tới đây là BUG (namespace khoá sai / DI vắng). Kêu, đừng nuốt.
        // Redact + giữ `stack`: khoá `rl:*` NHÚNG email, nên chi tiết lỗi của đúng lớp lỗi này là chỗ
        // email dễ trôi vào log nhất. Mirror đường tự phục vụ (`AuthService.clearLoginLocksAfterReset`).
        const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
        this.logger.error(
          `resetPassword: gỡ khoá đăng nhập thất bại cho user ${id} (mật khẩu ĐÃ đổi — có thể vẫn 429): ` +
            redactEmailFromDetail(detail, outcome.email),
        );
        await this.recordFailedLockClear(actor, id, meta);
      }
    }
    return { tempPassword: outcome.tempPassword, revokedSessionCount: outcome.revokedSessionCount };
  }

  /**
   * S18-AUTH-RESETCLEARS-1 — ghi vết CHỈ khi gỡ khoá THẤT BẠI (tx thứ hai, sau commit).
   *
   * Ca thành công không ghi hàng nào — hàng `user.password_reset_by_admin` đã đủ, và bồi `USER_UNLOCKED`
   * cho tài khoản chưa từng bị khoá là món nợ WO-1 đã ghi ở §10.5. Ca thất bại thì khác: đúng lúc đó
   * hàng audit kia hàm ý "người dùng vào lại được ngay" trong khi khoá còn sống ⇒ suy luận gãy, phải có
   * vết riêng. Bọc try/catch: tx phụ hỏng không được kéo đổ thao tác chính đã commit.
   */
  private async recordFailedLockClear(
    actor: AuthUserActor,
    id: string,
    // S18-AUTH-SECEVENTMETA-1 — private, MỘT caller (`resetPassword`) ⇒ ripple = 0 ngoài file. Để
    // một hàng cùng chuỗi câm trong khi hàng chính có vết là để lại đúng khoảng trống WO này đi lấp.
    meta: RequestMeta,
  ): Promise<void> {
    try {
      await this.db.withTenant(actor.companyId, async (tx) => {
        await this.audit.record(tx, {
          action: "user.login_throttle_cleared",
          objectType: "user",
          actorUserId: actor.id,
          objectId: id,
          after: { ok: false, reason: "password_reset" },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        await this.securityEvents?.record(tx, {
          eventType: "USER_UNLOCKED",
          userId: id,
          actorUserId: actor.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          payload: { reason: "password_reset", ok: false },
        });
      });
    } catch (err) {
      // KHÔNG nhận email vào đây chỉ để redact: `id` đã định danh đủ, và một tham số email thêm vào
      // hàm ghi-vết là đúng đường để nó vô tình trôi vào payload audit (đang sạch — giữ nguyên).
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      this.logger.error(
        `resetPassword: ghi vết 'gỡ khoá thất bại' KHÔNG thành công cho user ${id} — mất dấu forensics: ${detail}`,
      );
    }
  }

  /** Chống tự khoá/mở khoá chính mình (lockout). actor.id === target → BadRequest TRƯỚC khi chạm DB. */
  private assertNotSelf(actor: AuthUserActor, id: string): void {
    if (actor.id === id) throw new BadRequestException(CANNOT_TARGET_SELF);
  }

  /**
   * Predicate data-scope trên BẢNG users. LUÔN mang company_id (phòng thủ kép trên RLS — KHÔNG bao giờ
   * bare match-all). Company/System (N=1) → tenant. Own → chính actor. Team/Department (users KHÔNG có
   * org-mapping) + scope null → fail-closed sql`false` (0 rows).
   */
  /**
   * ⚠️ BẢN SAO THỨ HAI của cùng một luật — con trỏ HAI CHIỀU (nợ N-1b, `S6-SEC-ORGSCOPE-1`).
   * Bản kia: `DataScopeService.buildUserScopeCondition` (`../permission/data-scope.service.ts`), dùng
   * cho `GET /org/employees`. Hai chỗ PHẢI cùng ngữ nghĩa; sửa một bên mà quên bên kia là đúng lớp
   * drift mà S6 đang đóng.
   *
   * Khác biệt ĐÃ BIẾT, đừng "đồng bộ" nhầm chiều: nhánh `Own` ở bản kia CÓ thêm vế `company_id`, bản
   * này KHÔNG. Bản kia CHẶT HƠN ⇒ khi hợp nhất thì hợp nhất VỀ PHÍA nó. RLS vẫn là sàn cho chỗ này
   * nên hôm nay không rò, nhưng đừng lấy hình dạng ở đây làm chuẩn.
   *
   * Cả hai đều fail-closed `Team`/`Department` → 0 hàng: `users` không mang org-mapping. Hệ quả phi
   * đơn điệu (thêm role có thể LÀM MẤT hàng vì `resolveStrongestScope` lấy max) mô tả đầy đủ ở
   * `docs/plans/S6-SEC-ORGSCOPE-1.md` §2.1 — sửa phải sửa CẢ HAI cùng lúc, không vá lẻ một bên.
   */
  private buildUserScopeCondition(scope: DataScope | null, actor: AuthUserActor): SQL {
    switch (scope) {
      case "System":
      case "Company":
        return eq(users.companyId, actor.companyId);
      case "Own":
        return eq(users.id, actor.id);
      default:
        return sql`false`;
    }
  }

  /** Membership test cho 1 row đã load (get-by-id). Defense-in-depth ngoài RLS. */
  private isInScope(scope: DataScope | null, actor: AuthUserActor, row: User): boolean {
    if (row.companyId !== actor.companyId) return false;
    switch (scope) {
      case "System":
      case "Company":
        return true;
      case "Own":
        return row.id === actor.id;
      default:
        return false;
    }
  }
}
