import { describe, expect, it, vi } from "vitest";
import { LoginRateLimiter } from "./login-rate-limiter";
import { ValkeyService } from "../permission/valkey.service";
import { isKeyScoped, rlKey } from "../common/valkey/valkey-key";

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
    await rl.recordFailure(LoginRateLimiter.accountKey(SLUG, EMAIL), rl.accountMaxAttempts, now);
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

describe("S10-SEC-LOGINLOG429-1 (KI-048) — claimFirstOfWindow: gộp hàng nhật ký theo CỬA SỔ", () => {
  // ⚠️ VÌ SAO LÀ UNIT CHỨ KHÔNG INT-SPEC. Cửa sổ thật là `LOGIN_LOCKOUT_SEC` = 900s — không chờ
  // được; `reset()` cố ý KHÔNG chạm khoá gộp (gộp phải sống trọn TTL, không bị xoá theo mỗi lần đăng
  // nhập thành công); và qua HTTP thì không truyền được `nowMs`. Ba lý do đó khiến ca "hết hạn ⇒ ghi
  // lại" chỉ đo được ở đây. Không có ca này thì "gộp" không phân biệt nổi với "thôi ghi vĩnh viễn".
  const KEY = ["rl", "test", "logdedup", "login:acct:acme|a@b.c"].join(":");
  const TTL = 900;

  it("người ĐẦU TIÊN của cửa sổ được ghi; các lượt sau trong cùng cửa sổ thì KHÔNG", async () => {
    const rl = new LoginRateLimiter();
    const t0 = 5_000_000;
    expect(await rl.claimFirstOfWindow(KEY, TTL, t0)).toBe(true);
    expect(await rl.claimFirstOfWindow(KEY, TTL, t0 + 1)).toBe(false);
    expect(await rl.claimFirstOfWindow(KEY, TTL, t0 + 60_000)).toBe(false);
  });

  it("HẾT cửa sổ ⇒ ghi LẠI — gộp bị chặn bởi TTL, KHÔNG phải 'thôi ghi vĩnh viễn'", async () => {
    const rl = new LoginRateLimiter();
    const t0 = 5_000_000;
    expect(await rl.claimFirstOfWindow(KEY, TTL, t0)).toBe(true);
    // Biên: mốc CUỐI còn trong cửa sổ vẫn bị gộp...
    expect(await rl.claimFirstOfWindow(KEY, TTL, t0 + TTL * 1000 - 1)).toBe(false);
    // ...và đúng mốc hết hạn thì mở lại. Cửa sổ kế có hàng đầu của riêng nó.
    expect(await rl.claimFirstOfWindow(KEY, TTL, t0 + TTL * 1000)).toBe(true);
  });

  it("hai khoá KHÁC nhau độc lập — gộp của tài khoản này không nuốt hàng của tài khoản kia", async () => {
    const rl = new LoginRateLimiter();
    const t0 = 5_000_000;
    const other = ["rl", "test", "logdedup", "login:acct:acme|x@y.z"].join(":");
    expect(await rl.claimFirstOfWindow(KEY, TTL, t0)).toBe(true);
    expect(await rl.claimFirstOfWindow(other, TTL, t0)).toBe(true);
  });

  it("`reset()` KHÔNG mở lại cửa sổ gộp — đăng nhập thành công không được xoá dấu vết đã ghi", async () => {
    // Nếu `reset()` xoá khoá gộp thì mỗi lượt đăng nhập thành công xen giữa sẽ mở lại cửa sổ ⇒ kẻ
    // tấn công biết mật khẩu một tài khoản khác có thể ép ghi lại liên tục. Ghim hành vi hiện tại.
    const rl = new LoginRateLimiter();
    const t0 = 5_000_000;
    expect(await rl.claimFirstOfWindow(KEY, TTL, t0)).toBe(true);
    await rl.reset(KEY);
    expect(await rl.claimFirstOfWindow(KEY, TTL, t0 + 1)).toBe(false);
  });
});
/**
 * S18-AUTH-UNLOCK429-1 — GỠ khoá đăng nhập (429) + chỉ mục IP.
 *
 * ⚠️ BẢNG CA CHẠY HAI LẦN, và đó là điều kiện để bộ ca này có nghĩa. `VALKEY_URL` VẮNG ở máy local
 * (⇒ nhánh in-memory) nhưng CI có service Valkey và đặt biến đó (`.github/workflows/ci.yml`) ⇒ nhánh
 * Valkey. Chỉ phủ một bên nghĩa là một nửa số lần chạy không chứng minh gì, và hai ca đột biến ở dưới
 * sẽ chỉ đỏ ở một nửa số môi trường.
 */
