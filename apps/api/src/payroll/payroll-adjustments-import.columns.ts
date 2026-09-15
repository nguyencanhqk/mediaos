import type { BonusKind } from "@mediaos/contracts";
import { PAYROLL_ADJUSTMENT_IMPORT_MAX_ROWS } from "@mediaos/contracts";

/**
 * S15-PAYROLL-BE-4 (plan D-7 · §4.6) — **MỘT nguồn** cho khuôn cột của `PAYROLL-API-076` (parser) LẪN `077` (tệp mẫu):
 * tệp mẫu tĩnh ở FE sẽ trôi khỏi parser, nên 077 sinh workbook từ CHÍNH bảng này (SPEC-11 §15.1 hàng 077).
 *
 * Map theo VỊ TRÍ (khuôn HR `IMPORT_COLUMN_ORDER`); nhãn header là văn bản người dùng sửa được ⇒ chỉ dùng để KIỂM
 * KHUÔN (`headerMatches`), không dùng để map cột.
 *
 * 🔴 Mọi message lỗi dòng ở đây KHÔNG BAO GIỜ lặp lại giá trị ô — nhất là số tiền (API-18 §6.5, spec neo bằng chuỗi giả).
 */

export interface AdjustmentImportColumn {
  readonly key: "employeeCode" | "kind" | "amount" | "reason" | "periodMonth";
  readonly header: string;
  /** Ví dụ ở dòng 2 của tệp mẫu — phải NẠP LẠI được vào parser (ca tự-nhất-quán). */
  readonly example: string;
}

export const ADJUSTMENT_IMPORT_COLUMNS: readonly AdjustmentImportColumn[] = [
  { key: "employeeCode", header: "Mã NV", example: "NV001" },
  { key: "kind", header: "Loại", example: "Thưởng" },
  { key: "amount", header: "Số tiền", example: "500000" },
  { key: "reason", header: "Lý do", example: "Thưởng dự án tháng" },
  { key: "periodMonth", header: "Kỳ (YYYY-MM)", example: "2026-10" },
];

/** Nhãn Việt (chuẩn hoá: trim + lowercase) → enum `bonus_penalties.kind`. Enum gốc cũng được nhận. */
export const ADJUSTMENT_KIND_LABELS: Readonly<Record<string, BonusKind>> = {
  bonus: "bonus",
  penalty: "penalty",
  thưởng: "bonus",
  "thu nhập": "bonus",
  phạt: "penalty",
  "khấu trừ": "penalty",
};

export interface ParsedAdjustmentRow {
  /** Số thứ tự DÒNG DỮ LIỆU (1-based, không tính header) — dùng cho `details[] {field:"row:<n>"}`. */
  row: number;
  employeeCode: string;
  kind: BonusKind;
  /** Chuỗi thập phân 2 số (numeric(18,2)) — KHÔNG float. */
  amount: string;
  reason: string;
}

export interface AdjustmentRowError {
  row: number;
  message: string;
}

export interface ParsedAdjustmentMatrix {
  kind: "header-mismatch" | "empty" | "too-large" | "ok";
  rows: ParsedAdjustmentRow[];
  rowErrors: AdjustmentRowError[];
}

const norm = (s: string | undefined): string => (s ?? "").trim().toLowerCase();

/** Header hàng 0 khớp ĐÚNG 5 nhãn (trim, không phân biệt hoa/thường), không thiếu/thừa/đảo cột. */
export function headerMatches(header: readonly string[]): boolean {
  if (header.length !== ADJUSTMENT_IMPORT_COLUMNS.length) return false;
  return ADJUSTMENT_IMPORT_COLUMNS.every((c, i) => norm(header[i]) === norm(c.header));
}

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const ADJUSTMENT_REASON_MAX = 500;
export const ADJUSTMENT_EMPLOYEE_CODE_MAX = 64;

/** Ma trận chuỗi (kể cả header) → dòng đã validate + lỗi theo dòng. Thuần, không DB. */
export function parseAdjustmentMatrix(
  matrix: readonly (readonly string[])[],
  periodMonth: string,
): ParsedAdjustmentMatrix {
  const header = matrix[0] ?? [];
  if (!headerMatches(header)) return { kind: "header-mismatch", rows: [], rowErrors: [] };
  const data = matrix.slice(1);
  if (data.length === 0) return { kind: "empty", rows: [], rowErrors: [] };
  if (data.length > PAYROLL_ADJUSTMENT_IMPORT_MAX_ROWS) {
    return { kind: "too-large", rows: [], rowErrors: [] };
  }

  const rows: ParsedAdjustmentRow[] = [];
  const rowErrors: AdjustmentRowError[] = [];
  data.forEach((cells, idx) => {
    const row = idx + 1;
    const cell = (i: number) => (typeof cells[i] === "string" ? cells[i].trim() : "");
    const employeeCode = cell(0);
    const kind = ADJUSTMENT_KIND_LABELS[norm(cell(1))];
    const amountRaw = cell(2);
    const reason = cell(3);
    const month = cell(4);
    const problems: string[] = [];
    if (employeeCode.length === 0 || employeeCode.length > ADJUSTMENT_EMPLOYEE_CODE_MAX) {
      problems.push("Mã NV trống hoặc quá dài");
    }
    if (!kind) problems.push("Loại phải là Thưởng/Thu nhập/Phạt/Khấu trừ (hoặc bonus/penalty)");
    if (!AMOUNT_RE.test(amountRaw) || Number(amountRaw) <= 0) {
      // KHÔNG chép giá trị ô vào message — số tiền không đi vào lỗi trả về.
      problems.push("Số tiền phải là số dương, tối đa 2 chữ số thập phân");
    }
    if (reason.length === 0 || reason.length > ADJUSTMENT_REASON_MAX) {
      problems.push("Lý do trống hoặc quá 500 ký tự");
    }
    if (!MONTH_RE.test(month) || month !== periodMonth) {
      problems.push(`Kỳ phải bằng kỳ lương đang nạp (${periodMonth})`);
    }
    if (problems.length > 0) {
      rowErrors.push({ row, message: problems.join("; ") });
      return;
    }
    rows.push({
      row,
      employeeCode,
      kind: kind as BonusKind,
      amount: Number(amountRaw).toFixed(2),
      reason,
    });
  });

  // Mã NV trùng trong tệp ⇒ lỗi CẢ các dòng trùng (không chọn hộ dòng nào — người nhập phải quyết).
  const byCode = new Map<string, number[]>();
  for (const r of rows) {
    const k = r.employeeCode.toLowerCase();
    byCode.set(k, [...(byCode.get(k) ?? []), r.row]);
  }
  const dupRows = new Set<number>();
  for (const [, list] of byCode) if (list.length > 1) list.forEach((r) => dupRows.add(r));
  for (const r of dupRows) rowErrors.push({ row: r, message: "Mã NV bị trùng trong tệp" });
  rowErrors.sort((a, b) => a.row - b.row);
  return { kind: "ok", rows: rows.filter((r) => !dupRows.has(r.row)), rowErrors };
}
