/**
 * S15-PAYROLL-FE-4 — logic THUẦN của track D: chuyển hướng `/payroll` · bộ lọc/yêu thích/ô báo cáo ·
 * biến đổi dữ liệu Tổng quan · hàng tổng TOÀN KỲ từ 018 · census nhãn cột i18n ↔ registry báo cáo của BE.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PAYROLL_REPORT_CODES,
  type PayrollPeriodLineDto,
  type PayrollReportCatalogItemDto,
  type PayrollSummaryDto,
} from "@mediaos/contracts";
import type { SidebarItemMeta } from "@mediaos/web-core";
import { pickFirstAllowedPath, sidebarLeafPaths } from "./payroll-root-redirect";
import {
  REPORT_ENUM_COLUMNS,
  buildReportQuery,
  defaultReportFilters,
  formatPeriodMonth,
  formatReportCell,
  isPayrollReportCode,
  missingRequiredParams,
  monthOffset,
  orderByFavorites,
  reportColumnLabelKeys,
  reportParams,
  sanitizeFavorites,
  toggleFavorite,
} from "./report-view";
import {
  budgetLevel,
  hasAnyHeadcount,
  meterFillPct,
  salaryBandLabel,
  toOrgUnitRows,
  toStructureRows,
} from "./overview-data";
import { toLineRows, totalsFromSummary } from "./period-line-columns";
import payrollVi from "@/i18n/locales/vi/payroll";

const repoRoot = path.resolve(__dirname, "../../../../..");

// ── 1. `/payroll` chuyển hướng ────────────────────────────────────────────────────────────────────

const leaf = (path: string, order: number): SidebarItemMeta => ({
  sidebarKey: path,
  moduleCode: "PAYROLL",
  label: path,
  path,
  order,
});

describe("payroll-root-redirect", () => {
  const tree: SidebarItemMeta[] = [
    leaf("/payroll/employees", 2),
    leaf("/payroll", 1),
    {
      sidebarKey: "group",
      moduleCode: "PAYROLL",
      label: "Tính lương",
      order: 3,
      children: [leaf("/payroll/advances", 2), leaf("/payroll/periods", 1)],
    },
  ];

  it("lá theo THỨ TỰ HIỂN THỊ (order từng cấp, cha trước con), nhóm không path bị bỏ", () => {
    expect(sidebarLeafPaths(tree)).toEqual([
      "/payroll",
      "/payroll/employees",
      "/payroll/periods",
      "/payroll/advances",
    ]);
  });

  it("chọn lá ĐẦU TIÊN mở được, KHÔNG BAO GIỜ tự trỏ về `/payroll` dù nó được phép", () => {
    const paths = sidebarLeafPaths(tree);
    expect(pickFirstAllowedPath(paths, () => true, "/payroll")).toBe("/payroll/employees");
    expect(pickFirstAllowedPath(paths, (p) => p === "/payroll/periods", "/payroll")).toBe(
      "/payroll/periods",
    );
  });

  it("không lá nào mở được ⇒ null (router giữ trang 403, không đẩy vòng vòng)", () => {
    expect(pickFirstAllowedPath(sidebarLeafPaths(tree), () => false, "/payroll")).toBeNull();
    expect(pickFirstAllowedPath(["/payroll"], () => true, "/payroll")).toBeNull();
  });
});

// ── 2. Báo cáo ────────────────────────────────────────────────────────────────────────────────────

const item = (over: Partial<PayrollReportCatalogItemDto> = {}): PayrollReportCatalogItemDto => ({
  code: "employee-income",
  requiredParams: ["fromMonth", "toMonth"],
  optionalParams: ["orgUnitId"],
  columns: [],
  exportable: false,
  ...over,
});

describe("report-view — bộ lọc", () => {
  const now = new Date(2026, 8, 17); // 17/09/2026 giờ máy

  it("mặc định = 12 kỳ tới tháng hiện tại, năm hiện tại; qua ranh giới năm đúng", () => {
    const f = defaultReportFilters(now);
    expect(f.fromMonth).toBe("2025-10");
    expect(f.toMonth).toBe("2026-09");
    expect(f.fiscalYear).toBe("2026");
    expect(monthOffset(new Date(2026, 0, 31), -1)).toBe("2025-12");
  });

  it("tham số áp = required ∪ optional theo THỨ TỰ cố định, không theo thứ tự server", () => {
    expect(
      reportParams(
        item({ requiredParams: ["toMonth", "fromMonth"], optionalParams: ["userId", "orgUnitId"] }),
      ),
    ).toEqual(["fromMonth", "toMonth", "orgUnitId", "userId"]);
  });

  it("[deny] thiếu tham số bắt buộc ⇒ liệt kê đúng ô thiếu (màn KHÔNG gọi 081)", () => {
    const f = { ...defaultReportFilters(now), toMonth: " " };
    expect(missingRequiredParams(item(), f)).toEqual(["toMonth"]);
    const budget = item({
      code: "budget-status",
      requiredParams: ["fiscalYear"],
      optionalParams: [],
    });
    expect(missingRequiredParams(budget, { ...f, fiscalYear: "" })).toEqual(["fiscalYear"]);
  });

  it("[allow] đủ tham số ⇒ không thiếu gì", () => {
    expect(missingRequiredParams(item(), defaultReportFilters(now))).toEqual([]);
  });

  it("query chỉ mang tham số ÁP cho báo cáo và có giá trị; fiscalYear là SỐ", () => {
    const f = { ...defaultReportFilters(now), userId: "u-1", batchStatus: "Draft", orgUnitId: "" };
    expect(buildReportQuery(item(), f)).toEqual({ fromMonth: "2025-10", toMonth: "2026-09" });
    const budget = item({
      code: "budget-status",
      requiredParams: ["fiscalYear"],
      optionalParams: ["orgUnitId"],
    });
    expect(buildReportQuery(budget, { ...f, orgUnitId: "o-1" })).toEqual({
      fiscalYear: 2026,
      orgUnitId: "o-1",
    });
  });

  it("mã báo cáo lạ (URL gõ tay) bị nhận diện", () => {
    expect(isPayrollReportCode("employee-income")).toBe(true);
    expect(isPayrollReportCode("payroll-dump")).toBe(false);
    expect(isPayrollReportCode("")).toBe(false);
  });
});

describe("report-view — yêu thích", () => {
  const items = PAYROLL_REPORT_CODES.map((code) => ({ code }));

  it("bật/tắt KHÔNG sửa mảng gốc", () => {
    const favs = ["salary-history"] as const;
    const on = toggleFavorite(favs, "budget-status");
    expect(on).toEqual(["salary-history", "budget-status"]);
    expect(toggleFavorite(on, "salary-history")).toEqual(["budget-status"]);
    expect(favs).toEqual(["salary-history"]);
  });

  it("yêu thích lên đầu, trong từng nhóm GIỮ thứ tự server", () => {
    const ordered = orderByFavorites(items, ["budget-status", "income-structure"]).map(
      (i) => i.code,
    );
    expect(ordered.slice(0, 2)).toEqual(["income-structure", "budget-status"]);
    expect(ordered.slice(2)).toEqual(
      PAYROLL_REPORT_CODES.filter((c) => c !== "budget-status" && c !== "income-structure"),
    );
  });

  it("giá trị localStorage hỏng/sửa tay ⇒ chỉ giữ mã hợp lệ, bỏ trùng", () => {
    expect(sanitizeFavorites("x")).toEqual([]);
    expect(sanitizeFavorites(null)).toEqual([]);
    expect(sanitizeFavorites(["salary-history", 7, "evil", "salary-history"])).toEqual([
      "salary-history",
    ]);
  });
});

describe("report-view — ô + nhãn", () => {
  it("định dạng theo type; null ⇒ «—» (không in 0 cho ô trống)", () => {
    expect(formatReportCell("money", null)).toBe("—");
    expect(formatReportCell("money", 0)).not.toBe("—");
    expect(formatReportCell("number", 1234)).toBe("1.234");
    expect(formatReportCell("percent", 12.5)).toBe("12,5 %");
    expect(formatReportCell("month", "2026-09")).toBe("09/2026");
    expect(formatPeriodMonth("rác")).toBe("rác");
    expect(formatReportCell("text", "Published", (v) => `T:${v}`)).toBe("T:Published");
    expect(formatReportCell("text", "abc")).toBe("abc");
  });

  it("nhãn: ghi đè theo báo cáo TRƯỚC, nhãn chung SAU", () => {
    expect(reportColumnLabelKeys("payment-summary", "totalNet")).toEqual([
      "reports.columnOverride.payment-summary.totalNet",
      "reports.columns.totalNet",
    ]);
  });

  /**
   * Census: MỌI `key` cột trong registry báo cáo của BE phải có nhãn i18n — thiếu thì bảng hiện khoá máy
   * («insuranceEmployee») mà không test nào đỏ. Đọc file BE bằng `fs` (không import chéo package).
   */
  it("census — mọi cột của 7 báo cáo (BE registry) đều có nhãn; mọi mã có tên + mô tả", () => {
    const src = fs.readFileSync(
      path.join(repoRoot, "apps/api/src/payroll/payroll-reports.registry.ts"),
      "utf8",
    );
    const keys = new Set<string>();
    for (const m of src.matchAll(/(?:text|money|count|pct)\("([a-zA-Z]+)"/g)) keys.add(m[1]!);
    for (const m of src.matchAll(/\{ key: "([a-zA-Z]+)", type:/g)) keys.add(m[1]!);
    expect(keys.size, "regex census mù — registry BE đổi dạng?").toBeGreaterThan(30);

    const columns = payrollVi.reports.columns as Record<string, string>;
    const missing = [...keys].filter((k) => !columns[k]);
    expect(missing).toEqual([]);
    for (const code of PAYROLL_REPORT_CODES) {
      expect(payrollVi.reports.names[code], code).toBeTruthy();
      expect(payrollVi.reports.descriptions[code], code).toBeTruthy();
    }
  });

  it("census — nhãn XLSX «Tổng tiền» của payment-summary được ghi đè đúng chỗ", () => {
    expect(payrollVi.reports.columnOverride["payment-summary"].totalNet).toBe("Tổng tiền");
  });

  it("cột enum trỏ tới khối i18n CÓ THẬT", () => {
    const vi = payrollVi as unknown as Record<string, unknown>;
    for (const prefix of Object.values(REPORT_ENUM_COLUMNS)) {
      const block = prefix
        .split(".")
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], vi);
      expect(block, prefix).toBeTypeOf("object");
    }
  });
});

