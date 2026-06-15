import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "./login-rate-limiter";
import type { ValkeyService } from "../permission/valkey.service";

/**
 * Fake Valkey: Map nội bộ mô phỏng incr/get/set/del + EXPIRE bỏ qua (test đếm ngưỡng, không test TTL thật).
 * `enabled` cho phép test nhánh fail-soft (bật-nhưng-rớt → fallback memory).
 */
function fakeValkey(enabled = true) {
  const store = new Map<string, string>();
  return {
    store,
    isEnabled: () => enabled,
    async incr(key: string) {
      const n = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(n));
      return enabled ? n : null;
    },
    async get(key: string) {
      return enabled ? (store.get(key) ?? null) : null;
    },
    async set(key: string, val: string) {
      if (enabled) store.set(key, val);
      return true;
    },
    async del(...keys: string[]) {
      keys.forEach((k) => store.delete(k));
      return true;
    },
  } as unknown as ValkeyService & { store: Map<string, string> };
}

describe("LoginRateLimiter (brute-force)", () => {
  describe("in-memory (single-instance fallback, không có Valkey)", () => {
    it("khoá tạm sau LOGIN_MAX_ATTEMPTS lần sai liên tiếp (mặc định 5)", async () => {
      const rl = new LoginRateLimiter();
      const key = LoginRateLimiter.key("acme", "a@b.c", "1.1.1.1");
      const now = 1_000_000;
      expect(await rl.isLocked(key, now)).toBe(false);
      for (let i = 0; i < 5; i++) await rl.recordFailure(key, undefined, now);
      expect(await rl.isLocked(key, now)).toBe(true);
    });

    it("hết thời gian khoá → mở lại", async () => {
      const rl = new LoginRateLimiter();
      const key = LoginRateLimiter.key("acme", "a@b.c", "1.1.1.1");
      const now = 1_000_000;
      for (let i = 0; i < 5; i++) await rl.recordFailure(key, undefined, now);
      expect(await rl.isLocked(key, now)).toBe(true);
      expect(await rl.isLocked(key, now + 901_000)).toBe(false); // > LOGIN_LOCKOUT_SEC (900s)
    });

    it("reset() xoá trạng thái sau login thành công", async () => {
      const rl = new LoginRateLimiter();
      const key = LoginRateLimiter.key("acme", "a@b.c", "1.1.1.1");
      const now = 1_000_000;
      for (let i = 0; i < 5; i++) await rl.recordFailure(key, undefined, now);
      await rl.reset(key);
      expect(await rl.isLocked(key, now)).toBe(false);
    });

    it("maxAttempts tuỳ biến (bucket tài khoản ngưỡng cao hơn) — khoá đúng ngưỡng truyền vào", async () => {
      const rl = new LoginRateLimiter();
      const acct = LoginRateLimiter.accountKey("acme", "a@b.c");
      const now = 1_000_000;
      for (let i = 0; i < 7; i++) await rl.recordFailure(acct, 8, now); // ngưỡng 8 → 7 lần chưa khoá
      expect(await rl.isLocked(acct, now)).toBe(false);
      await rl.recordFailure(acct, 8, now); // lần thứ 8 → khoá
      expect(await rl.isLocked(acct, now)).toBe(true);
    });
  });

  it("key chuẩn hoá email lowercase (case-insensitive); accountKey KHÁC ipKey", () => {
    expect(LoginRateLimiter.key("acme", "A@B.C", "ip")).toBe(
      LoginRateLimiter.key("acme", "a@b.c", "ip"),
    );
    expect(LoginRateLimiter.accountKey("acme", "A@B.C")).toBe(
      LoginRateLimiter.accountKey("acme", "a@b.c"),
    );
    expect(LoginRateLimiter.accountKey("acme", "a@b.c")).not.toBe(
      LoginRateLimiter.key("acme", "a@b.c", "1.1.1.1"),
    );
  });

  describe("Valkey-backed (multi-instance)", () => {
    it("khoá sau MAX lần sai qua Valkey; reset xoá counter + lock", async () => {
      const valkey = fakeValkey(true);
      const rl = new LoginRateLimiter(valkey);
      const key = LoginRateLimiter.key("acme", "a@b.c", "1.1.1.1");
      expect(await rl.isLocked(key)).toBe(false);
      for (let i = 0; i < 5; i++) await rl.recordFailure(key);
      expect(await rl.isLocked(key)).toBe(true);
      await rl.reset(key);
      expect(await rl.isLocked(key)).toBe(false);
    });

    it("fail-soft: Valkey cấu hình nhưng isEnabled=false → fallback in-memory (vẫn khoá đúng)", async () => {
      const valkey = fakeValkey(false);
      const rl = new LoginRateLimiter(valkey);
      const key = LoginRateLimiter.key("acme", "a@b.c", "1.1.1.1");
      const now = 1_000_000;
      for (let i = 0; i < 5; i++) await rl.recordFailure(key, undefined, now);
      expect(await rl.isLocked(key, now)).toBe(true); // memory path đã khoá
      expect(valkey.store.size).toBe(0); // KHÔNG chạm Valkey khi disabled
    });

    it("KHÔNG fail-open: Valkey ENABLED nhưng đang rớt (mọi op null) → recordFailure rơi memory, isLocked vẫn TRUE", async () => {
      // isEnabled=true nhưng incr/get trả null (mô phỏng outage). recordFailure → incr null → recordFailureMem;
      // isLocked → get null → KHÔNG return false ngay mà rơi xuống kiểm map in-memory → thấy khoá (không bỏ limit).
      const erroring = {
        isEnabled: () => true,
        incr: async () => null,
        get: async () => null,
        set: async () => false,
        del: async () => false,
      } as unknown as ValkeyService;
      const rl = new LoginRateLimiter(erroring);
      const key = LoginRateLimiter.key("acme", "a@b.c", "1.1.1.1");
      const now = 1_000_000;
      expect(await rl.isLocked(key, now)).toBe(false);
      for (let i = 0; i < 5; i++) await rl.recordFailure(key, undefined, now);
      expect(await rl.isLocked(key, now)).toBe(true);
    });
  });
});
