import { describe, expect, it } from "vitest";
import {
  payslipPdfFileName,
  payslipZipEntryName,
  toPayslipPdfInput,
} from "./payroll-payslip-pdf.document-input";
import type { PayslipItemRow, PayslipRow } from "./payroll-payslips.repository";

const USER = "abcdef12-3456-4789-8abc-def012345678";

const row = {
  id: "p1",
  user_id: USER,
  period_month: "2026-08",
  base_salary: "10000000.00",
  total_allowances: "0.00",
  bonus_amount: "0.00",
  penalty_amount: "0.00",
  deduction_amount: "0.00",
  adjustment_amount: "0.00",
  gross: "10000000.00",
  net: "9000000.00",
  work_days: "22.00",
  present_days: "22.00",
  paid_leave_days: "0.00",
  unpaid_leave_days: "0.00",
} as unknown as PayslipRow;

const item = (label: string, amount: string) =>
  ({
    id: label,
    payslip_id: "p1",
    item_type: "earning",
    label,
    amount,
    sort_order: 1,
  }) as unknown as PayslipItemRow;

describe("toPayslipPdfInput", () => {
  it("chép nguyên snapshot (không tính lại) + tên/mã từ bảng tên", () => {
    const input = toPayslipPdfInput("Cty", row, [item("Lương", "10000000.00")], {
      userId: USER,
      displayName: "Nguyễn Văn A",
      employeeCode: "NV1",
    });
    expect(input).toMatchObject({
      companyName: "Cty",
      periodMonth: "2026-08",
      employeeName: "Nguyễn Văn A",
      employeeCode: "NV1",
      items: [{ label: "Lương", amount: "10000000.00" }],
    });
    expect(input.payslip.net).toBe("9000000.00");
  });

  it("người đã xoá mềm (vắng bảng tên) ⇒ tên/mã null (PDF in «—»)", () => {
    const input = toPayslipPdfInput("Cty", row, [], undefined);
    expect(input.employeeName).toBeNull();
    expect(input.employeeCode).toBeNull();
  });
});

describe("tên tệp", () => {
  it("tên hiển thị KHÔNG mang danh tính người", () => {
    expect(payslipPdfFileName("2026-08", "pdf")).toBe("phieu-luong-2026-08.pdf");
    expect(payslipPdfFileName("2026-08", "zip")).toBe("phieu-luong-2026-08.zip");
  });

  it("entry ZIP = mã NV; thiếu mã ⇒ 8 ký tự userId; ký tự lạ bị thay; trùng ⇒ thêm hậu tố", () => {
    const seen = new Set<string>();
    const person = { userId: USER, displayName: null, employeeCode: "NV/01 x" };
    expect(payslipZipEntryName("2026-08", USER, person, seen)).toBe("NV_01_x-2026-08.pdf");
    expect(payslipZipEntryName("2026-08", USER, person, seen)).toBe("NV_01_x-abcdef12-2026-08.pdf");
    expect(payslipZipEntryName("2026-08", USER, undefined, seen)).toBe("abcdef12-2026-08.pdf");
  });
});
