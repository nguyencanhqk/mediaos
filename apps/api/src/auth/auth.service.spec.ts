import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import type { ErrorDetail } from "@mediaos/contracts";
import { Column, SQL } from "drizzle-orm";
import { rlKey as rateLimitKey } from "../common/valkey/valkey-key";
import { TOO_MANY_REQUESTS_MESSAGE } from "../common/filters/retry-after";
import { AuthService, redactEmailFromDetail } from "./auth.service";
import { LoginRateLimiter } from "./login-rate-limiter";
import { TWO_FACTOR_ENFORCED } from "./two-factor.service";
import { loadEnv } from "../config/env.schema";
import { companies, employeeProfiles, passwordResetTokens, userRoles, users } from "../db/schema";

/**
 * S2-AUTH-DB-3 Lane C — RED-first (kiểm chứng CẤU TRÚC WHERE, không cần Postgres). Reader `user_roles`
 * ngoài permission-engine (me() roleRows, isOperatorTx) PHẢI lọc `isNull(userRoles.deletedAt)`. Duyệt
 * `queryChunks` đệ quy tìm Column `deleted_at` THUỘC ĐÚNG bảng — phân biệt userRoles.deleted_at với
 * roles.deleted_at (reader CŨ chỉ lọc roles ⇒ RED; sau fix lọc CẢ HAI ⇒ GREEN).
 */
