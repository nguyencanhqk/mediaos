import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictException } from "@nestjs/common";
import { Column, SQL } from "drizzle-orm";
import { AuthService, redactEmailFromDetail } from "./auth.service";
import { LoginRateLimiter } from "./login-rate-limiter";
import { TWO_FACTOR_ENFORCED } from "./two-factor.service";
import { loadEnv } from "../config/env.schema";
import { companies, employeeProfiles, userRoles, users } from "../db/schema";

/**
 * S2-AUTH-DB-3 Lane C — RED-first (kiểm chứng CẤU TRÚC WHERE, không cần Postgres). Reader `user_roles`
 * ngoài permission-engine (me() roleRows, isOperatorTx) PHẢI lọc `isNull(userRoles.deletedAt)`. Duyệt
 * `queryChunks` đệ quy tìm Column `deleted_at` THUỘC ĐÚNG bảng — phân biệt userRoles.deleted_at với
 * roles.deleted_at (reader CŨ chỉ lọc roles ⇒ RED; sau fix lọc CẢ HAI ⇒ GREEN).
 */
function whereFiltersSoftDelete(where: unknown, table: unknown): boolean {
  let found = false;
  const walk = (node: unknown): void => {
    if (node instanceof Column) {
      if (node.table === table && node.name === "deleted_at") found = true;
      return;
    }
    if (node instanceof SQL) {
      for (const chunk of node.queryChunks) walk(chunk);
      return;
    }
    if (Array.isArray(node)) for (const item of node) walk(item);
  };
  walk(where);
  return found;
}

/**
 * G6-2f residual M3 — forgotPassword ghi `err.stack` để quan sát (silent-failure F3) nhưng stack
 * KHÔNG kiểm soát được và có thể nhúng email người gọi. `redactEmailFromDetail` phải redact email
 * (PII) khỏi chuỗi chẩn đoán TRƯỚC khi log, mà vẫn giữ phần còn lại của stack.
 */
describe("redactEmailFromDetail (G6-2f M3 — scrub email khỏi log)", () => {
  const email = "Victim@Example.com";

  it("redact email khi nó xuất hiện trong chuỗi detail", () => {
    const detail = `Error: db down for ${email}\n    at AuthService.forgotPassword`;
    const out = redactEmailFromDetail(detail, email);
    expect(out).not.toContain(email);
    expect(out).toContain("[redacted-email]");
  });

  it("redact cả biến lowercase (lỗi downstream hạ chữ thường email)", () => {
    const detail = `constraint violation: ${email.toLowerCase()} already exists`;
    const out = redactEmailFromDetail(detail, email);
    expect(out).not.toContain(email.toLowerCase());
    expect(out).toContain("[redacted-email]");
  });

  it("trả nguyên detail khi email undefined/rỗng (KHÔNG split chuỗi rỗng)", () => {
    const detail = "Error: KMS unavailable";
    expect(redactEmailFromDetail(detail, undefined)).toBe(detail);
    expect(redactEmailFromDetail(detail, "")).toBe(detail);
  });

  it("giữ nguyên detail khi không có email bên trong", () => {
    const detail = "Error: KMS provider timeout";
    expect(redactEmailFromDetail(detail, email)).toBe(detail);
  });
});

/**
 * S2-AUTH-BE-11 — nhánh FAIL-FAST trong AuthService.disableTwoFactor(): user bị ÉP 2FA (role HOẶC
 * per-user, mig 0466) phải bị chặn NGAY (409 TWO_FACTOR_ENFORCED) TRƯỚC khi tiêu tốn rate-limit /
 * re-auth mật khẩu. Đây là lớp defense-in-depth ở tầng service (song song chốt tx-level trong
 * TwoFactorService.disable()). Unit-mock `twoFactor.requiresTwoFactor` để cô lập đúng nhánh này —
 * KHÔNG chạm DB (đường tx-level đã có int-spec riêng chạy dưới LANE_DB).
 *
 * Chứng minh RED-trước-GREEN: nếu bỏ khối `if (requiresTwoFactor) throw` thì assertion
 * "rateLimiter.isLocked / password.verify KHÔNG được gọi" sẽ vỡ (luồng chạy tiếp xuống re-auth).
 */