// ── 3. Tổng quan ──────────────────────────────────────────────────────────────────────────────────

describe("overview-data", () => {
  it("nhãn dải lương; dải cuối không cận trên", () => {
    expect(salaryBandLabel(5_000_000, 10_000_000)).toMatch(/–/);
    expect(salaryBandLabel(50_000_000, null)).toMatch(/^≥ /);
  });

  it("dải trống toàn bộ ⇒ khối RỖNG (không vẽ 7 cột 0)", () => {
    expect(hasAnyHeadcount([{ headcount: 0 }, { headcount: 0 }])).toBe(false);
    expect(hasAnyHeadcount([{ headcount: 0 }, { headcount: 3 }])).toBe(true);
  });

  it("mức ngân sách: chưa lập · trong · sắp chạm (≥90) · vượt (>100); meter kẹp 0..100", () => {
    expect(budgetLevel(null)).toBe("unplanned");
    expect(budgetLevel(89.99)).toBe("normal");
    expect(budgetLevel(90)).toBe("warning");
    expect(budgetLevel(100)).toBe("warning");
    expect(budgetLevel(100.01)).toBe("over");
    expect(meterFillPct(null)).toBe(0);
    expect(meterFillPct(-5)).toBe(0);
    expect(meterFillPct(137)).toBe(100);
    expect(meterFillPct(42)).toBe(42);
  });

  it("cơ cấu: xếp theo số tiền giảm dần, hàng «Khác» luôn CUỐI dù lớn nhất", () => {
    const rows = toStructureRows([
      { componentCode: null, itemType: "other", label: "", amount: 900, sharePct: 60 },
      { componentCode: "A", itemType: "earning", label: "A", amount: 100, sharePct: 10 },
      { componentCode: "B", itemType: "allowance", label: "B", amount: 500, sharePct: 30 },
    ]);
    expect(rows.map((r) => r.componentCode)).toEqual(["B", "A", null]);
    expect(rows[2]!.isOther).toBe(true);
  });

  it("đơn vị: null ⇒ nhãn «chưa gán», xếp theo thu nhập BQ giảm dần, không sửa mảng gốc", () => {
    const input = [
      { orgUnitId: "a", orgUnitName: "A", headcount: 1, avgGross: 10, minGross: 10, maxGross: 10 },
      {
        orgUnitId: null,
        orgUnitName: null,
        headcount: 2,
        avgGross: 30,
        minGross: 20,
        maxGross: 40,
      },
    ];
    const rows = toOrgUnitRows(input, "Chưa gán");
    expect(rows.map((r) => r.label)).toEqual(["Chưa gán", "A"]);
    expect(input[0]!.orgUnitId).toBe("a");
  });
});

