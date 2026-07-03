import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictException } from "@nestjs/common";
import { AuthService, redactEmailFromDetail } from "./auth.service";
import { TWO_FACTOR_ENFORCED } from "./two-factor.service";

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
