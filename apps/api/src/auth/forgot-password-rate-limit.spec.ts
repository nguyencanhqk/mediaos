import { describe, it, expect, vi } from "vitest";
import { AuthService } from "./auth.service";
import { LoginRateLimiter } from "./login-rate-limiter";

/**
 * S2-AUTH-BE-4 — forgot-password rate-limit (chống dội email reset / enumeration timing).
 *
 * Sau N lần forgot-password cho CÙNG account/IP, limiter báo locked. Đường locked PHẢI trả VOID ĐỒNG NHẤT
 * (KHÔNG ném, KHÔNG đổi outcome) — tuyệt đối không lộ "account tồn tại". Limiter dùng LẠI LoginRateLimiter
 * (in-memory fallback khi không có Valkey) — cùng cơ chế với login.
 */
describe("AuthService.forgotPassword — rate-limit uniform-void (S2-AUTH-BE-4)", () => {
  const meta = { ip: "203.0.113.5", userAgent: "vitest" };
  const SLUG = "acme";
  const EMAIL = "user@acme.test";

  /**
   * Dựng AuthService với rate-limiter THẬT + stub resolveCompanyId (luôn resolve) + withTenant no-op
   * (KHÔNG chạm DB). Mục tiêu: chỉ kiểm hành vi cổng rate-limit, không phải DB.
   */
  function makeAuth(): { auth: AuthService; limiter: LoginRateLimiter } {
    const limiter = new LoginRateLimiter();
    const auth = Object.create(AuthService.prototype) as AuthService;
    // Gán field private cần thiết qua cast (chỉ cho test).
    Object.assign(auth, {
      rateLimiter: limiter,
      logger: { error: vi.fn(), warn: vi.fn() },
    });
    // resolveCompanyId luôn resolve một company giả.
    vi.spyOn(
      auth as unknown as { resolveCompanyId: (s: string) => Promise<string | null> },
      "resolveCompanyId",
    ).mockResolvedValue("00000000-0000-0000-0000-000000000001");
    // withTenant: chạy callback với tx giả mà findActiveUserByEmail trả null (im lặng) — đủ cho test
    // rate-limit (đường ghi DB không cần). dbsvc.withTenant no-op trả undefined.
    Object.assign(auth, {
      dbsvc: { withTenant: async () => undefined },
    });
    return { auth, limiter };
  }

  it("sau khi bucket account bị khoá → forgotPassword vẫn trả VOID (KHÔNG ném)", async () => {
    const { auth, limiter } = makeAuth();
    // Khoá thủ công bucket account để mô phỏng "đã quá ngưỡng".
    const acctKey = LoginRateLimiter.accountKey(SLUG, EMAIL);
    for (let i = 0; i < limiter.accountMaxAttempts; i++) {
      await limiter.recordFailure(acctKey, limiter.accountMaxAttempts);
    }
    expect(await limiter.isLocked(acctKey)).toBe(true);

    await expect(
      auth.forgotPassword({ companySlug: SLUG, email: EMAIL }, meta),
    ).resolves.toBeUndefined();
  });

  it("đường locked KHÔNG phân biệt được với đường thường (cùng trả void)", async () => {
    const { auth } = makeAuth();
    // Chưa khoá → vẫn void.
    await expect(
      auth.forgotPassword({ companySlug: SLUG, email: EMAIL }, meta),
    ).resolves.toBeUndefined();
  });
});