interface FakeValkey extends ValkeyService {
  store: Map<string, string>;
  sets: Map<string, Set<string>>;
  ttls: Map<string, number>;
}

/** Fake đầy đủ hơn `fakeValkey` ở trên: có SET + TTL để đo chỉ mục IP và `remainingSec`. */
function fakeValkeyWithSets(opts: { enabled?: boolean; sAddFails?: boolean } = {}): FakeValkey {
  const enabled = opts.enabled !== false;
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const ttls = new Map<string, number>();
  return {
    store,
    sets,
    ttls,
    isEnabled: () => enabled,
    async incr(key: string, ttlSec: number) {
      if (!enabled) return null;
      const n = Number(store.get(key) ?? "0") + 1;
      store.set(key, String(n));
      ttls.set(key, ttlSec);
      return n;
    },
    async get(key: string) {
      return enabled ? (store.get(key) ?? null) : null;
    },
    async set(key: string, val: string, ttlSec: number) {
      if (!enabled) return true;
      store.set(key, val);
      ttls.set(key, ttlSec);
      return true;
    },
    async ttl(key: string) {
      if (!enabled) return null;
      if (!store.has(key) && !sets.has(key)) return null;
      return ttls.get(key) ?? null;
    },
    async sAddWithTtl(key: string, member: string, ttlSec: number) {
      if (!enabled || opts.sAddFails) return null;
      const set = sets.get(key) ?? new Set<string>();
      set.add(member);
      sets.set(key, set);
      ttls.set(key, ttlSec);
      return set.size;
    },
    async sCard(key: string) {
      if (!enabled) return null;
      return sets.get(key)?.size ?? 0;
    },
    // Nhánh chạm-trần của `noteFailureSource` gộp WARN qua `claimFirstOfWindow` ⇒ fake phải có `setNx`,
    // nếu không ca trần sẽ đỏ vì lý do chẳng liên quan gì tới cái nó đo.
    async setNx(key: string, val: string, ttlSec: number) {
      if (!enabled) return null;
      if (store.has(key)) return false;
      store.set(key, val);
      ttls.set(key, ttlSec);
      return true;
    },
    async sMembers(key: string) {
      if (!enabled) return null;
      return [...(sets.get(key) ?? [])];
    },
    async del(...keys: string[]) {
      keys.forEach((k) => {
        store.delete(k);
        sets.delete(k);
        ttls.delete(k);
      });
      return true;
    },
  } as unknown as FakeValkey;
}

