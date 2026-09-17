import { z } from "zod";
import { periodMonthSchema } from "./attendance";
import {
  paymentBatchStatusEnum,
  payrollPageQuery,
  payrollPeriodStatusEnum,
  payslipItemTypeEnum,
} from "./payroll";

/**
 * MediaOS — PAYROLL v2 track D phần 1 (S15-PAYROLL-BE-5 · SPEC-11 §9.1 PAY-SCREEN-015/016 · §15.1 hàng
 * 078–082 · PAY-DEC-018): Tổng quan module · Lời nhắc · 7 báo cáo.
 *
 * Tách file riêng (khuôn `./payroll-disbursement`): import NGƯỢC enum/helper của `./payroll`, **KHÔNG
 * re-export** tên nào của nó.
 *
 * Luật chung:
 *  1. **Nguồn số = phiếu lương của kỳ ĐÃ PHÁT HÀNH** (`Published`/`Paid`/`Locked`) — cùng nguồn với «thực
 *     hiện» ngân sách (073), nên ba nơi ra cùng một con số (plan BE-5 D-1).
 *  2. **Đơn vị = đơn vị HIỆN TẠI của nhân sự** (hồ sơ sống) — `payslips` không lưu đơn vị (D-2).
 *  3. Tiền là `number` như mọi DTO PAYROLL; nhãn cột sống ở i18n FE, server chỉ trả `key` + `type`.
 *  4. KHÔNG cache ở server — số tiền phải tươi và mỗi lượt đọc có vết audit (SPEC-11 §18.1 D).
 */

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. Mã báo cáo + tham số
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** 7 báo cáo của PAY-DEC-018 — thứ tự = thứ tự hiển thị ở PAY-SCREEN-016. */
export const PAYROLL_REPORT_CODES = [
  "employee-income",
  "salary-by-period",
  "income-structure",
  "cost-by-org-unit",
  "salary-history",
  "payment-summary",
  "budget-status",
] as const;
export const payrollReportCodeEnum = z.enum(PAYROLL_REPORT_CODES);
export type PayrollReportCode = z.infer<typeof payrollReportCodeEnum>;

/** Trần dòng theo bộ lọc của 081/082 — vượt ⇒ 422 `PAYROLL-ERR-031` `report-too-large` (SPEC-11 §12.1). */
export const PAYROLL_REPORT_MAX_ROWS = 50_000;
/** Khoảng tháng tối đa của một lượt (NFR SPEC-11 §19.1 đo ở 12 kỳ; 24 là trần an toàn — plan BE-5 D-5). */
export const PAYROLL_REPORT_MAX_MONTHS = 24;
/** Số kỳ mặc định của khối xu hướng ở Tổng quan (078). */
export const PAYROLL_OVERVIEW_DEFAULT_MONTHS = 12;

export const payrollReportParamEnum = z.enum([
  "fromMonth",
  "toMonth",
  "orgUnitId",
  "userId",
  "fiscalYear",
  "batchStatus",
]);
export type PayrollReportParam = z.infer<typeof payrollReportParamEnum>;

export const payrollReportColumnTypeEnum = z.enum([
  "text",
  "money",
  "number",
  "percent",
  "date",
  "month",
]);
export type PayrollReportColumnType = z.infer<typeof payrollReportColumnTypeEnum>;

/** Số tháng giữa hai `YYYY-MM` tính CẢ HAI đầu (`2026-01..2026-12` = 12). */
export function payrollMonthSpan(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = toMonth.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

const reportFilterShape = {
  fromMonth: periodMonthSchema.optional(),
  toMonth: periodMonthSchema.optional(),
  /** Lọc CHÍNH XÁC một đơn vị (không đệ quy cây con — cùng luật 036). */
  orgUnitId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  fiscalYear: z.coerce.number().int().min(2000).max(2100).optional(),
  batchStatus: paymentBatchStatusEnum.optional(),
};

type RangeInput = { fromMonth?: string; toMonth?: string };

/** `fromMonth ≤ toMonth` và khoảng ≤ `PAYROLL_REPORT_MAX_MONTHS` — chỉ kiểm khi CÓ ĐỦ hai đầu. */
function refineRange(v: RangeInput, ctx: z.RefinementCtx): void {
  if (!v.fromMonth || !v.toMonth) return;
  const span = payrollMonthSpan(v.fromMonth, v.toMonth);
  if (span < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toMonth"],
      message: "toMonth phải ≥ fromMonth",
    });
  } else if (span > PAYROLL_REPORT_MAX_MONTHS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toMonth"],
      message: `Khoảng tháng tối đa ${PAYROLL_REPORT_MAX_MONTHS} tháng`,
    });
  }
}

