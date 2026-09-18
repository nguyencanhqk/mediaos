// @vitest-environment jsdom
/**
 * [deny-path] S15-PAYROLL-QA-1 G14 — FE track E: hai lỗ chưa có ca ở `done_when 6`:
 *
 *  T4 — nút xuất tệp UNC (071, `PaymentBatchDetailPage`) chỉ hiện khi ĐỦ BA cặp quyền
 *  (`manage:payment-batch` + `export:payroll` + `view-payslip:payslip`, `canExportUnc` ở component).
 *  Thiếu MỘT trong ba là mời người dùng ăn 403 ở BE — nút phải ẨN, không phải hiện-rồi-chặn.
 *
 *  T6 — cột tiền của 4 màn track C (Tạm ứng · Đợt chi trả · Dòng chi · Ngân sách) phải render `—`
 *  khi server VẮNG KHOÁ tiền trong DTO (mask là việc của server — `formatPayrollMoney`), và KHÔNG
 *  còn chữ số nào của khoản bị mask sót lại trên trang. Cạnh đó: thiếu cặp `view:*` cấp trang ⇒ màn
 *  hiện trạng thái "không có quyền" và KHÔNG gọi client danh sách — server không hề được hỏi tới.
 *
 * Mỗi ca DENY đi cặp ca ALLOW đối chứng (`deny-cases-vacuous-without-allow-case`): không có đối
 * chứng thì "văng mất chữ/số" có thể chỉ vì trang không render gì, không chứng minh được gì cả.
 *
 * T5 (gắn/gỡ dòng chi 069 qua `updatePaymentBatch`) KHÔNG có UI ở `apps/app` **lúc QA-1 chạy** — nợ đó
 * đã trả ở `S15-PAYROLL-FE-6`; ca T5 nay sống ở `payroll-fe6-payment-lines.spec.tsx` (ALLOW/DENY từng
 * cặp · FSM `Completed` chỉ-đọc · dòng đã chi khoá ô tích · chữ lỗi 409/404 riêng).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import type {
  PaymentBatchDto,
  PaymentLineDto,
  PayrollAdvanceDto,
  PayrollBudgetDto,
} from "@mediaos/contracts";

const granted = new Set<string>();
const allow = (...pairs: string[]) => {
  granted.clear();
  for (const p of pairs) granted.add(p);
};
const CURRENT_USER_ID = "99999999-9999-4999-8999-999999999999";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn((a: string, r: string) => granted.has(`${a}:${r}`)),
  useCanExact: vi.fn((a: string, r: string) => granted.has(`${a}:${r}`)),
  useAuthStore: vi.fn(() => CURRENT_USER_ID),
  formatNumber: (v: number, o?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("vi-VN", o).format(v),
  formatCurrency: (v: number) => `${new Intl.NumberFormat("vi-VN").format(v)} ₫`,
  parseKindError: () => ({ code: null, status: null, kind: null, message: "", fields: new Map() }),
  orgApi: { getTree: vi.fn().mockResolvedValue([]) },
  payrollApi: {
    listAdvances: vi.fn(),
    createAdvance: vi.fn(),
    updateAdvance: vi.fn(),
    approveAdvance: vi.fn(),
    rejectAdvance: vi.fn(),
    listPaymentBatches: vi.fn(),
    createPaymentBatch: vi.fn(),
    getPaymentBatch: vi.fn(),
    listPaymentLines: vi.fn(),
    exportPaymentBatch: vi.fn(),
    completePaymentBatch: vi.fn(),
    listPeriods: vi.fn(),
    listPayrollBudgets: vi.fn(),
    createPayrollBudget: vi.fn(),
    updatePayrollBudget: vi.fn(),
    pickerPeople: vi.fn(async () => []),
  },
  payrollKeys: {
    advances: {
      allOf: () => ["payroll", "advances"],
      list: (p: unknown) => ["payroll", "advances", "list", p],
      detail: (id: string) => ["payroll", "advances", "detail", id],
    },
    paymentBatches: {
      allOf: () => ["payroll", "payment-batches"],
      list: (p: unknown) => ["payroll", "payment-batches", "list", p],
      detail: (id: string) => ["payroll", "payment-batches", "detail", id],
      lines: (id: string, p: unknown) => ["payroll", "payment-batches", "lines", id, p],
      linesOf: (id: string) => ["payroll", "payment-batches", "lines", id],
    },
    budgets: {
      allOf: () => ["payroll", "budgets"],
      list: (p: unknown) => ["payroll", "budgets", "list", p],
    },
    periods: {
      list: (p: unknown) => ["payroll", "periods", "list", p],
    },
    pickers: {
      people: (p: unknown) => ["payroll", "pickers", "people", p],
    },
  },
}));

import { payrollApi } from "@mediaos/web-core";
import { PayrollAdvanceListPage } from "./PayrollAdvanceListPage";
import { PaymentBatchListPage } from "./PaymentBatchListPage";
import { PaymentBatchDetailPage } from "./PaymentBatchDetailPage";
import { PayrollBudgetListPage } from "./PayrollBudgetListPage";
import { PAYROLL_ENGINE_PAIRS, type PayrollEnginePair } from "./constants";
import { PAYROLL_MASKED_PLACEHOLDER } from "./payroll-format";

const api = payrollApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const tr = (k: string, o?: Record<string, unknown>) => i18n.t(`payroll:${k}`, o);
/** Chuỗi `action:resourceType` — cùng khoá `granted` dùng ở trên. Tra thẳng từ `PAYROLL_ENGINE_PAIRS`
 * (nguồn sự thật của component) thay vì gõ lại literal, để test không trôi khi bảng cặp đổi. */