function whereHasColumn(where: unknown, table: unknown, column: string): boolean {
  let found = false;
  const walk = (node: unknown): void => {
    if (node instanceof Column) {
      if (node.table === table && node.name === column) found = true;
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

function whereFiltersSoftDelete(where: unknown, table: unknown): boolean {
  return whereHasColumn(where, table, "deleted_at");
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
      noteFailureSource: vi.fn().mockResolvedValue(undefined),
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
      noteFailureSource: vi.fn().mockResolvedValue(undefined),
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

// ── S18-AUTH-RETRYAFTER-1 — 429 mang `retryAfterSec` ────────────────────────────────────────────
describe("AuthService — 429 mang retryAfterSec (S18-AUTH-RETRYAFTER-1)", () => {
  const SLUG = "acme";
  const EMAIL = "victim@acme.test";
  const IP = "203.0.113.7";
  const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
  const USER_ID = "11111111-1111-1111-1111-111111111111";

  /** Bóc số giây ra khỏi payload 429 — `null` khi payload không khai `details`. */
  function retryAfterOf(err: unknown): string | null {
    expect(err).toBeInstanceOf(HttpException);
    const e = err as HttpException;
    expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    const payload = e.getResponse() as { message?: unknown; details?: ErrorDetail[] };
    // `message` PHẢI giữ nguyên ở CẢ hai nhánh (Nest initMessage) — ghim luôn tại đây.
    expect(payload.message).toBe(TOO_MANY_REQUESTS_MESSAGE);
    const hit = payload.details?.find((d) => d.field === "retryAfterSec");
    return hit?.message ?? null;
  }

  // ── login(): nhánh 429 có SÀN THỜI GIAN, nên còn phải ghim THỨ TỰ ────────────────────────────
  function makeLoginAuth(opts: { lockedKey: string | null; remaining?: number | null }) {
    const order: string[] = [];
    const rateLimiter = {
      isLocked: vi.fn(async (key: string) => key === opts.lockedKey),
      remainingLockSecOrNull: vi.fn(async (key: string) => {
        order.push(`remainingLockSec:${key}`);
        return opts.remaining ?? null;
      }),
      claimFirstOfWindow: vi.fn(async () => false),
      lockoutSec: 900,
    };
    const auth = Object.create(AuthService.prototype) as AuthService;
    Object.assign(auth, {
      rateLimiter,
      logger: { error: vi.fn(), warn: vi.fn() },
      dbsvc: { withTenant: vi.fn() },
    });
    vi.spyOn(
      auth as unknown as { applyUniformResponseFloor: (s: number, f?: number) => Promise<void> },
      "applyUniformResponseFloor",
    ).mockImplementation(async () => {
      order.push("floor");
    });
    return { auth, rateLimiter, order };
  }

  const login = (auth: AuthService) =>
    auth.login({ companySlug: SLUG, email: EMAIL, password: "wrong" }, { ip: IP, userAgent: "v" });

  it("bucket `acct` khoá ⇒ đọc TTL bằng ĐÚNG accountKey và TRƯỚC khi sàn chạy", async () => {
    const acctKey = LoginRateLimiter.accountKey(SLUG, EMAIL);
    const { auth, rateLimiter, order } = makeLoginAuth({ lockedKey: acctKey, remaining: 842 });

    await expect(login(auth)).rejects.toSatisfy((err) => retryAfterOf(err) === "842");

    expect(rateLimiter.remainingLockSecOrNull).toHaveBeenCalledWith(acctKey);
    // THỨ TỰ LÀ HỢP ĐỒNG: đọc TTL SAU sàn = cộng thẳng round-trip Valkey vào sau mốc tuyệt đối,
    // tức tự tay đẻ lại đúng oracle mà sàn sinh ra để che.
    expect(order).toEqual(["remainingLockSec:" + acctKey, "floor"]);
  });

  it("bucket `ip` khoá ⇒ đọc TTL bằng ĐÚNG khoá per-IP (không dựng khoá lần hai bằng tay)", async () => {
    const ipKey = LoginRateLimiter.key(SLUG, EMAIL, IP);
    const { auth, rateLimiter } = makeLoginAuth({ lockedKey: ipKey, remaining: 77 });

    await expect(login(auth)).rejects.toSatisfy((err) => retryAfterOf(err) === "77");
    expect(rateLimiter.remainingLockSecOrNull).toHaveBeenCalledWith(ipKey);
  });

  it("TTL `null` (Valkey rớt) ⇒ VẪN 429, KHÔNG `details`, KHÔNG '0 giây'", async () => {
    const { auth } = makeLoginAuth({
      lockedKey: LoginRateLimiter.accountKey(SLUG, EMAIL),
      remaining: null,
    });

    await expect(login(auth)).rejects.toSatisfy((err) => retryAfterOf(err) === null);
  });

  it("KHÔNG khoá ⇒ KHÔNG đọc TTL một round-trip nào (đường sạch không trả thêm giá)", async () => {
    const { auth, rateLimiter } = makeLoginAuth({ lockedKey: null });
    vi.spyOn(
      auth as unknown as { resolveCompanyId: (s: string) => Promise<string | null> },
      "resolveCompanyId",
    ).mockResolvedValue(null);
    Object.assign(auth, {
      password: { hash: vi.fn().mockResolvedValue("h") },
      recordLoginFailure: vi.fn().mockResolvedValue(undefined),
      recordLoginAttempt: vi.fn().mockResolvedValue(undefined),
    });

    // ⚠️ KHÔNG dùng `.rejects.toThrow()` TRẦN: nó xanh với BẤT KỲ lỗi nào, kể cả `TypeError` do mock
    // thiếu một method — lúc đó `remainingLockSecOrNull` "không được gọi" chỉ vì hàm đã chết TRƯỚC khi
    // tới đó, và ca này biến thành xanh-RỖNG (cùng họ `.not.toBe(403)` nuốt cả 500). Ghim đúng lớp lỗi
    // của đường không-khoá: 401 đồng nhất.
    await expect(login(auth)).rejects.toThrow(UnauthorizedException);
    expect(rateLimiter.remainingLockSecOrNull).not.toHaveBeenCalled();
  });

  // ── 3 chỗ ném còn lại trong auth.service (actor ĐÃ có token ⇒ không cần sàn) ─────────────────
  function makeReauthAuth(remaining: number | null) {
    const rateLimiter = {
      isLocked: vi.fn(async () => true),
      remainingLockSecOrNull: vi.fn(async () => remaining),
    };
    const twoFactor = { requiresTwoFactor: vi.fn(async () => false) };
    const auth = Object.create(AuthService.prototype) as AuthService;
    Object.assign(auth, { rateLimiter, twoFactor, logger: { error: vi.fn(), warn: vi.fn() } });
    return { auth, rateLimiter };
  }

  const ACTOR = { id: USER_ID, companyId: COMPANY_ID };

  it("disableTwoFactor 429 mang số giây, đọc bằng ĐÚNG khoá `2fa-disable`", async () => {
    const { auth, rateLimiter } = makeReauthAuth(300);

    await expect(auth.disableTwoFactor(ACTOR, "pw")).rejects.toSatisfy(
      (err) => retryAfterOf(err) === "300",
    );
    expect(rateLimiter.remainingLockSecOrNull).toHaveBeenCalledWith(
      rateLimitKey("2fa-disable", `${COMPANY_ID}|${USER_ID}`),
    );
  });

  it("changePassword 429 mang số giây, đọc bằng ĐÚNG khoá `change-pw`", async () => {
    const { auth, rateLimiter } = makeReauthAuth(120);

    await expect(auth.changePassword(ACTOR, "old", "new")).rejects.toSatisfy(
      (err) => retryAfterOf(err) === "120",
    );
    expect(rateLimiter.remainingLockSecOrNull).toHaveBeenCalledWith(
      rateLimitKey("change-pw", `${COMPANY_ID}|${USER_ID}`),
    );
  });

  it("completeTwoFactorLogin 429 mang số giây, đọc bằng ĐÚNG khoá twoFactorKey", async () => {
    // Chỗ ném 429 THỨ NĂM — trước WO này KHÔNG có ca nào chạm nhánh này (cùng họ với mock rỗng ở
    // `two-factor.service.spec.ts`): `grep verifyTwoFactorChallenge *.spec.ts` chỉ ra spec của
    // TokenService, không phải của đường này.
    const rlKey = LoginRateLimiter.twoFactorKey(COMPANY_ID, USER_ID);
    const rateLimiter = {
      isLocked: vi.fn(async () => true),
      remainingLockSecOrNull: vi.fn(async () => 480),
      // `claimFirstOfWindow` được gọi HAI lần trên đường này (replay-guard + gộp log 429) — trả false
      // để không rẽ vào nhánh ghi `login_logs` (cần DB), ta chỉ đo hình dạng của 429.
      claimFirstOfWindow: vi.fn(async () => false),
      lockoutSec: 900,
    };
    const auth = Object.create(AuthService.prototype) as AuthService;
    Object.assign(auth, {
      rateLimiter,
      logger: { error: vi.fn(), warn: vi.fn() },
      tokens: {
        verifyTwoFactorChallenge: vi.fn(() => ({
          sub: USER_ID,
          companyId: COMPANY_ID,
          jti: "jti-1",
        })),
      },
      // `true` = challengeToken dùng LẦN ĐẦU ⇒ đi tiếp xuống nhánh khoá. `false` sẽ rẽ sang 401
      // replay và ca này xanh-RỖNG (không bao giờ chạm chỗ ném 429).
      replayGuard: { claim: vi.fn(async () => true) },
    });

    await expect(
      auth.completeTwoFactorLogin("challenge-token", "123456", { ip: IP, userAgent: "v" }),
    ).rejects.toSatisfy((err) => retryAfterOf(err) === "480");
    expect(rateLimiter.remainingLockSecOrNull).toHaveBeenCalledWith(rlKey);
  });

  it("changePassword TTL `null` ⇒ 429 KHÔNG `details` (hành vi y hệt trước WO này)", async () => {
    const { auth } = makeReauthAuth(null);

    await expect(auth.changePassword(ACTOR, "old", "new")).rejects.toSatisfy(
      (err) => retryAfterOf(err) === null,
    );
  });
});

/**
 * S18-AUTH-RESETCLEARS-1 — `resetPassword` (tự phục vụ) gỡ luôn khoá đăng nhập 429.
 *
 * Ba trục được đo ở đây, và cả ba đều là nhánh QUYẾT ĐỊNH chứ không phải hình dạng:
 *   1. chỉ gỡ khi token HỢP LỆ (ba nhánh hỏng phải im lặng tuyệt đối trên không gian khoá);
 *   2. gỡ với `includeForgot:false` và KHÔNG `subject` — hai control còn lại không được đụng tới;
 *   3. gỡ hỏng KHÔNG được ném (mật khẩu đã đổi, token đã dùng) nhưng cũng KHÔNG được im.
 */
describe("AuthService.resetPassword — gỡ khoá 429 sau khi đặt lại mật khẩu (S18-AUTH-RESETCLEARS-1)", () => {
  const COMPANY_ID = "3f6a6a3e-3a52-4f2f-9f6e-2a1c4b8d0e11";
  const USER_ID = "9a2c1b44-0d6b-4a1e-8c33-77d5f0a1b2c3";
  const EMAIL = "victim@acme.test";
  const TOKEN = `${COMPANY_ID}.opaque-token-part`;

  function makeService(
    over: {
      tokenRow?: Record<string, unknown> | null;
      /** Hàng `users` mà câu UPDATE trả về. `[]` = bị predicate từ chối (xoá mềm / lệch tenant). */
      updatedRow?: Array<{ email: string }>;
      /** Hàng `.returning()` của câu ĐÒI token nguyên tử. `[]` = thua race / token đã dùng. */
      claimed?: Array<{ id: string }>;
      /** Hàng `users` mà SELECT đo-lý-do ở nhánh từ chối đọc được. */
      probeRow?: Array<{ deletedAt: Date | null }>;
      companyRows?: Array<{ slug: string }>;
      clearImpl?: () => Promise<{ clearedKeys: number; degraded: boolean }>;
      /** Cho phép ép `audit.record` NÉM — pin hành vi "ghi vết hỏng thì fail-closed". */
      auditImpl?: () => Promise<void>;
    } = {},
  ) {
    const tokenRow =
      over.tokenRow === undefined
        ? {
            id: "tok-1",
            userId: USER_ID,
            usedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          }
        : over.tokenRow;

    // S18-AUTH-RESETDELETED-1 — mock phải BIẾT nó đang dựng câu trên BẢNG NÀO. `resetPassword` giờ
    // chạm ba bảng và có HAI câu `.returning()` (đòi token nguyên tử · UPDATE users); trả chung một
    // giá trị cho cả hai là cách nhanh nhất biến một ca từ chối thành xanh-RỖNG.
    let current: unknown = null;
    const wheres: Array<{ table: unknown; where: unknown }> = [];
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      from: vi.fn((t: unknown) => {
        current = t;
        return chain;
      }),
      where: vi.fn((w: unknown) => {
        wheres.push({ table: current, where: w });
        return chain;
      }),
      limit: vi.fn(() =>
        Promise.resolve(
          current === users ? (over.probeRow ?? [{ deletedAt: null }]) : tokenRow ? [tokenRow] : [],
        ),
      ),
      update: vi.fn((t: unknown) => {
        current = t;
        return chain;
      }),
      set: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      values: vi.fn(() => chain),
      returning: vi.fn(() =>
        Promise.resolve(
          current === passwordResetTokens
            ? (over.claimed ?? [{ id: "tok-1" }])
            : (over.updatedRow ?? [{ email: EMAIL }]),
        ),
      ),
      execute: vi.fn(async () => ({
        rows: over.companyRows ?? [{ slug: "acme" }],
      })),
      then: (resolve: (v: unknown) => void) => resolve(undefined),
    };

    const dbsvc = {
      withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => unknown) => fn(chain)),
    };
    const clearLoginLocks = vi.fn(
      over.clearImpl ?? (async () => ({ clearedKeys: 8, degraded: false })),
    );
    const rateLimiter = { clearLoginLocks };
    const audit = {
      record: over.auditImpl ? vi.fn(over.auditImpl) : vi.fn().mockResolvedValue(undefined),
    };
    const securityEvents = { record: vi.fn().mockResolvedValue(undefined) };

    const Ctor = AuthService as unknown as new (...args: unknown[]) => AuthService;
    const service = new Ctor(
      dbsvc, // 1 dbsvc
      { hash: vi.fn().mockResolvedValue("argon2-new-hash") }, // 2 password
      { hashToken: vi.fn(() => "hashed-token") }, // 3 tokens
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
    (service as unknown as { securityEvents: unknown }).securityEvents = securityEvents;
    const svcLogger = (
      service as unknown as {
        logger: { error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
      }
    ).logger;
    const logger = vi.spyOn(svcLogger, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(svcLogger, "warn").mockImplementation(() => undefined);
    return { service, clearLoginLocks, audit, securityEvents, logger, warn, chain, wheres };
  }

  it("token HỢP LỆ ⇒ gỡ khoá với ĐÚNG 4 đối số: slug/email từ DB · subject undefined · includeForgot=false", async () => {
    const { service, clearLoginLocks } = makeService();
    await expect(
      service.resetPassword({ token: TOKEN, newPassword: "N3wPassw0rd" }),
    ).resolves.toBeUndefined();
    // `undefined` ở vế 3 KHÔNG phải thừa: truyền `subject` sẽ gỡ bucket `rl:2fa` — control DUY NHẤT
    // chặn dò TOTP bước-2 — bằng một thao tác chỉ chứng minh quyền kiểm soát HÒM THƯ.
    // `includeForgot:false` giữ trần của endpoint forgot (công khai, không xác thực).
    expect(clearLoginLocks).toHaveBeenCalledTimes(1);
    expect(clearLoginLocks).toHaveBeenCalledWith("acme", EMAIL, undefined, {
      includeForgot: false,
    });
  });

  it.each([
    ["token không tồn tại", null],
    [
      "token ĐÃ DÙNG",
      {
        id: "t",
        userId: USER_ID,
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    ],
    [
      "token HẾT HẠN",
      {
        id: "t",
        userId: USER_ID,
        usedAt: null,
        expiresAt: new Date(Date.now() - 1),
      },
    ],
  ])("%s ⇒ 401 + TUYỆT ĐỐI không chạm không gian khoá", async (_label, tokenRow) => {
    const { service, clearLoginLocks } = makeService({ tokenRow });
    await expect(
      service.resetPassword({ token: TOKEN, newPassword: "N3wPassw0rd" }),
    ).rejects.toThrow("Token không hợp lệ hoặc đã hết hạn.");
    // Gọi clear ở nhánh hỏng = biến một endpoint nhận token TUỲ Ý thành nút gỡ khoá theo email.
    expect(clearLoginLocks).not.toHaveBeenCalled();
  });

  it("ba nhánh token hỏng trả chuỗi lỗi BYTE-GIỐNG NHAU (thay cho sàn thời gian — done_when sửa 03/09)", async () => {
    const rows = [
      null,
      {
        id: "t",
        userId: USER_ID,
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: "t",
        userId: USER_ID,
        usedAt: null,
        expiresAt: new Date(Date.now() - 1),
      },
    ];
    const messages: string[] = [];
    for (const tokenRow of rows) {
      const { service } = makeService({ tokenRow });
      await service
        .resetPassword({ token: TOKEN, newPassword: "N3wPassw0rd" })
        .catch((e: Error) => messages.push(e.message));
    }
    expect(messages).toHaveLength(3);
    expect(new Set(messages).size).toBe(1);
  });

  /**
   * S18-AUTH-RESETDELETED-1 — ca "user xoá mềm ⇒ KHÔNG gỡ khoá" và ca đối chứng "…trong IM LẶNG" của
   * WO trước ĐÃ BỊ XOÁ khỏi đây, KHÔNG phải sửa cho xanh.
   *
   * Lý do: cả hai gieo `updated.deletedAt = <Date>`, một trạng thái mà người gọi thật không còn dựng
   * được — predicate `deleted_at IS NULL` nay nằm trong chính câu UPDATE, nên hàng đã xoá dừng ở tầng
   * DB và không bao giờ tới `clearLoginLocksAfterReset`. Giữ chúng lại là ghim một trạng thái không
   * tồn tại (`tests-can-pin-a-hole-open`). Bảo vệ tương ứng được đo ở hai chỗ ĐÚNG hơn: predicate ở
   * ca ngay dưới, và hành vi đầu-cuối trên DB thật ở `auth-s18-resetdeleted-1.int-spec.ts`.
   *
   * ⚠️ Ca dưới đây là kiểm CẤU TRÚC. Nó KHÔNG thay được int-spec: mock `.returning()` mù với
   * `.where()`, nên nếu chỉ có ca này thì gỡ cả predicate đi vẫn có thể xanh ở nơi khác.
   */
  it("câu UPDATE `users` lọc CẢ `deleted_at IS NULL` LẪN `company_id` — RED nếu thiếu một vế", async () => {
    const { service, wheres } = makeService();
    await service.resetPassword({ token: TOKEN, newPassword: "N3wPassw0rd" });

    // ⚠️ Hai vế phải nằm trên CÙNG MỘT `where`. Hai `.some()` độc lập sẽ được thoả bởi HAI câu KHÁC
    // NHAU (mỗi câu một vế) ngay khi ai đó thêm một câu `users` thứ hai vào đường này — đúng hình
    // dạng `same-builder-twice-makes-unit-spec-vacuous`.
    const userWrites = wheres.filter((w) => w.table === users);
    expect(userWrites.length).toBeGreaterThan(0);
    expect(
      userWrites.some(
        (w) =>
          // Vế xoá-mềm: email của user đã xoá có thể đã cấp lại cho NGƯỜI KHÁC (unique là PARTIAL).
          whereFiltersSoftDelete(w.where, users) &&
          // Vế tenant (BẤT BIẾN #1): trước WO này đường reset chỉ dựa vào RLS, khác mọi repo khác.
          whereHasColumn(w.where, users, "company_id"),
      ),
    ).toBe(true);
  });

  it("audit ở nhánh từ chối NÉM ⇒ lỗi PHẢI trồi lên (fail-closed), KHÔNG bị nuốt thành 401 giả", async () => {
    // Quyết định đã ký ở plan §3.2: ghi vết hỏng ⇒ tx rollback ⇒ mất luôn `used_at` ⇒ token SỐNG LẠI
    // và người dùng nhận 500. Chấp nhận được vì fail-CLOSED (không ai đổi được mật khẩu), nhưng một
    // quyết định 0 test pin thì lần refactor sau (vd bọc `audit.record` trong try/catch "cho an
    // toàn") sẽ lặng lẽ đổi nó: khi đó nhánh từ chối trả 401 mà KHÔNG còn vết nào — đúng thứ mà
    // memory `fix-commit-for-review-findings-is-itself-ungated` cảnh báo.
    const boom = new Error("audit sink down");
    const { service, clearLoginLocks } = makeService({
      updatedRow: [],
      probeRow: [{ deletedAt: new Date() }],
      auditImpl: () => Promise.reject(boom),
    });
    // KHÔNG phải UnauthorizedException: 401 ở đây nghĩa là lỗi đã bị nuốt và vết đã mất trong im lặng.
    await expect(service.resetPassword({ token: TOKEN, newPassword: "N3wPassw0rd" })).rejects.toBe(
      boom,
    );
    expect(clearLoginLocks).not.toHaveBeenCalled();
  });

  it("token đã dùng/thua race ⇒ ĐÒI token khớp 0 hàng ⇒ 401, KHÔNG đổi mật khẩu, KHÔNG gỡ khoá", async () => {
    // Trạng thái này TỚI ĐƯỢC (khác hai ca đã xoá ở trên): `UPDATE … WHERE used_at IS NULL` khớp 0
    // hàng khi một request khác vừa đòi được token. Đây là vế ép single-use thành thật.
    const { service, clearLoginLocks, audit } = makeService({ claimed: [] });
    await expect(
      service.resetPassword({ token: TOKEN, newPassword: "N3wPassw0rd" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(clearLoginLocks).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("predicate `users` từ chối (xoá mềm) ⇒ 401 + audit 'auth.password_reset_denied', KHÔNG gỡ khoá", async () => {
    const { service, clearLoginLocks, audit, securityEvents } = makeService({
      updatedRow: [],
      probeRow: [{ deletedAt: new Date() }],
    });
    await expect(
      service.resetPassword({ token: TOKEN, newPassword: "N3wPassw0rd" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // Vết forensics phải ĐO rồi mới ghi — `reason` suy từ SELECT đo-lý-do, không phải hằng.
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][1]).toMatchObject({
      action: "auth.password_reset_denied",
      objectType: "auth",
      after: { reason: "user_deleted" },
    });
    // TUYỆT ĐỐI không được ghi vết "đã đặt lại thành công" cho một lượt bị từ chối.
    expect(securityEvents.record).not.toHaveBeenCalled();
    expect(clearLoginLocks).not.toHaveBeenCalled();
  });

  it("không đọc được slug ⇒ KHÔNG đoán, KHÔNG gỡ, KHÔNG hỏng reset — nhưng PHẢI cảnh báo", async () => {
    const { service, clearLoginLocks, warn } = makeService({ companyRows: [] });
    await expect(
      service.resetPassword({ token: TOKEN, newPassword: "N3wPassw0rd" }),
    ).resolves.toBeUndefined();
    expect(clearLoginLocks).not.toHaveBeenCalled();
    // Khác hẳn ca user-xoá-mềm ngay dưới: thiếu hàng `companies` cho `companyId` của một token VỪA
    // ĐƯỢC CẤP là lệch dữ liệu, không phải nghiệp vụ. Đây là ca "không gỡ vì chưa từng thử gỡ" —
    // im lặng ở đây để lại ÍT dấu vết hơn cả ca Valkey chập chờn.
    expect(warn).toHaveBeenCalled();
  });

  it("ca BÌNH THƯỜNG ⇒ KHÔNG cảnh báo nhiễu (đối chứng của ca thiếu-slug ngay trên)", async () => {
    // Đối chứng giữ lại từ cặp cũ: nếu gộp các nhánh dừng vào một `if` chung thì hoặc mất cảnh báo
    // cho ca lệch dữ liệu, hoặc bồi cảnh báo cho ca bình thường — cặp này ghim cả hai chiều. Vế
    // "user xoá mềm" của cặp cũ đã chuyển lên tầng predicate (xem khối ca ở trên).
    const { service, warn, logger } = makeService();
    await service.resetPassword({ token: TOKEN, newPassword: "N3wPassw0rd" });
    expect(warn).not.toHaveBeenCalled();
    expect(logger).not.toHaveBeenCalled();
  });

  it("gỡ khoá NÉM ⇒ reset vẫn thành công, nhưng PHẢI log ERROR (catch rỗng ⇒ ca này ĐỎ)", async () => {
    // `ValkeyService` theo hợp đồng "never throws" ⇒ tới được đây là BUG (namespace khoá sai / DI vắng).
    // Một `catch {}` ở đây chỉ có tác dụng giấu đúng loại lỗi đó.
    const { service, logger, audit } = makeService({
      clearImpl: async () => {
        throw new Error("ValkeyKeyScopeError: khoá ngoài phạm vi env");
      },
    });
    await expect(
      service.resetPassword({ token: TOKEN, newPassword: "N3wPassw0rd" }),
    ).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalled();
    const actions = audit.record.mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(actions).toContain("user.login_throttle_cleared");
  });

  it("gỡ khoá degraded ⇒ ghi vết USER_UNLOCKED{ok:false}; ca THÀNH CÔNG thì KHÔNG ghi (đối chứng)", async () => {
    const bad = makeService({
      clearImpl: async () => ({ clearedKeys: 8, degraded: true }),
    });
    await bad.service.resetPassword({
      token: TOKEN,
      newPassword: "N3wPassw0rd",
    });
    // Nhánh degraded KHÔNG ném ⇒ nếu chỉ ghi audit thì log/APM im lặng đúng lúc bất thường nhất
    // (mật khẩu đã đổi mà không kết luận được khoá đã gỡ hay chưa).
    expect(bad.logger).toHaveBeenCalled();
    const badEvents = bad.securityEvents.record.mock.calls.map(
      (c) =>
        c[1] as {
          eventType: string;
          payload?: { ok?: boolean; reason?: string };
        },
    );
    expect(badEvents.find((e) => e.eventType === "USER_UNLOCKED")?.payload).toMatchObject({
      reason: "password_reset",
      ok: false,
    });

    // Đối chứng: thiếu vế này thì ca trên vẫn xanh khi code ghi vết VÔ ĐIỀU KIỆN — tức bồi
    // `USER_UNLOCKED` cho tài khoản chưa từng bị khoá, đúng món nợ WO-1 đã ghi ở §10.5.
    const good = makeService();
    await good.service.resetPassword({
      token: TOKEN,
      newPassword: "N3wPassw0rd",
    });
    const goodEvents = good.securityEvents.record.mock.calls.map(
      (c) => (c[1] as { eventType: string }).eventType,
    );
    expect(goodEvents).not.toContain("USER_UNLOCKED");
  });
});
