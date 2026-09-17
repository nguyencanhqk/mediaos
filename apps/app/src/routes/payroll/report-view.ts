import {
  PAYROLL_REPORT_CODES,
  type PayrollReportCatalogItemDto,
  type PayrollReportCode,
  type PayrollReportColumnType,
  type PayrollReportParam,
  type PayrollReportQuery,
} from "@mediaos/contracts";
import { formatDate } from "@mediaos/web-core";
import { formatPayrollMoney, PAYROLL_MASKED_PLACEHOLDER } from "./payroll-format";

/**
 * S15-PAYROLL-FE-4 — logic THUẦN của PAY-SCREEN-016 (danh mục + màn xem báo cáo). Tách khỏi component để ca
 * test không phải dựng query/router.
 *
 * Luật:
 *  - Tham số áp cho một báo cáo = `requiredParams ∪ optionalParams` của CHÍNH mục 080 (server là nguồn) —
 *    không suy từ mã báo cáo.
 *  - Thiếu tham số bắt buộc ⇒ KHÔNG gọi 081: route audit mỗi lượt, bộ lọc dở dang là hàng audit rác.
 *  - Chỉ gửi tham số áp cho báo cáo đó: 081 `.strict()` bỏ qua khoá không áp, nhưng gửi thừa làm khoá cache
 *    của React Query khác nhau cho cùng một kết quả.
 */

export type ReportFilters = {
  readonly fromMonth: string;
  readonly toMonth: string;
  readonly orgUnitId: string;
  readonly userId: string;
  readonly fiscalYear: string;
  readonly batchStatus: string;
};

/** Thứ tự ô lọc trên thanh công cụ — cố định, không theo thứ tự server trả. */
export const REPORT_PARAM_ORDER: readonly PayrollReportParam[] = [
  "fromMonth",
  "toMonth",
  "fiscalYear",
  "orgUnitId",
  "userId",
  "batchStatus",
];

