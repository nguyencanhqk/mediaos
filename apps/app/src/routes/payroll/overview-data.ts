import type { PayrollOverviewDto } from "@mediaos/contracts";
import { formatCompactMoney } from "@/components/charts/chart-theme";
import { formatPeriodMonth } from "./report-view";

/**
 * S15-PAYROLL-FE-4 — biến đổi THUẦN dữ liệu 078 cho 6 khối PAY-SCREEN-015. Không cộng tiền ở FE (luật
 * `payroll-format.ts`): mọi tổng/bình quân/tỉ trọng đã tính ở SQL, ở đây chỉ đổi hình dạng + nhãn.
 */

/** Dải lương: «0 – 5 Tr» · dải cuối «≥ 50 Tr». */
export function salaryBandLabel(bandFrom: number, bandTo: number | null): string {
  if (bandTo === null) return `≥ ${formatCompactMoney(bandFrom)}`;
  return `${formatCompactMoney(bandFrom)} – ${formatCompactMoney(bandTo)}`;
}

export function hasAnyHeadcount(rows: readonly { headcount: number }[]): boolean {
  return rows.some((r) => r.headcount > 0);
}

/** Ngưỡng cảnh báo ngân sách: ≥ 90 % sắp chạm, > 100 % vượt. */
export const BUDGET_WARNING_PCT = 90;

export type BudgetLevel = "normal" | "warning" | "over" | "unplanned";

export function budgetLevel(usagePct: number | null): BudgetLevel {
  if (usagePct === null) return "unplanned";
  if (usagePct > 100) return "over";
  if (usagePct >= BUDGET_WARNING_PCT) return "warning";
  return "normal";
}

/** Phần tô của meter kẹp trong [0, 100] — vượt kế hoạch vẫn tô đầy, con số thật nằm ở nhãn. */
export function meterFillPct(usagePct: number | null): number {
  if (usagePct === null || Number.isNaN(usagePct)) return 0;
  return Math.min(100, Math.max(0, usagePct));
}

export type TrendPoint = PayrollOverviewDto["byPeriod"][number] & { readonly label: string };

/** Khối 4/5: thêm nhãn kỳ `MM/YYYY`; giữ thứ tự tăng dần server trả. */
export function toTrendPoints(byPeriod: PayrollOverviewDto["byPeriod"]): TrendPoint[] {
  return byPeriod.map((p) => ({ ...p, label: formatPeriodMonth(p.periodMonth) }));
}

export type OrgUnitRow = PayrollOverviewDto["byOrgUnit"][number] & { readonly label: string };

/**
 * Khối 6: nhãn đơn vị (`null` = chưa gán đơn vị ⇒ nhãn do caller dịch), xếp theo thu nhập BQ giảm dần để
 * thanh dài nhất nằm trên cùng.
 */
export function toOrgUnitRows(
  rows: PayrollOverviewDto["byOrgUnit"],
  unassignedLabel: string,
): OrgUnitRow[] {
  return [...rows]
    .map((r) => ({ ...r, label: r.orgUnitName ?? unassignedLabel }))
    .sort((a, b) => b.avgGross - a.avgGross);
}

export type StructureRow = PayrollOverviewDto["incomeStructure"][number] & {
  readonly isOther: boolean;
};

/** Khối 2: hàng gộp «Khác» (`itemType = 'other'`) luôn nằm CUỐI dù lớn cỡ nào — nó không phải một khoản. */
export function toStructureRows(rows: PayrollOverviewDto["incomeStructure"]): StructureRow[] {
  const mapped = rows.map((r) => ({ ...r, isOther: r.itemType === "other" }));
  return [
    ...mapped.filter((r) => !r.isOther).sort((a, b) => b.amount - a.amount),
    ...mapped.filter((r) => r.isOther),
  ];
}