describe("AuthService.disableTwoFactor — fail-fast khi bị ÉP 2FA (S2-AUTH-BE-11)", () => {
  const user = { id: "user-1", companyId: "co-1" } as const;

  // Chain stub cho `tx.select(...).from(...).where(...).limit(1)` → trả 1 row có passwordHash.
  function makeTxStub() {
    const tx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ passwordHash: "argon2-hash" }]),
    };
    return tx;
  }

  function makeService() {
    const twoFactor = {
      requiresTwoFactor: vi.fn(),
      disable: vi.fn().mockResolvedValue(undefined),
    };
    const rateLimiter = {
      isLocked: vi.fn().mockResolvedValue(false),
      recordFailure: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
    };
    const password = {
      verify: vi.fn().mockResolvedValue(true),
    };
    const txStub = makeTxStub();
    const dbsvc = {
      withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => unknown) => fn(txStub)),
    };

    // AuthService có nhiều DI-dep nhưng disableTwoFactor() chỉ dùng dbsvc/password/rateLimiter/twoFactor.
    // Các dep còn lại chỉ được GÁN ở constructor (không gọi) → truyền stub rỗng an toàn. Cast constructor
    // sang chữ ký lỏng để khỏi import 13 type không dùng (KHÔNG dùng `any`).
    const Ctor = AuthService as unknown as new (...args: unknown[]) => AuthService;
    const service = new Ctor(
      dbsvc, // 1 dbsvc
      password, // 2 password
      {}, // 3 tokens
      rateLimiter, // 4 rateLimiter
      {}, // 5 audit
      {}, // 6 outbox
      {}, // 7 permissions
      {}, // 8 secrets
      twoFactor, // 9 twoFactor
      {}, // 10 replayGuard
      {}, // 11 securityAlerts
      {}, // 12 securityPolicy
      {}, // 13 modules
    );
    return { service, twoFactor, rateLimiter, password, dbsvc };
  }

  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it("bị ÉP (requiresTwoFactor=true) → 409 TWO_FACTOR_ENFORCED TRƯỚC re-auth (không chạm rate-limit/verify)", async () => {
    ctx.twoFactor.requiresTwoFactor.mockResolvedValue(true);

    let thrown: unknown;
    try {
      await ctx.service.disableTwoFactor(user, "pw");
      expect.unreachable("disableTwoFactor phải ném khi user bị ép 2FA");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    const res = (thrown as ConflictException).getResponse() as { code?: string };
    expect(res.code).toBe(TWO_FACTOR_ENFORCED);
    expect((thrown as ConflictException).getStatus()).toBe(409);

    // Kiểm nhánh: requiresTwoFactor đọc đúng (userId, companyId) và deny NGAY — chưa tiêu re-auth.
    expect(ctx.twoFactor.requiresTwoFactor).toHaveBeenCalledWith(user.id, user.companyId);
    expect(ctx.rateLimiter.isLocked).not.toHaveBeenCalled();
    expect(ctx.password.verify).not.toHaveBeenCalled();
    expect(ctx.dbsvc.withTenant).not.toHaveBeenCalled();
    expect(ctx.twoFactor.disable).not.toHaveBeenCalled();
    // KHÔNG ghi nhận thất bại rate-limit cho nhánh policy (không phải sai mật khẩu).
    expect(ctx.rateLimiter.recordFailure).not.toHaveBeenCalled();
  });

  it("KHÔNG bị ép (requiresTwoFactor=false) → chạy tiếp xuống rate-limit + re-auth + disable (hành vi cũ)", async () => {
    ctx.twoFactor.requiresTwoFactor.mockResolvedValue(false);

    await expect(ctx.service.disableTwoFactor(user, "pw")).resolves.toBeUndefined();

    // Qua khỏi fail-fast → chạm đúng các lớp phía dưới.
    expect(ctx.twoFactor.requiresTwoFactor).toHaveBeenCalledWith(user.id, user.companyId);
    expect(ctx.rateLimiter.isLocked).toHaveBeenCalledTimes(1);
    expect(ctx.password.verify).toHaveBeenCalledWith("argon2-hash", "pw");
    expect(ctx.rateLimiter.reset).toHaveBeenCalledTimes(1);
    expect(ctx.twoFactor.disable).toHaveBeenCalledWith(user.id, user.companyId);
  });
});