/**
 * `GET /payroll/reports/{code}` (081) — MỘT schema phẳng cho cả 7 báo cáo (plan D-5). Tham số BẮT BUỘC
 * của từng báo cáo do server kiểm (400 `VALIDATION-ERR-001` kèm `field`); tham số không áp cho báo cáo đó
 * bị bỏ qua. `.strict()`: khoá lạ ⇒ 400.
 */
export const payrollReportQuerySchema = z
  .object({ ...reportFilterShape, ...payrollPageQuery })
  .strict()
  .superRefine(refineRange);
export type PayrollReportQuery = z.infer<typeof payrollReportQuerySchema>;

/** `GET /payroll/reports/{code}/export` (082) — cùng bộ lọc, KHÔNG phân trang (trần 50.000 dòng). */
export const payrollReportExportQuerySchema = z
  .object(reportFilterShape)
  .strict()
  .superRefine(refineRange);
export type PayrollReportExportQuery = z.infer<typeof payrollReportExportQuerySchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. Danh mục (080) + dữ liệu (081)
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const payrollReportColumnSchema = z.object({
  key: z.string(),
  type: payrollReportColumnTypeEnum,
});
export type PayrollReportColumn = z.infer<typeof payrollReportColumnSchema>;

/**
 * Một mục của 080. Server CHỈ trả báo cáo caller mở được (owner O-2: báo cáo lộ tiền theo người đòi
 * thêm cặp đọc của nguồn); `exportable` = caller giữ thêm `('export','payroll')`.
 */
export const payrollReportCatalogItemSchema = z.object({
  code: payrollReportCodeEnum,
  requiredParams: z.array(payrollReportParamEnum),
  optionalParams: z.array(payrollReportParamEnum),
  columns: z.array(payrollReportColumnSchema),
  exportable: z.boolean(),
});
export type PayrollReportCatalogItemDto = z.infer<typeof payrollReportCatalogItemSchema>;
export const payrollReportCatalogSchema = z.array(payrollReportCatalogItemSchema);

const reportCell = z.union([z.string(), z.number(), z.null()]);

/**
 * 081 — `data` của envelope phân trang. `rows[i][column.key]`; `totals` = tổng các cột `money` trên
 * CẢ bộ lọc (không phải trang) — SUM ở SQL.
 */
export const payrollReportDataSchema = z.object({
  reportCode: payrollReportCodeEnum,
  columns: z.array(payrollReportColumnSchema),
  rows: z.array(z.record(z.string(), reportCell)),
  totals: z.record(z.string(), z.number()),
});
export type PayrollReportDataDto = z.infer<typeof payrollReportDataSchema>;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. Tổng quan (078) + Lời nhắc (079)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Cận DƯỚI của 7 dải lương (VND, gross/tháng) — dải cuối không có cận trên. */
export const PAYROLL_SALARY_BANDS = [
  0, 5_000_000, 10_000_000, 15_000_000, 20_000_000, 30_000_000, 50_000_000,
] as const;
/** Số khoản thu hiện riêng ở khối cơ cấu; phần còn lại gộp thành một hàng `other`. */
export const PAYROLL_OVERVIEW_STRUCTURE_TOP = 8;

export const payrollOverviewQuerySchema = z
  .object({
    /** Kỳ neo = kỳ đã phát hành mới nhất có `period_month ≤ toMonth` (vắng ⇒ mới nhất). */
    toMonth: periodMonthSchema.optional(),
    months: z.coerce.number().int().min(1).max(PAYROLL_REPORT_MAX_MONTHS).optional(),
    fiscalYear: z.coerce.number().int().min(2000).max(2100).optional(),
  })
  .strict();
export type PayrollOverviewQuery = z.infer<typeof payrollOverviewQuerySchema>;

