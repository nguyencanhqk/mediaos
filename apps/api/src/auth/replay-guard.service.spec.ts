import { describe, expect, it } from "vitest";
import { ReplayGuardService } from "./replay-guard.service";
import type { ValkeyService } from "../permission/valkey.service";
import { currentEnvScope, replayKey } from "../common/valkey/valkey-key";

/**
 * Fake Valkey với `setNx` nguyên tử mô phỏng (Map). `enabled` bật/tắt; `outage` ép setNx trả null (rớt
 * giữa chừng) để test fallback memory KHÔNG fail-open. `setNxCalls` ghi lại TỪNG lượt gọi — sau
 * S10-FND-VALKEYSCOPE-2, số lượt chính là bằng chứng "một khoá, một round-trip".
 */
function fakeValkey(opts: { enabled?: boolean; outage?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const store = new Map<string, string>();
  const setNxCalls: string[] = [];
  return {
    store,
    setNxCalls,
    isEnabled: () => enabled,
    async setNx(key: string, val: string): Promise<boolean | null> {
      setNxCalls.push(key);
      if (!enabled || opts.outage) return null;
      if (store.has(key)) return false; // đã giữ → replay
      store.set(key, val);
      return true;
    },
  } as unknown as ValkeyService & { store: Map<string, string>; setNxCalls: string[] };
}

describe("ReplayGuardService (single-use fail-closed)", () => {
  describe("in-memory (no Valkey)", () => {
    it("lần đầu claim → true; lần 2 cùng marker → false (replay)", async () => {
      const g = new ReplayGuardService();
      const now = 1_000_000;
      expect(await g.claim("2fa-jti", "abc", 600, now)).toBe(true);
      expect(await g.claim("2fa-jti", "abc", 600, now)).toBe(false);
    });

    it("key khác nhau độc lập", async () => {
      const g = new ReplayGuardService();
      const now = 1_000_000;
      expect(await g.claim("totp-step", "u1:100", 90, now)).toBe(true);
      expect(await g.claim("totp-step", "u1:101", 90, now)).toBe(true);
      expect(await g.claim("totp-step", "u2:100", 90, now)).toBe(true);
    });

    it("hết TTL → claim lại được (marker hết hạn)", async () => {
      const g = new ReplayGuardService();
      const now = 1_000_000;
      expect(await g.claim("2fa-jti", "k", 90, now)).toBe(true);
      expect(await g.claim("2fa-jti", "k", 90, now + 91_000)).toBe(true); // > 90s
    });
  });

  describe("Valkey-backed (setNx nguyên tử)", () => {
    it("dùng setNx: lần đầu true, replay false", async () => {
      const v = fakeValkey({ enabled: true });
      const g = new ReplayGuardService(v);
      expect(await g.claim("2fa-jti", "xyz", 600)).toBe(true);
      expect(await g.claim("2fa-jti", "xyz", 600)).toBe(false);
      expect(v.store.has(replayKey("2fa-jti", "xyz"))).toBe(true);
    });

    it("FAIL-CLOSED: Valkey bật nhưng rớt (setNx null) → fallback memory, KHÔNG fail-open", async () => {
      const v = fakeValkey({ enabled: true, outage: true });
      const g = new ReplayGuardService(v);
      const now = 2_000_000;
      // outage → setNx null → memory: lần đầu true, replay false (KHÔNG luôn-pass = fail-open).
      expect(await g.claim("2fa-jti", "out", 600, now)).toBe(true);
      expect(await g.claim("2fa-jti", "out", 600, now)).toBe(false);
    });
  });

  /**
   * S10-FND-VALKEYSCOPE-2 — chu kỳ chuyển tiếp đọc-kép/ghi-kép ĐÃ GỠ. Ba ca dưới đóng đinh chiều NGƯỢC
   * với bộ ca của S10-FND-VALKEYSCOPE-1: còn ĐÚNG MỘT khoá, khoá đó mang envScope, và mỗi claim chỉ tốn
   * MỘT round-trip.
   */
  describe("sau khi gỡ chu kỳ chuyển tiếp: đúng MỘT khoá scoped", () => {
    it("claim ghi ĐÚNG MỘT khoá, và đó là khoá mang envScope", async () => {
      const v = fakeValkey({ enabled: true });
      const g = new ReplayGuardService(v);
      expect(await g.claim("2fa-jti", "j1", 600)).toBe(true);

      const scoped = replayKey("2fa-jti", "j1");
      expect(scoped).toContain(currentEnvScope());
      // Đỏ với 2 phần tử = vế ghi-kép legacy còn sống ⇒ khoá KHÔNG scoped vẫn bơm vào Valkey dùng
      // chung của bốn môi trường, đúng cái lỗ KI-067 đã bịt.
      expect([...v.store.keys()]).toEqual([scoped]);
    });

    it("mỗi claim tốn ĐÚNG MỘT lượt setNx (hết 2 round-trip trên đường bước-2 2FA)", async () => {
      const v = fakeValkey({ enabled: true });
      const g = new ReplayGuardService(v);
      await g.claim("2fa-jti", "j2", 600);
      expect(v.setNxCalls).toEqual([replayKey("2fa-jti", "j2")]);
    });

    it("memory fallback khoá theo chuỗi ĐÃ scoped (hai môi trường chung máy không dùng chung ô nhớ)", async () => {
      const g = new ReplayGuardService();
      const now = 4_000_000;
      expect(await g.claim("totp-step", "u9:1", 90, now)).toBe(true);
      // Cùng marker + rest ⇒ cùng khoá scoped ⇒ replay.
      expect(await g.claim("totp-step", "u9:1", 90, now)).toBe(false);
    });
  });
});
