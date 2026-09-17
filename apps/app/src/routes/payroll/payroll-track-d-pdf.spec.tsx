// @vitest-environment jsdom
/**
 * [deny-path] S15-PAYROLL-FE-4 — nút PDF phiếu lương: 083 (phiếu người khác — đòi CẢ `view-payslip` lẫn
 * `export:payroll`) · 084 (Own, không cặp thêm) · 085 (lô ZIP, lấy-hoặc-tạo + hỏi lại) · helper mở tab mới.
 *
 * Mỗi ca DENY đi cặp ca ALLOW đối chứng (`deny-cases-vacuous-without-allow-case`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import type { PayslipDetailDto, PayslipDto, PayslipPdfBatchDto } from "@mediaos/contracts";

const granted = new Set<string>();
const allow = (...pairs: string[]) => {
  granted.clear();
  for (const p of pairs) granted.add(p);
};
const VIEW_PAYSLIP = "view-payslip:payslip";
const EXPORT = "export:payroll";

vi.mock("@mediaos/web-core", () => {
  const key =
    (...parts: string[]) =>
    (...x: unknown[]) => ["payroll", ...parts, ...x];
  return {
    useCan: vi.fn((a: string, r: string) => granted.has(`${a}:${r}`)),
    useCanExact: vi.fn((a: string, r: string) => granted.has(`${a}:${r}`)),
    formatDate: (v: string) => `D(${v})`,
    formatDateTime: (v: string) => `DT(${v})`,
    formatNumber: (v: number) => new Intl.NumberFormat("vi-VN").format(v),
    formatCurrency: (v: number) => `${new Intl.NumberFormat("vi-VN").format(v)} ₫`,
    parseKindError: () => ({ code: null, status: 422, kind: null, message: "", fields: new Map() }),
    payrollApi: {
      getPayslip: vi.fn(),
      getPayslipPdf: vi.fn(),
      listMyPayslips: vi.fn(),
      getMyPayslip: vi.fn(),
      getMyPayslipPdf: vi.fn(),
      acknowledgeMyPayslip: vi.fn(),
      listPayslips: vi.fn(),
      requestPayslipPdfBatch: vi.fn(),
      pickerPeople: vi.fn(async () => []),
    },
    payrollKeys: {
      payslips: { list: key("payslips", "list"), detail: key("payslips", "detail") },
      mePayslips: {
        allOf: () => ["payroll", "me-payslips"],
        list: key("me-payslips", "list"),
        detail: key("me-payslips", "detail"),
      },
      pickers: { people: key("pickers", "people") },
    },
  };
});

import { payrollApi } from "@mediaos/web-core";
import { PayslipDetailPage } from "./PayslipDetailPage";
import { MePayslipsPage } from "./MePayslipsPage";
import { PeriodPayslipsSection } from "./components/PeriodPayslipsSection";
import { nextPollDelay } from "./components/PayslipPdfBatchControl";
import { openSignedUrlInNewTab } from "./open-signed-url";

const api = payrollApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
}

const PAYSLIP_ID = "33333333-3333-3333-3333-333333333333";
const PERIOD_ID = "44444444-4444-4444-4444-444444444444";
const SIGNED = "https://files.example.test/signed?x=1";

const payslip = {
  id: PAYSLIP_ID,
  userId: "55555555-5555-5555-5555-555555555555",
  payrollPeriodId: PERIOD_ID,
  status: "Published",
  net: 1000,
  gross: 1200,
  acknowledgedAt: null,
  items: [],
} as unknown as PayslipDetailDto;

const PEOPLE = { byUserId: new Map(), isLoading: false, canResolve: false };

/** Tab giả do `window.open` trả về — ghi lại URL được gán. */
function fakeTab() {
  const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  return { tab, open };
}

