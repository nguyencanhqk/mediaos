import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "./login-rate-limiter";

describe("LoginRateLimiter (brute-force)", () => {
  it("khoá tạm sau LOGIN_MAX_ATTEMPTS lần sai liên tiếp (mặc định 5)", () => {
    const rl = new LoginRateLimiter();
    const key = LoginRateLimiter.key("acme", "a@b.c", "1.1.1.1");
    const now = 1_000_000;
    expect(rl.isLocked(key, now)).toBe(false);
    for (let i = 0; i < 5; i++) rl.recordFailure(key, now);
    expect(rl.isLocked(key, now)).toBe(true);
  });

  it("hết thời gian khoá → mở lại", () => {
    const rl = new LoginRateLimiter();
    const key = LoginRateLimiter.key("acme", "a@b.c", "1.1.1.1");
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) rl.recordFailure(key, now);
    expect(rl.isLocked(key, now)).toBe(true);
    expect(rl.isLocked(key, now + 901_000)).toBe(false); // > LOGIN_LOCKOUT_SEC (900s)
  });

  it("reset() xoá trạng thái sau login thành công", () => {
    const rl = new LoginRateLimiter();
    const key = LoginRateLimiter.key("acme", "a@b.c", "1.1.1.1");
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) rl.recordFailure(key, now);
    rl.reset(key);
    expect(rl.isLocked(key, now)).toBe(false);
  });

  it("key chuẩn hoá email lowercase (case-insensitive)", () => {
    expect(LoginRateLimiter.key("acme", "A@B.C", "ip")).toBe(
      LoginRateLimiter.key("acme", "a@b.c", "ip"),
    );
  });
});