/** Khoảng mặc định khi mở màn: 12 kỳ kết thúc ở tháng hiện tại (khớp mặc định khối xu hướng của 078). */
export const REPORT_DEFAULT_MONTHS = 12;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM` của tháng lệch `offset` tháng so với `now` (giờ máy người dùng — chỉ để điền sẵn ô lọc). */
export function monthOffset(now: Date, offset: number): string {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function defaultReportFilters(now: Date): ReportFilters {
  return {
    fromMonth: monthOffset(now, -(REPORT_DEFAULT_MONTHS - 1)),
    toMonth: monthOffset(now, 0),
    orgUnitId: "",
    userId: "",
    fiscalYear: String(now.getFullYear()),
    batchStatus: "",
  };
}

export function isPayrollReportCode(value: string): value is PayrollReportCode {
  return (PAYROLL_REPORT_CODES as readonly string[]).includes(value);
}

/** Tham số áp cho báo cáo, theo `REPORT_PARAM_ORDER`. */
export function reportParams(item: PayrollReportCatalogItemDto): PayrollReportParam[] {
  const all = new Set<PayrollReportParam>([...item.requiredParams, ...item.optionalParams]);
  return REPORT_PARAM_ORDER.filter((p) => all.has(p));
}

export function missingRequiredParams(
  item: PayrollReportCatalogItemDto,
  filters: ReportFilters,
): PayrollReportParam[] {
  return item.requiredParams.filter((p) => filters[p].trim() === "");
}

/**
 * Query 081/082 — chỉ tham số áp cho báo cáo và có giá trị. `fromMonth > toMonth` không chặn ở đây: server
 * trả 400 kèm `field` và màn hiện lỗi đó (một nguồn luật).
 */
export function buildReportQuery(
  item: PayrollReportCatalogItemDto,
  filters: ReportFilters,
): Partial<PayrollReportQuery> {
  const query: Record<string, string | number> = {};
  for (const p of reportParams(item)) {
    const v = filters[p].trim();
    if (v === "") continue;
    query[p] = p === "fiscalYear" ? Number(v) : v;
  }
  return query as Partial<PayrollReportQuery>;
}

// ── Yêu thích (localStorage) ─────────────────────────────────────────────────────────────────────

export function toggleFavorite(
  favorites: readonly PayrollReportCode[],
  code: PayrollReportCode,
): PayrollReportCode[] {
  return favorites.includes(code) ? favorites.filter((c) => c !== code) : [...favorites, code];
}

/** Yêu thích lên đầu; trong từng nhóm GIỮ thứ tự server trả (thứ tự PAY-DEC-018). */
export function orderByFavorites<T extends { code: PayrollReportCode }>(
  items: readonly T[],
  favorites: readonly PayrollReportCode[],
): T[] {
  const fav = new Set(favorites);
  return [...items.filter((i) => fav.has(i.code)), ...items.filter((i) => !fav.has(i.code))];
}

/** Giá trị localStorage có thể bị sửa tay/cũ ⇒ chỉ giữ mã hợp lệ, bỏ trùng. */
export function sanitizeFavorites(raw: unknown): PayrollReportCode[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw.filter((v): v is PayrollReportCode => typeof v === "string" && isPayrollReportCode(v)),
    ),
  ];
}

// ── Cột + ô ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Khoá i18n của nhãn cột: ghi đè theo báo cáo trước (`totalNet` của `payment-summary` = «Tổng tiền», khác
 * «Thực nhận» ở báo cáo khác — cùng nhãn XLSX của BE), rồi nhãn chung theo `key`.
 */
export function reportColumnLabelKeys(code: PayrollReportCode, key: string): [string, string] {
  return [`reports.columnOverride.${code}.${key}`, `reports.columns.${key}`];
}

/**
 * Cột text mang GIÁ TRỊ MÁY (enum) ⇒ tiền tố i18n SẴN CÓ để dịch. Cột không có ở đây in nguyên văn.
 * `status` chỉ có ở `payment-summary` (trạng thái đợt chi).
 */
export const REPORT_ENUM_COLUMNS: Readonly<Record<string, string>> = {
  periodStatus: "periodStatus",
  status: "paymentBatchStatus",
  itemType: "payslipItemType",
  method: "paymentBatchMethod",
  salaryType: "salaryType",
  direction: "reports.direction",
};

const numberFormat = new Intl.NumberFormat("vi-VN");
const percentFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

/** `YYYY-MM` ⇒ `MM/YYYY` (cách đọc kỳ lương ở mọi màn PAYROLL). */
export function formatPeriodMonth(value: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return m ? `${m[2]}/${m[1]}` : value;
}

/**
 * Định dạng ô theo `type` của cột. `null`/`undefined` ⇒ `—` (server trả `null` cho ô không có giá trị — vd
 * kế hoạch ngân sách chưa lập); chuỗi enum dịch bằng `translateEnum` khi cột nằm trong `REPORT_ENUM_COLUMNS`.
 */
export function formatReportCell(
  type: PayrollReportColumnType,
  value: string | number | null | undefined,
  translateEnum?: (value: string) => string,
): string {
  if (value === null || value === undefined || value === "") return PAYROLL_MASKED_PLACEHOLDER;
  switch (type) {
    case "money":
      return typeof value === "number" ? formatPayrollMoney(value) : String(value);
    case "number":
      return typeof value === "number" ? numberFormat.format(value) : String(value);
    case "percent":
      return typeof value === "number" ? `${percentFormat.format(value)} %` : String(value);
    case "month":
      return formatPeriodMonth(String(value));
    case "date":
      return typeof value === "string" ? formatDate(value) : String(value);
    default:
      return translateEnum ? translateEnum(String(value)) : String(value);
  }
}

export function isNumericColumn(type: PayrollReportColumnType): boolean {
  return type === "money" || type === "number" || type === "percent";
}