// ── 4. Hàng tổng TOÀN KỲ (018) ────────────────────────────────────────────────────────────────────

describe("period-line-columns — tổng toàn kỳ", () => {
  const PERIOD = "p-1";
  const line = (gross: number, net: number): PayrollPeriodLineDto =>
    ({
      id: `l-${gross}`,
      userId: "u",
      gross,
      net,
      deductionAmount: 0,
      adjustmentAmount: 0,
    }) as PayrollPeriodLineDto;
  const summary: PayrollSummaryDto = {
    payrollPeriodId: PERIOD,
    periodMonth: "2026-09",
    status: "Calculated",
    headcount: 40,
    lineTotals: {
      baseAmount: 0,
      allowanceAmount: 0,
      bonusAmount: 0,
      penaltyAmount: 0,
      deductionAmount: 7,
      adjustmentAmount: 3,
      gross: 1_000,
      net: 900,
    },
    componentTotals: [
      { code: "LCB", label: "Lương", kind: "earning", sortOrder: 1, isVisible: true, total: 800 },
    ],
  } as PayrollSummaryDto;
  const cols = [
    { code: "LCB", label: "Lương" },
    { code: "PC", label: "Phụ cấp" },
  ];

  it("[allow] có lineTotals của ĐÚNG kỳ ⇒ hàng tổng dùng số TOÀN KỲ, không cộng trang", () => {
    const totals = totalsFromSummary(summary, PERIOD, cols);
    expect(totals).toEqual({
      byCode: { LCB: 800, PC: undefined },
      gross: 1_000,
      deduction: 7,
      adjustment: 3,
      net: 900,
    });
    const rows = toLineRows([line(10, 9), line(20, 18)], [], totals);
    const last = rows[rows.length - 1]!;
    expect(last.kind === "total" && last.totals.gross).toBe(1_000);
  });

  it("[deny] thiếu lineTotals / của KỲ KHÁC / chưa về ⇒ null ⇒ rơi về tổng TRANG", () => {
    expect(totalsFromSummary(undefined, PERIOD, cols)).toBeNull();
    expect(totalsFromSummary(null, PERIOD, cols)).toBeNull();
    expect(totalsFromSummary({ ...summary, lineTotals: undefined }, PERIOD, cols)).toBeNull();
    expect(totalsFromSummary(summary, "p-khac", cols)).toBeNull();
    const rows = toLineRows([line(10, 9), line(20, 18)], [], null);
    const last = rows[rows.length - 1]!;
    expect(last.kind === "total" && last.totals.gross).toBe(30);
  });

  it("trang rỗng ⇒ KHÔNG có hàng tổng kể cả khi có tổng kỳ", () => {
    expect(toLineRows([], [], totalsFromSummary(summary, PERIOD, cols))).toEqual([]);
  });
});
