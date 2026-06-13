/**
 * profit-calc.ts — TÍNH lợi nhuận (G13-3), THUẦN (không chạm DB). Đầu vào là cents đã tổng hợp (service
 * lo SUM bản ghi hiệu lực theo scope/kỳ). profit = revenue − direct − allocated.
 *
 * Quy ước chống ĐẾM ĐÔI (plan §4.5):
 *  - company scope: direct = TOÀN BỘ cost hiệu lực, allocated = 0 (phân bổ chỉ tái phân phối nội bộ).
 *  - scope con: direct = cost gắn đúng cột target = id; allocated = allocation active trỏ tới target.
 */

const MARGIN_SCALE = 10_000n; // numeric(9,4) — margin là tỉ lệ (vd 0.2533 = 25.33%)

export interface ProfitInput {
  revenueCents: bigint;
  directCostCents: bigint;
  allocatedCostCents: bigint;
}

export interface ProfitResult {
  revenueCents: bigint;
  directCostCents: bigint;
  allocatedCostCents: bigint;
  totalCostCents: bigint;
  profitCents: bigint;
  /** profit / revenue (tỉ lệ, 4dp). null khi revenue = 0. */
  profitMargin: number | null;
}

export function computeProfit(input: ProfitInput): ProfitResult {
  const { revenueCents, directCostCents, allocatedCostCents } = input;
  const totalCostCents = directCostCents + allocatedCostCents;
  const profitCents = revenueCents - totalCostCents;

  let profitMargin: number | null = null;
  if (revenueCents !== 0n) {
    const neg = (profitCents < 0n) !== (revenueCents < 0n);
    const absProfit = profitCents < 0n ? -profitCents : profitCents;
    const absRevenue = revenueCents < 0n ? -revenueCents : revenueCents;
    const scaled = (absProfit * MARGIN_SCALE) / absRevenue; // tỉ lệ * 10^4 (floor)
    const value = Number(scaled) / Number(MARGIN_SCALE);
    profitMargin = neg ? -value : value;
  }

  return {
    revenueCents,
    directCostCents,
    allocatedCostCents,
    totalCostCents,
    profitCents,
    profitMargin,
  };
}
