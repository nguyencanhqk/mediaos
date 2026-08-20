import { HttpException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuthService } from "../../src/auth/auth.service";
import { AuthLogsViewerService } from "../../src/auth/auth-logs-viewer.service";
import { DataScopeService } from "../../src/permission/data-scope.service";
import { DataScopeRepository } from "../../src/permission/data-scope.repository";

/** Actor đọc log — không giữ grant danh bạ nào; spec này không khẳng định gì về cột danh tính. */
// UUID HỢP LỆ (hex). Bản đầu dùng "…-00000000log1" — `l`,`o`,`g` không phải hex ⇒ Postgres 22P02,
// `resolveStrongestScope` nuốt vào try/catch rồi fail-closed `null`. Spec vẫn xanh nhưng xanh vì đi
// vào NHÁNH LỖI HẠ TẦNG, không phải nhánh deny, và bơm error-log rác mỗi lần gọi.
const LOG_READER_ACTOR = "00000000-0000-0000-0000-0000000010c1";
import { LoginLogRepository } from "../../src/auth/login-log.repository";
import { SecurityEventRepository } from "../../src/auth/security-event.repository";
import { LoginRateLimiter } from "../../src/auth/login-rate-limiter";
import { PasswordService } from "../../src/auth/password.service";
import { TokenService } from "../../src/auth/token.service";
import { TotpService } from "../../src/auth/totp.service";
import { TwoFactorService } from "../../src/auth/two-factor.service";
import { ReplayGuardService } from "../../src/auth/replay-guard.service";
import { SecurityAlertService } from "../../src/auth/security-alert.service";
import { ValkeyService } from "../../src/permission/valkey.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import type { ModuleCatalogService } from "../../src/foundation/module-catalog/module-catalog.service";
import { SecretEncryptionService } from "../../src/crypto/secret-encryption.service";
import { NodeEnvelopeCipher } from "../../src/crypto/envelope-cipher";
import { LocalKekProvider } from "../../src/crypto/local-kek.provider";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { loadEnv } from "../../src/config/env.schema";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { makeSecurityPolicyService } from "../helpers/security-policy";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

/**
 * S6-SEC-LOGINLOG-2 · KI-044 — hàng `blocked/TooManyAttempts` phải gắn ĐÚNG CHỦ.
 *
 * LỖ: `isLoginRateLimited()` chạy TRƯỚC `resolveCompanyId()` trong `login()` ⇒ hàng bị chặn
 * ghi `company_id = NULL` KỂ CẢ khi companySlug HỢP LỆ. Sau mig 0532 (vế USING chỉ còn tenant hiện tại)
 * hàng NULL không tenant nào đọc được ⇒ company-admin MẤT quan sát brute-force nhắm vào chính mình.
 * Đo PROD 2026-07-28: 165/268 hàng NULL (~62%) thuộc loại này — tức là CÓ CHỦ, đang bị gắn sai.
 *
 * R1/R2 = chốt VÁ (phải ĐỎ trước khi sửa auth.service). R3/R4/R5 = chốt KHÔNG-HỒI-QUY (xanh CẢ HAI phía —
 * chúng tồn tại để bản vá không nới cô lập tenant, không phải để chứng minh bản vá). R6 = chốt fail-soft.
 *
 * ĐI QUA ĐƯỜNG THẬT: khoá bucket bằng `LoginRateLimiter.recordFailure()` trên ĐÚNG instance đã truyền vào
 * AuthService — KHÔNG stub `isLocked`. Mỗi ca dùng email RIÊNG: bucket in-memory sống LOGIN_LOCKOUT_SEC
 * (900s) trong cùng process, dùng lại email giữa các ca sẽ rò trạng thái khoá sang nhau.
 */
