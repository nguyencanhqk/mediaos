import { describe, it, expect, vi } from "vitest";
import { AuthService } from "./auth.service";
import { LoginRateLimiter } from "./login-rate-limiter";
import { loadEnv } from "../config/env.schema";

/**
 * S2-AUTH-BE-4 — forgot-password rate-limit (chống dội email reset / enumeration timing).
 *
 * Sau N lần forgot-password cho CÙNG account/IP, limiter báo locked. Đường locked PHẢI trả VOID ĐỒNG NHẤT
 * (KHÔNG ném, KHÔNG đổi outcome) — tuyệt đối không lộ "account tồn tại". Limiter dùng LẠI LoginRateLimiter
 * (in-memory fallback khi không có Valkey) — cùng cơ chế với login.
 *
 * S2-QA-DEBT-1 (efficacy): KHÔNG chỉ test "void khi đã pre-lock". Bổ sung 2 assert THẬT:
 *   (a) N lần forgotPassword THẬT (= LOGIN_MAX_ATTEMPTS) đẩy bucket per-IP tới locked — không pre-lock tay.
 *   (b) khi locked, withTenant/DB KHÔNG được gọi (short-circuit) — chứng tỏ rate-limit cắt TRƯỚC khi chạm DB.
 *   + control: đường KHÔNG-locked CÓ gọi withTenant đúng 1 lần (để (b) có nghĩa, không phải no-op).
 */
describe("AuthService.forgotPassword — rate-limit uniform-void (S2-AUTH-BE-4)", () => {
  const meta = { ip: "203.0.113.5", userAgent: "vitest" };
  const SLUG = "acme";
  const EMAIL = "user@acme.test";

  /**
   * Dựng AuthService với rate-limiter THẬT + stub resolveCompanyId (luôn resolve) + withTenant SPY no-op
   * (KHÔNG chạm DB). Trả về spy `withTenant` để khẳng định short-circuit (locked ⇒ KHÔNG chạm DB).
   */
  function makeAuth(): {
    auth: AuthService;
    limiter: LoginRateLimiter;
    withTenant: ReturnType<typeof vi.fn>;
  } {
    const limiter = new LoginRateLimiter();
    // withTenant SPY: no-op trả undefined. Ta chỉ quan tâm withTenant CÓ được gọi hay không (đường-thường
    // chạm DB) — đủ để khẳng định short-circuit khi locked.
    const withTenant = vi.fn(async () => undefined);
    const auth = Object.create(AuthService.prototype) as AuthService;
    // Gán field private cần thiết qua cast (chỉ cho test).
    Object.assign(auth, {
      rateLimiter: limiter,
      logger: { error: vi.fn(), warn: vi.fn() },
      dbsvc: { withTenant },
    });
    // resolveCompanyId luôn resolve một company giả (đường tenant-resolve KHÔNG phải đối tượng test này).
    vi.spyOn(
      auth as unknown as { resolveCompanyId: (s: string) => Promise<string | null> },
      "resolveCompanyId",
    ).mockResolvedValue("00000000-0000-0000-0000-000000000001");
    return { auth, limiter, withTenant };
  }

  it("control: đường KHÔNG locked → trả VOID + GỌI withTenant đúng 1 lần (để assert short-circuit có nghĩa)", async () => {
    const { auth, withTenant } = makeAuth();
    await expect(
      auth.forgotPassword({ companySlug: SLUG, email: EMAIL }, meta),
    ).resolves.toBeUndefined();
    expect(withTenant).toHaveBeenCalledTimes(1);
  });

  it("(b) sau khi bucket account bị khoá → forgotPassword trả VOID + SHORT-CIRCUIT (KHÔNG gọi withTenant)", async () => {
    const { auth, limiter, withTenant } = makeAuth();
    // Khoá thủ công bucket account để mô phỏng "đã quá ngưỡng".
    const acctKey = LoginRateLimiter.accountKey(SLUG, EMAIL);
    for (let i = 0; i < limiter.accountMaxAttempts; i++) {
      await limiter.recordFailure(acctKey, limiter.accountMaxAttempts);
    }
    expect(await limiter.isLocked(acctKey)).toBe(true);

    await expect(
      auth.forgotPassword({ companySlug: SLUG, email: EMAIL }, meta),
    ).resolves.toBeUndefined();
    // BẤT BIẾN efficacy: locked ⇒ cắt TRƯỚC khi chạm DB (không tạo token / không ghi outbox / không audit).
    expect(withTenant).not.toHaveBeenCalled();
  });

  it("(a) N lần forgotPassword THẬT (= LOGIN_MAX_ATTEMPTS) đẩy bucket per-IP tới locked + cuộc gọi kế short-circuit", async () => {
    const { auth, limiter, withTenant } = makeAuth();
    const ipKey = LoginRateLimiter.key(SLUG, EMAIL, meta.ip);
    const maxAttempts = loadEnv().LOGIN_MAX_ATTEMPTS; // N từ chính nguồn limiter dùng — KHÔNG magic number.

    expect(await limiter.isLocked(ipKey)).toBe(false);
    for (let i = 0; i < maxAttempts; i++) {
      // Trước MỖI lần gọi, bucket CHƯA khoá ⇒ cuộc gọi đi hết đường-thường (không short-circuit sớm).
      expect(await limiter.isLocked(ipKey), `lần ${i + 1} không được pre-locked`).toBe(false);
      await expect(
        auth.forgotPassword({ companySlug: SLUG, email: EMAIL }, meta),
      ).resolves.toBeUndefined();
    }
    // Đúng N cuộc gọi THẬT → bucket per-IP đã khoá (efficacy: N forgotPassword đẩy tới locked).
    expect(await limiter.isLocked(ipKey)).toBe(true);
    expect(withTenant).toHaveBeenCalledTimes(maxAttempts); // mỗi lần trong loop đều chạm DB (chưa khoá).

    // Cuộc gọi KẾ TIẾP (đã locked) → short-circuit, KHÔNG chạm DB thêm.
    withTenant.mockClear();
    await expect(
      auth.forgotPassword({ companySlug: SLUG, email: EMAIL }, meta),
    ).resolves.toBeUndefined();
    expect(withTenant).not.toHaveBeenCalled();
  });

  it("đường locked KHÔNG phân biệt được với đường thường (cùng trả void)", async () => {
    const { auth } = makeAuth();
    // Chưa khoá → vẫn void.
    await expect(
      auth.forgotPassword({ companySlug: SLUG, email: EMAIL }, meta),
    ).resolves.toBeUndefined();
  });
});