/**
 * S2-FND-SEED-3 (LANE SEED3-C-authme) — /auth/me PHẢI expose `mustChangePassword` (ADDITIVE, mẫu
 * S2-AUTH-BE-1: KHÔNG phá contract cũ). Super-admin bootstrap upsert đặt cờ = true (mig 0469 +
 * super-admin-bootstrap.repository), FE dùng cờ này để ép đổi mật khẩu lần đầu (enforcement = follow-up FE).
 *
 * Chứng minh RED-trước-GREEN: nếu me() KHÔNG select/return users.must_change_password thì
 * `result.mustChangePassword` = undefined ⇒ assertion `toBe(true)/toBe(false)` vỡ.
 *
 * Cô lập bằng unit-mock: `dbsvc.withTenant` dispatch theo BẢNG (`from(table)`) — users → row có
 * mustChangePassword; companies → 1 row; employee/roles → [] (không hồ sơ). KHÔNG chạm DB (đường me()
 * đầy đủ đã có int-spec riêng dưới LANE_DB).
 */
describe("AuthService.me — expose mustChangePassword (S2-FND-SEED-3)", () => {
  const CLAIMS = { sub: "user-1", companyId: "co-1" } as const;

  // tx stub dispatch theo bảng: users/companies kết ở `.limit(1)`; userRoles kết ở `.where(...)` (await
  // trực tiếp). `whereResult` vừa CHAINABLE (.limit cho users/company/emp) vừa THENABLE (roleRows).
  function makeMeTx(
    row: Record<string, unknown>,
    company: Record<string, unknown>,
    captures: { userRolesWhere?: unknown } = {},
  ) {
    let table: unknown = null;
    const rowsFor = (): unknown[] => {
      if (table === users) return [row];
      if (table === companies) return [company];
      if (table === employeeProfiles) return []; // không hồ sơ nhân sự
      if (table === userRoles) return []; // không role (không load-bearing cho test cờ)
      return [];
    };
    const whereResult = {
      limit: vi.fn(() => Promise.resolve(rowsFor())),
      then: (resolve: (v: unknown) => void) => resolve(rowsFor()),
    };
    const tx = {
      select: vi.fn(() => tx),
      from: vi.fn((t: unknown) => {
        table = t;
        return tx;
      }),
      innerJoin: vi.fn(() => tx),
      // S2-AUTH-DB-3 Lane C: bắt WHERE của reader roleRows (from userRoles) để assert lọc soft-delete.
      where: vi.fn((cond?: unknown) => {
        if (table === userRoles) captures.userRolesWhere = cond;
        return whereResult;
      }),
      limit: vi.fn(() => Promise.resolve(rowsFor())),
    };
    return tx;
  }

  function makeService(row: Record<string, unknown>) {
    const company = { id: CLAIMS.companyId, name: "ACME", status: "active" };
    const captures: { userRolesWhere?: unknown } = {};
    const tx = makeMeTx(row, company, captures);
    const dbsvc = {
      withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => unknown) => fn(tx)),
    };
    const tokens = { verifyAccessToken: vi.fn(() => ({ ...CLAIMS })) };
    const twoFactor = {
      requiresTwoFactorTx: vi.fn().mockResolvedValue(false),
      isEnabledTx: vi.fn().mockResolvedValue(false),
    };
    const permissions = {
      getCapabilities: vi.fn().mockResolvedValue({}),
      getAllowlistedSensitiveCapabilities: vi.fn().mockResolvedValue({}),
      getCapabilityScopes: vi.fn().mockResolvedValue({}),
    };
    const modules = { getMyApps: vi.fn().mockResolvedValue([]) };

    const Ctor = AuthService as unknown as new (...args: unknown[]) => AuthService;
    const service = new Ctor(
      dbsvc, // 1 dbsvc
      {}, // 2 password
      tokens, // 3 tokens
      {}, // 4 rateLimiter
      {}, // 5 audit
      {}, // 6 outbox
      permissions, // 7 permissions
      {}, // 8 secrets
      twoFactor, // 9 twoFactor
      {}, // 10 replayGuard
      {}, // 11 securityAlerts
      {}, // 12 securityPolicy
      modules, // 13 modules
    );
    return { service, captures };
  }

  const baseRow = {
    id: CLAIMS.sub,
    companyId: CLAIMS.companyId,
    email: "admin@acme.local",
    fullName: "Admin",
    status: "active",
    deletedAt: null,
  };

  // S2-AUTH-DB-3 Lane C: me() roleRows reader PHẢI lọc soft-delete assignment (isNull(userRoles.deletedAt)).
  it("roleRows lọc isNull(userRoles.deletedAt) — RED nếu chỉ lọc roles.deletedAt", async () => {
    const { service, captures } = makeService({ ...baseRow, mustChangePassword: false });
    await service.me("access-token");
    expect(captures.userRolesWhere).toBeDefined();
    expect(whereFiltersSoftDelete(captures.userRolesWhere, userRoles)).toBe(true);
  });

  it("must_change_password=true (admin sau bootstrap) → me().mustChangePassword=true", async () => {
    const { service } = makeService({ ...baseRow, mustChangePassword: true });
    const result = await service.me("access-token");
    expect(result.mustChangePassword).toBe(true);
  });

  it("must_change_password=false (đã đổi) → me().mustChangePassword=false (mặc định, KHÔNG phá contract cũ)", async () => {
    const { service } = makeService({ ...baseRow, mustChangePassword: false });
    const result = await service.me("access-token");
    expect(result.mustChangePassword).toBe(false);
    // ADDITIVE: field cũ (mustSetupTwoFactor) giữ nguyên semantics.
    expect(result.mustSetupTwoFactor).toBe(false);
  });
});

