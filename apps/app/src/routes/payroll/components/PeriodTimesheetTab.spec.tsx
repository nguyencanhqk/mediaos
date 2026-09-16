// @vitest-environment jsdom
/**
 * PAY-SCREEN-008 — tab bảng công: (1) thiếu `view-line` ⇒ KHÔNG gọi 043 + câu «không có quyền» (gate
 * bằng `useCanExact` — ca `useCan=true` vẫn phải đóng); (2) có cặp ⇒ gọi ĐÚNG 043 và cột số ngày
 * `tabular-nums`; (3) pill khoá kỳ công: chưa gắn / khoá / mở / không rõ — «không rõ» khi thiếu cặp
 * picker 035, KHÔNG đoán `open`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { PayrollPeriodDto } from "@mediaos/contracts";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  useCanExact: vi.fn(() => false),
  // `payroll-format.ts` gọi hai hàm này — bản thật của web-core dùng Intl vi-VN, mock giữ cùng hành vi
  // để assert «20,5» (thập phân nửa ngày) đúng như runtime.
  formatNumber: (v: number, o?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("vi-VN", o).format(v),
  formatCurrency: (v: number) => `${new Intl.NumberFormat("vi-VN").format(v)} ₫`,
  payrollApi: {
    getPeriodTimesheet: vi.fn(),
    pickerAttendancePeriods: vi.fn(async () => []),
  },
  payrollKeys: {
    periods: { timesheet: (id: string, p: unknown) => ["payroll", "periods", "timesheet", id, p] },
    pickers: { attendancePeriods: (p: unknown) => ["payroll", "pickers", "attendance-periods", p] },
  },
}));

import { payrollApi, useCan, useCanExact } from "@mediaos/web-core";
import { PeriodTimesheetTab } from "./PeriodTimesheetTab";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockTimesheet = payrollApi.getPeriodTimesheet as ReturnType<typeof vi.fn>;
const mockAttPicker = payrollApi.pickerAttendancePeriods as ReturnType<typeof vi.fn>;

const ATT_ID = "aaaaaaaa-1111-1111-1111-111111111111";

const period = (over: Partial<PayrollPeriodDto> = {}): PayrollPeriodDto => ({
  id: "bbbbbbbb-2222-2222-2222-222222222222",
  companyId: "cccccccc-3333-3333-3333-333333333333",
  periodMonth: "2026-09",
  status: "CollectingData",
  payDate: null,
  attendancePeriodId: ATT_ID,
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
  ...over,
});

const ROW = {
  userId: "11111111-2222-3333-4444-555555555555",
  employeeCode: "NV001",
  fullName: "Nguyễn Văn A",
  workDays: 22,
  presentDays: 20.5,
  paidLeaveDays: 1,
  unpaidLeaveDays: 0.5,
  lateMinutes: 15,
};

const people = { byUserId: new Map<string, string>(), isLoading: false, canResolve: false };

function renderTab(p: PayrollPeriodDto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <PeriodTimesheetTab period={p} people={people} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(false);
  mockUseCanExact.mockReturnValue(false);
  mockTimesheet.mockResolvedValue({ data: [ROW], pagination: { total: 1, page: 1, perPage: 20 } });
  mockAttPicker.mockResolvedValue([{ id: ATT_ID, periodMonth: "2026-09", status: "locked" }]);
});

describe("PeriodTimesheetTab — gate view-line", () => {
  it("[deny] thiếu cặp ⇒ không gọi 043, hiện câu không có quyền — kể cả khi useCan=true", async () => {
    mockUseCan.mockReturnValue(true);
    renderTab(period());
    expect(await screen.findByText("Bạn không có quyền xem bảng công của kỳ.")).toBeTruthy();
    expect(mockTimesheet).not.toHaveBeenCalled();
    expect(mockAttPicker).not.toHaveBeenCalled();
  });

  it("[allow] có cặp ⇒ gọi 043 với đúng periodId, bảng có số ngày thập phân nửa ngày, ô tabular-nums", async () => {
    mockUseCanExact.mockReturnValue(true);
    renderTab(period());
    await screen.findByText("Nguyễn Văn A");
    expect(mockTimesheet).toHaveBeenCalledWith(
      "bbbbbbbb-2222-2222-2222-222222222222",
      expect.objectContaining({ page: 1 }),
    );
    const cell = screen.getByText("20,5");
    expect(cell.className).toContain("tabular-nums");
    // KHÔNG số tiền: không có ký hiệu ₫ nào trong bảng.
    expect(document.body.textContent).not.toContain("₫");
  });
});

describe("PeriodTimesheetTab — pill khoá kỳ công", () => {
  it("chưa gắn kỳ công ⇒ «Chưa gắn kỳ công», không gọi picker", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockUseCan.mockReturnValue(true);
    renderTab(period({ attendancePeriodId: null }));
    expect(await screen.findByText("Chưa gắn kỳ công")).toBeTruthy();
    expect(mockAttPicker).not.toHaveBeenCalled();
  });

  it("có cặp picker và kỳ công `locked` ⇒ «Kỳ công đã khoá»", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockUseCan.mockReturnValue(true);
    renderTab(period());
    expect(await screen.findByText("Kỳ công đã khoá")).toBeTruthy();
  });

  it("kỳ công `open` ⇒ «Kỳ công đang mở»", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockUseCan.mockReturnValue(true);
    mockAttPicker.mockResolvedValue([{ id: ATT_ID, periodMonth: "2026-09", status: "open" }]);
    renderTab(period());
    expect(await screen.findByText("Kỳ công đang mở")).toBeTruthy();
  });

  it("thiếu cặp picker 035 ⇒ «không rõ trạng thái» (không đoán), không gọi picker", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockUseCan.mockReturnValue(false);
    renderTab(period());
    expect(await screen.findByText("Kỳ công: không rõ trạng thái")).toBeTruthy();
    await waitFor(() => expect(mockTimesheet).toHaveBeenCalled());
    expect(mockAttPicker).not.toHaveBeenCalled();
  });
});
