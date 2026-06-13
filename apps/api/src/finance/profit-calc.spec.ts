import { describe, expect, it } from "vitest";
import { computeProfit } from "./profit-calc";

describe("profit-calc — computeProfit", () => {
  it("profit = revenue − direct − allocated; totalCost = direct + allocated", () => {
    const r = computeProfit({
      revenueCents: 100_000_00n, // 100,000.00
      directCostCents: 40_000_00n,
      allocatedCostCents: 10_000_00n,
    });
    expect(r.totalCostCents).toBe(50_000_00n);
    expect(r.profitCents).toBe(50_000_00n);
    expect(r.profitMargin).toBe(0.5); // 50,000 / 100,000
  });

  it("margin 4dp", () => {
    const r = computeProfit({
      revenueCents: 3_00n,
      directCostCents: 1_00n,
      allocatedCostCents: 0n,
    });
    // profit 2.00 / revenue 3.00 = 0.6666...
    expect(r.profitMargin).toBeCloseTo(0.6666, 4);
  });

  it("revenue = 0 ⇒ margin null (chia 0)", () => {
    const r = computeProfit({ revenueCents: 0n, directCostCents: 5_00n, allocatedCostCents: 0n });
    expect(r.profitMargin).toBeNull();
    expect(r.profitCents).toBe(-5_00n); // lỗ
  });

  it("lỗ ⇒ profit âm, margin âm", () => {
    const r = computeProfit({
      revenueCents: 10_00n,
      directCostCents: 30_00n,
      allocatedCostCents: 0n,
    });
    expect(r.profitCents).toBe(-20_00n);
    expect(r.profitMargin).toBe(-2); // -20 / 10
  });

  it("company scope: allocated = 0 (chống đếm đôi)", () => {
    const r = computeProfit({
      revenueCents: 80_000_00n,
      directCostCents: 50_000_00n,
      allocatedCostCents: 0n,
    });
    expect(r.totalCostCents).toBe(50_000_00n);
    expect(r.profitCents).toBe(30_000_00n);
  });
});
