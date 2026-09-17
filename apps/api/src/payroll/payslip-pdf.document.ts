/**
 * S15-PAYROLL-BE-5B — dựng `docDefinition` (pdfmake) cho MỘT phiếu lương. Hàm THUẦN: không I/O, không đọc
 * giờ hệ thống, không tính lại tiền — mọi con số lấy nguyên từ snapshot `payslips` + `payslip_items`
 * (DECISIONS-14 §4.4.1). Font mặc định = `Roboto` NHÚNG (renderer nạp vào vfs) — §4.2.
 *
 * Tiền đi dạng CHUỖI numeric của Postgres và chỉ được định dạng bằng thao tác chuỗi (DECISIONS-14 §6.1 cấm
 * `Number`/`parseFloat` trên đường tiền).
 */

/** Tên font nhúng — renderer đăng ký đúng tên này; đổi ở một chỗ. */
export const PAYSLIP_PDF_FONT = "Roboto";

export interface PayslipPdfMoney {
  base_salary: string;
  total_allowances: string;
  bonus_amount: string;
  penalty_amount: string;
  deduction_amount: string;
  adjustment_amount: string;
  gross: string;
  net: string;
}

export interface PayslipPdfDays {
  work_days: string;
  present_days: string;
  paid_leave_days: string;
  unpaid_leave_days: string;
}

export interface PayslipPdfItem {
  label: string;
  amount: string;
}

export interface PayslipPdfInput {
  companyName: string;
  /** `YYYY-MM` (CHECK `payroll_periods_month_check`). */
  periodMonth: string;
  employeeName: string | null;
  employeeCode: string | null;
  payslip: PayslipPdfMoney & PayslipPdfDays;
  /** Đã xếp theo `sort_order, id` (repository). */
  items: readonly PayslipPdfItem[];
}

/** pdfmake không kèm kiểu cho 0.3 — giữ kiểu hẹp ở ranh giới, renderer là nơi duy nhất nhận nó. */
export type PdfDocDefinition = Readonly<Record<string, unknown>>;

const NUMERIC_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * `"19999999.99"` ⇒ `"19.999.999,99"` · `"-1500000.00"` ⇒ `"-1.500.000"` · `"0"` ⇒ `"0"`.
 * Phần lẻ toàn số 0 bị bỏ (VND); phần lẻ khác 0 giữ nguyên chữ số (không làm tròn). Chuỗi không phải
 * numeric ⇒ NÉM — một phiếu lương in sai số thì tệ hơn không in.
 */
export function formatVndAmount(value: string): string {
  const match = NUMERIC_RE.exec(value.trim());
  if (!match) throw new Error(`payslip-pdf: số tiền không hợp lệ "${value}"`);
  const [, sign, intRaw, fracRaw = ""] = match;
  const intPart = intRaw.replace(/^0+(?=\d)/, "");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = fracRaw.replace(/0+$/, "");
  const isZero = intPart === "0" && frac === "";
  const body = frac ? `${grouped},${frac}` : grouped;
  return isZero ? "0" : `${sign}${body}`;
}

/** `"22.00"` ⇒ `"22"` · `"21.5"` ⇒ `"21,5"`. */
export function formatDays(value: string): string {
  const match = NUMERIC_RE.exec(value.trim());
  if (!match) throw new Error(`payslip-pdf: số ngày không hợp lệ "${value}"`);
  const [, sign, intRaw, fracRaw = ""] = match;
  const frac = fracRaw.replace(/0+$/, "");
  const intPart = intRaw.replace(/^0+(?=\d)/, "");
  return `${sign}${intPart}${frac ? `,${frac}` : ""}`;
}

/** `"2026-08"` ⇒ `"08/2026"`. */
export function formatPeriodMonth(periodMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodMonth);
  if (!match) throw new Error(`payslip-pdf: kỳ không hợp lệ "${periodMonth}"`);
  return `${match[2]}/${match[1]}`;
}

type Row = readonly [string, string];

function keyValueTable(rows: readonly Row[]): Record<string, unknown> {
  return {
    table: {
      widths: ["*", "auto"],
      body: rows.map(([label, value]) => [label, { text: value, alignment: "right" }]),
    },
    layout: "lightHorizontalLines",
    margin: [0, 0, 0, 12],
  };
}

export function buildPayslipPdfDocument(input: PayslipPdfInput): PdfDocDefinition {
  const { payslip } = input;
  const month = formatPeriodMonth(input.periodMonth);

  const infoRows: Row[] = [
    ["Họ và tên", input.employeeName ?? "—"],
    ["Mã nhân viên", input.employeeCode ?? "—"],
    ["Ngày công chuẩn", formatDays(payslip.work_days)],
    ["Ngày công thực tế", formatDays(payslip.present_days)],
    ["Nghỉ có lương", formatDays(payslip.paid_leave_days)],
    ["Nghỉ không lương", formatDays(payslip.unpaid_leave_days)],
  ];

  const itemBody = [
    [
      { text: "Khoản mục", bold: true },
      { text: "Số tiền (VND)", bold: true, alignment: "right" },
    ],
    ...input.items.map((item) => [
      item.label,
      { text: formatVndAmount(item.amount), alignment: "right" },
    ]),
  ];

  const summaryRows: Row[] = [
    ["Lương cơ bản", formatVndAmount(payslip.base_salary)],
    ["Tổng phụ cấp", formatVndAmount(payslip.total_allowances)],
    ["Thưởng", formatVndAmount(payslip.bonus_amount)],
    ["Phạt", formatVndAmount(payslip.penalty_amount)],
    ["Khấu trừ", formatVndAmount(payslip.deduction_amount)],
    ["Điều chỉnh", formatVndAmount(payslip.adjustment_amount)],
    ["Tổng thu nhập", formatVndAmount(payslip.gross)],
  ];

  return {
    info: { title: `Phiếu lương ${month}` },
    pageSize: "A4",
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: PAYSLIP_PDF_FONT, fontSize: 10 },
    content: [
      { text: input.companyName, bold: true, fontSize: 11 },
      {
        text: `PHIẾU LƯƠNG THÁNG ${month}`,
        bold: true,
        fontSize: 16,
        alignment: "center",
        margin: [0, 12, 0, 12],
      },
      keyValueTable(infoRows),
      {
        table: { headerRows: 1, widths: ["*", "auto"], body: itemBody },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 12],
      },
      keyValueTable(summaryRows),
      {
        columns: [
          { text: "THỰC LĨNH", bold: true, fontSize: 13 },
          {
            text: `${formatVndAmount(payslip.net)} VND`,
            bold: true,
            fontSize: 13,
            alignment: "right",
          },
        ],
      },
    ],
  };
}
