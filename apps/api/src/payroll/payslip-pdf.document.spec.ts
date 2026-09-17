import { describe, expect, it } from "vitest";
import { inspectPdf, normalizePdfText } from "../../test/helpers/pdf-text";
import {
  buildPayslipPdfDocument,
  formatDays,
  formatPeriodMonth,
  formatVndAmount,
  type PayslipPdfInput,
} from "./payslip-pdf.document";
import { PayslipPdfRenderer } from "./payslip-pdf.renderer";

const INPUT: PayslipPdfInput = {
  companyName: "Công ty Cổ phần Ánh Dương",
  periodMonth: "2026-08",
  employeeName: "Nguyễn Thị Ánh Tuyết",
  employeeCode: "NV-0042",
  payslip: {
    base_salary: "19999999.99",
    total_allowances: "1500000.00",
    bonus_amount: "0.00",
    penalty_amount: "0.00",
    deduction_amount: "2310000.50",
    adjustment_amount: "-125000.00",
    gross: "21499999.99",
    net: "19064999.49",
    work_days: "22.00",
    present_days: "21.50",
    paid_leave_days: "0.50",
    unpaid_leave_days: "0.00",
  },
  items: [
    { label: "Lương cơ bản", amount: "19999999.99" },
    { label: "Phụ cấp ăn trưa", amount: "1500000.00" },
    { label: "Bảo hiểm xã hội (8%)", amount: "-1599999.99" },
    { label: "Điều chỉnh: truy thu tháng trước", amount: "-125000.00" },
  ],
};

describe("formatVndAmount — chỉ thao tác chuỗi (DECISIONS-14 §6.1)", () => {
  it.each([
    ["19999999.99", "19.999.999,99"],
    ["1500000.00", "1.500.000"],
    ["-125000.00", "-125.000"],
    ["0.00", "0"],
    ["-0.00", "0"],
    ["1.005", "1,005"],
    ["0.385", "0,385"],
    ["999", "999"],
    ["1000", "1.000"],
    ["007.50", "7,5"],
  ])("%s ⇒ %s", (raw, expected) => {
    expect(formatVndAmount(raw)).toBe(expected);
  });

  it.each(["", "abc", "1e6", "1,5", "NaN", "12.3.4"])(
    "ném với chuỗi không phải numeric %j — không in số sai",
    (raw) => {
      expect(() => formatVndAmount(raw)).toThrow(/không hợp lệ/);
    },
  );
});

describe("formatDays / formatPeriodMonth", () => {
  it("bỏ phần lẻ 0, giữ phần lẻ khác 0 bằng dấu phẩy", () => {
    expect(formatDays("22.00")).toBe("22");
    expect(formatDays("21.50")).toBe("21,5");
  });

  it("kỳ YYYY-MM ⇒ MM/YYYY, kỳ lệch khuôn ⇒ ném", () => {
    expect(formatPeriodMonth("2026-08")).toBe("08/2026");
    expect(() => formatPeriodMonth("2026-8")).toThrow();
  });
});

describe("buildPayslipPdfDocument", () => {
  it("giữ nguyên thứ tự khoản và nhãn snapshot, font mặc định là Roboto", () => {
    const doc = buildPayslipPdfDocument(INPUT);
    expect(doc.defaultStyle).toEqual({ font: "Roboto", fontSize: 10 });
    const json = JSON.stringify(doc);
    const positions = INPUT.items.map((item) => json.indexOf(item.label));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("hiển thị «—» khi thiếu tên/mã (người đã xoá mềm)", () => {
    const doc = buildPayslipPdfDocument({ ...INPUT, employeeName: null, employeeCode: null });
    expect(JSON.stringify(doc)).toContain('["Họ và tên",{"text":"—"');
  });
});

describe("PayslipPdfRenderer — đọc LẠI PDF (DECISIONS-14 §6.2)", () => {
  it("PDF sinh ra chứa đúng chuỗi có dấu + số tiền snapshot, font Roboto nhúng", async () => {
    const started = Date.now();
    const bytes = await new PayslipPdfRenderer().render(buildPayslipPdfDocument(INPUT));
    const elapsedMs = Date.now() - started;

    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const pdf = await inspectPdf(bytes);
    const text = normalizePdfText(pdf.text);

    expect(pdf.pageCount).toBe(1);
    expect(pdf.hasEmbeddedTrueType).toBe(true);
    expect(pdf.hasEmbeddedRoboto).toBe(true);
    for (const needle of [
      "PHIẾU LƯƠNG THÁNG 08/2026",
      "Công ty Cổ phần Ánh Dương",
      "Nguyễn Thị Ánh Tuyết",
      "NV-0042",
      "Phụ cấp ăn trưa",
      "Bảo hiểm xã hội (8%)",
      "Điều chỉnh: truy thu tháng trước",
      "19.999.999,99",
      "-1.599.999,99",
      "THỰC LĨNH",
      "19.064.999,49 VND",
    ]) {
      expect(text).toContain(needle);
    }
    // SPEC-11 §19.1: < 1,5 s một phiếu (lượt đầu gồm cả nạp font).
    expect(elapsedMs).toBeLessThan(1500);
  });
});