beforeEach(() => {
  vi.clearAllMocks();
  granted.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("083 — PDF phiếu người khác (PayslipDetailPage)", () => {
  beforeEach(() => api.getPayslip!.mockResolvedValue(payslip));

  it("[deny] có view-payslip nhưng THIẾU export:payroll ⇒ không có nút, không gọi 083", async () => {
    allow(VIEW_PAYSLIP);
    wrap(<PayslipDetailPage payslipId={PAYSLIP_ID} onBack={vi.fn()} />);
    await waitFor(() => expect(api.getPayslip).toHaveBeenCalled());
    await screen.findAllByText("Đã phát hành");
    expect(screen.queryByRole("button", { name: /Tải PDF/ })).toBeNull();
    expect(api.getPayslipPdf).not.toHaveBeenCalled();
  });

  it("[allow] giữ CẢ HAI cặp ⇒ nút mở tab NGAY trong click, gán signed-URL, cắt opener", async () => {
    allow(VIEW_PAYSLIP, EXPORT);
    api.getPayslipPdf!.mockResolvedValue({
      fileId: "f",
      fileName: "a.pdf",
      url: SIGNED,
      expiresAt: "x",
    });
    const { tab, open } = fakeTab();
    wrap(<PayslipDetailPage payslipId={PAYSLIP_ID} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Tải PDF/ }));
    expect(open).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(tab.location.href).toBe(SIGNED));
    expect(tab.opener).toBeNull();
    expect(api.getPayslipPdf).toHaveBeenCalledWith(PAYSLIP_ID);
  });

  it("lỗi 083 ⇒ đóng tab trắng + báo lỗi, không để tab rỗng treo", async () => {
    allow(VIEW_PAYSLIP, EXPORT);
    api.getPayslipPdf!.mockRejectedValue(new Error("boom"));
    const { tab } = fakeTab();
    wrap(<PayslipDetailPage payslipId={PAYSLIP_ID} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Tải PDF/ }));
    await screen.findByRole("alert");
    expect(tab.close).toHaveBeenCalled();
  });
});

describe("084 — PDF phiếu của tôi (MePayslipsPage)", () => {
  it("Own: KHÔNG cần cặp nào ⇒ nút có sau khi chọn phiếu, gọi 084 (không gọi 083)", async () => {
    allow();
    api.listMyPayslips!.mockResolvedValue({
      data: [payslip as unknown as PayslipDto],
      pagination: { total: 1, page: 1, perPage: 20 },
    });
    api.getMyPayslip!.mockResolvedValue(payslip);
    api.getMyPayslipPdf!.mockResolvedValue({
      fileId: "f",
      fileName: "a.pdf",
      url: SIGNED,
      expiresAt: "x",
    });
    const { tab } = fakeTab();
    wrap(<MePayslipsPage />);
    expect(screen.queryByRole("button", { name: /Tải PDF/ })).toBeNull();
    fireEvent.click(await screen.findByText("1.000 ₫"));
    fireEvent.click(await screen.findByRole("button", { name: /Tải PDF/ }));
    await waitFor(() => expect(tab.location.href).toBe(SIGNED));
    expect(api.getMyPayslipPdf).toHaveBeenCalledWith(PAYSLIP_ID);
    expect(api.getPayslipPdf).not.toHaveBeenCalled();
  });
});

const batch = (over: Partial<PayslipPdfBatchDto>): PayslipPdfBatchDto => ({
  fileId: "66666666-6666-6666-6666-666666666666",
  periodId: PERIOD_ID,
  status: "Pending",
  payslipCount: 12,
  fileName: "phieu.zip",
  createdAt: "2026-09-17T00:00:00.000Z",
  fileExpiresAt: "2026-09-18T00:00:00.000Z",
  ...over,
});

