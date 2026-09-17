import type {
  PayrollReportCode,
  PayrollReportColumnType,
  PayrollReportParam,
} from "@mediaos/contracts";
import type { PayrollSoftGateKey } from "./payroll-access.service";

/**
 * S15-PAYROLL-BE-5 — BẢNG ĐỊNH NGHĨA 7 báo cáo (PAY-DEC-018, plan BE-5 §3). NGUỒN SỰ THẬT cho:
 *  · cặp NGUỒN mà 081/082 assert thêm (owner O-2) và 080 kiểm mềm để lọc danh mục;
 *  · tham số bắt buộc/tuỳ chọn (400 khi thiếu);
 *  · cột hiển thị + kiểu + quy tắc hàng tổng (§0b B4) + nhãn/độ rộng cột XLSX.
 *
 * ⚠️ `sourceRouteKey` được census ghim bằng ĐẲNG THỨC (`payroll-report-source-pairs.unit-spec.ts`): đổi một ô ở
 * đây là đổi quyền, phải đi qua review — không phải chỉnh nhãn.
 *
 * Hàng dữ liệu có thể mang thêm khoá KHÔNG nằm trong `columns` (`userId` · `orgUnitId` · `periodId` · `batchId` ·
 * `salaryProfileId`) để FE dựng liên kết sâu; XLSX chỉ xuất `columns`.
 */

export interface PayrollReportColumnDef {
  readonly key: string;
  readonly type: PayrollReportColumnType;
  /** Nhãn cột XLSX (FE dùng i18n theo `key`). */
  readonly header: string;
  readonly width: number;
  /** `sum` = cộng được trên CẢ bộ lọc (hàng tổng). Vắng = không cộng (bình quân · min/max · tỉ lệ · phiên bản). */
  readonly total?: "sum";
}

export interface PayrollReportDef {
  readonly code: PayrollReportCode;
  /** Cặp đọc của NGUỒN theo người (O-2); `null` = báo cáo chỉ số tổng hợp. */
  readonly sourceRouteKey: Exclude<PayrollSoftGateKey, "periodExport"> | null;
  readonly required: readonly PayrollReportParam[];
  readonly optional: readonly PayrollReportParam[];
  readonly sheetName: string;
  readonly filePrefix: string;
  readonly columns: readonly PayrollReportColumnDef[];
}

const money = (key: string, header: string, total?: "sum"): PayrollReportColumnDef => ({
  key,
  type: "money",
  header,
  width: 16,
  ...(total ? { total } : {}),
});
const text = (key: string, header: string, width = 20): PayrollReportColumnDef => ({
  key,
  type: "text",
  header,
  width,
});
const count = (key: string, header: string): PayrollReportColumnDef => ({
  key,
  type: "number",
  header,
  width: 12,
});
const pct = (key: string, header: string): PayrollReportColumnDef => ({
  key,
  type: "percent",
  header,
  width: 12,
});

const RANGE: readonly PayrollReportParam[] = ["fromMonth", "toMonth"];

