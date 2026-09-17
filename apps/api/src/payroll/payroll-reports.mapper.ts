import type { PayrollReportColumn } from "@mediaos/contracts";
import type { PayrollReportDef } from "./payroll-reports.registry";
import type { RawReportRow } from "./payroll-reports.repository";
import type { PayrollPeopleMap } from "./payroll.types";

/**
 * S15-PAYROLL-BE-5 — chuyển hàng SQL thô của báo cáo sang ô DTO theo `type` của registry.
 *
 * Tiền/số đi ra `number` như mọi DTO PAYROLL (`payroll.mapper.ts` `num`): driver `pg` trả `numeric` là chuỗi, mọi
 * phép cộng/bình quân/làm tròn đã xong ở SQL — ở đây CHỈ đổi biểu diễn, không tính thêm.
 */

export type ReportCell = string | number | null;

/** Khoá liên kết được giữ trong hàng dù không phải cột hiển thị (FE dựng link sâu; XLSX bỏ qua). */
const LINK_KEYS = ["userId", "orgUnitId", "periodId", "batchId", "salaryProfileId"] as const;

export const reportNumber = (v: unknown): number => Number(v ?? 0);
export const reportNumberOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

function cellOf(col: PayrollReportColumn, raw: unknown): ReportCell {
  if (raw === null || raw === undefined) return null;
  switch (col.type) {
    case "money":
    case "number":
    case "percent":
      return Number(raw);
    case "text":
    case "date":
    case "month":
      return String(raw);
  }
}

/**
 * Hàng DTO. `employeeCode`/`displayName` KHÔNG bao giờ lấy từ SQL — chỉ từ `names` (điểm chiếu danh tính DUY NHẤT,
 * SPEC-11 §18); người đã xoá mềm vắng trong map ⇒ hai ô `null` (plan §0b C6).
 */
export function toReportRow(
  def: PayrollReportDef,
  raw: RawReportRow,
  names: PayrollPeopleMap | null,
): Record<string, ReportCell> {
  const out: Record<string, ReportCell> = {};
  for (const key of LINK_KEYS) {
    if (key in raw) out[key] = (raw[key] as string | null) ?? null;
  }
  const person = names && typeof raw["userId"] === "string" ? names.get(raw["userId"]) : undefined;
  for (const col of def.columns) {
    if (col.key === "employeeCode") out[col.key] = person?.employeeCode ?? null;
    else if (col.key === "displayName") out[col.key] = person?.displayName ?? null;
    else out[col.key] = cellOf(col, raw[col.key]);
  }
  return out;
}

export function toReportTotals(raw: RawReportRow): Record<string, number> {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, reportNumber(v)]));
}

export function reportColumnsOf(def: PayrollReportDef): PayrollReportColumn[] {
  return def.columns.map((c) => ({ key: c.key, type: c.type }));
}

/** Báo cáo có cột danh tính ⇒ phải tra tên qua `PayrollPeopleRepository`. */
export function needsNames(def: PayrollReportDef): boolean {
  return def.columns.some((c) => c.key === "employeeCode" || c.key === "displayName");
}
