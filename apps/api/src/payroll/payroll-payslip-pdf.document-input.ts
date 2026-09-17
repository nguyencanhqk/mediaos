import type { PayslipPdfInput } from "./payslip-pdf.document";
import type { PayslipItemRow, PayslipRow } from "./payroll-payslips.repository";
import type { PayrollPersonRef } from "./payroll.types";

/**
 * S15-PAYROLL-BE-5B — ghép hàng snapshot thành đầu vào của `buildPayslipPdfDocument`. Dùng chung cho 083/084
 * (một phiếu) và consumer 085 (lô) ⇒ hai đường in ra đúng cùng một tài liệu cho cùng một phiếu.
 */
export function toPayslipPdfInput(
  companyName: string,
  row: PayslipRow,
  items: readonly PayslipItemRow[],
  person: PayrollPersonRef | undefined,
): PayslipPdfInput {
  return {
    companyName,
    periodMonth: row.period_month,
    // Người đã xoá mềm vắng khỏi bảng tên (PayrollPeopleRepository) ⇒ PDF in «—» (plan §0b).
    employeeName: person?.displayName ?? null,
    employeeCode: person?.employeeCode ?? null,
    payslip: {
      base_salary: row.base_salary,
      total_allowances: row.total_allowances,
      bonus_amount: row.bonus_amount,
      penalty_amount: row.penalty_amount,
      deduction_amount: row.deduction_amount,
      adjustment_amount: row.adjustment_amount,
      gross: row.gross,
      net: row.net,
      work_days: row.work_days,
      present_days: row.present_days,
      paid_leave_days: row.paid_leave_days,
      unpaid_leave_days: row.unpaid_leave_days,
    },
    items: items.map((item) => ({ label: item.label, amount: item.amount })),
  };
}

/** Tên tệp hiển thị (danh sách metadata chung thấy được) — KHÔNG chứa tên/mã người (plan E-6). */
export function payslipPdfFileName(periodMonth: string, kind: "pdf" | "zip"): string {
  return `phieu-luong-${periodMonth}.${kind}`;
}

/** Tên entry trong ZIP — mã NV, thiếu thì 8 ký tự đầu `userId`; `seen` chống trùng tên. */
export function payslipZipEntryName(
  periodMonth: string,
  userId: string,
  person: PayrollPersonRef | undefined,
  seen: Set<string>,
): string {
  const raw = person?.employeeCode ?? userId.slice(0, 8);
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "_") || userId.slice(0, 8);
  let name = `${safe}-${periodMonth}.pdf`;
  if (seen.has(name)) name = `${safe}-${userId.slice(0, 8)}-${periodMonth}.pdf`;
  seen.add(name);
  return name;
}
