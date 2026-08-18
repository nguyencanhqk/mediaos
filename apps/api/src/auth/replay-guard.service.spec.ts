import { describe, expect, it } from "vitest";
import { ReplayGuardService } from "./replay-guard.service";
import type { ValkeyService } from "../permission/valkey.service";
import { currentEnvScope, legacyReplayKey, replayKey } from "../common/valkey/valkey-key";

/**
 * Fake Valkey với `setNx` nguyên tử mô phỏng (Map). `enabled` bật/tắt; `outage` ép setNx trả null (rớt
 * giữa chừng) để test fallback memory KHÔNG fail-open. `outageFor` ép null CHỈ cho những khoá khớp —
 * dùng để dựng đúng tổ hợp (mới=true, legacy=null) của bảng chân trị ghi-kép.
 */
function fakeValkey(
  opts: { enabled?: boolean; outage?: boolean; outageFor?: RegExp; seed?: string[] } = {},
) {
  const enabled = opts.enabled ?? true;
  const store = new Map<string, string>();
  for (const k of opts.seed ?? []) store.set(k, "1");
  return {
    store,
    isEnabled: () => enabled,
    async setNx(key: string, val: string): Promise<boolean | null> {
      if (!enabled || opts.outage) return null;
      if (opts.outageFor?.test(key)) return null;
      if (store.has(key)) return false; // đã giữ → replay
      store.set(key, val);
      return true;
    },
  } as unknown as ValkeyService & { store: Map<string, string> };
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
   * S10-FND-VALKEYSCOPE-1 — chu kỳ chuyển tiếp. Ba ca dưới là lý do đường đọc-kép/ghi-kép tồn tại; xoá
   * một trong ba là mở lại đúng cửa sổ mà nó đóng.
   */
  describe("đọc kép + ghi kép (một chu kỳ deploy)", () => {
    it("khoá MỚI mang envScope, và mỗi lần claim ghi CẢ hai hình dạng (rollback đối xứng)", async () => {
      const v = fakeValkey({ enabled: true });
      const g = new ReplayGuardService(v);
      expect(await g.claim("2fa-jti", "j1", 600)).toBe(true);

      const scoped = replayKey("2fa-jti", "j1");
      expect(scoped).toContain(currentEnvScope());
      expect(v.store.has(scoped)).toBe(true);
      // Vế legacy: thiếu nó thì rollback làm mọi marker tiêu thụ sau deploy sống lại.
      expect(v.store.has(legacyReplayKey("2fa-jti", "j1"))).toBe(true);
    });

    it("CHIỀU TIẾN: jti đã tiêu ở hình dạng CŨ (trước deploy) vẫn bị chặn sau deploy", async () => {
      const v = fakeValkey({ enabled: true, seed: [legacyReplayKey("2fa-jti", "pre")] });
      const g = new ReplayGuardService(v);
      // Khoá mới còn trống, nhưng legacy đã bị giữ ⇒ replay. Nếu ca này đỏ: một challenge JWT đã dùng
      // trước deploy verify được lần thứ hai trong phần đời còn lại của token.
      expect(await g.claim("2fa-jti", "pre", 600)).toBe(false);
    });

    it("BẢNG CHÂN TRỊ: (mới=true, legacy=null) KHÔNG được trả true thẳng — phải hạ về memory", async () => {
      const v = fakeValkey({ enabled: true, outageFor: /^replay:(2fa-jti|totp-step):/ });
      const g = new ReplayGuardService(v);
      const now = 3_000_000;
      // Lần đầu: memory chưa có → true (fail-soft, giống mọi outage khác).
      expect(await g.claim("2fa-jti", "half", 600, now)).toBe(true);
      // Lần hai: nếu code trả thẳng `newRes` thì đây sẽ là… true lần nữa? Không — khoá mới đã bị giữ nên
      // newRes=false ⇒ false. Ca thật sự đóng đinh nằm ở memory: cùng marker, cùng ms, phải là false.
      expect(await g.claim("2fa-jti", "half", 600, now)).toBe(false);
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