const periodPoint = z.object({
  periodMonth: periodMonthSchema,
  headcount: z.number().int().nonnegative(),
  totalGross: z.number(),
  totalNet: z.number(),
  /** Σ các khoản luật định phía DN (BHXH/BHYT/BHTN/KPCĐ — kind `statutory_employer`) của dòng lương đã đóng băng. */
  employerStatutory: z.number(),
  totalCost: z.number(),
  avgGross: z.number(),
  avgNet: z.number(),
});

export const payrollOverviewSchema = z.object({
  /**
   * Kỳ neo = kỳ ĐÃ PHÁT HÀNH mới nhất (≠ «kỳ mới nhất» của 018 — 018 xét MỌI trạng thái, plan BE-5 §0b C14).
   */
  latestPeriod: z
    .object({
      id: z.string().uuid(),
      periodMonth: periodMonthSchema,
      status: payrollPeriodStatusEnum,
    })
    .nullable(),
  months: z.number().int().positive(),
  /** Khối 1 — phân bố gross của kỳ neo theo `PAYROLL_SALARY_BANDS`; luôn đủ 7 dải (dải trống = 0). */
  salaryDistribution: z.array(
    z.object({
      bandFrom: z.number(),
      bandTo: z.number().nullable(),
      headcount: z.number().int().nonnegative(),
    }),
  ),
  /** Khối 2 — cơ cấu khoản THU của kỳ neo; `componentCode = null` + `itemType = 'other'` là hàng gộp. */
  incomeStructure: z.array(
    z.object({
      componentCode: z.string().nullable(),
      itemType: z.union([payslipItemTypeEnum, z.literal("other")]),
      label: z.string(),
      amount: z.number(),
      sharePct: z.number(),
    }),
  ),
  /**
   * Khối 3 — ngân sách năm (kế hoạch null = chưa lập). Thực hiện = gross, CHƯA gồm phần DN (như 073). **Vắng khoá**
   * khi caller thiếu `('view','payroll-budget')`@Company (plan BE-5 §0b B2 — cùng cổng báo cáo `budget-status`).
   */
  budget: z
    .object({
      fiscalYear: z.number().int(),
      plannedAmount: z.number().nullable(),
      actualAmount: z.number(),
      usagePct: z.number().nullable(),
    })
    .optional(),
  /** Khối 4 + 5 — chi phí & thu nhập bình quân theo kỳ (tăng dần theo tháng). */
  byPeriod: z.array(periodPoint),
  /** Khối 6 — thu nhập theo đơn vị HIỆN TẠI ở kỳ neo; `orgUnitId = null` = chưa gán đơn vị. */
  byOrgUnit: z.array(
    z.object({
      orgUnitId: z.string().uuid().nullable(),
      orgUnitName: z.string().nullable(),
      headcount: z.number().int().nonnegative(),
      avgGross: z.number(),
      minGross: z.number(),
      maxGross: z.number(),
    }),
  ),
});
export type PayrollOverviewDto = z.infer<typeof payrollOverviewSchema>;

/** Số kỳ tối đa liệt kê ở lời nhắc #1 (cũ nhất trước). */
export const PAYROLL_REMINDER_PERIOD_LIMIT = 5;

/** 079 — chỉ SỐ ĐẾM (không tên người, không tiền). #2/#3 = `pagination.total` của 036 cùng `insuranceIssue`. */
export const payrollOverviewRemindersSchema = z.object({
  unpublishedPayslips: z.object({
    periodCount: z.number().int().nonnegative(),
    payslipCount: z.number().int().nonnegative(),
    periods: z.array(
      z.object({
        id: z.string().uuid(),
        periodMonth: periodMonthSchema,
        payslipCount: z.number().int().nonnegative(),
      }),
    ),
  }),
  uninsuredEmployees: z.object({ count: z.number().int().nonnegative() }),
  insuranceSalaryOutOfRange: z.object({
    count: z.number().int().nonnegative(),
    /** Ngày (TZ công ty) mà bản tỉ lệ + hồ sơ lương được xét. */
    asOf: z.string(),
    /** Chưa có bản tỉ lệ hiệu lực ⇒ không xét được (`count = 0`). */
    rateMissing: z.boolean(),
  }),
});
export type PayrollOverviewRemindersDto = z.infer<typeof payrollOverviewRemindersSchema>;
