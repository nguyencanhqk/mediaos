/**
 * S15-PAYROLL-FE-6 — **T5 của S15-PAYROLL-QA-1** (`done_when` 6): thao tác trên DÒNG của đợt chi trả
 * (PAYROLL-API-069) ở PAY-SCREEN-013. Trước WO này ca T5 không dựng được vì `apps/app` KHÔNG gọi
 * `payrollApi.updatePaymentBatch` ở đâu — bảng dòng là chỉ-đọc.
 *
 * File này neo ĐÚNG những luật BE mà UI phải phản chiếu, không neo bố cục:
 *
 *   ALLOW  — giữ `manage:payment-batch` ⇒ 3 thao tác hiện; mỗi lượt gửi ĐÚNG MỘT mảng của 069.
 *   DENY   — thiếu cặp ⇒ nút VẮNG **và** client KHÔNG được gọi (nút ẩn mà vẫn gọi = cổng giả).
 *   FSM    — đợt `Completed` là chỉ-đọc (BE: `assertNotCompleted` ⇒ 409 027).
 *   DÒNG ĐÃ CHI — ô tích khoá: `removeUserIds` all-or-nothing (409 `line-already-paid` cho CẢ lượt) và
 *                 `markPaidUserIds` là no-op IM LẶNG trên dòng đó.
 *   LỖI    — 409 `line-already-paid` · `payee-already-in-batch` có chữ RIÊNG (không rơi «Đã có lỗi»);
 *            404 có chữ riêng của màn này, KHÔNG mượn `errors.notFound` dùng chung cả module.
 *   AUDIT  — 029 ghi một hàng `audit_logs` MỖI lượt gọi ⇒ hộp «Thêm người» ĐÓNG thì `listPayslips`
 *            chưa được gọi lần nào.
 *
 * Mỗi ca DENY đi cặp ca ALLOW đối chứng (`deny-cases-vacuous-without-allow-case`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import type { PaymentBatchDto, PaymentLineDto, PayslipDto } from "@mediaos/contracts";

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
  /**
   * Bản THẬT bóc `kind` từ `details[]`; ở đây ca test ném thẳng `{status, kind}` nên chỉ cần chiếu
   * lại — đủ để `payrollErrorText` tra đúng bảng `KIND_TO_I18N_KEY` như chạy thật.
   */
  parseKindError: (e: unknown) => {
    const err = (e ?? {}) as { status?: number; kind?: string };
    return {
      code: null,
      status: err.status ?? null,
      kind: err.kind ?? null,
      message: "",
      fields: new Map<string, string>(),
    };
  },
  payrollApi: {
    getPaymentBatch: vi.fn(),
    listPaymentLines: vi.fn(),
    updatePaymentBatch: vi.fn(),
    listPayslips: vi.fn(),
    exportPaymentBatch: vi.fn(),
    completePaymentBatch: vi.fn(),
    pickerPeople: vi.fn(async () => []),
  },
  payrollKeys: {
    paymentBatches: {
      allOf: () => ["payroll", "payment-batches"],
      detail: (id: string) => ["payroll", "payment-batches", "detail", id],
      lines: (id: string, p: unknown) => ["payroll", "payment-batches", "lines", id, p],
    },
    payslips: {
      allOf: () => ["payroll", "payslips"],
      list: (p: unknown) => ["payroll", "payslips", "list", p],
    },
    pickers: { people: (p: unknown) => ["payroll", "pickers", "people", p] },
  },
}));

import { payrollApi } from "@mediaos/web-core";
import { PaymentBatchDetailPage } from "./PaymentBatchDetailPage";
import { PAYROLL_ENGINE_PAIRS, type PayrollEnginePair } from "./constants";
import { PaymentBatchAddPayeesDialog } from "./components/PaymentBatchAddPayeesDialog";

const api = payrollApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const tr = (k: string, o?: Record<string, unknown>) => i18n.t(`payroll:${k}`, o);
/** Tra thẳng từ `PAYROLL_ENGINE_PAIRS` (nguồn sự thật của component) — test không trôi khi bảng đổi. */
const pairKey = (p: PayrollEnginePair) => `${p.action}:${p.resourceType}`;