export const PAYROLL_REPORTS: Readonly<Record<PayrollReportCode, PayrollReportDef>> = {
  "employee-income": {
    code: "employee-income",
    sourceRouteKey: "payslipList",
    required: RANGE,
    optional: ["orgUnitId"],
    sheetName: "Thu nhập nhân viên",
    filePrefix: "tong-hop-thu-nhap",
    columns: [
      text("employeeCode", "Mã NV", 14),
      text("displayName", "Họ tên", 28),
      text("orgUnitName", "Đơn vị", 24),
      count("payslipCount", "Số kỳ"),
      money("totalGross", "Tổng thu nhập", "sum"),
      money("insuranceEmployee", "BH người lao động", "sum"),
      money("pitWithheld", "Thuế TNCN khấu trừ", "sum"),
      money("totalDeduction", "Tổng khấu trừ", "sum"),
      money("totalAdjustment", "Điều chỉnh", "sum"),
      money("totalNet", "Thực nhận", "sum"),
    ],
  },
  "salary-by-period": {
    code: "salary-by-period",
    sourceRouteKey: null,
    required: RANGE,
    optional: ["orgUnitId"],
    sheetName: "Lương theo thời gian",
    filePrefix: "luong-theo-thoi-gian",
    columns: [
      { key: "periodMonth", type: "month", header: "Kỳ", width: 10 },
      text("periodStatus", "Trạng thái", 14),
      count("headcount", "Số người"),
      money("totalGross", "Tổng thu nhập", "sum"),
      money("totalDeduction", "Tổng khấu trừ", "sum"),
      money("totalNet", "Thực nhận", "sum"),
      money("avgGross", "Thu nhập bình quân"),
      money("avgNet", "Thực nhận bình quân"),
      money("employerStatutory", "BH/KPCĐ doanh nghiệp", "sum"),
      money("totalCost", "Tổng chi phí", "sum"),
    ],
  },
  "income-structure": {
    code: "income-structure",
    sourceRouteKey: null,
    required: RANGE,
    optional: ["orgUnitId"],
    sheetName: "Cơ cấu thu nhập",
    filePrefix: "co-cau-thu-nhap",
    columns: [
      text("componentCode", "Mã thành phần", 18),
      text("itemType", "Loại", 12),
      text("label", "Khoản", 28),
      text("direction", "Chiều", 12),
      money("totalAmount", "Số tiền"),
      pct("sharePct", "Tỉ trọng (%)"),
    ],
  },
  "cost-by-org-unit": {
    code: "cost-by-org-unit",
    sourceRouteKey: null,
    required: RANGE,
    optional: ["orgUnitId"],
    sheetName: "Chi phí theo đơn vị",
    filePrefix: "chi-phi-theo-don-vi",
    columns: [
      text("orgUnitName", "Đơn vị", 24),
      count("headcount", "Số người"),
      money("totalGross", "Tổng thu nhập", "sum"),
      money("employerStatutory", "BH/KPCĐ doanh nghiệp", "sum"),
      money("totalCost", "Tổng chi phí", "sum"),
      money("totalNet", "Thực nhận", "sum"),
      money("avgGross", "Thu nhập bình quân"),
      money("minGross", "Thu nhập thấp nhất"),
      money("maxGross", "Thu nhập cao nhất"),
    ],
  },
  "salary-history": {
    code: "salary-history",
    sourceRouteKey: "salaryProfileList",
    required: [],
    optional: ["fromMonth", "toMonth", "orgUnitId", "userId"],
    sheetName: "Lịch sử lương",
    filePrefix: "lich-su-luong",
    columns: [
      text("employeeCode", "Mã NV", 14),
      text("displayName", "Họ tên", 28),
      text("orgUnitName", "Đơn vị", 24),
      { key: "effectiveDate", type: "date", header: "Ngày hiệu lực", width: 14 },
      text("salaryType", "Loại lương", 10),
      money("baseSalary", "Lương cơ bản"),
      money("insuranceSalary", "Lương đóng BH"),
      money("probationSalary", "Lương thử việc"),
      pct("payRatioPct", "Tỉ lệ hưởng (%)"),
      money("itemsTotal", "Phụ cấp định mức"),
      pct("changePct", "Thay đổi (%)"),
    ],
  },
  "payment-summary": {
    code: "payment-summary",
    sourceRouteKey: "batchList",
    required: RANGE,
    optional: ["orgUnitId", "batchStatus"],
    sheetName: "Tổng hợp chi trả",
    filePrefix: "tong-hop-chi-tra",
    columns: [
      text("batchCode", "Mã đợt", 24),
      { key: "periodMonth", type: "month", header: "Kỳ", width: 10 },
      text("method", "Hình thức", 12),
      text("status", "Trạng thái", 12),
      { key: "payDate", type: "date", header: "Ngày chi", width: 14 },
      count("lineCount", "Số dòng"),
      count("paidLineCount", "Đã chi"),
      money("totalNet", "Tổng tiền", "sum"),
      { key: "completedAt", type: "date", header: "Hoàn tất lúc", width: 22 },
    ],
  },
  "budget-status": {
    code: "budget-status",
    sourceRouteKey: "budgetList",
    required: ["fiscalYear"],
    optional: ["orgUnitId"],
    sheetName: "Tình hình ngân sách",
    filePrefix: "tinh-hinh-ngan-sach",
    // Hàng tổng của báo cáo này KHÔNG phải Σ cột (hàng công ty + hàng đơn vị sẽ cộng trùng) — repository tính
    // riêng bằng `PayrollBudgetsRepository.yearTotalsTx` (§0b B4). `total` vắng ở mọi cột là CÓ CHỦ ĐÍCH.
    columns: [
      text("orgUnitName", "Đơn vị", 24),
      money("plannedAmount", "Kế hoạch"),
      money("actualAmount", "Thực hiện"),
      money("variance", "Chênh lệch"),
      pct("usagePct", "Tỉ lệ sử dụng (%)"),
    ],
  },
};

/** Cột cộng được của một báo cáo (hàng tổng). */
export function sumColumnsOf(def: PayrollReportDef): string[] {
  return def.columns.filter((c) => c.total === "sum").map((c) => c.key);
}

/** Khoá hàng tổng của `budget-status` (tính riêng, không qua `sumColumnsOf`). */
export const BUDGET_TOTAL_KEYS = ["plannedAmount", "actualAmount", "variance"] as const;