const pairKey = (p: PayrollEnginePair) => `${p.action}:${p.resourceType}`;

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
}

const pageOf = <T,>(data: T[]) => ({
  data,
  pagination: { total: data.length, page: 1, perPage: 20 },
});

/** Hàng KHÔNG DIGIT nào của `amount` được lộ ra bất kỳ đâu trên trang — kiểm bằng regex trên toàn
 * `document.body`, không chỉ trong một ô, vì "rò nhãn" cũng có thể lọt qua chỗ khác (tooltip, ⚙…). */
function expectAmountNowhereOnPage(amount: number) {
  const digits = new Intl.NumberFormat("vi-VN").format(amount);
  expect(document.body.textContent).not.toContain(digits);
}

beforeEach(() => {
  vi.clearAllMocks();
  granted.clear();
  localStorage.clear();
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T4 — 071 xuất tệp UNC (PaymentBatchDetailPage) đòi ĐỦ BA cặp quyền
// ════════════════════════════════════════════════════════════════════════════════════════════════

const BATCH_ID = "10000000-0000-4000-8000-000000000001";

const BATCH: PaymentBatchDto = {
  id: BATCH_ID,
  payrollPeriodId: "20000000-0000-4000-8000-000000000002",
  periodMonth: "2026-09",
  code: "CT-202609-BANK-ABC123",
  method: "bank",
  status: "Ready",
  payDate: null,
  note: null,
  lineCount: 2,
  paidLineCount: 0,
  createdBy: "creator-other-user",
  createdAt: "2026-09-01T00:00:00.000Z",
  completedBy: null,
  completedAt: null,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

/** Ba cặp mà `canExportUnc` đòi ĐỦ CẢ BA — mirror `batchExport`/`periodExport`/`payslipList` của constants. */
const UNC_THREE_PAIRS = [
  PAYROLL_ENGINE_PAIRS.batchExport,
  PAYROLL_ENGINE_PAIRS.periodExport,
  PAYROLL_ENGINE_PAIRS.payslipList,
] as const;

function renderBatchDetail() {
  return wrap(<PaymentBatchDetailPage batchId={BATCH_ID} onBack={vi.fn()} />);
}

describe("T4 — 071 xuất tệp UNC đòi ĐỦ BA cặp (PaymentBatchDetailPage)", () => {
  beforeEach(() => {
    api.getPaymentBatch!.mockResolvedValue(BATCH);
  });

  it("[allow] giữ CẢ BA cặp ⇒ mục ⋯ hiện, bấm gọi 071 ĐÚNG một lần với batchId", async () => {
    allow(...UNC_THREE_PAIRS.map(pairKey));
    api.exportPaymentBatch!.mockResolvedValue({
      blob: new Blob(["unc"]),
      filename: "unc-CT-202609.xlsx",
    });
    renderBatchDetail();

    await screen.findByText(BATCH.code);
    expect(screen.queryByText(tr("paymentBatchDetail.exportNoPermission"))).toBeNull();

    fireEvent.click(await screen.findByTestId("detail-header-overflow"));
    fireEvent.click(screen.getByRole("menuitem", { name: tr("paymentBatchDetail.export") }));

    await waitFor(() => expect(api.exportPaymentBatch).toHaveBeenCalledTimes(1));
    expect(api.exportPaymentBatch).toHaveBeenCalledWith(BATCH_ID);
  });

  it("[deny] THIẾU manage:payment-batch (batchExport) ⇒ không có mục ⋯, không gọi 071", async () => {
    allow(pairKey(PAYROLL_ENGINE_PAIRS.periodExport), pairKey(PAYROLL_ENGINE_PAIRS.payslipList));
    renderBatchDetail();

    await screen.findByText(BATCH.code);
    expect(screen.queryByTestId("detail-header-overflow")).not.toBeInTheDocument();
    expect(
      await screen.findByText(tr("paymentBatchDetail.exportNoPermission")),
    ).toBeInTheDocument();
    expect(api.exportPaymentBatch).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **Hai ca dưới đây KHÔNG đo được bằng «nút ⋯ vắng» (sửa ở S15-PAYROLL-FE-7).** Cặp
   * `batchExport` CHÍNH LÀ `manage:payment-batch`, và từ FE-7 cặp đó còn mở mục «Sửa thông tin đợt»
   * (069) trong cùng menu ⋯ ⇒ người thiếu MỘT trong hai cặp xuất còn lại vẫn thấy nút ⋯ vì lý do
   * khác. Bằng chứng deny đúng chỗ là **MỤC «Xuất tệp chuyển khoản» vắng khi menu đã MỞ** (+ câu
   * giải thích + client 071 không được gọi). Ca đầu (thiếu `manage:payment-batch`) giữ nguyên phép
   * đo cũ: thiếu cặp đó thì cả hai mục đều không có nên nút ⋯ biến mất thật.
   */
  it("[deny] THIẾU export:payroll (periodExport) ⇒ menu không có mục xuất, không gọi 071", async () => {
    allow(pairKey(PAYROLL_ENGINE_PAIRS.batchExport), pairKey(PAYROLL_ENGINE_PAIRS.payslipList));
    renderBatchDetail();

    await screen.findByText(BATCH.code);
    // Mở menu rồi mới kết luận: `menuitem` chỉ tồn tại sau khi bấm ⋯, không mở thì ca này RỖNG.
    fireEvent.click(await screen.findByTestId("detail-header-overflow"));
    expect(
      screen.getByRole("menuitem", { name: tr("paymentBatchDetail.edit") }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: tr("paymentBatchDetail.export") })).toBeNull();
    expect(
      await screen.findByText(tr("paymentBatchDetail.exportNoPermission")),
    ).toBeInTheDocument();
    expect(api.exportPaymentBatch).not.toHaveBeenCalled();
  });

  it("[deny] THIẾU view-payslip:payslip (payslipList) ⇒ menu không có mục xuất, không gọi 071", async () => {
    allow(pairKey(PAYROLL_ENGINE_PAIRS.batchExport), pairKey(PAYROLL_ENGINE_PAIRS.periodExport));
    renderBatchDetail();

    await screen.findByText(BATCH.code);
    fireEvent.click(await screen.findByTestId("detail-header-overflow"));
    expect(
      screen.getByRole("menuitem", { name: tr("paymentBatchDetail.edit") }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: tr("paymentBatchDetail.export") })).toBeNull();
    expect(
      await screen.findByText(tr("paymentBatchDetail.exportNoPermission")),
    ).toBeInTheDocument();
    expect(api.exportPaymentBatch).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// T6 — mask cột tiền: Tạm ứng · Đợt chi trả · Dòng chi · Ngân sách
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Hàng thân bảng (bỏ hàng tiêu đề) trong `<table>` DUY NHẤT đang render.
 *
 * ⚠️ `DataTable` LUÔN render `<table>` ngay cả lúc `isLoading` (5 hàng SKELETON rỗng chữ) — `findByRole`
 * chỉ đợi phần tử xuất hiện, KHÔNG đợi tải xong. Phải `waitFor` tới đúng số hàng DỮ LIỆU mong đợi
 * (`+1` header) rồi mới đọc nội dung ô, nếu không assert ăn nhầm hàng skeleton rỗng.
 */
async function bodyRows(expectedCount = 1): Promise<HTMLElement[]> {
  const table = await screen.findByRole("table");
  await waitFor(() => {
    expect(within(table).getAllByRole("row")).toHaveLength(expectedCount + 1);
  });
  return within(table).getAllByRole("row").slice(1);
}

// ── Tạm ứng (PayrollAdvanceListPage) — cột "amount", ô cột thứ 2 (sau "Nhân sự") ──────────────────

const ADVANCE_BASE: Omit<PayrollAdvanceDto, "amount"> = {
  id: "30000000-0000-4000-8000-000000000003",
  companyId: "40000000-0000-4000-8000-000000000004",
  userId: "50000000-0000-4000-8000-000000000005",
  deductPeriodMonth: "2026-09",
  reason: "Ứng lương tháng 9",
  status: "Pending",
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  payrollPeriodId: null,
  consumedAt: null,
  createdBy: "creator-other-user",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const ADVANCE_AMOUNT = 7_300_000;

describe("T6 — Tạm ứng (PayrollAdvanceListPage), cột «Số tiền»", () => {
  it("[allow] hàng CÓ amount ⇒ ô hiện số tiền định dạng ĐÚNG", async () => {
    allow(pairKey(PAYROLL_ENGINE_PAIRS.advanceList));
    api.listAdvances!.mockResolvedValue(pageOf([{ ...ADVANCE_BASE, amount: ADVANCE_AMOUNT }]));
    wrap(<PayrollAdvanceListPage />);

    const rows = await bodyRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getAllByRole("cell")[1]).toHaveTextContent("7.300.000 ₫");
  });

  it("[deny mask] hàng VẮNG khoá amount ⇒ ô hiện «—», KHÔNG còn số nào của khoản đó trên trang", async () => {
    allow(pairKey(PAYROLL_ENGINE_PAIRS.advanceList));
    api.listAdvances!.mockResolvedValue(pageOf([{ ...ADVANCE_BASE }]));
    wrap(<PayrollAdvanceListPage />);

    const rows = await bodyRows();
    expect(within(rows[0]!).getAllByRole("cell")[1]).toHaveTextContent(PAYROLL_MASKED_PLACEHOLDER);
    expectAmountNowhereOnPage(ADVANCE_AMOUNT);
  });

  it("[deny view] THIẾU view:payroll-advance ⇒ trang hiện «không có quyền», không gọi 059", async () => {
    allow(); // không cặp nào
    wrap(<PayrollAdvanceListPage />);

    expect(await screen.findByText(tr("advances.noPermission"))).toBeInTheDocument();
    expect(api.listAdvances).not.toHaveBeenCalled();
  });
});

// ── Đợt chi trả — danh sách (PaymentBatchListPage) — cột "totalNet" (cột 7, index 6) ───────────────

const BATCH_LIST_BASE: Omit<PaymentBatchDto, "totalNet"> = { ...BATCH };
const BATCH_TOTAL_NET = 128_450_000;

describe("T6 — Đợt chi trả · danh sách (PaymentBatchListPage), cột «Tổng thực nhận»", () => {
  it("[allow] hàng CÓ totalNet ⇒ ô hiện số tiền định dạng ĐÚNG", async () => {
    allow(pairKey(PAYROLL_ENGINE_PAIRS.batchList));
    api.listPaymentBatches!.mockResolvedValue(
      pageOf([{ ...BATCH_LIST_BASE, totalNet: BATCH_TOTAL_NET }]),
    );
    wrap(<PaymentBatchListPage onOpenBatch={vi.fn()} />);

    const rows = await bodyRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getAllByRole("cell")[6]).toHaveTextContent("128.450.000 ₫");
  });

  it("[deny mask] hàng VẮNG khoá totalNet ⇒ ô hiện «—», KHÔNG còn số nào của khoản đó trên trang", async () => {
    allow(pairKey(PAYROLL_ENGINE_PAIRS.batchList));
    api.listPaymentBatches!.mockResolvedValue(pageOf([{ ...BATCH_LIST_BASE }]));
    wrap(<PaymentBatchListPage onOpenBatch={vi.fn()} />);

    const rows = await bodyRows();
    expect(within(rows[0]!).getAllByRole("cell")[6]).toHaveTextContent(PAYROLL_MASKED_PLACEHOLDER);
    expectAmountNowhereOnPage(BATCH_TOTAL_NET);
  });

  it("[deny view] THIẾU view:payment-batch ⇒ trang hiện «không có quyền», không gọi 066", async () => {
    allow();
    wrap(<PaymentBatchListPage onOpenBatch={vi.fn()} />);

    expect(await screen.findByText(tr("paymentBatches.noPermission"))).toBeInTheDocument();
    expect(api.listPaymentBatches).not.toHaveBeenCalled();
  });
});

// ── Đợt chi trả — dòng chi (PaymentBatchDetailPage) — cột "net" (cột 2, index 1) ────────────────────

const LINE_BASE: Omit<PaymentLineDto, "net"> = {
  id: "60000000-0000-4000-8000-000000000006",
  userId: "50000000-0000-4000-8000-000000000005",
  employeeCode: "NV001",
  fullName: "Nguyễn Văn A",
  payslipId: "70000000-0000-4000-8000-000000000007",
  bankAccountLast4: "6789",
  bankName: "Vietcombank",
  accountHolder: "NGUYEN VAN A",
  paidAt: null,
  createdAt: "2026-09-05T00:00:00.000Z",
};
const LINE_NET = 15_200_000;
/** Chỉ cần `view:payment-batch` (070 dùng CHUNG cặp với 066 — mirror `batchLines` ở constants.ts). */
const canViewLinesPair = pairKey(PAYROLL_ENGINE_PAIRS.batchLines);

describe("T6 — Đợt chi trả · dòng chi (PaymentBatchDetailPage), cột «Thực nhận»", () => {
  beforeEach(() => {
    api.getPaymentBatch!.mockResolvedValue(BATCH);
  });

  it("[allow] dòng CÓ net ⇒ ô hiện số tiền định dạng ĐÚNG", async () => {
    allow(canViewLinesPair);
    api.listPaymentLines!.mockResolvedValue(pageOf([{ ...LINE_BASE, net: LINE_NET }]));
    renderBatchDetail();

    await screen.findByText(BATCH.code);
    const rows = await bodyRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getAllByRole("cell")[1]).toHaveTextContent("15.200.000 ₫");
  });

  it("[deny mask] dòng VẮNG khoá net ⇒ ô hiện «—», KHÔNG còn số nào của khoản đó trên trang", async () => {
    allow(canViewLinesPair);
    api.listPaymentLines!.mockResolvedValue(pageOf([{ ...LINE_BASE }]));
    renderBatchDetail();

    await screen.findByText(BATCH.code);
    const rows = await bodyRows();
    expect(within(rows[0]!).getAllByRole("cell")[1]).toHaveTextContent(PAYROLL_MASKED_PLACEHOLDER);
    expectAmountNowhereOnPage(LINE_NET);
  });

  it("[deny view] THIẾU view:payment-batch ⇒ khối dòng chi hiện «không có quyền», không gọi 070", async () => {
    allow(); // batchQuery vẫn tải được — chỉ khối DÒNG CHI đứng sau `canViewLines`
    renderBatchDetail();

    await screen.findByText(BATCH.code);
    expect(await screen.findByText(tr("paymentBatchDetail.linesNoPermission"))).toBeInTheDocument();
    expect(api.listPaymentLines).not.toHaveBeenCalled();
  });
});

// ── Ngân sách (PayrollBudgetListPage) — BA cột tiền: planned(1) · actual(2) · variance(3) ──────────

const BUDGET_BASE: Omit<PayrollBudgetDto, "plannedAmount" | "actualAmount" | "variance"> = {
  id: "80000000-0000-4000-8000-000000000008",
  fiscalYear: 2026,
  orgUnitId: null,
  orgUnitName: null,
  note: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const BUDGET_PLANNED = 500_000_000;
const BUDGET_ACTUAL = 317_250_000;
const BUDGET_VARIANCE = 182_750_000;

describe("T6 — Ngân sách (PayrollBudgetListPage), cột «Kế hoạch/Thực hiện/Chênh lệch»", () => {
  it("[allow] hàng CÓ cả ba khoá tiền ⇒ ba ô hiện số tiền định dạng ĐÚNG", async () => {
    allow(pairKey(PAYROLL_ENGINE_PAIRS.budgetList));
    api.listPayrollBudgets!.mockResolvedValue([
      {
        ...BUDGET_BASE,
        plannedAmount: BUDGET_PLANNED,
        actualAmount: BUDGET_ACTUAL,
        variance: BUDGET_VARIANCE,
      },
    ]);
    wrap(<PayrollBudgetListPage />);

    const rows = await bodyRows();
    expect(rows).toHaveLength(1);
    const cells = within(rows[0]!).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("500.000.000 ₫");
    expect(cells[2]).toHaveTextContent("317.250.000 ₫");
    expect(cells[3]).toHaveTextContent("182.750.000 ₫");
  });

  it("[deny mask] hàng VẮNG cả ba khoá tiền ⇒ ba ô hiện «—», không còn số nào của cả ba trên trang", async () => {
    allow(pairKey(PAYROLL_ENGINE_PAIRS.budgetList));
    api.listPayrollBudgets!.mockResolvedValue([{ ...BUDGET_BASE }]);
    wrap(<PayrollBudgetListPage />);

    const rows = await bodyRows();
    const cells = within(rows[0]!).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent(PAYROLL_MASKED_PLACEHOLDER);
    expect(cells[2]).toHaveTextContent(PAYROLL_MASKED_PLACEHOLDER);
    expect(cells[3]).toHaveTextContent(PAYROLL_MASKED_PLACEHOLDER);
    expectAmountNowhereOnPage(BUDGET_PLANNED);
    expectAmountNowhereOnPage(BUDGET_ACTUAL);
    expectAmountNowhereOnPage(BUDGET_VARIANCE);
  });

  it("[deny view] THIẾU view:payroll-budget ⇒ trang hiện «không có quyền», không gọi 073", async () => {
    allow();
    wrap(<PayrollBudgetListPage />);

    expect(await screen.findByText(tr("budgets.noPermission"))).toBeInTheDocument();
    expect(api.listPayrollBudgets).not.toHaveBeenCalled();
  });
});
