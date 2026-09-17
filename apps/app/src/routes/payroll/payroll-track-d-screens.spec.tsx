// @vitest-environment jsdom
/**
 * [deny-path] S15-PAYROLL-FE-4 — màn track D: PAY-SCREEN-015 Tổng quan · 016 Báo cáo (danh mục + màn xem) ·
 * lối vào `/payroll` (chuyển hướng). Cặp `view:payroll-report` SENSITIVE ⇒ gate `useCanExact`; 078/079/081
 * audit MỖI LƯỢT ⇒ ca DENY assert «KHÔNG gọi API», không chỉ «không hiện».
 *
 * Mỗi ca DENY đi cặp ca ALLOW đối chứng (`deny-cases-vacuous-without-allow-case`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import type {
  PayrollOverviewDto,
  PayrollOverviewRemindersDto,
  PayrollReportCatalogItemDto,
  PayrollReportDataDto,
} from "@mediaos/contracts";

const granted = new Set<string>();
const allow = (...pairs: string[]) => {
  granted.clear();
  for (const p of pairs) granted.add(p);
};

const REPORT = "view:payroll-report";
const EMPLOYEES = "view:payroll-employee";
const PERIODS = "view:payroll-period";

vi.mock("@mediaos/web-core", () => {
  const key =
    (...parts: string[]) =>
    (...x: unknown[]) => ["payroll", ...parts, ...x];
  return {
    useCan: vi.fn((a: string, r: string) => granted.has(`${a}:${r}`)),
    useCanExact: vi.fn((a: string, r: string) => granted.has(`${a}:${r}`)),
    useAuthStore: vi.fn(() => ({})),
    ROUTE_REGISTRY: [
      { routeKey: "payroll.periods", path: "/payroll/periods" },
      { routeKey: "payroll.employees", path: "/payroll/employees" },
    ],
    formatDate: (v: string) => `D(${v})`,
    formatNumber: (v: number) => new Intl.NumberFormat("vi-VN").format(v),
    formatCurrency: (v: number) => `${new Intl.NumberFormat("vi-VN").format(v)} ₫`,
    parseKindError: () => ({
      code: null,
      status: null,
      kind: null,
      message: "",
      fields: new Map(),
    }),
    orgApi: { getTree: vi.fn(async () => []) },
    payrollApi: {
      getOverview: vi.fn(),
      getOverviewReminders: vi.fn(),
      listReports: vi.fn(),
      getReport: vi.fn(),
      exportReport: vi.fn(),
      pickerPeople: vi.fn(async () => []),
    },
    payrollKeys: {
      overview: { blocks: key("overview", "blocks"), reminders: key("overview", "reminders") },
      reports: { catalog: key("reports", "catalog"), data: key("reports", "data") },
      pickers: { people: key("pickers", "people") },
    },
  };
});

// Recharts cần kích thước layout thật — jsdom không có. Khối vẽ không phải thứ spec này đo (cổng + dữ liệu).
vi.mock("./components/overview/OverviewCharts", () => ({
  SalaryDistributionChart: () => <div data-testid="chart-distribution" />,
  IncomeStructureChart: () => <div data-testid="chart-structure" />,
  CostTrendChart: () => <div data-testid="chart-cost" />,
  AverageIncomeChart: () => <div data-testid="chart-average" />,
  OrgUnitIncomeChart: () => <div data-testid="chart-org-unit" />,
  orgUnitChartHeight: () => 240,
}));

const triggerBlobDownload = vi.fn();
vi.mock("@/lib/download-blob", () => ({
  triggerBlobDownload: (...args: unknown[]) => triggerBlobDownload(...args),
}));

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}));

const evaluate = vi.fn();
vi.mock("@/layouts/protected/ProtectedRoute", () => ({
  evaluateRouteFromStore: (meta: { path: string }) => evaluate(meta.path),
}));
vi.mock("@/layouts/workspace/sidebar-registry", () => ({
  PAYROLL_SIDEBAR: [
    { sidebarKey: "o", moduleCode: "PAYROLL", label: "o", path: "/payroll", order: 1 },
    { sidebarKey: "e", moduleCode: "PAYROLL", label: "e", path: "/payroll/employees", order: 2 },
    { sidebarKey: "p", moduleCode: "PAYROLL", label: "p", path: "/payroll/periods", order: 3 },
  ],
}));
vi.mock("./PayrollOverviewPage", () => ({
  PayrollOverviewPage: () => <div data-testid="overview-page" />,
}));

import { payrollApi } from "@mediaos/web-core";
import { PayrollReportListPage } from "./PayrollReportListPage";
import { PayrollReportViewPage } from "./PayrollReportViewPage";
import { PayrollRootEntry } from "./PayrollRootEntry";

const api = payrollApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
}

const OVERVIEW: PayrollOverviewDto = {
  latestPeriod: {
    id: "11111111-1111-1111-1111-111111111111",
    periodMonth: "2026-08",
    status: "Published",
  },
  months: 12,
  salaryDistribution: [{ bandFrom: 0, bandTo: 5_000_000, headcount: 3 }],
  incomeStructure: [
    { componentCode: "LCB", itemType: "earning", label: "Lương", amount: 100, sharePct: 100 },
  ],
  byPeriod: [
    {
      periodMonth: "2026-08",
      headcount: 3,
      totalGross: 30,
      totalNet: 27,
      employerStatutory: 6,
      totalCost: 36,
      avgGross: 10,
      avgNet: 9,
    },
  ],
  byOrgUnit: [],
};

const REMINDERS: PayrollOverviewRemindersDto = {
  unpublishedPayslips: {
    periodCount: 1,
    payslipCount: 4,
    periods: [
      { id: "22222222-2222-2222-2222-222222222222", periodMonth: "2026-09", payslipCount: 4 },
    ],
  },
  uninsuredEmployees: { count: 2 },
  insuranceSalaryOutOfRange: { count: 0, asOf: "2026-09-17", rateMissing: false },
};

// PayrollOverviewPage đang bị mock cho khối PayrollRootEntry — lấy bản THẬT cho khối Tổng quan.
const RealOverview = (
  await vi.importActual<typeof import("./PayrollOverviewPage")>("./PayrollOverviewPage")
).PayrollOverviewPage;

beforeEach(() => {
  vi.clearAllMocks();
  granted.clear();
  window.localStorage.clear();
  api.getOverview!.mockResolvedValue(OVERVIEW);
  api.getOverviewReminders!.mockResolvedValue(REMINDERS);
});

// ── PAY-SCREEN-015 ────────────────────────────────────────────────────────────────────────────────

describe("PAY-SCREEN-015 Tổng quan", () => {
  it("[deny] thiếu view:payroll-report ⇒ KHÔNG gọi 078/079 (cả hai audit mỗi lượt)", async () => {
    allow(PERIODS, EMPLOYEES);
    wrap(<RealOverview onOpenPeriod={vi.fn()} onOpenEmployees={vi.fn()} />);
    expect(await screen.findByText("Bạn không có quyền xem tổng quan tiền lương.")).toBeTruthy();
    expect(api.getOverview).not.toHaveBeenCalled();
    expect(api.getOverviewReminders).not.toHaveBeenCalled();
  });

  it("[allow] có cặp ⇒ gọi 078 (12 kỳ, năm hiện tại) + 079, vẽ các khối", async () => {
    allow(REPORT);
    wrap(<RealOverview onOpenPeriod={vi.fn()} onOpenEmployees={vi.fn()} />);
    await screen.findByTestId("chart-distribution");
    expect(api.getOverview).toHaveBeenCalledWith({
      months: 12,
      fiscalYear: new Date().getFullYear(),
    });
    expect(api.getOverviewReminders).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("chart-cost")).toBeTruthy();
    // Không có dữ liệu đơn vị ⇒ khối rỗng, không vẽ.
    expect(screen.queryByTestId("chart-org-unit")).toBeNull();
  });

  it("[deny] khối ngân sách VẮNG khoá ⇒ «không có quyền», KHÔNG vẽ meter 0", async () => {
    allow(REPORT);
    wrap(<RealOverview onOpenPeriod={vi.fn()} onOpenEmployees={vi.fn()} />);
    const block = await screen.findByTestId("overview-budget");
    await within(block).findByText("Bạn không có quyền xem ngân sách lương.");
    expect(within(block).queryByRole("meter")).toBeNull();
  });

  it("[allow] khối ngân sách có số ⇒ meter + mức «Vượt kế hoạch» bằng CHỮ", async () => {
    allow(REPORT);
    api.getOverview!.mockResolvedValue({
      ...OVERVIEW,
      budget: { fiscalYear: 2026, plannedAmount: 100, actualAmount: 120, usagePct: 120 },
    });
    wrap(<RealOverview onOpenPeriod={vi.fn()} onOpenEmployees={vi.fn()} />);
    const block = await screen.findByTestId("overview-budget");
    const meter = await within(block).findByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("100");
    expect(within(block).getByText("Vượt kế hoạch")).toBeTruthy();
  });

  it("[deny] Lời nhắc: thiếu cặp đích ⇒ chỉ hiện SỐ, không có link sâu", async () => {
    allow(REPORT);
    wrap(<RealOverview onOpenPeriod={vi.fn()} onOpenEmployees={vi.fn()} />);
    const panel = await screen.findByTestId("payroll-reminders");
    await within(panel).findByText("2 nhân viên chính thức chưa tham gia bảo hiểm");
    expect(
      within(panel).queryAllByRole("button", { name: /Xem danh sách|Kỳ 09\/2026/ }),
    ).toHaveLength(0);
  });

  it("[allow] Lời nhắc: có cặp đích ⇒ link sâu gọi đúng callback + đúng filter", async () => {
    allow(REPORT, EMPLOYEES, PERIODS);
    const onOpenPeriod = vi.fn();
    const onOpenEmployees = vi.fn();
    wrap(<RealOverview onOpenPeriod={onOpenPeriod} onOpenEmployees={onOpenEmployees} />);
    const panel = await screen.findByTestId("payroll-reminders");
    fireEvent.click(await within(panel).findByRole("button", { name: "Kỳ 09/2026 · 4 phiếu" }));
    expect(onOpenPeriod).toHaveBeenCalledWith("22222222-2222-2222-2222-222222222222");
    // Mục «lương BH ngoài khung» có count 0 ⇒ không link; chỉ còn MỘT «Xem danh sách».
    const links = within(panel).getAllByRole("button", { name: "Xem danh sách" });
    expect(links).toHaveLength(1);
    fireEvent.click(links[0]!);
    expect(onOpenEmployees).toHaveBeenCalledWith("not-joined");
  });
});

// ── PAY-SCREEN-016 danh mục ───────────────────────────────────────────────────────────────────────

const catalogItem = (
  code: PayrollReportCatalogItemDto["code"],
  over: Partial<PayrollReportCatalogItemDto> = {},
): PayrollReportCatalogItemDto => ({
  code,
  requiredParams: ["fromMonth", "toMonth"],
  optionalParams: [],
  columns: [{ key: "totalGross", type: "money" }],
  exportable: false,
  ...over,
});

describe("PAY-SCREEN-016 danh mục báo cáo", () => {
  it("[deny] thiếu cặp ⇒ KHÔNG gọi 080", async () => {
    allow(PERIODS);
    wrap(<PayrollReportListPage onOpenReport={vi.fn()} />);
    await screen.findByText("Bạn không có quyền xem tổng quan tiền lương.");
    expect(api.listReports).not.toHaveBeenCalled();
  });

  it("[allow] dựng TỪ 080 — chỉ báo cáo server trả, không hard-code 7 mục; nhãn Excel theo exportable", async () => {
    allow(REPORT);
    api.listReports!.mockResolvedValue([
      catalogItem("salary-by-period", { exportable: true }),
      catalogItem("cost-by-org-unit"),
    ]);
    const onOpen = vi.fn();
    wrap(<PayrollReportListPage onOpenReport={onOpen} />);
    await screen.findByText("Thống kê lương theo thời gian");
    expect(screen.getByText("Chi phí lương theo đơn vị")).toBeTruthy();
    expect(screen.queryByText("Tổng hợp thu nhập nhân viên")).toBeNull();
    expect(screen.getAllByText("Xuất được Excel")).toHaveLength(1);
    fireEvent.click(screen.getByText("Chi phí lương theo đơn vị"));
    expect(onOpen).toHaveBeenCalledWith("cost-by-org-unit");
  });

  it("yêu thích đưa báo cáo lên đầu và lưu vào localStorage", async () => {
    allow(REPORT);
    api.listReports!.mockResolvedValue([
      catalogItem("salary-by-period"),
      catalogItem("cost-by-org-unit"),
    ]);
    wrap(<PayrollReportListPage onOpenReport={vi.fn()} />);
    await screen.findByText("Chi phí lương theo đơn vị");
    const stars = screen.getAllByRole("button", { name: "Đánh dấu yêu thích" });
    fireEvent.click(stars[1]!);
    const names = screen.getAllByText(/Thống kê lương theo thời gian|Chi phí lương theo đơn vị/);
    expect(names[0]!.textContent).toBe("Chi phí lương theo đơn vị");
    expect(JSON.parse(window.localStorage.getItem("payroll.reports.favorites") ?? "[]")).toEqual([
      "cost-by-org-unit",
    ]);
  });
});

// ── PAY-SCREEN-016 màn xem ────────────────────────────────────────────────────────────────────────

const DATA: PayrollReportDataDto = {
  reportCode: "salary-by-period",
  columns: [
    { key: "periodMonth", type: "month" },
    { key: "periodStatus", type: "text" },
    { key: "totalGross", type: "money" },
  ],
  rows: [{ periodMonth: "2026-08", periodStatus: "Published", totalGross: 1000 }],
  totals: { totalGross: 1000 },
};

describe("PAY-SCREEN-016 màn xem báo cáo", () => {
  it("[deny] mã lạ trên URL ⇒ «không tìm thấy», KHÔNG gọi 080/081", async () => {
    allow(REPORT);
    wrap(<PayrollReportViewPage reportCode="payroll-dump" onBack={vi.fn()} />);
    await screen.findByText("Không tìm thấy báo cáo này hoặc bạn không có quyền xem.");
    expect(api.listReports).not.toHaveBeenCalled();
    expect(api.getReport).not.toHaveBeenCalled();
  });

  it("[deny] báo cáo KHÔNG có trong 080 của caller (thiếu cặp nguồn) ⇒ không gọi 081", async () => {
    allow(REPORT);
    api.listReports!.mockResolvedValue([catalogItem("salary-by-period")]);
    wrap(<PayrollReportViewPage reportCode="employee-income" onBack={vi.fn()} />);
    await screen.findByText("Không tìm thấy báo cáo này hoặc bạn không có quyền xem.");
    expect(api.listReports).toHaveBeenCalledTimes(1);
    expect(api.getReport).not.toHaveBeenCalled();
  });

  it("[deny] báo cáo đòi tham số KHÔNG có mặc định ⇒ nhắc chọn, KHÔNG gọi 081", async () => {
    allow(REPORT);
    api.listReports!.mockResolvedValue([
      catalogItem("salary-history", { requiredParams: ["userId"], optionalParams: [] }),
    ]);
    wrap(<PayrollReportViewPage reportCode="salary-history" onBack={vi.fn()} />);
    await screen.findByText("Chọn Nhân viên để xem báo cáo.");
    expect(api.getReport).not.toHaveBeenCalled();
  });

  it("[allow] đủ tham số ⇒ gọi 081 với ĐÚNG tham số áp; bảng dịch enum + hàng tổng từ server; xuất Excel", async () => {
    allow(REPORT);
    api.listReports!.mockResolvedValue([catalogItem("salary-by-period", { exportable: true })]);
    api.getReport!.mockResolvedValue({
      data: DATA,
      pagination: { total: 1, page: 1, perPage: 20 },
    });
    api.exportReport!.mockResolvedValue({ blob: new Blob(["x"]), filename: "bc.xlsx" });
    wrap(<PayrollReportViewPage reportCode="salary-by-period" onBack={vi.fn()} />);

    await screen.findByText("08/2026");
    const [code, query] = api.getReport!.mock.calls[0]!;
    expect(code).toBe("salary-by-period");
    expect(Object.keys(query as object).sort()).toEqual([
      "fromMonth",
      "page",
      "per_page",
      "toMonth",
    ]);
    expect(screen.getByText("Đã phát hành")).toBeTruthy();
    expect(screen.getByText("Tổng")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Xuất Excel/ }));
    await waitFor(() =>
      expect(triggerBlobDownload).toHaveBeenCalledWith(expect.any(Blob), "bc.xlsx"),
    );
    const [, exportQuery] = api.exportReport!.mock.calls[0]!;
    expect(exportQuery).not.toHaveProperty("page");
  });

  it("[deny] không exportable ⇒ KHÔNG có nút xuất", async () => {
    allow(REPORT);
    api.listReports!.mockResolvedValue([catalogItem("salary-by-period")]);
    api.getReport!.mockResolvedValue({
      data: DATA,
      pagination: { total: 1, page: 1, perPage: 20 },
    });
    wrap(<PayrollReportViewPage reportCode="salary-by-period" onBack={vi.fn()} />);
    await screen.findByText("08/2026");
    expect(screen.queryByRole("button", { name: /Xuất Excel/ })).toBeNull();
  });
});

// ── `/payroll` — lối vào ──────────────────────────────────────────────────────────────────────────

const OVERVIEW_META = { path: "/payroll" } as never;

describe("PayrollRootEntry — `/payroll`", () => {
  it("[allow] có cặp Tổng quan ⇒ render Tổng quan, KHÔNG chuyển hướng", async () => {
    evaluate.mockImplementation(() => ({ allowed: true, action: "ALLOW" }));
    wrap(
      <PayrollRootEntry
        overviewMeta={OVERVIEW_META}
        onOpenPeriod={vi.fn()}
        onOpenEmployees={vi.fn()}
      />,
    );
    await screen.findByTestId("overview-page");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("[deny] thiếu cặp ⇒ chuyển hướng (replace) tới lá sidebar ĐẦU TIÊN mở được", async () => {
    evaluate.mockImplementation((p: string) =>
      p === "/payroll/periods"
        ? { allowed: true, action: "ALLOW" }
        : { allowed: false, action: "SHOW_403", reason: "NO_PERMISSION" },
    );
    wrap(
      <PayrollRootEntry
        overviewMeta={OVERVIEW_META}
        onOpenPeriod={vi.fn()}
        onOpenEmployees={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: "/payroll/periods", replace: true }),
    );
    expect(screen.queryByTestId("overview-page")).toBeNull();
  });

  it("[deny] không lá nào mở được ⇒ trang 403, không điều hướng", async () => {
    evaluate.mockImplementation(() => ({
      allowed: false,
      action: "SHOW_403",
      reason: "NO_PERMISSION",
    }));
    wrap(
      <PayrollRootEntry
        overviewMeta={OVERVIEW_META}
        onOpenPeriod={vi.fn()}
        onOpenEmployees={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.queryByTestId("overview-page")).toBeNull());
    expect(navigate).not.toHaveBeenCalled();
    expect(await screen.findByRole("link")).toBeTruthy();
  });
});