/**
 * S2-FND-SEED-3 (LANE SEED3-C-authme) — change-password thành công PHẢI clear `must_change_password`
 * TRONG CÙNG tx (cùng câu UPDATE users với password_hash) ⇒ đổi mật khẩu = hết bị ép + rollback nguyên tử.
 *
 * Chứng minh RED-trước-GREEN: nếu changePassword() KHÔNG set `mustChangePassword: false` thì set-call
 * chứa `passwordHash` KHÔNG có key `mustChangePassword` ⇒ `=== false` vỡ (undefined).
 *
 * tx stub: chain thenable cho UPDATE/INSERT (await trực tiếp); `.limit(1)` trả hash hiện tại cho SELECT.
 * securityEvents default-construct (constructor) → record() gọi tx.insert(...).values(...) → chain nuốt êm.
 */
describe("AuthService.changePassword — clear must_change_password cùng tx (S2-FND-SEED-3)", () => {
  const user = { id: "user-1", companyId: "co-1" } as const;

  function makeChangePwTx() {
    const setCalls: Array<Record<string, unknown>> = [];
    const chain = {
      select: vi.fn(() => chain),
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve([{ passwordHash: "argon2-current-hash" }])),
      update: vi.fn(() => chain),
      set: vi.fn((obj: Record<string, unknown>) => {
        setCalls.push(obj);
        return chain;
      }),
      insert: vi.fn(() => chain),
      values: vi.fn(() => chain),
      // UPDATE/INSERT được `await` trực tiếp ở service → chain là thenable resolve êm.
      then: (resolve: (v: unknown) => void) => resolve(undefined),
    };
    return { tx: chain, setCalls };
  }

  function makeService() {
    const { tx, setCalls } = makeChangePwTx();
    const dbsvc = {
      withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => unknown) => fn(tx)),
    };
    const password = {
      verify: vi.fn().mockResolvedValue(true),
      hash: vi.fn().mockResolvedValue("argon2-new-hash"),
    };
    const rateLimiter = {
      isLocked: vi.fn().mockResolvedValue(false),
      recordFailure: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };

    const Ctor = AuthService as unknown as new (...args: unknown[]) => AuthService;
    const service = new Ctor(
      dbsvc, // 1 dbsvc
      password, // 2 password
      {}, // 3 tokens
      rateLimiter, // 4 rateLimiter
      audit, // 5 audit
      {}, // 6 outbox
      {}, // 7 permissions
      {}, // 8 secrets
      {}, // 9 twoFactor
      {}, // 10 replayGuard
      {}, // 11 securityAlerts
      {}, // 12 securityPolicy
      {}, // 13 modules
    );
    return { service, setCalls, password, audit };
  }

  it("đổi thành công → set mustChangePassword:false trong CÙNG update với password_hash", async () => {
    const { service, setCalls, password, audit } = makeService();

    await expect(service.changePassword(user, "old-pw", "new-pw")).resolves.toBeUndefined();

    // Câu UPDATE users mang password_hash mới PHẢI đồng thời clear cờ (cùng tx, cùng statement).
    const pwUpdate = setCalls.find((c) => "passwordHash" in c);
    expect(pwUpdate).toBeDefined();
    expect(pwUpdate?.passwordHash).toBe("argon2-new-hash");
    expect(pwUpdate?.mustChangePassword).toBe(false);

    // Băm mật khẩu MỚI (KHÔNG log/return plaintext — BẤT BIẾN #3) + audit hành động (DoD §8).
    expect(password.hash).toHaveBeenCalledWith("new-pw");
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "auth.password_changed" }),
    );
  });
});