describe.skipIf(!hasDb)("S6-SEC-LOGINLOG-2 login blocked → gắn đúng company_id (KI-044)", () => {
  const direct = directPool();
  const password = new PasswordService();
  const env = loadEnv();
  const IP = "203.0.113.77";
  const meta = { ip: IP, userAgent: "vitest-loginlog2" };
  const PASSWORD = "Passw0rd!strong";
  /** Marker để `afterAll` dọn được hàng `company_id IS NULL` — `cleanupTenants` dọn theo company_id nên
   *  KHÔNG dính chúng (bẫy đã phải vá tay ở auth-me-bootstrap.int-spec:67-73 + login-logs-rls:31-37). */
  const MARKER = "loginlog2";

  let A: SeededTenant;
  let B: SeededTenant;
  let auth: AuthService;
  let limiter: LoginRateLimiter;
  let viewer: AuthLogsViewerService;

  beforeAll(async () => {
    A = await seedCompany(direct, "lgl2A");
    B = await seedCompany(direct, "lgl2B");
    await seedUser(direct, A.companyId, `owner-${MARKER}@a.test`, await password.hash(PASSWORD));
    const dbsvc = new DatabaseService();
    limiter = new LoginRateLimiter();
    auth = newAuth(dbsvc, limiter);
    viewer = new AuthLogsViewerService(
      dbsvc,
      new LoginLogRepository(),
      new SecurityEventRepository(),
      // S6-SEC-IDENTITY-PROJ-1 (KI-054): instance THẬT. Actor của spec này không giữ grant `view:user`
      // nào ⇒ cột danh tính bị bỏ — không sao, spec này khẳng định về GẮN TENANT + ip/status, không
      // về danh tính. Nếu sau này nó bắt đầu assert email thì nó phải seed grant, và đó là điều đúng.
      new DataScopeService(
        new PermissionService(new PermissionRepository(dbsvc)),
        new DataScopeRepository(dbsvc),
      ),
    );
  });

  afterAll(async () => {
    await direct
      .query("DELETE FROM login_logs WHERE normalized_email LIKE $1", [`%${MARKER}%`])
      .catch(() => undefined);
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  function newAuth(dbsvc: DatabaseService, rateLimiter: LoginRateLimiter): AuthService {
    const permissions = new PermissionService(new PermissionRepository(dbsvc));
    const modules = { getMyApps: async () => [] } as unknown as ModuleCatalogService;
    const secrets = new SecretEncryptionService(new NodeEnvelopeCipher(), new LocalKekProvider());
    const replayGuard = new ReplayGuardService(new ValkeyService());
    const twoFactor = new TwoFactorService(
      dbsvc,
      secrets,
      new TotpService(),
      new TokenService(),
      new AuditService(),
      new LoginRateLimiter(),
      replayGuard,
    );
    return new AuthService(
      dbsvc,
      password,
      new TokenService(),
      rateLimiter,
      new AuditService(),
      new OutboxService(),
      permissions,
      secrets,
      twoFactor,
      replayGuard,
      new SecurityAlertService(dbsvc, new AuditService()),
      makeSecurityPolicyService(dbsvc),
      modules,
    );
  }

  /** Khoá bucket per-IP qua ĐÚNG API thật của limiter (không stub). */
  async function lockBucket(slug: string, email: string): Promise<void> {
    const key = LoginRateLimiter.key(slug, email, IP);
    for (let i = 0; i < env.LOGIN_MAX_ATTEMPTS; i += 1) {
      await limiter.recordFailure(key);
    }
    expect(await limiter.isLocked(key)).toBe(true);
  }

  /**
   * Ngưỡng ghim SÀN THỜI GIAN của nhánh 429 (`BLOCKED_LOGIN_FLOOR_MS = 250` + jitter).
   *
   * ⚠️ LITERAL CỐ Ý — KHÔNG import hằng số từ auth.service. Import vào thì hạ sàn về 0 vẫn xanh
   * (tautology); literal khiến việc hạ/gỡ sàn ĐỎ ngay. Để 225 chứ không phải 250 chỉ vì độ mịn của
   * setTimeout, vẫn cách ~40× so với ~5ms khi KHÔNG có sàn ⇒ gỡ `finally` là đỏ chắc chắn.
   *
   * VÌ SAO PHẢI GHIM: sàn này tồn tại DUY NHẤT để bịt oracle "slug tenant có tồn tại" mà CHÍNH bản vá
   * KI-044 sinh ra (slug hợp lệ đi withTenant 4 round-trip · slug sai đi insert trần 1 round-trip; nhánh
   * 429 không có argon2 che). Đo thật khi TẮT sàn: 4.6±0.0ms vs 3.2±0.0ms — hai phân phối RỜI NHAU, phân
   * loại được ~100%. Không có ca này thì xoá `finally` đi bộ test vẫn 6/6 xanh (cả hai reviewer FULL gate
   * đều bắt đúng điểm này — memory `tests-can-pin-a-hole-open`, `review-gate-blind-to-deletions`).
   */
  const FLOOR_PIN_MS = 225;

  /** Gọi login, khẳng định đúng 429 (KHÔNG phải 500), trả lỗi + thời gian đã trôi để ca kiểm thêm. */
  async function expect429(slug: string, email: string): Promise<{ elapsedMs: number }> {
    const t0 = Date.now();
    const err = await auth
      .login({ companySlug: slug, email, password: PASSWORD }, meta)
      .then(() => null)
      .catch((e: unknown) => e);
    const elapsedMs = Date.now() - t0;
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    return { elapsedMs };
  }

  /** Hàng `id` có nhìn thấy được trong ngữ cảnh tenant này KHÔNG (qua ĐƯỜNG ĐỌC THẬT AUTH-API-401). */
  async function visibleTo(companyId: string, rowId: string): Promise<boolean> {
    const page = await listBlocked(companyId);
    return page.data.some((r) => r.id === rowId);
  }

  async function lastLoginLog(email: string) {
    const res = await direct.query(
      `SELECT id, company_id, user_id, login_status, failure_reason, ip_address
         FROM login_logs WHERE normalized_email = $1 ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase()],
    );
    return res.rows[0] as
      | {
          id: string;
          company_id: string | null;
          user_id: string | null;
          login_status: string;
          failure_reason: string | null;
          ip_address: string | null;
        }
      | undefined;
  }

  const listBlocked = (companyId: string) =>
    viewer.listLoginLogs({ id: LOG_READER_ACTOR, companyId }, {
      page: 1,
      per_page: 100,
      status: "blocked",
      sort: "created_at",
      order: "desc",
    } as Parameters<AuthLogsViewerService["listLoginLogs"]>[1]);

  // ─────────────────────────── R1/R2: chốt VÁ (ĐỎ trước khi sửa) ───────────────────────────

  it("R1 — slug HỢP LỆ + bucket đã khoá → 429 và hàng blocked/TooManyAttempts gắn company_id = A", async () => {
    const email = `r1-${MARKER}@a.test`;
    await lockBucket(A.slug, email);
    const { elapsedMs } = await expect429(A.slug, email);

    const row = await lastLoginLog(email);
    expect(row?.login_status).toBe("blocked");
    expect(row?.failure_reason).toBe("TooManyAttempts");
    // ⟵ ĐÂY là KI-044. Trước vá: NULL (slug hợp lệ nhưng chưa kịp resolve lúc ghi).
    expect(row?.company_id).toBe(A.companyId);
    // Nhánh ĐẮT (withTenant, 4 round-trip) phải bị sàn nuốt — xem FLOOR_PIN_MS.
    expect(elapsedMs).toBeGreaterThanOrEqual(FLOOR_PIN_MS);
  });

  it("R2 — hàng đó HIỆN RA ở đường đọc THẬT AUTH-API-401 của tenant A (user = null)", async () => {
    const email = `r2-${MARKER}@a.test`;
    await lockBucket(A.slug, email);
    await expect429(A.slug, email);
    const row = await lastLoginLog(email);
    expect(row).toBeDefined();

    const page = await listBlocked(A.companyId);
    // Khoá theo id: listLoginLogs(status='blocked') trả CẢ hàng blocked/Inactive (nhánh
    // `result.kind === "blocked"` trong login() ghi userId THẬT) nên lọc bằng failure_reason là chốt
    // lỏng. DTO không có email để phân biệt.
    const seen = page.data.find((r) => r.id === row!.id);
    expect(seen).toBeDefined();
    expect(seen!.ip_address).toBe(IP);
    expect(seen!.failure_reason).toBe("TooManyAttempts");
    // RANH GIỚI đã đo (plan §1.1): userRef() trả null khi thiếu user_id ⇒ admin thấy "bị nện từ IP nào,
    // lúc nào", KHÔNG thấy TÀI KHOẢN nào bị nhắm. LoginLogListItem không có field email. Đừng hứa quá.
    expect(seen!.user).toBeNull();
  });

  // ─────────────────── R3/R4/R5: chốt KHÔNG-HỒI-QUY (xanh CẢ HAI phía) ───────────────────

  it("R3 — tenant B KHÔNG đọc được hàng của A, NHƯNG đọc được hàng của chính mình (có đối chứng dương)", async () => {
    const emailA = `r3a-${MARKER}@a.test`;
    await lockBucket(A.slug, emailA);
    await expect429(A.slug, emailA);
    const rowA = await lastLoginLog(emailA);

    // ĐỐI CHỨNG DƯƠNG: không có nó, ca này vẫn xanh nếu listLoginLogs trả rỗng vì bất kỳ lý do gì
    // (sai filter, hỏng repo, sai companyId) — tức là chứng minh "không thấy" bằng một đường đọc đã chết.
    const emailB = `r3b-${MARKER}@b.test`;
    await lockBucket(B.slug, emailB);
    await expect429(B.slug, emailB);
    const rowB = await lastLoginLog(emailB);
    expect(rowB?.company_id).toBe(B.companyId);

    expect(await visibleTo(B.companyId, rowB!.id)).toBe(true); // đường đọc SỐNG
    expect(await visibleTo(B.companyId, rowA!.id)).toBe(false); // và vẫn không thấy hàng của A
    expect(await visibleTo(A.companyId, rowB!.id)).toBe(false); // chiều ngược lại
  });

  it("R4 — slug SAI/không tồn tại + bucket đã khoá → hàng VẪN company_id NULL (thực sự vô chủ)", async () => {
    const email = `r4-${MARKER}@nope.test`;
    const badSlug = "khong-ton-tai-slug-nay-lgl2";
    await lockBucket(badSlug, email);
    const { elapsedMs } = await expect429(badSlug, email);

    const row = await lastLoginLog(email);
    expect(row?.login_status).toBe("blocked");
    expect(row?.failure_reason).toBe("TooManyAttempts");
    // done_when #4: chỉ hàng KHÔNG resolve được chủ mới là hàng vô chủ. Bản vá không được gắn bừa.
    expect(row?.company_id).toBeNull();
    // Nhánh RẺ (insert trần, 1 round-trip) cũng phải bị sàn nuốt — nếu chỉ nhánh đắt bị nuốt thì chênh
    // lệch VẪN CÒN. Đây mới là nửa còn lại của chốt chống oracle (xem FLOOR_PIN_MS).
    expect(elapsedMs).toBeGreaterThanOrEqual(FLOOR_PIN_MS);
    // Và nửa quan trọng của "vô chủ": KHÔNG tenant nào đọc được nó (0532). Chỉ assert NULL bằng
    // superuser là bỏ mất đúng vế mã hoá sự cô lập — vế sẽ ĐỎ khi lỗ KI-042 quay lại.
    expect(await visibleTo(A.companyId, row!.id)).toBe(false);
    expect(await visibleTo(B.companyId, row!.id)).toBe(false);
  });

  it("R5 — BẤT BIẾN giữ nguyên: company_id IS NULL ⟹ user_id IS NULL (và MẪU KHÔNG rỗng)", async () => {
    // TỰ SINH mẫu thay vì ăn theo hàng của R4: ca này từng phụ thuộc THỨ TỰ KHAI BÁO, nên chạy cô lập
    // (`-t "R5"`) là "1 passed" trên tập RỖNG. Tự sinh ⇒ có denominator thật ở MỌI cách chạy.
    const email = `r5-${MARKER}@nope.test`;
    const badSlug = "khong-ton-tai-slug-nay-r5";
    await lockBucket(badSlug, email);
    await expect429(badSlug, email);

    const res = await direct.query(
      `SELECT count(*) FILTER (WHERE company_id IS NULL)                          ::int AS null_rows,
              count(*) FILTER (WHERE company_id IS NULL AND user_id IS NOT NULL)  ::int AS violations
         FROM login_logs WHERE normalized_email LIKE $1`,
      [`%${MARKER}%`],
    );
    // Đếm denominator TRONG CÙNG truy vấn: bản trước chỉ đếm vi phạm nên chạy `-t "R5"` một mình là
    // "1 passed" trên tập RỖNG — xanh mà không chứng minh gì (FULL gate rls-tenant-isolation-tester
    // chứng minh bằng cách chạy đúng ca này cô lập).
    expect(res.rows[0].null_rows).toBeGreaterThan(0);
    expect(res.rows[0].violations).toBe(0);
  });

  it("R7 — công ty TỒN TẠI nhưng bị ĐÌNH CHỈ + bucket khoá → vẫn vô chủ (NULL) và không tenant nào đọc được", async () => {
    // done_when #4 nói "slug sai/inactive"; R4 mới phủ vế "sai". Vế "inactive" đi qua nhánh khác của
    // resolveCompanyId (`status !== 'active'`) nên phải có ca riêng — đúng ca mà FULL gate chỉ ra là thiếu.
    const C = await seedCompany(direct, "lgl2C");
    await direct.query("UPDATE companies SET status = 'suspended' WHERE id = $1", [C.companyId]);
    const email = `r7-${MARKER}@c.test`;
    await lockBucket(C.slug, email);
    await expect429(C.slug, email);

    const row = await lastLoginLog(email);
    expect(row?.company_id).toBeNull();
    expect(await visibleTo(C.companyId, row!.id)).toBe(false);
    expect(await visibleTo(A.companyId, row!.id)).toBe(false);
    await cleanupTenants(direct, [C.companyId]);
  });

  // ─────────────────────────── R6: fail-soft ───────────────────────────

  it("R6 — resolve tenant NÉM → vẫn 429 (KHÔNG phải 500), hàng ghi NULL, và lỗi được LOG (không nuốt câm)", async () => {
    const email = `r6-${MARKER}@a.test`;
    await lockBucket(A.slug, email);

    // Stub ĐÚNG seam: resolveCompanyId nằm BÊN TRONG try/catch của resolveBlockedLogOwner. KHÔNG stub
    // resolveBlockedLogOwner — ném từ đó thoát khỏi try ⇒ 500 ⇒ ca này đỏ vì lý do SAI. Nếu người sau
    // inline SQL vào resolveBlockedLogOwner thay vì gọi resolveCompanyId, spy thành vô hiệu và ca đỏ TO
    // (company_id sẽ = A) — không âm thầm thành tautology.
    const resolveSpy = vi
      .spyOn(
        auth as unknown as { resolveCompanyId: (s: string) => Promise<string | null> },
        "resolveCompanyId",
      )
      .mockRejectedValue(new Error("db down (giả lập)"));
    const warnSpy = vi.spyOn(
      (auth as unknown as { logger: { warn: (m: string) => void } }).logger,
      "warn",
    );

    try {
      await expect429(A.slug, email);
      const row = await lastLoginLog(email);
      expect(row?.login_status).toBe("blocked");
      expect(row?.company_id).toBeNull(); // thoái lui về hành vi cũ, KHÔNG đổi outcome
      // BẤT BIẾN #-nuốt-câm: một trục trặc DB âm thầm hạ hàng CÓ CHỦ xuống vô chủ = đúng lớp mù mà
      // KI-044 đang vá. Phải nhìn thấy được (tiền lệ: hai nhánh catch trong `recordLoginAttempt`).
      // Khoá theo NỘI DUNG: `toHaveBeenCalled()` trần thoả mãn bởi BẤT KỲ warn nào của logger này,
      // kể cả warn `!db` của recordLoginAttempt ⇒ không chứng minh đúng đường fail-soft đã chạy.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("resolveBlockedLogOwner"));
    } finally {
      resolveSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
