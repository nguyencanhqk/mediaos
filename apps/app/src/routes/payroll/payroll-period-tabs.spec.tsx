// @vitest-environment jsdom
/**
 * [deny-path] PAY-SCREEN-002/008 — dải tab «Bảng lương / Bảng công» của chi tiết kỳ: **mở tab «Bảng công»
 * (hoặc deep-link `/timesheet`) KHÔNG được kéo 008 `lines`** — route nhạy cảm CÓ audit lượt đọc (SPEC-11
 * §15 hàng 008). Bản đầu để `enabled: canViewLines` không xét `tab` ⇒ mỗi lượt xem bảng công là một hàng
 * audit «đã xem tiền» giả (code-review S15-PAYROLL-FE-1, HIGH). Ca ALLOW (tab lines ⇒ gọi 008, KHÔNG gọi
 * 043) đặt cạnh để ca DENY không xanh-rỗng.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { PayrollPeriodDto } from "@mediaos/contracts";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => true),
  useCanExact: vi.fn(() => true),
  useAuthStore: vi.fn(() => "user-self"),
  payrollIdempotencyKey: vi.fn(() => "idem-key"),
  formatNumber: (v: number, o?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("vi-VN", o).format(v),
  formatCurrency: (v: number) => `${new Intl.NumberFormat("vi-VN").format(v)} ₫`,
  payrollApi: {
    getPeriod: vi.fn(),
    listLines: vi.fn(async () => ({ data: [], pagination: { total: 0, page: 1, perPage: 20 } })),
    getReadiness: vi.fn(async () => ({ eligibleCount: 0, warnings: [] })),
    getPeriodTimesheet: vi.fn(async () => ({
      data: [],
      pagination: { total: 0, page: 1, perPage: 20 },
    })),
    pickerAttendancePeriods: vi.fn(async () => []),
    pickerPeople: vi.fn(async () => []),
    listPayslips: vi.fn(async () => ({ data: [], pagination: undefined })),
  },
  payrollKeys: {
    periods: {
      allOf: () => ["payroll", "periods"],
      detail: (id: string) => ["payroll", "periods", "detail", id],
      readiness: (id: string) => ["payroll", "periods", "readiness", id],
      lines: (id: string, p: unknown) => ["payroll", "periods", "lines", id, p],
      linesOf: (id: string) => ["payroll", "periods", "lines", id],
      timesheet: (id: string, p: unknown) => ["payroll", "periods", "timesheet", id, p],
    },
    payslips: { list: (p: unknown) => ["payroll", "payslips", "list", p] },
    pickers: {
      people: (p: unknown) => ["payroll", "pickers", "people", p],
      attendancePeriods: (p: unknown) => ["payroll", "pickers", "attendance-periods", p],
    },
  },
}));

import { payrollApi } from "@mediaos/web-core";
import { PayrollPeriodDetailPage } from "./PayrollPeriodDetailPage";
import type { PayrollPeriodTab } from "./constants";

const mockGetPeriod = payrollApi.getPeriod as ReturnType<typeof vi.fn>;
const mockListLines = payrollApi.listLines as ReturnType<typeof vi.fn>;
const mockTimesheet = payrollApi.getPeriodTimesheet as ReturnType<typeof vi.fn>;

const PERIOD_ID = "bbbbbbbb-2222-2222-2222-222222222222";

const PERIOD: PayrollPeriodDto = {
  id: PERIOD_ID,
  companyId: "cccccccc-3333-3333-3333-333333333333",
  periodMonth: "2026-09",
  status: "CollectingData",
  payDate: null,
  attendancePeriodId: null,
  templateId: null,
  note: null,
  reopenReason: null,
  createdBy: null,
  updatedBy: null,
  calculatedBy: null,
  calculatedAt: null,
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
  publishedBy: null,
  publishedAt: null,
  paidBy: null,
  paidAt: null,
  legacyPaidTrail: false,
  lockedBy: null,
  lockedAt: null,
  payslipsGeneratedBy: null,
  payslipsGeneratedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function renderPage(tab: PayrollPeriodTab) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <PayrollPeriodDetailPage
          periodId={PERIOD_ID}
          tab={tab}
          onTabChange={() => {}}
          onBack={() => {}}
          onOpenPayslip={() => {}}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPeriod.mockResolvedValue(PERIOD);
});

describe("PAY-SCREEN-002 — dải tab «Bảng lương / Bảng công»", () => {
  it("[deny] tab «Bảng công» ⇒ gọi 043, KHÔNG gọi 008 lines (không đẻ audit «xem tiền» giả)", async () => {
    renderPage("timesheet");
    await screen.findByTestId("period-timesheet-tab");
    await waitFor(() => expect(mockTimesheet).toHaveBeenCalledTimes(1));
    expect(mockListLines).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Bảng công" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("[allow đối chứng] tab «Bảng lương» ⇒ gọi 008 lines, KHÔNG gọi 043", async () => {
    renderPage("lines");
    // 008 được gọi NGAY khi mount (không chờ 003) — chờ dải tab xuất hiện (kỳ đã tải) rồi mới assert.
    const linesTab = await screen.findByRole("tab", { name: "Bảng lương" });
    await waitFor(() => expect(mockListLines).toHaveBeenCalledTimes(1));
    expect(mockTimesheet).not.toHaveBeenCalled();
    expect(screen.queryByTestId("period-timesheet-tab")).toBeNull();
    expect(linesTab.getAttribute("aria-selected")).toBe("true");
  });
});