const BATCH_ID = "10000000-0000-4000-8000-000000000001";
const PERIOD_ID = "20000000-0000-4000-8000-000000000002";
const USER_UNPAID = "30000000-0000-4000-8000-000000000003";
const USER_PAID = "40000000-0000-4000-8000-000000000004";
const USER_NEW = "50000000-0000-4000-8000-000000000005";

const BATCH: PaymentBatchDto = {
  id: BATCH_ID,
  payrollPeriodId: PERIOD_ID,
  periodMonth: "2026-09",
  code: "CT-202609-BANK-ABC123",
  method: "bank",
  status: "Ready",
  payDate: null,
  note: null,
  lineCount: 2,
  paidLineCount: 1,
  createdBy: "creator-other-user",
  createdAt: "2026-09-01T00:00:00.000Z",
  completedBy: null,
  completedAt: null,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const line = (userId: string, paidAt: string | null): PaymentLineDto => ({
  id: `line-${userId}`,
  userId,
  employeeCode: null,
  fullName: null,
  payslipId: `payslip-${userId}`,
  net: 10_000_000,
  bankAccountLast4: "4321",
  bankName: "VCB",
  accountHolder: "NGUYEN VAN A",
  paidAt,
  createdAt: "2026-09-01T00:00:00.000Z",
});

const LINES = [line(USER_UNPAID, null), line(USER_PAID, "2026-09-10T03:00:00.000Z")];

const payslip = (userId: string): PayslipDto => ({
  id: `ps-${userId}`,
  companyId: "60000000-0000-4000-8000-000000000006",
  payrollPeriodId: PERIOD_ID,
  userId,
  salaryProfileId: null,
  status: "Published",
  workDays: 22,
  presentDays: 22,
  paidLeaveDays: 0,
  unpaidLeaveDays: 0,
  lateMinutes: 0,
  createdBy: CURRENT_USER_ID,
  createdAt: "2026-09-01T00:00:00.000Z",
});

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

function renderDetail() {
  return wrap(<PaymentBatchDetailPage batchId={BATCH_ID} onBack={vi.fn()} />);
}

/** Chọn dòng CHƯA chi rồi bấm nút thao tác + xác nhận trong hộp thoại. */
async function actOnUnpaidLine(triggerTestId: string, confirmLabel: string) {
  fireEvent.click(await screen.findByTestId(`line-select-${USER_UNPAID}`));
  fireEvent.click(screen.getByTestId(triggerTestId));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: confirmLabel }));
}

beforeEach(() => {
  vi.clearAllMocks();
  granted.clear();
  localStorage.clear();
  api.getPaymentBatch!.mockResolvedValue(BATCH);
  api.listPaymentLines!.mockResolvedValue(pageOf(LINES));
  api.updatePaymentBatch!.mockResolvedValue({ id: BATCH_ID, warnings: [] });
  api.listPayslips!.mockResolvedValue(pageOf([payslip(USER_UNPAID), payslip(USER_NEW)]));
});

