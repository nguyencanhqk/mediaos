/**
 * S15-PAYROLL-FE-7 — sửa BA TRƯỜNG của bản thân đợt chi trả (PAYROLL-API-069: `status` · `payDate` ·
 * `note`) ở PAY-SCREEN-013. Nợ của FE-6: FE-6 chỉ dựng ba mảng thao tác trên DÒNG, ba vế này vẫn
 * không có đường sửa nào ở `apps/app`.
 *
 * File neo ĐÚNG những luật BE mà UI phải phản chiếu, không neo bố cục:
 *
 *   ENUM   — `status` của 069 là enum RIÊNG `Draft|Ready`; **`Completed` KHÔNG BAO GIỜ trong ô chọn**
 *            (chỉ 072 tới được — gửi ở đây là 400 và lách cả cổng four-eyes).
 *   DIRTY  — chỉ gửi trường THẬT SỰ đổi: thân rỗng vẫn qua Zod và vẫn sinh một hàng audit
 *            `changedFields: []` ⇒ nút Lưu khoá khi chưa đổi gì.
 *   NULL   — ô trống ⇒ `null`, KHÔNG `""` (`note` là `.trim().max(500)` KHÔNG có `.min(1)` nên `""`
 *            hợp lệ và ghi thẳng chuỗi rỗng vào cột).
 *   CHUNG  — ba trường đi CHUNG một PATCH (BE gộp thành một `updateTx`) — khác ba mảng dòng của FE-6.
 *   DENY   — thiếu `manage:payment-batch` ⇒ mục VẮNG **và** client KHÔNG được gọi.
 *   FSM    — đợt `Completed` ⇒ mục VẮNG (BE `assertNotCompleted` ⇒ 409 027).
 *   LỖI    — 409 `batch-already-completed` có chữ riêng; 404 có chữ RIÊNG của màn này (mặc định rơi
 *            `errors.generic` vì `payrollErrorI18nKey` không đọc `status`).
 *
 * Mỗi ca DENY đi cặp ca ALLOW đối chứng (`deny-cases-vacuous-without-allow-case`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import type { PaymentBatchDto, PaymentLineDto } from "@mediaos/contracts";

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
  /** Bản THẬT bóc `kind` từ `details[]`; ca test ném thẳng `{status, kind}` nên chỉ cần chiếu lại. */
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

const api = payrollApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const tr = (k: string, o?: Record<string, unknown>) => i18n.t(`payroll:${k}`, o);
/** Tra thẳng từ `PAYROLL_ENGINE_PAIRS` (nguồn sự thật của component) — test không trôi khi bảng đổi. */
const pairKey = (p: PayrollEnginePair) => `${p.action}:${p.resourceType}`;

const BATCH_ID = "10000000-0000-4000-8000-000000000001";
const PERIOD_ID = "20000000-0000-4000-8000-000000000002";
const USER_UNPAID = "30000000-0000-4000-8000-000000000003";

