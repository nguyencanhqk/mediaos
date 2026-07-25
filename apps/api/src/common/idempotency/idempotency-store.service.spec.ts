import { describe, expect, it } from "vitest";
import type { ValkeyService } from "../../permission/valkey.service";
import {
  IDEMPOTENCY_MAX_BODY_BYTES,
  IDEMPOTENCY_TTL_SEC,
  IdempotencyStore,
  fingerprintBody,
} from "./idempotency-store.service";

/**
 * S5-BE-CONTRACT-1 — vòng đời khoá idempotency. Chạy trên nhánh BỘ NHỚ (không Valkey) + một bộ nhỏ
 * kiểm nhánh Valkey bằng fake in-memory, để không phụ thuộc hạ tầng khi chạy `pnpm test`.
 */

/** Fake ValkeyService tối thiểu (đủ setNx/get/set/del) — mô phỏng ngữ nghĩa NX của Valkey thật. */
function fakeValkey(): ValkeyService & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    isEnabled: () => true,
    setNx: async (k: string, v: string) => {
      if (store.has(k)) return false;
      store.set(k, v);
      return true;
    },
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return true;
    },
    del: async (...keys: string[]) => {
      keys.forEach((k) => store.delete(k));
      return true;
    },
  } as unknown as ValkeyService & { store: Map<string, string> };
}

const FP = fingerprintBody({ note: "xin nghỉ" });

describe("fingerprintBody", () => {
  it("cùng nội dung → cùng vân tay; khác nội dung → khác", () => {
    expect(fingerprintBody({ a: 1 })).toBe(fingerprintBody({ a: 1 }));
    expect(fingerprintBody({ a: 1 })).not.toBe(fingerprintBody({ a: 2 }));
  });

  it("body undefined/rỗng vẫn cho vân tay ổn định (không ném)", () => {
    expect(fingerprintBody(undefined)).toBe(fingerprintBody(undefined));
    expect(fingerprintBody({})).toHaveLength(32);
  });
});

describe("IdempotencyStore — nhánh bộ nhớ (không Valkey)", () => {
  it("lần đầu → first; lần hai khi CHƯA xong → in-flight (không chạy nghiệp vụ 2 lần)", async () => {
    const store = new IdempotencyStore();
    expect(await store.begin("k1", FP)).toEqual({ kind: "first" });
    expect(await store.begin("k1", FP)).toEqual({ kind: "in-flight" });
  });

  it("sau complete → replay đúng status + body", async () => {
    const store = new IdempotencyStore();
    await store.begin("k2", FP);
    await store.complete("k2", 201, FP, { id: "leave-1" });
    expect(await store.begin("k2", FP)).toEqual({
      kind: "replay",
      status: 201,
      body: { id: "leave-1" },
    });
  });

  it("cùng khoá + nội dung KHÁC → key-reused (chặn phát lại phản hồi của ý định khác)", async () => {
    const store = new IdempotencyStore();
    await store.begin("k3", FP);
    await store.complete("k3", 201, FP, { id: "leave-1" });
    expect(await store.begin("k3", fingerprintBody({ note: "khác" }))).toEqual({
      kind: "key-reused",
    });
  });

  it("release (handler lỗi) → khoá được nhả, lần sau chạy THẬT (lỗi không bị cache)", async () => {
    const store = new IdempotencyStore();
    await store.begin("k4", FP);
    await store.release("k4");
    expect(await store.begin("k4", FP)).toEqual({ kind: "first" });
  });

  it("hết TTL → coi như lần đầu", async () => {
    const store = new IdempotencyStore();
    const t0 = 1_000_000;
    await store.begin("k5", FP, t0);
    await store.complete("k5", 200, FP, { ok: true }, t0);
    const afterTtl = t0 + IDEMPOTENCY_TTL_SEC * 1000 + 1;
    expect(await store.begin("k5", FP, afterTtl)).toEqual({ kind: "first" });
  });

  it("body quá lớn → KHÔNG cache, nhả khoá (cache là tối ưu hoá, không phải kho dữ liệu)", async () => {
    const store = new IdempotencyStore();
    await store.begin("k6", FP);
    await store.complete("k6", 200, FP, { blob: "x".repeat(IDEMPOTENCY_MAX_BODY_BYTES + 100) });
    expect(await store.begin("k6", FP)).toEqual({ kind: "first" });
  });

  it("body không serialize được (vòng lặp tham chiếu) → nhả khoá, KHÔNG ném", async () => {
    const store = new IdempotencyStore();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await store.begin("k7", FP);
    await expect(store.complete("k7", 200, FP, cyclic)).resolves.toBeUndefined();
    expect(await store.begin("k7", FP)).toEqual({ kind: "first" });
  });

  it("hai khoá khác nhau độc lập nhau", async () => {
    const store = new IdempotencyStore();
    await store.begin("a", FP);
    expect(await store.begin("b", FP)).toEqual({ kind: "first" });
  });
});

describe("IdempotencyStore — nhánh Valkey", () => {
  it("dùng Valkey khi bật: first → complete → replay", async () => {
    const valkey = fakeValkey();
    const store = new IdempotencyStore(valkey);
    expect(await store.begin("v1", FP)).toEqual({ kind: "first" });
    await store.complete("v1", 201, FP, { id: "t-1" });
    expect(await store.begin("v1", FP)).toEqual({
      kind: "replay",
      status: 201,
      body: { id: "t-1" },
    });
  });

  it("KHÔNG ghi bản sao bóng vào bộ nhớ khi Valkey bật (tránh phình RAM ở prod)", async () => {
    const valkey = fakeValkey();
    const store = new IdempotencyStore(valkey);
    await store.begin("v2", FP);
    await store.complete("v2", 200, FP, { ok: true });
    expect(valkey.store.size).toBe(1);
    // Xoá phía Valkey ⇒ store phải coi như chưa từng có (không có bản sao trong RAM giữ lại).
    valkey.store.clear();
    expect(await store.begin("v2", FP)).toEqual({ kind: "first" });
  });

  it("Valkey rớt giữa chừng (setNx→null) → KHÔNG chặn nghiệp vụ (fail-soft, coi như first)", async () => {
    const flaky = {
      isEnabled: () => true,
      setNx: async () => null,
      get: async () => null,
      set: async () => false,
      del: async () => false,
    } as unknown as ValkeyService;
    const store = new IdempotencyStore(flaky);
    expect(await store.begin("v3", FP)).toEqual({ kind: "first" });
  });
});