describe.each([
  ["in-memory (VALKEY_URL vắng — máy local)", () => new LoginRateLimiter()],
  ["Valkey (CI có service valkey)", () => new LoginRateLimiter(fakeValkeyWithSets())],
] as const)("S18 — gỡ khoá đăng nhập · %s", (_label, makeLimiter) => {
  const SLUG = "acme";
  const EMAIL = "victim@acme.test";
  const NOW = 2_000_000;

  /** Bản sao điều phối của `AuthService.recordLoginFailure` (2 bucket + nuôi chỉ mục). */
  async function loginFailure(rl: LoginRateLimiter, ip: string, now = NOW): Promise<void> {
    await rl.recordFailure(LoginRateLimiter.key(SLUG, EMAIL, ip), undefined, now);
    await rl.recordFailure(LoginRateLimiter.accountKey(SLUG, EMAIL), rl.accountMaxAttempts, now);
    await rl.noteFailureSource("login", SLUG, EMAIL, ip);
  }

  async function ipLocked(rl: LoginRateLimiter, ip: string, now = NOW): Promise<boolean> {
    return rl.isLocked(LoginRateLimiter.key(SLUG, EMAIL, ip), now);
  }

  it("5 lần sai từ 1 IP ⇒ khoá; clearLoginLocks ⇒ vào lại được NGAY (không chờ TTL)", async () => {
    const rl = makeLimiter();
    for (let i = 0; i < 5; i++) await loginFailure(rl, "198.51.100.10");
    expect(await ipLocked(rl, "198.51.100.10")).toBe(true);

    const res = await rl.clearLoginLocks(SLUG, EMAIL, undefined, { includeForgot: true });
    expect(res.degraded).toBe(false);
    expect(await ipLocked(rl, "198.51.100.10")).toBe(false);
  });

  it("ĐỘT BIẾN A (bucket acct) — 20 lần sai rải 2 IP ⇒ khoá tài khoản; clear phải gỡ CẢ bucket acct", async () => {
    // Bỏ vế xoá `accountKey` trong `clearLoginLocks` ⇒ ca này ĐỎ: từng IP mở ra nhưng bucket tài khoản
    // vẫn chặn, tức người dùng vẫn 429 sau khi admin bấm nút.
    const rl = makeLimiter();
    for (let n = 0; n < 10; n++) await loginFailure(rl, "203.0.113.1");
    for (let n = 0; n < 10; n++) await loginFailure(rl, "203.0.113.2");
    const acct = LoginRateLimiter.accountKey(SLUG, EMAIL);
    expect(await rl.isLocked(acct, NOW)).toBe(true);

    await rl.clearLoginLocks(SLUG, EMAIL, undefined, { includeForgot: true });
    expect(await rl.isLocked(acct, NOW)).toBe(false);
  });

  it("ĐỘT BIẾN B (chỉ mục IP) — hai IP cùng bị khoá ⇒ clear phải gỡ CẢ HAI, không riêng cái cuối", async () => {
    // Bỏ vế duyệt chỉ mục (hoặc chỉ xoá một IP) ⇒ ca này ĐỎ. Đây là lý do chỉ mục tồn tại: khoá per-IP
    // nhúng `ip` vào chuỗi khoá và `SCAN` theo pattern bị CẤM (Valkey dùng chung 4 môi trường).
    const rl = makeLimiter();
    for (let n = 0; n < 5; n++) await loginFailure(rl, "203.0.113.11");
    for (let n = 0; n < 5; n++) await loginFailure(rl, "203.0.113.12");
    expect(await ipLocked(rl, "203.0.113.11")).toBe(true);
    expect(await ipLocked(rl, "203.0.113.12")).toBe(true);

    await rl.clearLoginLocks(SLUG, EMAIL, undefined, { includeForgot: true });
    expect(await ipLocked(rl, "203.0.113.11")).toBe(false);
    expect(await ipLocked(rl, "203.0.113.12")).toBe(false);
  });

  it("KHÔNG quét quá tay: gỡ khoá cho email A KHÔNG mở khoá của email B", async () => {
    // Ca đối chứng cho hai ca trên. Một `clearLoginLocks` dựng tiền tố quá rộng (ví dụ quên `|{email}|`)
    // sẽ vẫn làm chúng xanh, nhưng biến nút "gỡ khoá" thành nút "tắt chống brute-force cho cả công ty".
    const rl = makeLimiter();
    const other = "other@acme.test";
    for (let n = 0; n < 5; n++) await loginFailure(rl, "203.0.113.21");
    for (let n = 0; n < 5; n++) {
      await rl.recordFailure(LoginRateLimiter.key(SLUG, other, "203.0.113.22"), undefined, NOW);
      await rl.noteFailureSource("login", SLUG, other, "203.0.113.22");
    }

    await rl.clearLoginLocks(SLUG, EMAIL, undefined, { includeForgot: true });
    expect(await ipLocked(rl, "203.0.113.21")).toBe(false);
    expect(await rl.isLocked(LoginRateLimiter.key(SLUG, other, "203.0.113.22"), NOW)).toBe(true);
  });

  it("slug lệch HOA/thường vẫn gỡ được — `companies.slug` là citext nên `Funtime` và `funtime` là CÙNG công ty", async () => {
    // Không có ca này thì bản vá xanh toàn tập mà vẫn hỏng trên PROD: khoá do một client gửi slug hoa
    // tạo ra, còn admin gỡ bằng slug canonical đọc từ DB ⇒ 204 + audit "đã gỡ" mà người dùng vẫn 429.
    const rl = makeLimiter();
    for (let n = 0; n < 5; n++) await loginFailure(rl, "203.0.113.31");
    const upper = "ACME";
    for (let n = 0; n < 5; n++) {
      await rl.recordFailure(LoginRateLimiter.key(upper, EMAIL, "203.0.113.32"), undefined, NOW);
      await rl.noteFailureSource("login", upper, EMAIL, "203.0.113.32");
    }
    expect(LoginRateLimiter.key("Funtime", EMAIL, "ip")).toBe(
      LoginRateLimiter.key("funtime", EMAIL, "ip"),
    );
    expect(await ipLocked(rl, "203.0.113.32")).toBe(true);

    await rl.clearLoginLocks(SLUG, EMAIL, undefined, { includeForgot: true });
    expect(await ipLocked(rl, "203.0.113.32")).toBe(false);
  });

  it("bucket forgot (`forgot:ip` + `forgot:acct`) cũng được gỡ — đường tự-chữa phải mở lại cùng lúc", async () => {
    const rl = makeLimiter();
    const ip = "203.0.113.41";
    for (let n = 0; n < 5; n++) {
      await rl.recordFailure(LoginRateLimiter.forgotKey(SLUG, EMAIL, ip), undefined, NOW);
      await rl.recordFailure(
        LoginRateLimiter.forgotAccountKey(SLUG, EMAIL),
        rl.accountMaxAttempts,
        NOW,
      );
      await rl.noteFailureSource("forgot", SLUG, EMAIL, ip);
    }
    expect(await rl.isLocked(LoginRateLimiter.forgotKey(SLUG, EMAIL, ip), NOW)).toBe(true);

    await rl.clearLoginLocks(SLUG, EMAIL, undefined, { includeForgot: true });
    expect(await rl.isLocked(LoginRateLimiter.forgotKey(SLUG, EMAIL, ip), NOW)).toBe(false);
  });

  // S18-AUTH-RESETCLEARS-1 — ca ĐỐI XỨNG với ca ngay trên. Cặp này phải đi CÙNG nhau: một mình ca
  // `includeForgot:false` sẽ XANH-RỖNG nếu `clearLoginLocks` không xoá gì cả, còn một mình ca
  // `includeForgot:true` thì không chứng minh được cái trần forgot có thật sự giữ lại được hay không.
  // Cả hai chạy trên CẢ HAI nhánh (in-memory + Valkey) nhờ describe.each của khối này — đó là điều
  // kiện để `purgeMemoryLocks` không lệch khỏi nhánh Valkey trong im lặng.
  it("`includeForgot:false` (đường tự phục vụ) ⇒ khoá LOGIN sạch nhưng trần `forgot:*` CÒN NGUYÊN", async () => {
    const rl = makeLimiter();
    const ip = "203.0.113.42";
    for (let n = 0; n < 5; n++) {
      await loginFailure(rl, ip);
      await rl.recordFailure(LoginRateLimiter.forgotKey(SLUG, EMAIL, ip), undefined, NOW);
      await rl.recordFailure(
        LoginRateLimiter.forgotAccountKey(SLUG, EMAIL),
        rl.accountMaxAttempts,
        NOW,
      );
      await rl.noteFailureSource("forgot", SLUG, EMAIL, ip);
    }
    expect(await ipLocked(rl, ip)).toBe(true);
    expect(await rl.isLocked(LoginRateLimiter.forgotKey(SLUG, EMAIL, ip), NOW)).toBe(true);

    await rl.clearLoginLocks(SLUG, EMAIL, undefined, { includeForgot: false });

    // Đường login mở lại — đó là mục đích của WO.
    expect(await ipLocked(rl, ip)).toBe(false);
    expect(await rl.isLocked(LoginRateLimiter.accountKey(SLUG, EMAIL), NOW)).toBe(false);
    // …nhưng trần của endpoint CÔNG KHAI thì không được cấp lại. Bỏ vế `includeForgot` ở BẤT KỲ chỗ
    // nào trong ba chỗ (vòng family · `exact` · `purgeMemoryLocks`) ⇒ một trong hai assert này ĐỎ.
    expect(await rl.isLocked(LoginRateLimiter.forgotKey(SLUG, EMAIL, ip), NOW)).toBe(true);
    // Bucket `forgot:acct` CHƯA khoá ở đây (ngưỡng của nó là `accountMaxAttempts`=20, mới có 5 lượt)
    // nên hỏi "còn khoá không" đo được ĐÚNG KHÔNG GÌ CẢ. Thứ phải đo là **bộ đếm có sống sót không**:
    // bồi nốt phần còn thiếu tới ngưỡng. Đếm còn ⇒ khoá; đếm bị xoá ⇒ 15 < 20 ⇒ không khoá.
    const forgotAcct = LoginRateLimiter.forgotAccountKey(SLUG, EMAIL);
    expect(await rl.isLocked(forgotAcct, NOW)).toBe(false);
    for (let n = 0; n < rl.accountMaxAttempts - 5; n++) {
      await rl.recordFailure(forgotAcct, rl.accountMaxAttempts, NOW);
    }
    expect(await rl.isLocked(forgotAcct, NOW)).toBe(true);
  });

  it("bucket bước-2 (`2fa`) được gỡ và có mặt trong `buckets` — sai TOTP cũng là 429 Ở MÀN ĐĂNG NHẬP", async () => {
    const rl = makeLimiter();
    const subject = { companyId: "co-1", userId: "user-1" };
    const key = LoginRateLimiter.twoFactorKey(subject.companyId, subject.userId);
    for (let n = 0; n < 5; n++) await rl.recordFailure(key, undefined, NOW);

    const before = await rl.loginThrottleState(SLUG, EMAIL, subject, NOW);
    expect(before.locked).toBe(true);
    expect(before.buckets).toContain("2fa");

    await rl.clearLoginLocks(SLUG, EMAIL, subject, { includeForgot: true });
    const after = await rl.loginThrottleState(SLUG, EMAIL, subject, NOW);
    expect(after.locked).toBe(false);
    expect(after.buckets).toEqual([]);
  });

  it("không có khoá nào ⇒ clear không ném, không degraded; state rỗng KHÔNG hiện '0 giây'", async () => {
    const rl = makeLimiter();
    const res = await rl.clearLoginLocks(SLUG, EMAIL, undefined, { includeForgot: true });
    expect(res.degraded).toBe(false);
    const state = await rl.loginThrottleState(SLUG, EMAIL, undefined, NOW);
    expect(state).toEqual({ locked: false, remainingSec: null, buckets: [], unknown: false });
  });

  it("`buckets` phân biệt đúng nguồn khoá: chỉ IP ⇒ ['ip'] · chỉ tài khoản ⇒ ['acct'] · cả hai ⇒ ['acct','ip']", async () => {
    const onlyIp = makeLimiter();
    for (let n = 0; n < 5; n++)
      await onlyIp.recordFailure(LoginRateLimiter.key(SLUG, EMAIL, "203.0.113.51"), undefined, NOW);
    await onlyIp.noteFailureSource("login", SLUG, EMAIL, "203.0.113.51");
    expect((await onlyIp.loginThrottleState(SLUG, EMAIL, undefined, NOW)).buckets).toEqual(["ip"]);

    const onlyAcct = makeLimiter();
    for (let n = 0; n < onlyAcct.accountMaxAttempts; n++) {
      await onlyAcct.recordFailure(
        LoginRateLimiter.accountKey(SLUG, EMAIL),
        onlyAcct.accountMaxAttempts,
        NOW,
      );
    }
    expect((await onlyAcct.loginThrottleState(SLUG, EMAIL, undefined, NOW)).buckets).toEqual([
      "acct",
    ]);

    const both = makeLimiter();
    for (let n = 0; n < 20; n++) await loginFailure(both, "203.0.113.52");
    expect((await both.loginThrottleState(SLUG, EMAIL, undefined, NOW)).buckets).toEqual([
      "acct",
      "ip",
    ]);
  });
});