describe("085 — PDF hàng loạt (PeriodPayslipsSection)", () => {
  beforeEach(() => {
    api.listPayslips!.mockResolvedValue({
      data: [payslip as unknown as PayslipDto],
      pagination: { total: 1, page: 1, perPage: 20 },
    });
  });

  it("[deny] có view-payslip nhưng THIẾU export:payroll ⇒ không có nút lô, không gọi 085", async () => {
    allow(VIEW_PAYSLIP);
    wrap(<PeriodPayslipsSection periodId={PERIOD_ID} people={PEOPLE} onOpenPayslip={vi.fn()} />);
    await screen.findByText("1.000 ₫");
    expect(screen.queryByTestId("payslip-pdf-batch")).toBeNull();
    expect(api.requestPayslipPdfBatch).not.toHaveBeenCalled();
  });

  it("[allow] bấm ⇒ Pending ⇒ hỏi lại (không gửi retry) ⇒ Uploaded ⇒ «Tải tệp ZIP» xin URL MỚI", async () => {
    allow(VIEW_PAYSLIP, EXPORT);
    api
      .requestPayslipPdfBatch!.mockResolvedValueOnce(batch({ status: "Pending" }))
      .mockResolvedValueOnce(batch({ status: "Uploaded", url: SIGNED, expiresAt: "y" }))
      .mockResolvedValueOnce(batch({ status: "Uploaded", url: `${SIGNED}&fresh`, expiresAt: "z" }));
    wrap(<PeriodPayslipsSection periodId={PERIOD_ID} people={PEOPLE} onOpenPayslip={vi.fn()} />);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(await screen.findByRole("button", { name: "Xuất PDF hàng loạt" }));
    await screen.findByRole("status");
    expect(api.requestPayslipPdfBatch).toHaveBeenNthCalledWith(1, PERIOD_ID, {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(nextPollDelay(0));
    });
    const dl = await screen.findByRole("button", { name: "Tải tệp ZIP" });
    expect(api.requestPayslipPdfBatch).toHaveBeenNthCalledWith(2, PERIOD_ID);

    const { tab } = fakeTab();
    fireEvent.click(dl);
    await waitFor(() => expect(tab.location.href).toBe(`${SIGNED}&fresh`));
    expect(api.requestPayslipPdfBatch).toHaveBeenCalledTimes(3);
  });

  it("Failed ⇒ lý do theo mã + «Tạo lại» gửi retry:true ĐÚNG một lần", async () => {
    allow(VIEW_PAYSLIP, EXPORT);
    api
      .requestPayslipPdfBatch!.mockResolvedValueOnce(
        batch({ status: "Failed", failure: "timeout" }),
      )
      .mockResolvedValueOnce(batch({ status: "Uploaded", url: SIGNED }));
    wrap(<PeriodPayslipsSection periodId={PERIOD_ID} people={PEOPLE} onOpenPayslip={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Xuất PDF hàng loạt" }));
    await screen.findByText("Tạo tệp quá thời gian cho phép.");
    fireEvent.click(screen.getByRole("button", { name: "Tạo lại" }));
    await screen.findByRole("button", { name: "Tải tệp ZIP" });
    expect(api.requestPayslipPdfBatch).toHaveBeenNthCalledWith(2, PERIOD_ID, { retry: true });
  });

  it("nhịp hỏi lại giãn dần và có trần", () => {
    expect(nextPollDelay(0)).toBe(3_000);
    expect(nextPollDelay(1)).toBe(4_500);
    expect(nextPollDelay(20)).toBe(15_000);
  });
});

describe("openSignedUrlInNewTab", () => {
  it("chưa có URL ⇒ đóng tab trắng, trả false", async () => {
    const { tab } = fakeTab();
    await expect(openSignedUrlInNewTab(async () => null)).resolves.toBe(false);
    expect(tab.close).toHaveBeenCalled();
  });

  it("popup bị chặn ⇒ điều hướng chính tab (vẫn nhận được tệp)", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ assign } as unknown as Location);
    await expect(openSignedUrlInNewTab(async () => SIGNED)).resolves.toBe(true);
    expect(assign).toHaveBeenCalledWith(SIGNED);
  });

  it("lỗi ⇒ đóng tab + ném lại cho caller", async () => {
    const { tab } = fakeTab();
    await expect(
      openSignedUrlInNewTab(async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(tab.close).toHaveBeenCalled();
  });
});