/**
 * S2-AUTH-DB-3 Lane C (round-2 #6) — isOperatorTx (login-path) quyết `aud=operator` khi user giữ role
 * platform-admin CÒN HIỆU LỰC. Soft-delete assignment platform-admin (deleted_at set) ⇒ login SAU KHÔNG
 * còn là operator. Reader PHẢI lọc `isNull(userRoles.deletedAt)` (trước fix chỉ lọc roles.deletedAt).
 *
 * RED-first: bắt WHERE của query user_roles (private method, gọi qua cast) rồi khẳng định có
 * userRoles.deletedAt trong predicate. Mock trả 0 hàng ⇒ isOperatorTx=false (không load-bearing cho assert
 * cấu trúc). Không cần Postgres — đường tx-thật đã có int-spec riêng dưới LANE_DB (Lane D).
 */
describe("AuthService.isOperatorTx — lọc soft-delete user_roles (S2-AUTH-DB-3 Lane C)", () => {
  function makeOperatorTx() {
    const captures: { userRolesWhere?: unknown } = {};
    const tx = {
      select: (_cols?: unknown) => ({
        from: (table: unknown) => {
          const whereChain = {
            where: (cond?: unknown) => {
              if (table === userRoles) captures.userRolesWhere = cond;
              return { limit: () => Promise.resolve([] as unknown[]) };
            },
          };
          // isOperatorTx: select().from(userRoles).innerJoin(roles).where().limit()
          return { ...whereChain, innerJoin: () => whereChain };
        },
      }),
    };
    return { tx, captures };
  }

  function bareService(): { isOperatorTx: (tx: unknown, userId: string) => Promise<boolean> } {
    const Ctor = AuthService as unknown as new (...args: unknown[]) => AuthService;
    // isOperatorTx chỉ đọc `tx` (const module PLATFORM_ADMIN_ROLE_ID) — KHÔNG chạm this.dep ⇒ stub rỗng an toàn.
    const service = new Ctor({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {});
    return service as unknown as {
      isOperatorTx: (tx: unknown, userId: string) => Promise<boolean>;
    };
  }

  it("WHERE isOperatorTx có isNull(userRoles.deletedAt) — RED nếu chỉ lọc roles.deletedAt", async () => {
    const { tx, captures } = makeOperatorTx();
    const result = await bareService().isOperatorTx(tx, "33333333-3333-3333-3333-333333333333");
    expect(result).toBe(false); // 0 hàng (mock) ⇒ không operator
    expect(captures.userRolesWhere).toBeDefined();
    expect(whereFiltersSoftDelete(captures.userRolesWhere, userRoles)).toBe(true);
  });
});

/**
 * S4-INT-5 (crown-AUTH) — producer thông báo "tài khoản bị khoá tạm" (NOTI-EVENT AUTH_USER_LOCKED,
 * SPEC-08 §15). Chỉ phát ở EDGE sạch: lần sai mật khẩu vừa đẩy bucket per-account qua ngưỡng
 * (LOGIN_ACCOUNT_MAX_ATTEMPTS). login() đã 429 ở đầu (isLoginRateLimited) khi bucket ĐÃ khoá ⇒ mọi lần
 * sau KHÔNG chạm nhánh phát ⇒ đúng 1 notification/lock-window.
 *
 * Cô lập bằng LoginRateLimiter THẬT (in-memory) để driving bucket credential-stuffing (IP KHÁC NHAU mỗi
 * lần ⇒ bucket per-IP KHÔNG khoá sớm, chỉ bucket per-account tích luỹ). resolveCompanyId +
 * findActiveUserByEmail spy (đường tenant-resolve/DB KHÔNG phải đối tượng test). withTenant no-op stub.
 *
 * Chứng minh RED-trước-GREEN: nếu login() KHÔNG có khối emitAccountLocked ở nhánh WrongPassword thì
 * outbox.enqueue('auth.user_locked') KHÔNG bao giờ được gọi ⇒ toHaveLength(1) vỡ.
 */
describe("AuthService.login — account-lock notify producer (S4-INT-5)", () => {
  const SLUG = "acme";
  const REAL_EMAIL = "victim@acme.test";
  const GHOST_EMAIL = "nobody@acme.test";
  const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
  const USER_ID = "11111111-1111-1111-1111-111111111111";

  // tx stub CHAINABLE + THENABLE cho insert/update trong withTenant (login/recordLoginAttempt/bump).
  function makeTxStub() {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      insert: vi.fn(() => chain),
      values: vi.fn(() => chain),
      update: vi.fn(() => chain),
      set: vi.fn(() => chain),
      where: vi.fn(() => chain),
      select: vi.fn(() => chain),
      from: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve([])),
      then: (resolve: (v: unknown) => void) => resolve(undefined),
    });
    return chain;
  }

  function makeAuth(user: Record<string, unknown> | null) {
    const limiter = new LoginRateLimiter();
    const outbox = { enqueue: vi.fn().mockResolvedValue("evt-id") };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const securityEvents = { record: vi.fn().mockResolvedValue(undefined) };
    const withTenant = vi.fn(async (_c: string, fn: (tx: unknown) => unknown) => fn(makeTxStub()));
    const password = {
      verify: vi.fn().mockResolvedValue(false),
      hash: vi.fn().mockResolvedValue("argon2-hash"),
    };
    const auth = Object.create(AuthService.prototype) as AuthService;
    Object.assign(auth, {
      rateLimiter: limiter,
      logger: { error: vi.fn(), warn: vi.fn() },
      dbsvc: { withTenant },
      outbox,
      audit,
      securityEvents,
      password,
    });
    vi.spyOn(
      auth as unknown as { resolveCompanyId: (s: string) => Promise<string | null> },
      "resolveCompanyId",
    ).mockResolvedValue(COMPANY_ID);
    vi.spyOn(
      auth as unknown as { findActiveUserByEmail: (tx: unknown, e: string) => Promise<unknown> },
      "findActiveUserByEmail",
    ).mockResolvedValue(user);
    return { auth, limiter, outbox, audit, securityEvents };
  }

  async function loginWrong(auth: AuthService, email: string, ip: string) {
    try {
      await auth.login(
        { companySlug: SLUG, email, password: "wrong" },
        { ip, userAgent: "vitest" },
      );
    } catch {
      // 401 ĐỒNG NHẤT trên MỌI lần sai — nuốt để assert side-effect (producer), KHÔNG phải outcome.
    }
  }

  function lockEnqueues(outbox: { enqueue: { mock: { calls: unknown[][] } } }) {
    return outbox.enqueue.mock.calls.filter(
      (call) => (call[1] as { eventType: string }).eventType === "auth.user_locked",
    );
  }

  const activeUser = {
    id: USER_ID,
    email: REAL_EMAIL,
    passwordHash: "argon2-hash",
    status: "active",
  };

  it("N lần sai từ IP KHÁC NHAU (credential-stuffing) đẩy bucket account tới ngưỡng → phát ĐÚNG 1 auth.user_locked", async () => {
    const { auth, outbox, audit, securityEvents } = makeAuth({ ...activeUser });
    const N = loadEnv().LOGIN_ACCOUNT_MAX_ATTEMPTS;

    for (let i = 0; i < N; i++) {
      // IP KHÁC NHAU ⇒ bucket per-IP (ngưỡng 5) KHÔNG khoá sớm (mỗi ipKey đúng 1 fail) ⇒ mọi lần đều chạm
      // nhánh fail (không bị 429 ở đầu). Bucket per-account tích luỹ → khoá ĐÚNG lần thứ N.
      await loginWrong(auth, REAL_EMAIL, `203.0.113.${i + 1}`);
    }

    const locks = lockEnqueues(outbox);
    expect(locks).toHaveLength(1);
    // Payload TỐI THIỂU: CHỈ eventCode + userId — KHÔNG IP/attempts/chi tiết bảo mật (BẤT BIẾN #3 · done_when).
    const payload = (locks[0][1] as { payload: Record<string, unknown> }).payload;
    expect(payload).toEqual({ eventCode: "AUTH_USER_LOCKED", userId: USER_ID });
    // dual-write forensic (audit append-only + security timeline). audit KHÔNG set actorUserId (hệ thống khoá).
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "auth.user_locked", objectId: USER_ID }),
    );
    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "USER_LOCKED", userId: USER_ID }),
    );
  });

  it("dưới ngưỡng (N-1 lần sai) → CHƯA phát auth.user_locked (edge, không phát mỗi lần sai)", async () => {
    const { auth, outbox } = makeAuth({ ...activeUser });
    const N = loadEnv().LOGIN_ACCOUNT_MAX_ATTEMPTS;
    for (let i = 0; i < N - 1; i++) {
      await loginWrong(auth, REAL_EMAIL, `203.0.113.${i + 1}`);
    }
    expect(lockEnqueues(outbox)).toHaveLength(0);
  });

  it("ghost email (user KHÔNG tồn tại) vượt ngưỡng → 0 auth.user_locked (anti-enumeration: userId=null)", async () => {
    const { auth, outbox } = makeAuth(null); // findActiveUserByEmail → null ⇒ reason=UserNotFound, userId=null
    const N = loadEnv().LOGIN_ACCOUNT_MAX_ATTEMPTS;
    for (let i = 0; i < N + 1; i++) {
      await loginWrong(auth, GHOST_EMAIL, `198.51.100.${i + 1}`);
    }
    // Bucket account vẫn khoá (recordLoginFailure chạy), NHƯNG nhánh phát gated reason=WrongPassword+userId ⇒ 0.
    expect(lockEnqueues(outbox)).toHaveLength(0);
  });
});

