import type { AllocationMethod, AllocationTargetType } from "@mediaos/contracts";
import { splitCentsByWeights } from "./money";

/**
 * allocation.ts — TÍNH phân bổ chi phí (FIN-003), THUẦN (không chạm DB).
 *
 * Trọng số (`weight`) do SERVICE resolve theo `allocation_method`:
 *  - equal_split      → 1 cho mỗi target
 *  - manual_percent   → percent người nhập (tổng = 100, validate ở contract)
 *  - by_video_count   → COUNT content_items theo target trong kỳ
 *  - by_task_count    → COUNT tasks theo target trong kỳ
 *  - by_work_hours    → giờ người nhập (G11 attendance chưa merge)
 *  - by_revenue_ratio → SUM revenue hiệu lực theo target (cents, dạng number)
 *
 * Module này CHỈ chia tiền theo weight (cents integer, dồn dư target cuối — money.ts) + tính %.
 */

const PERCENT_SCALE = 10_000n; // 4 chữ số thập phân (khớp numeric(7,4))

export interface AllocationTargetWeight {
  targetType: AllocationTargetType;
  targetId: string;
  /** Trọng số đã resolve (≥0). Tổng = 0 ⇒ splitCentsByWeights ném (caller map → 400). */
  weight: number;
}

export interface AllocationLine {
  targetType: AllocationTargetType;
  targetId: string;
  allocatedCents: bigint;
  /** allocatedAmount / total * 100, 4dp. null khi total = 0. */
  percent: number | null;
}

/** % của `part` trên `total` (4dp, floor). null khi total = 0. */
export function percentOfTotal(part: bigint, total: bigint): number | null {
  if (total === 0n) return null;
  const neg = (part < 0n) !== (total < 0n);
  const absPart = part < 0n ? -part : part;
  const absTotal = total < 0n ? -total : total;
  const scaled = (absPart * 100n * PERCENT_SCALE) / absTotal; // percent * 10^4 (floor)
  const value = Number(scaled) / Number(PERCENT_SCALE);
  return neg ? -value : value;
}

/**
 * Chia `totalCents` cho các target theo weight. SUM(allocatedCents) === totalCents đúng tuyệt đối.
 * @throws MoneyError (qua splitCentsByWeights) nếu tổng weight = 0.
 */
export function computeAllocationLines(
  totalCents: bigint,
  targets: readonly AllocationTargetWeight[],
): AllocationLine[] {
  const cents = splitCentsByWeights(
    totalCents,
    targets.map((t) => t.weight),
  );
  return targets.map((t, i) => ({
    targetType: t.targetType,
    targetId: t.targetId,
    allocatedCents: cents[i],
    percent: percentOfTotal(cents[i], totalCents),
  }));
}

/** Trọng số mặc định theo method khi không phụ thuộc DB (equal/manual_percent/by_work_hours). */
export function staticWeight(
  method: AllocationMethod,
  input: { percent?: number; hours?: number },
): number {
  switch (method) {
    case "equal_split":
      return 1;
    case "manual_percent":
      return input.percent ?? 0;
    case "by_work_hours":
      return input.hours ?? 0;
    default:
      // by_video_count/by_task_count/by_revenue_ratio resolve từ DB — không dùng hàm này.
      throw new Error(`staticWeight không áp dụng cho method '${method}'`);
  }
}