const BATCH: PaymentBatchDto = {
  id: BATCH_ID,
  payrollPeriodId: PERIOD_ID,
  periodMonth: "2026-09",
  code: "CT-202609-BANK-ABC123",
  method: "bank",
  status: "Ready",
  payDate: null,
  note: null,
  lineCount: 1,
  paidLineCount: 0,
  createdBy: "creator-other-user",
  createdAt: "2026-09-01T00:00:00.000Z",
  completedBy: null,
  completedAt: null,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

/** Đợt ĐÃ có ngày chi + ghi chú — để đo ca XOÁ (phải gửi `null`, không phải `""`). */
const BATCH_FILLED: PaymentBatchDto = {
  ...BATCH,
  payDate: "2026-09-25",
  note: "Chi đợt 1",
};

const LINES: PaymentLineDto[] = [
  {
    id: `line-${USER_UNPAID}`,
    userId: USER_UNPAID,
    employeeCode: null,
    fullName: null,
    payslipId: `payslip-${USER_UNPAID}`,
    net: 10_000_000,
    bankAccountLast4: "4321",
    bankName: "VCB",
    accountHolder: "NGUYEN VAN A",
    paidAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  },
];

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

/** Mở menu ⋯ rồi bấm mục «Sửa thông tin đợt»; trả về hộp thoại đã mở. */
async function openEditDialog() {
  fireEvent.click(await screen.findByTestId("detail-header-overflow"));
  fireEvent.click(screen.getByRole("menuitem", { name: tr("paymentBatchDetail.edit") }));
  return screen.findByRole("dialog");
}

const lastPatchBody = () =>
  api.updatePaymentBatch!.mock.calls[0]?.[1] as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  granted.clear();
  localStorage.clear();
  api.getPaymentBatch!.mockResolvedValue(BATCH);
  api.listPaymentLines!.mockResolvedValue(pageOf(LINES));
  api.updatePaymentBatch!.mockResolvedValue({ id: BATCH_ID, warnings: [] });
  api.listPayslips!.mockResolvedValue(pageOf([]));
});

