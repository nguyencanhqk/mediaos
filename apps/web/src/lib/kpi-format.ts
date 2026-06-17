import type { TFunction } from "i18next";
import { KPI_COMPONENT_KEYS, type KpiComponentKey } from "@mediaos/contracts";
import type { BadgeProps } from "@mediaos/ui";

export type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/** Ngưỡng xếp loại điểm KPI (thang 0..100) — dùng chung bảng + cây mục tiêu. */
export const KPI_SCORE_GOOD = 80;
export const KPI_SCORE_FAIR = 50;

/** Bậc xếp loại theo điểm: tốt ≥80, khá ≥50, cần cải thiện <50. */
export type KpiScoreTier = "good" | "fair" | "poor";

export function kpiScoreTier(score: number): KpiScoreTier {
  if (score >= KPI_SCORE_GOOD) return "good";
  if (score >= KPI_SCORE_FAIR) return "fair";
  return "poor";
}

/** Map bậc điểm → variant Badge (Slate-Corporate). */
export const KPI_TIER_VARIANT: Record<KpiScoreTier, BadgeVariant> = {
  good: "success",
  fair: "warning",
  poor: "danger",
};

/** Class màu thanh tiến độ theo bậc điểm. */
export const KPI_TIER_BAR: Record<KpiScoreTier, string> = {
  good: "bg-emerald-500",
  fair: "bg-amber-500",
  poor: "bg-red-500",
};

/** Làm tròn 1 chữ số thập phân, hiển thị kiểu vi-VN (không ép số 0 thừa). */
export function formatScore(value: number): string {
  return Number(value.toFixed(1)).toLocaleString("vi-VN");
}

/** Kẹp điểm về [0,100] để vẽ tiến độ an toàn (phòng dữ liệu lệch). */
export function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Nhãn i18n cho tên 5 thành phần KPI (namespace kpi → components.<key>). */
export function componentLabel(key: KpiComponentKey, t: TFunction<"kpi">): string {
  return t(`components.${key}`);
}

/** Trạng thái xác nhận KPI (BR-007): có confirmedAt = đã xác nhận, ngược lại = tham khảo. */
export function isConfirmed(confirmedAt: string | null): boolean {
  return Boolean(confirmedAt);
}

export { KPI_COMPONENT_KEYS };
export type { KpiComponentKey };
