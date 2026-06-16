import { describe, expect, it } from "vitest";
import { ReplayGuardService } from "./replay-guard.service";
import type { ValkeyService } from "../permission/valkey.service";

/**
 * Fake Valkey với `setNx` nguyên tử mô phỏng (Map). `enabled` bật/tắt; `outage` ép setNx trả null (rớt
 * giữa chừng) để test fallback memory KHÔNG fail-open.
 */
function fakeValkey(opts: { enabled?: boolean; outage?: boolean } = {}) {
  const enabled = opts.enabled ?? true;
  const store = new Map<string, string>();
  return {
    store,
    isEnabled: () => enabled,
    async setNx(key: string, val: string): Promise<boolean | null> {
      if (!enabled || opts.outage) return null;
      if (store.has(key)) return false; // đã giữ → replay
      store.set(key, val);
      return true;
    },
  } as unknown as ValkeyService & { store: Map<string, string> };
}

describe("ReplayGuardService (single-use fail-closed)", () => {
  describe("in-memory (no Valkey)", () => {
    it("lần đầu claim → true; lần 2 cùng key → false (replay)", async () => {
      const g = new ReplayGuardService();
      const now = 1_000_000;
      expect(await g.claim("2fa-jti:abc", 600, now)).toBe(true);
      expect(await g.claim("2fa-jti:abc", 600, now)).toBe(false);
    });

    it("key khác nhau độc lập", async () => {
      const g = new ReplayGuardService();
      const now = 1_000_000;
      expect(await g.claim("totp-step:u1:100", 90, now)).toBe(true);
      expect(await g.claim("totp-step:u1:101", 90, now)).toBe(true);
      expect(await g.claim("totp-step:u2:100", 90, now)).toBe(true);
    });

    it("hết TTL → claim lại được (marker hết hạn)", async () => {
      const g = new ReplayGuardService();
      const now = 1_000_000;
      expect(await g.claim("k", 90, now)).toBe(true);
      expect(await g.claim("k", 90, now + 91_000)).toBe(true); // > 90s
    });
  });

  describe("Valkey-backed (setNx nguyên tử)", () => {
    it("dùng setNx: lần đầu true, replay false", async () => {
      const v = fakeValkey({ enabled: true });
      const g = new ReplayGuardService(v);
      expect(await g.claim("2fa-jti:xyz", 600)).toBe(true);
      expect(await g.claim("2fa-jti:xyz", 600)).toBe(false);
      expect(v.store.has("replay:2fa-jti:xyz")).toBe(true);
    });

    it("FAIL-CLOSED: Valkey bật nhưng rớt (setNx null) → fallback memory, KHÔNG fail-open", async () => {
      const v = fakeValkey({ enabled: true, outage: true });
      const g = new ReplayGuardService(v);
      const now = 2_000_000;
      // outage → setNx null → memory: lần đầu true, replay false (KHÔNG luôn-pass = fail-open).
      expect(await g.claim("2fa-jti:out", 600, now)).toBe(true);
      expect(await g.claim("2fa-jti:out", 600, now)).toBe(false);
    });
  });
});