describe("S18 — chỉ mục IP: hình dạng khoá, trần, và nhánh Valkey rớt", () => {
  const SLUG = "acme";
  const EMAIL = "victim@acme.test";
  const NOW = 3_000_000;

  it("chỉ mục dựng qua `rlKey` (có envScope) và TÁCH BẠCH login ↔ forgot", () => {
    // Khoá tự nối chuỗi là thứ `valkey-key-census.spec.ts` cấm; ca này ghim hình dạng để một refactor
    // "cho gọn" không lặng lẽ đẻ ra khoá thiếu envScope (bốn môi trường dùng chung một db0 — KI-067).
    const loginIdx = LoginRateLimiter.ipIndexKey(SLUG, EMAIL, "login");
    const forgotIdx = LoginRateLimiter.ipIndexKey(SLUG, EMAIL, "forgot");
    expect(loginIdx).toBe(rlKey("ip-index", `${SLUG}|${EMAIL}`));
    expect(forgotIdx).toBe(rlKey("forgot:ip-index", `${SLUG}|${EMAIL}`));
    expect(loginIdx).not.toBe(forgotIdx);
    expect(isKeyScoped(loginIdx)).toBe(true);
    expect(isKeyScoped(forgotIdx)).toBe(true);
  });

  it("khoá chỉ mục đi qua cổng `assertKeysScoped` của ValkeyService THẬT (fake không đo được cổng)", async () => {
    // Fake Valkey ở các ca trên KHÔNG chạy `assertKeysScoped` ⇒ chúng mù với lỗi thiếu envScope.
    // `ValkeyService` thật (client null vì VALKEY_URL vắng) vẫn chạy cổng TRƯỚC `if (!this.client)`.
    const real = new ValkeyService();
    real.onModuleInit();
    await expect(
      real.sMembers(LoginRateLimiter.ipIndexKey(SLUG, EMAIL, "login")),
    ).resolves.toBeNull();
    await expect(real.ttl(LoginRateLimiter.ipIndexKey(SLUG, EMAIL, "login"))).resolves.toBeNull();
    // Đối chứng: khoá KHÔNG scoped phải bị cổng NÉM — nếu không, hai assert trên chỉ chứng minh
    // "hàm trả null", chẳng liên quan gì tới cổng.
    // Khoá dựng bằng GHÉP CHUỖI, KHÔNG literal: census tĩnh `valkey-key-census.spec.ts` cấm mọi literal
    // mở đầu bằng tiền tố khoá — kể cả trong spec, kể cả khi cố ý sai để đo cổng.
    const unscoped = ["rl", "ip-index", "acme|x@y.z"].join(":");
    await expect(real.sMembers(unscoped)).rejects.toThrow(/envScope/);
  });

  it("SADD ghi ip vào đúng chỉ mục với TTL = lockoutSec", async () => {
    const valkey = fakeValkeyWithSets();
    const rl = new LoginRateLimiter(valkey);
    await rl.noteFailureSource("login", SLUG, EMAIL, "198.51.100.1");
    await rl.noteFailureSource("login", SLUG, EMAIL, "198.51.100.2");
    const idx = LoginRateLimiter.ipIndexKey(SLUG, EMAIL, "login");
    expect([...(valkey.sets.get(idx) ?? [])]).toEqual(["198.51.100.1", "198.51.100.2"]);
    expect(valkey.ttls.get(idx)).toBe(rl.lockoutSec);
  });

  it("TRẦN: chỉ mục không phình quá IP_INDEX_CAP (endpoint công khai không điều khiển được kích thước)", async () => {
    const valkey = fakeValkeyWithSets();
    const rl = new LoginRateLimiter(valkey);
    for (let i = 0; i < 80; i++) {
      await rl.noteFailureSource("login", SLUG, EMAIL, `198.51.100.${i}`);
    }
    const idx = LoginRateLimiter.ipIndexKey(SLUG, EMAIL, "login");
    expect(valkey.sets.get(idx)?.size).toBe(64);
  });

  it("Valkey ENABLED nhưng RỚT: khoá rơi xuống memory ⇒ state vẫn báo locked (không nói 'không bị khoá')", async () => {
    // Ca này bảo vệ đúng nhánh nguy hiểm nhất: nếu `loginThrottleState` chỉ đọc chỉ mục trên Valkey,
    // một outage sẽ làm màn hình khẳng định người dùng KHÔNG bị khoá trong khi họ đang bị chặn.
    const dead = {
      isEnabled: () => true,
      incr: async () => null,
      get: async () => null,
      set: async () => false,
      del: async () => false,
      ttl: async () => null,
      sCard: async () => null,
      sMembers: async () => null,
      sAddWithTtl: async () => null,
    } as unknown as ValkeyService;
    const rl = new LoginRateLimiter(dead);
    for (let n = 0; n < 5; n++) {
      await rl.recordFailure(LoginRateLimiter.key(SLUG, EMAIL, "198.51.100.9"), undefined, NOW);
      await rl.noteFailureSource("login", SLUG, EMAIL, "198.51.100.9");
    }
    const state = await rl.loginThrottleState(SLUG, EMAIL, undefined, NOW);
    expect(state.locked).toBe(true);
    expect(state.buckets).toEqual(["ip"]);

    // …và clear phải báo DEGRADED (sMembers null = KHÔNG BIẾT, del false), để service KHÔNG trả 204.
    const res = await rl.clearLoginLocks(SLUG, EMAIL, undefined, { includeForgot: true });
    expect(res.degraded).toBe(true);
  });

  it("TRÀN TRẦN ⇒ clear báo DEGRADED và state báo UNKNOWN — không được nói 'đã gỡ xong'", async () => {
    // Các IP đến sau trần nằm NGOÀI chỉ mục ⇒ không xoá được và cũng không đọc được. Nếu không có
    // marker, `clearLoginLocks` sẽ trả degraded=false và service trả 204 + audit ok:true trong khi
    // nạn nhân vẫn ăn 429. Gỡ bucket `acct` KHÔNG cứu: một IP giữ `:lock` riêng vẫn chặn.
    const valkey = fakeValkeyWithSets();
    const rl = new LoginRateLimiter(valkey);
    for (let i = 0; i < 80; i++) {
      await rl.noteFailureSource("login", SLUG, EMAIL, `198.51.100.${i}`);
    }
    expect(await valkey.get(LoginRateLimiter.cappedMarkerKey(SLUG, EMAIL, "login"))).not.toBeNull();

    const state = await rl.loginThrottleState(SLUG, EMAIL, undefined, NOW);
    expect(state.unknown).toBe(true);

    const res = await rl.clearLoginLocks(SLUG, EMAIL, undefined, { includeForgot: true });
    expect(res.degraded).toBe(true);
  });

  it("`remainingLockSec` đọc TTL của khoá đã biết; không khoá ⇒ null (KHÔNG phải 0)", async () => {
    const valkey = fakeValkeyWithSets();
    const rl = new LoginRateLimiter(valkey);
    const key = LoginRateLimiter.key(SLUG, EMAIL, "198.51.100.3");
    expect(await rl.remainingLockSec(key, NOW)).toBeNull();
    for (let n = 0; n < 5; n++) await rl.recordFailure(key, undefined, NOW);
    expect(await rl.remainingLockSec(key, NOW)).toBe(rl.lockoutSec);
  });

  it("nhánh in-memory: `remainingLockSec` suy từ mốc hết hạn, giảm dần theo thời gian", async () => {
    const rl = new LoginRateLimiter();
    const key = LoginRateLimiter.key(SLUG, EMAIL, "198.51.100.4");
    for (let n = 0; n < 5; n++) await rl.recordFailure(key, undefined, NOW);
    expect(await rl.remainingLockSec(key, NOW)).toBe(rl.lockoutSec);
    expect(await rl.remainingLockSec(key, NOW + 300_000)).toBe(rl.lockoutSec - 300);
    expect(await rl.remainingLockSec(key, NOW + rl.lockoutSec * 1000)).toBeNull();
  });
});

