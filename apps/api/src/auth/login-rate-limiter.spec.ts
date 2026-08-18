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

/**
 * S10-AUTH-IPTRUST-1 — hai bucket chỉ TÁCH VAI được khi `req.ip` là IP THẬT.
 *
 * Trước WO này PROD chạy sau `cloudflared` cùng máy mà `TRUST_PROXY` không đặt ⇒ mọi request mang
 * `ip = "::1"`. Khoá per-IP là `rl:ip:{slug}|{email}|{ip}`, nên khi `ip` là hằng số thì bucket
 * "per-IP" thoái hoá thành bucket per-account với ngưỡng THẤP (5) — và bucket per-account thật
 * (20) không bao giờ chạm tới. Nhóm ca dưới đây đóng đinh cả hai phía của ranh giới đó, mô phỏng
 * đúng điều phối của `AuthService.recordLoginFailure`/`isLoginLocked` (ghi CẢ HAI bucket, per-account
 * dùng ngưỡng `accountMaxAttempts`).
 */
describe("tách vai per-IP (5) vs per-account (20) — chỉ đúng khi req.ip là IP THẬT", () => {
  const SLUG = "acme";
  const EMAIL = "victim@acme.test";

  /** Bản sao điều phối của AuthService: ghi 1 lần sai vào CẢ HAI bucket. */
  async function recordLoginFailure(rl: LoginRateLimiter, ip: string, now: number): Promise<void> {
    await rl.recordFailure(LoginRateLimiter.key(SLUG, EMAIL, ip), undefined, now);
    await rl.recordFailure(
      LoginRateLimiter.accountKey(SLUG, EMAIL),
      rl.accountMaxAttempts,
      now,
    );
  }

  /** Bản sao điều phối của AuthService: khoá nếu MỘT TRONG HAI bucket khoá. */
  async function isLoginLocked(rl: LoginRateLimiter, ip: string, now: number): Promise<boolean> {
    return (
      (await rl.isLocked(LoginRateLimiter.key(SLUG, EMAIL, ip), now)) ||
      (await rl.isLocked(LoginRateLimiter.accountKey(SLUG, EMAIL), now))
    );
  }

  it("IP THẬT: 5 nguồn khác nhau mỗi nguồn sai 1 lần ⇒ KHÔNG khoá (bucket per-IP tách theo nguồn)", async () => {
    const rl = new LoginRateLimiter();
    const now = 1_000_000;
    for (let i = 1; i <= 5; i++) await recordLoginFailure(rl, `198.51.100.${i}`, now);
    // 5 lần sai TỔNG nhưng rải 5 nguồn ⇒ không nguồn nào chạm 5, account mới 5/20.
    expect(await isLoginLocked(rl, "198.51.100.6", now)).toBe(false);
  });

  it("IP THẬT: 5 lần sai từ CÙNG một nguồn ⇒ khoá ĐÚNG nguồn đó, nguồn khác vẫn vào được", async () => {
    const rl = new LoginRateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) await recordLoginFailure(rl, "198.51.100.7", now);
    expect(await isLoginLocked(rl, "198.51.100.7", now)).toBe(true);
    // Đây là điều KHÔNG THỂ có khi mọi IP đều là "::1": chủ tài khoản thật ở nguồn khác vẫn đăng nhập được.
    expect(await isLoginLocked(rl, "198.51.100.8", now)).toBe(false);
  });

  it("IP THẬT: bucket per-account (20) MỚI thực sự có tác dụng — 20 lần sai rải 5 nguồn (mỗi nguồn 4, dưới ngưỡng per-IP) ⇒ khoá", async () => {
    const rl = new LoginRateLimiter();
    const now = 1_000_000;
    expect(rl.accountMaxAttempts).toBe(20);
    for (let src = 1; src <= 5; src++) {
      for (let n = 0; n < 4; n++) await recordLoginFailure(rl, `203.0.113.${src}`, now);
    }
    // Không nguồn nào chạm 5, nhưng tổng 20 ⇒ backstop credential-stuffing phân tán mới nổ.
    expect(await isLoginLocked(rl, "203.0.113.99", now)).toBe(true);
  });

  it("HIỆN TRẠNG TRƯỚC VÁ (mọi request = '::1'): 5 nguồn khác nhau vẫn khoá ở lần thứ 5 ⇒ trần thực tế là 5, bucket 20 không bao giờ chạm", async () => {
    const rl = new LoginRateLimiter();
    const now = 1_000_000;
    const BLIND = "::1"; // TRUST_PROXY=false sau proxy ⇒ mọi nguồn gộp thành một
    for (let i = 0; i < 5; i++) await recordLoginFailure(rl, BLIND, now);
    expect(await isLoginLocked(rl, BLIND, now)).toBe(true);
    // ĐỐI CHỨNG: cùng số lần sai đó, nếu IP thật thì KHÔNG khoá (ca đầu nhóm này) — chênh lệch
    // chính là thiệt hại của `::1`: account-lockout DoS chỉ tốn 5 lần đoán trên endpoint công khai.
  });
});
