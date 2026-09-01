/**
 * S13-PAYROLL-FE-1 — hiển thị tiền & ngày công cho PAYROLL (SPEC-11 §14).
 *
 * ⚠️ **`undefined` ≠ 0.** Mask của server là **VẮNG KHOÁ** (SPEC-11 §18) — mọi trường tiền trong
 * contracts khai `.optional()`. Render `gross ?? 0` là biến «bạn không có quyền xem» thành «0 đồng»:
 * một con số SAI, đọc được, không có gì báo. Mọi hàm dưới đây nhận `number | undefined` và trả
 * `PAYROLL_MASKED_PLACEHOLDER` cho vế vắng — đó là lý do chúng tồn tại thay vì gọi thẳng
 * `formatCurrency`.
 *
 * ⚠️ **KHÔNG cộng/trừ tiền ở FE.** `gross`/`net`/`deduction` đều do SQL tính và làm tròn
 * (`clamp-must-be-sql-not-js`); FE chỉ ĐỌC. Không có hàm `sum*` nào trong file này, và đừng thêm —
 * một tổng tính ở JS trên `numeric(18,2)` sẽ lệch với con số BE ghi vào phiếu lương.
 */
import { formatCurrency, formatNumber } from "@mediaos/web-core";

/** Ký hiệu cho trường bị server strip. KHÔNG dùng "0" và KHÔNG dùng ổ khoá 🔒 (§14: v1 gate cấp ROUTE,
 * không có trạng thái «ô tiền bị che» per-row — dấu gạch là "không có dữ liệu ở đây", đúng nghĩa). */
export const PAYROLL_MASKED_PLACEHOLDER = "—";

/** Tiền VND, hoặc `—` khi server không trả khoá. `0` THẬT vẫn in "0 ₫" — chỉ `undefined`/`null` mới `—`. */
export function formatPayrollMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return PAYROLL_MASKED_PLACEHOLDER;
  return formatCurrency(value);
}

/**
 * Tiền CÓ DẤU (`adjustmentAmount`, `payslip_items.amount`) — dấu `+` hiện TƯỜNG MINH cho số dương.
 *
 * Vì sao không để `Intl` tự lo: mặc định nó chỉ in dấu `−`, nên một dòng «Điều chỉnh 500.000 ₫» không
 * phân biệt được truy lĩnh với truy thu trên phiếu lương. `signDisplay: "exceptZero"` giữ `0` sạch.
 */
export function formatPayrollSignedMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return PAYROLL_MASKED_PLACEHOLDER;
  const formatted = formatCurrency(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

/**
 * Ngày công — **THẬP PHÂN NỬA NGÀY** kể từ `S13-PAYROLL-BE-1B` (`work/present/paid/unpaid` là
 * `numeric(8,2)`). In `21,5` chứ không làm tròn về `22`: làm tròn ở đây là che mất đúng cái nửa buổi mà
 * WO đó sinh ra để sửa. Số nguyên vẫn in gọn (`22`, không phải `22,00`).
 */
export function formatPayrollDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return PAYROLL_MASKED_PLACEHOLDER;
  return formatNumber(value, { maximumFractionDigits: 2 });
}

/** Phút trễ — số nguyên; `0` in "0" (có mặt là dữ liệu thật, không phải mask). */
export function formatPayrollMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return PAYROLL_MASKED_PLACEHOLDER;
  return formatNumber(value, { maximumFractionDigits: 0 });
}

/**
 * `true` khi DTO đã bị server strip vế tiền — dùng để hiện băng «bạn không có quyền xem số tiền» MỘT
 * LẦN ở đầu bảng thay vì rải `—` câm khắp 500 dòng.
 *
 * Neo bằng `gross` vì đó là khoá đi qua CÙNG cổng mask với mọi khoá tiền khác của cả `payslips` lẫn
 * `payroll_period_lines` (server strip theo cặp quyền, một lần, không strip lẻ từng cột).
 */
export function isPayrollMoneyMasked(row: { gross?: number | null }): boolean {
  return row.gross === null || row.gross === undefined;
}

/** Lớp CSS cho MỌI ô tiền/số — `tabular-nums` là yêu cầu tường minh của SPEC-11 §14. */
export const PAYROLL_NUMERIC_CELL_CLASS = "text-right tabular-nums";