const PAIR_UPDATE = pairKey(PAYROLL_ENGINE_PAIRS.batchUpdate);
const PAIR_LINES = pairKey(PAYROLL_ENGINE_PAIRS.batchLines);
const PAIR_PAYSLIP = pairKey(PAYROLL_ENGINE_PAIRS.payslipList);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ALLOW — 3 thao tác hiện và gửi ĐÚNG MỘT mảng mỗi lượt
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("T5 ALLOW — thao tác trên dòng gửi đúng payload 069", () => {
  beforeEach(() => allow(PAIR_UPDATE, PAIR_LINES, PAIR_PAYSLIP));

  it("hiện đủ «Đánh dấu đã chi» · «Gỡ khỏi đợt» · «Thêm người»", async () => {
    renderDetail();
    expect(await screen.findByTestId("lines-mark-paid")).toBeTruthy();
    expect(screen.getByTestId("lines-remove")).toBeTruthy();
    expect(screen.getByTestId("lines-add-payees")).toBeTruthy();
  });

  it("«Đánh dấu đã chi» gửi CHỈ `markPaidUserIds` (đúng một mảng mỗi PATCH)", async () => {
    renderDetail();
    await actOnUnpaidLine("lines-mark-paid", tr("paymentBatchDetail.markPaid"));

    await waitFor(() => expect(api.updatePaymentBatch).toHaveBeenCalledTimes(1));
    const [id, body] = api.updatePaymentBatch!.mock.calls[0];
    expect(id).toBe(BATCH_ID);
    expect(body).toEqual({ markPaidUserIds: [USER_UNPAID] });
    // BE xử `remove → add → markPaid` trong CÙNG tx: trộn hai mảng là nhận 409 không biết của vế nào.
    expect(Object.keys(body as object)).toEqual(["markPaidUserIds"]);
  });

  it("«Gỡ khỏi đợt» gửi CHỈ `removeUserIds`", async () => {
    renderDetail();
    await actOnUnpaidLine("lines-remove", tr("paymentBatchDetail.removeLines"));

    await waitFor(() => expect(api.updatePaymentBatch).toHaveBeenCalledTimes(1));
    const [, body] = api.updatePaymentBatch!.mock.calls[0];
    expect(body).toEqual({ removeUserIds: [USER_UNPAID] });
    expect(Object.keys(body as object)).toEqual(["removeUserIds"]);
  });

  it("chưa chọn ai ⇒ cả hai nút disabled (mảng rỗng là 400 KHÔNG mang `kind`)", async () => {
    renderDetail();
    const markPaid = (await screen.findByTestId("lines-mark-paid")) as HTMLButtonElement;
    expect(markPaid.disabled).toBe(true);
    expect((screen.getByTestId("lines-remove") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(await screen.findByTestId(`line-select-${USER_UNPAID}`));
    await waitFor(() =>
      expect((screen.getByTestId("lines-mark-paid") as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("dòng ĐÃ CHI ⇒ ô tích khoá (gỡ là 409 cho CẢ lượt, đánh dấu lại là no-op im lặng)", async () => {
    renderDetail();
    expect(
      ((await screen.findByTestId(`line-select-${USER_PAID}`)) as HTMLInputElement).disabled,
    ).toBe(true);
    expect((screen.getByTestId(`line-select-${USER_UNPAID}`) as HTMLInputElement).disabled).toBe(
      false,
    );
  });

  it("`markPaid` thành công KHÔNG khẳng định số dòng đã đổi, và tải lại bảng", async () => {
    renderDetail();
    await waitFor(() => expect(api.listPaymentLines).toHaveBeenCalledTimes(1));
    await actOnUnpaidLine("lines-mark-paid", tr("paymentBatchDetail.markPaid"));

    const ok = await screen.findByText(tr("paymentBatchDetail.markPaidDone"));
    // Envelope `{id, warnings}` KHÔNG mang số dòng đổi ⇒ câu báo không được chứa con số nào.
    expect(ok.textContent).not.toMatch(/\d/);
    // D7 — invalidate prefix `paymentBatches.allOf()` phủ cả nhánh `lines` ⇒ bảng tải lại.
    await waitFor(() => expect(api.listPaymentLines!.mock.calls.length).toBeGreaterThan(1));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// DENY — thiếu cặp ⇒ nút VẮNG và client KHÔNG được gọi
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("T5 DENY — cổng quyền và FSM", () => {
  it("[deny] thiếu `manage:payment-batch` ⇒ không nút nào, `updatePaymentBatch` không được gọi", async () => {
    allow(PAIR_LINES, PAIR_PAYSLIP);
    renderDetail();

    await screen.findByText(BATCH.code);
    await waitFor(() => expect(api.listPaymentLines).toHaveBeenCalled());
    expect(screen.queryByTestId("lines-mark-paid")).toBeNull();
    expect(screen.queryByTestId("lines-remove")).toBeNull();
    expect(screen.queryByTestId("lines-add-payees")).toBeNull();
    expect(screen.queryByTestId(`line-select-${USER_UNPAID}`)).toBeNull();
    expect(api.updatePaymentBatch).not.toHaveBeenCalled();
  });

  it("[deny] thiếu `view:payment-batch` ⇒ không cột chọn/thanh thao tác, nhưng «Thêm người» vẫn có", async () => {
    allow(PAIR_UPDATE, PAIR_PAYSLIP);
    renderDetail();

    await screen.findByText(BATCH.code);
    expect(screen.queryByTestId("lines-selected-count")).toBeNull();
    expect(screen.queryByTestId("lines-mark-paid")).toBeNull();
    // Bảng dòng không tải được ⇒ không có gì để chọn; nhưng thêm người KHÔNG cần đọc dòng.
    expect(screen.getByTestId("lines-add-payees")).toBeTruthy();
    expect(api.listPaymentLines).not.toHaveBeenCalled();
  });

  it("[deny] thiếu `view-payslip:payslip` ⇒ «Thêm người» vắng + nêu lý do; `listPayslips` không được gọi", async () => {
    allow(PAIR_UPDATE, PAIR_LINES);
    renderDetail();

    await screen.findByTestId("lines-mark-paid");
    expect(screen.queryByTestId("lines-add-payees")).toBeNull();
    expect(screen.getByText(tr("paymentBatchDetail.addPayeesNoPermission"))).toBeTruthy();
    expect(api.listPayslips).not.toHaveBeenCalled();
  });

  it("[allow đối chứng] hộp «Thêm người» ĐÓNG ⇒ `listPayslips` chưa gọi lần nào (029 ghi audit mỗi lượt)", async () => {
    allow(PAIR_UPDATE, PAIR_LINES, PAIR_PAYSLIP);
    renderDetail();

    await screen.findByTestId("lines-add-payees");
    await waitFor(() => expect(api.listPaymentLines).toHaveBeenCalled());
    expect(api.listPayslips).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("lines-add-payees"));
    await waitFor(() => expect(api.listPayslips).toHaveBeenCalledTimes(1));
    expect(api.listPayslips).toHaveBeenCalledWith({
      payrollPeriodId: PERIOD_ID,
      page: 1,
      per_page: 20,
    });
  });

  it("[fsm] đợt `Completed` ⇒ chỉ đọc: không thao tác nào, không cột chọn", async () => {
    allow(PAIR_UPDATE, PAIR_LINES, PAIR_PAYSLIP);
    api.getPaymentBatch!.mockResolvedValue({ ...BATCH, status: "Completed" as const });
    renderDetail();

    await screen.findByText(BATCH.code);
    await waitFor(() => expect(api.listPaymentLines).toHaveBeenCalled());
    expect(screen.queryByTestId("lines-mark-paid")).toBeNull();
    expect(screen.queryByTestId("lines-remove")).toBeNull();
    expect(screen.queryByTestId("lines-add-payees")).toBeNull();
    expect(screen.queryByTestId(`line-select-${USER_UNPAID}`)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LỖI — mỗi `kind` có chữ riêng, không nuốt
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("T5 lỗi 069 — chữ riêng theo `kind`", () => {
  beforeEach(() => allow(PAIR_UPDATE, PAIR_LINES, PAIR_PAYSLIP));

  it("409 `line-already-paid` ⇒ chữ riêng (không rơi «Đã có lỗi xảy ra»)", async () => {
    api.updatePaymentBatch!.mockRejectedValue({ status: 409, kind: "line-already-paid" });
    renderDetail();
    await actOnUnpaidLine("lines-remove", tr("paymentBatchDetail.removeLines"));

    expect(await screen.findByText(tr("errors.lineAlreadyPaid"))).toBeTruthy();
    expect(screen.queryByText(tr("errors.generic"))).toBeNull();
  });

  it("409 ⇒ dòng vừa bị người khác chi BỊ BỎ khỏi lựa chọn (không kẹt cụt đường)", async () => {
    // Người khác vừa đánh dấu dòng ta đang chọn là đã chi ⇒ lượt gỡ ăn 409 cho CẢ nhóm. Sau lượt tải
    // lại, ô tích của dòng đó `disabled` — giữ nó trong `selected` là mọi lượt gửi sau đều hỏng y hệt
    // mà không có cách nào bỏ chọn bằng tay.
    api.updatePaymentBatch!.mockRejectedValue({ status: 409, kind: "line-already-paid" });
    api
      .listPaymentLines!.mockResolvedValueOnce(pageOf(LINES))
      .mockResolvedValue(
        pageOf([
          line(USER_UNPAID, "2026-09-11T03:00:00.000Z"),
          line(USER_PAID, "2026-09-10T03:00:00.000Z"),
        ]),
      );
    renderDetail();
    await actOnUnpaidLine("lines-remove", tr("paymentBatchDetail.removeLines"));

    expect(await screen.findByText(tr("errors.lineAlreadyPaid"))).toBeTruthy();
    // Bảng tải lại ⇒ lựa chọn phải rỗng trở lại và hai nút khoá lại.
    await waitFor(() =>
      expect(screen.getByTestId("lines-selected-count").textContent).toBe(
        tr("paymentBatchDetail.selectedCount", { count: 0 }),
      ),
    );
    expect((screen.getByTestId("lines-remove") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(`line-select-${USER_UNPAID}`) as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it("404 ⇒ chữ RIÊNG của màn này, KHÔNG mượn `errors.notFound` dùng chung cả module", async () => {
    api.updatePaymentBatch!.mockRejectedValue({ status: 404 });
    renderDetail();
    await actOnUnpaidLine("lines-mark-paid", tr("paymentBatchDetail.markPaid"));

    expect(await screen.findByText(tr("paymentBatchDetail.lineNotFound"))).toBeTruthy();
    expect(screen.queryByText(tr("errors.notFound"))).toBeNull();
  });

  it("409 `payee-already-in-batch` khi thêm người ⇒ chữ riêng, người lỗi GIỮ lại trong hộp", async () => {
    api.updatePaymentBatch!.mockRejectedValue({ status: 409, kind: "payee-already-in-batch" });
    renderDetail();

    fireEvent.click(await screen.findByTestId("lines-add-payees"));
    fireEvent.click(await screen.findByTestId(`add-payees-row-${USER_NEW}`));
    fireEvent.click(screen.getByTestId("add-payees-confirm"));

    // Chữ lỗi đứng chung dòng với tên người («#5000… — <lý do>») ⇒ so trên textContent của khối cảnh báo.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(tr("errors.payeeAlreadyInBatch"));
    expect(alert.textContent).not.toContain(tr("errors.generic"));
    // Hộp KHÔNG đóng khi còn người lỗi — người dùng phải thấy ai hỏng và vì sao.
    expect(screen.getByTestId("add-payees-confirm")).toBeTruthy();
  });

  it("«Thêm người» gửi TỪNG NGƯỜI một lượt `addUserIds` (all-or-nothing của BE không chặn cả nhóm)", async () => {
    renderDetail();

    fireEvent.click(await screen.findByTestId("lines-add-payees"));
    fireEvent.click(await screen.findByTestId(`add-payees-row-${USER_NEW}`));
    fireEvent.click(screen.getByTestId("add-payees-confirm"));

    await waitFor(() => expect(api.updatePaymentBatch).toHaveBeenCalledTimes(1));
    expect(api.updatePaymentBatch).toHaveBeenCalledWith(BATCH_ID, { addUserIds: [USER_NEW] });
  });

  it("hộp «Thêm người» MỞ mà thiếu `view-payslip:payslip` ⇒ `listPayslips` vẫn KHÔNG được gọi (gác lớp hai)", async () => {
    // Lớp gác trong chính dialog, không tin vào việc cha có unmount hay không: dựng thẳng dialog với
    // bộ quyền thiếu cặp đọc phiếu — query phải im, vì mỗi lượt gọi 029 là một hàng audit tiền.
    allow(PAIR_UPDATE, PAIR_LINES);
    wrap(
      <PaymentBatchAddPayeesDialog
        batchId={BATCH_ID}
        payrollPeriodId={PERIOD_ID}
        existingUserIds={new Set()}
        people={{ byUserId: new Map(), isLoading: false, canResolve: false }}
        onClose={vi.fn()}
        onAdded={vi.fn()}
      />,
    );

    await screen.findByText(tr("paymentBatchAddPayees.title"));
    expect(api.listPayslips).not.toHaveBeenCalled();
  });

  it("người ĐÃ có dòng trong đợt ⇒ hàng khoá trong hộp chọn (lọc trước, BE vẫn là cổng)", async () => {
    renderDetail();
    fireEvent.click(await screen.findByTestId("lines-add-payees"));

    const already = (await screen.findByTestId(
      `add-payees-row-${USER_UNPAID}`,
    )) as HTMLInputElement;
    expect(already.disabled).toBe(true);
    expect((screen.getByTestId(`add-payees-row-${USER_NEW}`) as HTMLInputElement).disabled).toBe(
      false,
    );
  });
});
