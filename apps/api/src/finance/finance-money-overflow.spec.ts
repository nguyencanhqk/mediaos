/**
 * B3 MONEY OVERFLOW — unit spec (LANE b2). Tài chính = crown-jewel (BẤT BIẾN tiền cents-exact).
 *
 * RED-first: số tiền amount qua đường ghi sổ cái (revenue.create/cost.create → amountToCents) khi
 * vượt Number.MAX_SAFE_INTEGER (2^53-1) PHẢI ném lỗi RÕ ('vượt khoảng an toàn'), KHÔNG toFixed/Number()
 * lossy âm thầm. amount hợp lệ lớn (dưới ngưỡng) vẫn pass đúng giá trị (không regression).
 *
 * Chứng minh defect numToStr cũ: numToStr chỉ guard Number.isFinite → value.toFixed(2) trả CHUỖI cho mọi
 * số hữu hạn kể cả 9_007_199_254_740_993 (mất chính xác ở biên double) → KHÔNG fail-loud. amountToCents
 * (money.ts) có guard Number.isSafeInteger(Math.round(value*100)) → đường ĐÚNG mà service phải dùng.
 */

import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { amountToCents, MoneyError } from "./money";
import { RevenueService } from "./revenue.service";
import { CostService } from "./cost.service";

const MAX_SAFE = Number.MAX_SAFE_INTEGER; // 9_007_199_254_740_991

describe("B3 money overflow guard — amountToCents fail-loud > MAX_SAFE_INTEGER", () => {
  it("amount = 1e16 (vượt MAX_SAFE_INTEGER) → ném MoneyError 'vượt khoảng an toàn'", () => {
    expect(() => amountToCents(1e16)).toThrow(MoneyError);
    expect(() => amountToCents(1e16)).toThrow(/vượt khoảng an toàn/);
  });

  it("amount = 2^53 + 2 (> MAX_SAFE_INTEGER) → ném lỗi (KHÔNG lossy âm thầm)", () => {
    // MAX_SAFE_INTEGER + 2 = 9_007_199_254_740_993 — không biểu diễn CHÍNH XÁC bằng double (đúng cái
    // ta phải reject). Dựng lúc chạy (KHÔNG literal) để no-loss-of-precision không cờ chính giá trị test.
    const beyondSafe = MAX_SAFE + 2;
    expect(() => amountToCents(beyondSafe)).toThrow(MoneyError);
  });

  it("amount * 100 vượt khoảng an toàn (vd 1e15) → reject (cents là cái phải an toàn)", () => {
    // 1e15 * 100 = 1e17 > MAX_SAFE_INTEGER ⇒ cents không an toàn ⇒ reject.
    expect(() => amountToCents(1e15)).toThrow(/vượt khoảng an toàn/);
  });

  it("amount hợp lệ lớn (90_071_992_547_400) vẫn pass đúng cents — KHÔNG regression", () => {
    // 90_071_992_547_400 * 100 = 9_007_199_254_740_000 ≤ MAX_SAFE_INTEGER ⇒ an toàn.
    const cents = amountToCents(90_071_992_547_400);
    expect(cents).toBe(9_007_199_254_740_000n);
  });

  it("amount thường (1_234.56) → 123456 cents (đúng 2dp, không float drift)", () => {
    expect(amountToCents(1_234.56)).toBe(123456n);
  });

  it("MAX_SAFE_INTEGER/100 boundary cũng được guard nhất quán", () => {
    // amount sao cho amount*100 = MAX_SAFE_INTEGER chính xác → pass; +1 đơn vị nhỏ → reject.
    const safeAmount = (MAX_SAFE - (MAX_SAFE % 100)) / 100; // bảo đảm *100 ≤ MAX_SAFE
    expect(() => amountToCents(safeAmount)).not.toThrow();
    expect(() => amountToCents(safeAmount * 100)).toThrow(/vượt khoảng an toàn/);
  });
});

// ─── Service boundary: revenue.create / cost.create PHẢI reject overflow TRƯỚC khi mở tx ─────────────
// Chứng minh defect numToStr (chỉ Number.isFinite → toFixed lossy): GREEN phải dùng đường money-guard.

/** Dựng service với DB/repo/perm/audit/outbox mock. permission ALLOW; repo.insertTx KHÔNG bao giờ chạy
 *  khi overflow (guard ở boundary trước/ trong tx nhưng trước insert). */
function makeRevenueService() {
  const insertTx = vi
    .fn()
    .mockResolvedValue({ id: "r1", amount: "0.00", source: "manual", revenueDate: "2026-06-01" });
  const repo = { insertTx, list: vi.fn(), findByIdTx: vi.fn() };
  const db = { withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => unknown) => fn({})) };
  const permissions = { can: vi.fn().mockResolvedValue({ allow: true }) };
  const audit = { record: vi.fn() };
  const outbox = { enqueue: vi.fn() };
  const svc = new RevenueService(
    db as never,
    repo as never,
    permissions as never,
    audit as never,
    outbox as never,
  );
  return { svc, insertTx };
}

function makeCostService() {
  const insertTx = vi
    .fn()
    .mockResolvedValue({ id: "c1", amount: "0.00", costType: "other", costDate: "2026-06-01" });
  const repo = { insertTx, list: vi.fn(), findByIdTx: vi.fn() };
  const db = { withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => unknown) => fn({})) };
  const permissions = { can: vi.fn().mockResolvedValue({ allow: true }) };
  const audit = { record: vi.fn() };
  const outbox = { enqueue: vi.fn() };
  const svc = new CostService(
    db as never,
    repo as never,
    permissions as never,
    audit as never,
    outbox as never,
  );
  return { svc, insertTx };
}

describe("B3 service boundary — revenue/cost create reject overflow (KHÔNG lossy insert)", () => {
  it("revenue.create amount=1e16 → ném BadRequest/MoneyError, KHÔNG gọi repo.insertTx", async () => {
    const { svc, insertTx } = makeRevenueService();
    await expect(
      svc.create("c1", "u1", {
        amount: 1e16,
        currency: "VND",
        revenueDate: "2026-06-01",
        source: "manual",
      }),
    ).rejects.toThrow(/vượt khoảng an toàn|an toàn/);
    expect(insertTx).not.toHaveBeenCalled();
  });

  it("cost.create amount=1e16 → ném BadRequest/MoneyError, KHÔNG gọi repo.insertTx", async () => {
    const { svc, insertTx } = makeCostService();
    await expect(
      svc.create("c1", "u1", {
        costType: "other",
        amount: 1e16,
        currency: "VND",
        costDate: "2026-06-01",
      }),
    ).rejects.toThrow(/vượt khoảng an toàn|an toàn/);
    expect(insertTx).not.toHaveBeenCalled();
  });

  it("revenue.create amount thường (1234.56) vẫn gọi insertTx (không regression)", async () => {
    const { svc, insertTx } = makeRevenueService();
    await svc.create("c1", "u1", {
      amount: 1234.56,
      currency: "VND",
      revenueDate: "2026-06-01",
      source: "manual",
    });
    expect(insertTx).toHaveBeenCalledTimes(1);
    expect(insertTx.mock.calls[0][1].amount).toBe("1234.56");
  });

  it("lỗi overflow là BadRequestException ở boundary service (map 400 cho HTTP)", async () => {
    const { svc } = makeRevenueService();
    await expect(
      svc.create("c1", "u1", {
        amount: 1e16,
        currency: "VND",
        revenueDate: "2026-06-01",
        source: "manual",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