const PAIR_UPDATE = pairKey(PAYROLL_ENGINE_PAIRS.batchUpdate);
const PAIR_LINES = pairKey(PAYROLL_ENGINE_PAIRS.batchLines);
const PAIR_PAYSLIP = pairKey(PAYROLL_ENGINE_PAIRS.payslipList);
const PAIR_BATCH_EXPORT = pairKey(PAYROLL_ENGINE_PAIRS.batchExport);
const PAIR_PERIOD_EXPORT = pairKey(PAYROLL_ENGINE_PAIRS.periodExport);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ALLOW — hộp sửa mở được và gửi ĐÚNG payload 069
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("FE-7 ALLOW — sửa status/payDate/note của đợt", () => {
  beforeEach(() => allow(PAIR_UPDATE, PAIR_LINES));

  it("A1 — mục «Sửa thông tin đợt» có trong ⋯ và mở ra đủ ba trường", async () => {
    renderDetail();
    const dialog = await openEditDialog();

    expect(within(dialog).getByTestId("batch-edit-status")).toBeTruthy();
    expect(within(dialog).getByTestId("batch-edit-pay-date")).toBeTruthy();
    expect(within(dialog).getByTestId("batch-edit-note")).toBeTruthy();
  });

  it("A2 — ô chọn trạng thái ĐÚNG [Draft, Ready]: «Completed» KHÔNG có mặt", async () => {
    renderDetail();
    const dialog = await openEditDialog();

    const select = within(dialog).getByTestId("batch-edit-status") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["Draft", "Ready"]);
    // Nhãn tiếng Việt của `Completed` cũng không được xuất hiện ở đâu trong hộp.
    expect(within(dialog).queryByText(tr("paymentBatchStatus.Completed"))).toBeNull();
  });

  it("A3 — đổi MỖI trạng thái ⇒ PATCH mang đúng một khoá `status`", async () => {
    renderDetail();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByTestId("batch-edit-status"), {
      target: { value: "Draft" },
    });
    fireEvent.click(within(dialog).getByTestId("batch-edit-submit"));

    await waitFor(() => expect(api.updatePaymentBatch).toHaveBeenCalledTimes(1));
    expect(api.updatePaymentBatch!.mock.calls[0][0]).toBe(BATCH_ID);
    expect(lastPatchBody()).toEqual({ status: "Draft" });
  });

  it("A4 — đổi cả ba ⇒ MỘT PATCH mang đủ ba khoá (BE gộp thành một câu update)", async () => {
    renderDetail();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByTestId("batch-edit-status"), {
      target: { value: "Draft" },
    });
    fireEvent.change(within(dialog).getByTestId("batch-edit-pay-date"), {
      target: { value: "2026-09-30" },
    });
    fireEvent.change(within(dialog).getByTestId("batch-edit-note"), {
      target: { value: "Chuyển sang nháp để bổ sung người" },
    });
    fireEvent.click(within(dialog).getByTestId("batch-edit-submit"));

    await waitFor(() => expect(api.updatePaymentBatch).toHaveBeenCalledTimes(1));
    expect(lastPatchBody()).toEqual({
      status: "Draft",
      payDate: "2026-09-30",
      note: "Chuyển sang nháp để bổ sung người",
    });
  });

  it("A7 — chưa đổi gì ⇒ nút Lưu disabled và client KHÔNG được gọi", async () => {
    renderDetail();
    const dialog = await openEditDialog();

    const submit = within(dialog).getByTestId("batch-edit-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(api.updatePaymentBatch).not.toHaveBeenCalled();

    // Đối chứng: vừa đổi một trường là nút mở khoá ngay (ca trên không xanh vì hộp rỗng).
    fireEvent.change(within(dialog).getByTestId("batch-edit-note"), { target: { value: "x" } });
    await waitFor(() =>
      expect((within(dialog).getByTestId("batch-edit-submit") as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  it("thành công ⇒ hộp đóng và trang báo đã lưu", async () => {
    renderDetail();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByTestId("batch-edit-note"), { target: { value: "abc" } });
    fireEvent.click(within(dialog).getByTestId("batch-edit-submit"));

    await waitFor(() => expect(screen.getByText(tr("paymentBatchEdit.saved"))).toBeTruthy());
    expect(screen.queryByTestId("batch-edit-submit")).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// XOÁ giá trị — ô trống phải thành `null`, KHÔNG phải `""`
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("FE-7 — xoá ngày chi / ghi chú gửi `null`", () => {
  beforeEach(() => {
    allow(PAIR_UPDATE, PAIR_LINES);
    api.getPaymentBatch!.mockResolvedValue(BATCH_FILLED);
  });

  it('A5 — xoá cả hai ô ⇒ `{payDate: null, note: null}` (BE nhận `""` mà ghi thẳng chuỗi rỗng)', async () => {
    renderDetail();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByTestId("batch-edit-pay-date"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByTestId("batch-edit-note"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByTestId("batch-edit-submit"));

    await waitFor(() => expect(api.updatePaymentBatch).toHaveBeenCalledTimes(1));
    expect(lastPatchBody()).toEqual({ payDate: null, note: null });
  });

  it("A6 — ghi chú toàn khoảng trắng ⇒ `null` (không gửi chuỗi trắng)", async () => {
    renderDetail();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByTestId("batch-edit-note"), { target: { value: "   " } });
    fireEvent.click(within(dialog).getByTestId("batch-edit-submit"));

    await waitFor(() => expect(api.updatePaymentBatch).toHaveBeenCalledTimes(1));
    expect(lastPatchBody()).toEqual({ note: null });
  });

  it("giá trị y nguyên (chỉ thêm khoảng trắng quanh ghi chú) ⇒ KHÔNG coi là đổi", async () => {
    renderDetail();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByTestId("batch-edit-note"), {
      target: { value: `  ${BATCH_FILLED.note}  ` },
    });
    expect((within(dialog).getByTestId("batch-edit-submit") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// DENY — cổng quyền và FSM
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("FE-7 DENY — cổng quyền + FSM", () => {
  it("D1 — thiếu `manage:payment-batch` ⇒ không có mục sửa, client KHÔNG được gọi", async () => {
    allow(PAIR_LINES);
    renderDetail();

    // Đợi trang tải xong (bảng dòng đã hỏi server) rồi mới kết luận «vắng».
    await waitFor(() => expect(api.listPaymentLines).toHaveBeenCalled());
    // 🔴 Đo NÚT ⋯, không đo `menuitem`: mục menu chỉ được render SAU khi bấm ⋯, nên
    // `queryByRole("menuitem")` là null kể cả khi cổng hỏng — một ca DENY rỗng. Ở bộ quyền này
    // người gọi không có cả ba cặp xuất tệp ⇒ cổng còn đúng thì mảng `overflowItems` rỗng và nút ⋯
    // biến mất hẳn; cổng hỏng thì nút mọc lên và assert dưới đây đỏ.
    expect(screen.queryByTestId("detail-header-overflow")).toBeNull();
    expect(api.updatePaymentBatch).not.toHaveBeenCalled();
  });

  it("D2 — đợt `Completed` ⇒ mục sửa VẮNG dù CÓ đủ quyền (menu vẫn có mục xuất ⇒ ca không rỗng)", async () => {
    allow(PAIR_UPDATE, PAIR_LINES, PAIR_PAYSLIP, PAIR_BATCH_EXPORT, PAIR_PERIOD_EXPORT);
    api.getPaymentBatch!.mockResolvedValue({
      ...BATCH,
      status: "Completed",
      completedBy: CURRENT_USER_ID,
      completedAt: "2026-09-26T00:00:00.000Z",
    });
    renderDetail();

    fireEvent.click(await screen.findByTestId("detail-header-overflow"));
    expect(screen.getByRole("menuitem", { name: tr("paymentBatchDetail.export") })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: tr("paymentBatchDetail.edit") })).toBeNull();
    expect(api.updatePaymentBatch).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LỖI — mỗi ca có chữ RIÊNG, không rơi câu chung chung
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("FE-7 — lỗi có chữ riêng", () => {
  beforeEach(() => allow(PAIR_UPDATE, PAIR_LINES));

  it("E1 — 409 `batch-already-completed` ⇒ chữ riêng ở dải thông báo, hộp đóng, KHÔNG «Có lỗi xảy ra»", async () => {
    api.updatePaymentBatch!.mockRejectedValue({ status: 409, kind: "batch-already-completed" });
    renderDetail();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByTestId("batch-edit-status"), {
      target: { value: "Draft" },
    });
    fireEvent.click(within(dialog).getByTestId("batch-edit-submit"));

    await waitFor(() => expect(screen.getByText(tr("errors.batchAlreadyCompleted"))).toBeTruthy());
    expect(screen.queryByText(tr("errors.generic"))).toBeNull();
    expect(screen.queryByTestId("batch-edit-submit")).toBeNull();
  });

  it("E2 — 404 ⇒ chữ RIÊNG «đợt không còn tồn tại», KHÔNG rơi `errors.generic`", async () => {
    api.updatePaymentBatch!.mockRejectedValue({ status: 404 });
    renderDetail();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByTestId("batch-edit-note"), { target: { value: "abc" } });
    fireEvent.click(within(dialog).getByTestId("batch-edit-submit"));

    await waitFor(() =>
      expect(screen.getByText(tr("paymentBatchEdit.batchNotFound"))).toBeTruthy(),
    );
    expect(screen.queryByText(tr("errors.generic"))).toBeNull();
    // Chữ 404 của màn DÒNG (FE-6) là chuyện khác — không được mượn sang đây.
    expect(screen.queryByText(tr("paymentBatchDetail.lineNotFound"))).toBeNull();
  });

  it("lỗi KHÔNG phải tranh chấp trạng thái ⇒ ở lại TRONG hộp để sửa và gửi tiếp", async () => {
    api.updatePaymentBatch!.mockRejectedValue({ status: 422, kind: "export-limit" });
    renderDetail();
    const dialog = await openEditDialog();

    fireEvent.change(within(dialog).getByTestId("batch-edit-note"), { target: { value: "abc" } });
    fireEvent.click(within(dialog).getByTestId("batch-edit-submit"));

    await waitFor(() => expect(screen.getByTestId("batch-edit-error")).toBeTruthy());
    expect(screen.getByTestId("batch-edit-submit")).toBeTruthy();
  });
});