// ── S18-AUTH-RETRYAFTER-1 — remainingLockSecOrNull: fail-soft NHƯNG KHÔNG CÂM ───────────────────
describe("LoginRateLimiter.remainingLockSecOrNull — đường ném 429 không bao giờ thành 500", () => {
  const KEY = rlKey("change-pw", "s18-retryafter");

  it("`remainingLockSec` NÉM ⇒ trả `null` (KHÔNG lan lỗi) VÀ có LOG (không nuốt câm)", async () => {
    // Hợp đồng này là LÝ DO wrapper tồn tại (plan R8): một sự cố Valkey không được đổi ý nghĩa phản
    // hồi auth từ 429 sang 500. Đo trên wrapper THẬT — mock chính wrapper là đo một thứ không tồn tại.
    const rl = new LoginRateLimiter();
    const boom = new Error("valkey down");
    vi.spyOn(rl, "remainingLockSec").mockRejectedValue(boom);
    const warn = vi.spyOn(rl["logger"], "warn").mockImplementation(() => undefined);

    await expect(rl.remainingLockSecOrNull(KEY)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();

    // BẤT BIẾN #3: khoá chứa slug+email ⇒ TUYỆT ĐỐI không được nội suy vào log.
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(KEY);
  });

  it("không ném ⇒ trả nguyên giá trị (wrapper KHÔNG đổi hành vi đường sạch)", async () => {
    const rl = new LoginRateLimiter();
    vi.spyOn(rl, "remainingLockSec").mockResolvedValue(842);

    await expect(rl.remainingLockSecOrNull(KEY)).resolves.toBe(842);
  });
});
