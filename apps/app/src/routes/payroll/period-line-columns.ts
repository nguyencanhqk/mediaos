import type { PayrollPeriodLineDto, PayrollSummaryDto } from "@mediaos/contracts";

/**
 * S15-PAYROLL-FE-2 — cột ĐỘNG của bảng lương kỳ theo mẫu (PAY-SCREEN-002 v2, D9 của plan).
 *
 * Nguồn cột = `components[]` của dòng (snapshot LÚC TÍNH, không phải mẫu hiện tại — BE-3): lấy từ dòng ĐẦU
 * TIÊN có `components`, chỉ thành phần `isVisible`, sắp theo `sortOrder`. `components` đi CÙNG cổng tiền với
 * `gross` ⇒ vắng khoá khi bị che hoặc dòng v1 ⇒ màn rơi về bộ cột cũ.
 *
 * ── Hàng TỔNG ─────────────────────────────────────────────────────────────────────────────────────
 * `payroll-format.ts` cấm cộng tiền ở FE vì cộng SỐ THỰC trên `numeric(18,2)` lệch xu so với SQL. Ở đây cộng
 * bằng **SỐ NGUYÊN XU** (`Math.round(v × 100)`) — chính xác tuyệt đối tới 2^53 xu (~90 nghìn tỉ đồng), nên
 * tổng hiển thị khớp `SUM()` của SQL từng xu. Chỉ để HIỂN THỊ, không gửi đi đâu. Một dòng trong trang vắng
 * giá trị (bị che) ⇒ tổng cột đó `undefined` (không cộng thiếu âm thầm).
 *
 * S15-PAYROLL-FE-4: có tổng TOÀN KỲ từ 018 `?payrollPeriodId=` (`lineTotals` + `componentTotals`, SUM ở SQL —
 * BE-5 D-15) ⇒ hàng tổng dùng số đó (`totalsFromSummary`), nhãn «Tổng». Chưa về/lỗi ⇒ rơi về tổng TRANG và
 * nhãn nói thật phạm vi (`isWholePeriod`) — không bao giờ ghi «Tổng» cho số của một trang.
 */

export interface ComponentColumn {
  readonly code: string;
  readonly label: string;
}

export function deriveComponentColumns(lines: readonly PayrollPeriodLineDto[]): ComponentColumn[] {
  const source = lines.find((l) => l.components !== undefined && l.components.length > 0);
  if (!source?.components) return [];
  return [...source.components]
    .filter((c) => c.isVisible)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .map((c) => ({ code: c.code, label: c.label }));
}

export function componentValue(line: PayrollPeriodLineDto, code: string): number | undefined {
  return line.components?.find((c) => c.code === code)?.value;
}

const toCents = (v: number): number => Math.round(v * 100);

/** Tổng theo xu; bất kỳ phần tử `undefined` (bị che / thiếu) ⇒ `undefined`. Mảng rỗng ⇒ `undefined`. */
export function sumMoney(values: readonly (number | undefined)[]): number | undefined {
  if (values.length === 0) return undefined;
  let cents = 0;
  for (const v of values) {
    if (v === undefined) return undefined;
    cents += toCents(v);
  }
  return cents / 100;
}

export interface LineTotals {
  readonly byCode: Readonly<Record<string, number | undefined>>;
  readonly gross: number | undefined;
  readonly deduction: number | undefined;
  readonly adjustment: number | undefined;
  readonly net: number | undefined;
}

export function computeLineTotals(
  lines: readonly PayrollPeriodLineDto[],
  columns: readonly ComponentColumn[],
): LineTotals {
  const byCode: Record<string, number | undefined> = {};
  for (const col of columns) {
    byCode[col.code] = sumMoney(lines.map((l) => componentValue(l, col.code)));
  }
  return {
    byCode,
    gross: sumMoney(lines.map((l) => l.gross)),
    deduction: sumMoney(lines.map((l) => l.deductionAmount)),
    adjustment: sumMoney(lines.map((l) => l.adjustmentAmount)),
    net: sumMoney(lines.map((l) => l.net)),
  };
}

/**
 * Tổng TOÀN KỲ từ 018. `null` khi response không mang `lineTotals` (gọi thiếu `payrollPeriodId`) hoặc là của
 * KỲ KHÁC (phòng cache lệch). Thành phần không có trong `componentTotals` ⇒ `undefined` (ô `—`).
 */
export function totalsFromSummary(
  summary: PayrollSummaryDto | null | undefined,
  periodId: string,
  columns: readonly ComponentColumn[],
): LineTotals | null {
  if (!summary?.lineTotals || summary.payrollPeriodId !== periodId) return null;
  const byCode: Record<string, number | undefined> = {};
  for (const col of columns) {
    byCode[col.code] = summary.componentTotals?.find((c) => c.code === col.code)?.total;
  }
  const lt = summary.lineTotals;
  return {
    byCode,
    gross: lt.gross,
    deduction: lt.deductionAmount,
    adjustment: lt.adjustmentAmount,
    net: lt.net,
  };
}

/** Hàng của bảng: dòng lương thật HOẶC hàng tổng (không phải DTO — không bấm để điều chỉnh được). */
export type PeriodLineRow =
  | { readonly kind: "line"; readonly line: PayrollPeriodLineDto }
  | { readonly kind: "total"; readonly totals: LineTotals };

export function toLineRows(
  lines: readonly PayrollPeriodLineDto[],
  columns: readonly ComponentColumn[],
  periodTotals: LineTotals | null = null,
): PeriodLineRow[] {
  const rows: PeriodLineRow[] = lines.map((line) => ({ kind: "line", line }));
  if (lines.length > 0) {
    rows.push({ kind: "total", totals: periodTotals ?? computeLineTotals(lines, columns) });
  }
  return rows;
}

/** Cả kỳ nằm trọn trong trang đang xem ⇒ hàng tổng là tổng KỲ; không thì là «tổng trang này». */
export function isWholePeriod(page: number, lineCount: number, total: number | undefined): boolean {
  return page === 1 && total !== undefined && total <= lineCount;
}