/**
 * S4-INT-5 — emitAccountLocked (producer, cô lập). (a) SILENT-FAILURE: lỗi tx → logger.error (KHÔNG nuốt
 * câm) NHƯNG KHÔNG re-throw ⇒ login vẫn trả 401 ĐỒNG NHẤT (courtesy-notify, không phải security-control).
 * (b) HAPPY: enqueue outbox + audit + security-event trong CÙNG withTenant; payload CHỈ {eventCode,userId}.
 *
 * RED-trước-GREEN: method emitAccountLocked chưa tồn tại → cast-call ném/undefined ⇒ assert vỡ.
 */
describe("AuthService.emitAccountLocked — silent-failure log-not-swallow + payload tối thiểu (S4-INT-5)", () => {
  function bareAuth(withTenantImpl: (c: string, fn: (tx: unknown) => unknown) => Promise<unknown>) {
    const logger = { error: vi.fn(), warn: vi.fn() };
    const outbox = { enqueue: vi.fn().mockResolvedValue("evt") };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const securityEvents = { record: vi.fn().mockResolvedValue(undefined) };
    const auth = Object.create(AuthService.prototype) as AuthService;
    Object.assign(auth, {
      logger,
      outbox,
      audit,
      securityEvents,
      dbsvc: { withTenant: vi.fn(withTenantImpl) },
    });
    return { auth, logger, outbox, audit, securityEvents };
  }

  const emit = (auth: AuthService) =>
    (
      auth as unknown as {
        emitAccountLocked: (c: string, u: string, m: unknown) => Promise<void>;
      }
    ).emitAccountLocked("co-1", "user-1", { ip: "203.0.113.9", userAgent: "vitest" });

  it("tx lỗi → logger.error (KHÔNG nuốt câm) + KHÔNG re-throw (login giữ 401 đồng nhất)", async () => {
    const { auth, logger } = bareAuth(async () => {
      throw new Error("db down");
    });
    await expect(emit(auth)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("happy: outbox+audit+security cùng tx; payload CHỈ eventCode+userId (KHÔNG actorUserId/IP trong event)", async () => {
    const { auth, outbox, audit, securityEvents } = bareAuth(async (_c, fn) => fn({}));
    await emit(auth);

    expect(outbox.enqueue).toHaveBeenCalledWith(expect.anything(), {
      eventType: "auth.user_locked",
      payload: { eventCode: "AUTH_USER_LOCKED", userId: "user-1" },
    });
    // Payload KHÔNG có field actorUserId (⇒ actor-exclusion ở bridge KHÔNG loại chủ TK) và CHỈ 2 khóa.
    const [, ev] = outbox.enqueue.mock.calls[0] as [unknown, { payload: Record<string, unknown> }];
    expect(Object.keys(ev.payload).sort()).toEqual(["eventCode", "userId"]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "auth.user_locked", objectId: "user-1" }),
    );
    expect(securityEvents.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "USER_LOCKED", userId: "user-1" }),
    );
  });
});
