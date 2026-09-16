// @vitest-environment jsdom
/**
 * [deny-path] PAY-SCREEN-007 chi tiết nhân sự — **tab thiếu cặp thì ẨN TAB** (SPEC-11 §9.1, UI-07 §21.8
 * lưu ý 4), và gate bằng `useCanExact` chứ không phải `useCan`.
 *
 * ── VÌ SAO MOCK HAI HOOK TRẢ GIÁ TRỊ NGƯỢC NHAU ─────────────────────────────────────────────────
 * Cả 5 tab gác bằng cặp SENSITIVE. `useCan` cho wildcard `*:*` qua, còn BE KHÔNG kế thừa cặp sensitive
 * qua wildcard ⇒ page dùng nhầm `useCan` là hiện tab cho vai server chắc chắn 403 (memory
 * `sensitive-pair-widget-needs-usecanexact`). Mock cả hai cùng `true` thì đảo nhầm hook vẫn xanh
 * (`same-builder-twice-makes-unit-spec-vacuous`) — nên ca cuối cho `useCan=true`/`useCanExact=false`
 * và đòi KHÔNG tab nào + KHÔNG gọi 037.
 *
 * Ca ALLOW (đủ cặp ⇒ 5 tab) đặt cạnh để ca DENY không xanh-rỗng vì page không render gì.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCan: vi.fn(() => false),
  useCanExact: vi.fn(() => false),
  useAuthStore: vi.fn(() => "user-self"),
  payrollIdempotencyKey: vi.fn(() => "idem-key"),
  formatNumber: (v: number, o?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat("vi-VN", o).format(v),
  formatCurrency: (v: number) => `${new Intl.NumberFormat("vi-VN").format(v)} ₫`,
  payrollApi: {
    getEmployee: vi.fn(),
    getEmployeeSettings: vi.fn(),
    listDependents: vi.fn(async () => []),
    listSalaryProfiles: vi.fn(async () => ({ data: [], pagination: undefined })),
    getSalaryProfile: vi.fn(),
    pickerPeople: vi.fn(async () => []),
    listSalaryComponents: vi.fn(async () => ({ data: [], pagination: undefined })),
    createSalaryProfile: vi.fn(),
    putEmployeeSettings: vi.fn(),
    createDependent: vi.fn(),
    updateDependent: vi.fn(),
  },
  payrollKeys: {
    employees: {
      allOf: () => ["payroll", "employees"],
      detail: (id: string) => ["payroll", "employees", "detail", id],
      settings: (id: string) => ["payroll", "employees", "settings", id],
      dependents: (id: string) => ["payroll", "employees", "dependents", id],
    },
    salaryProfiles: {
      allOf: () => ["payroll", "salary-profiles"],
      list: (p: unknown) => ["payroll", "salary-profiles", "list", p],
      detail: (id: string) => ["payroll", "salary-profiles", "detail", id],
    },
    pickers: { people: (p: unknown) => ["payroll", "pickers", "people", p] },
    catalog: { components: (p: unknown) => ["payroll", "catalog", "components", p] },
  },
}));

import { payrollApi, useCan, useCanExact } from "@mediaos/web-core";
import { PayrollEmployeeDetailPage } from "./PayrollEmployeeDetailPage";

const mockUseCan = useCan as ReturnType<typeof vi.fn>;
const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockGetEmployee = payrollApi.getEmployee as ReturnType<typeof vi.fn>;
const mockGetSettings = payrollApi.getEmployeeSettings as ReturnType<typeof vi.fn>;

// Không chứa ≥8 chữ số liên tiếp — ca «không có chuỗi số dài trong DOM» bên dưới dò cả body.
const USER = "1a1a1a1a-2b2b-3c3c-4d4d-5e5e5e5e5e5e";

const EMPLOYEE = {
  userId: USER,
  employeeCode: "NV001",
  fullName: "Nguyễn Văn A",
  orgUnitName: "Kế toán",
  positionName: "Kế toán viên",
  employeeStatus: "active",
  hasSalaryProfile: true,
  startDate: "2024-03-01",
};

const TAB_LABELS = {
  general: "Thông tin chung",
  salaryHistory: "Lịch sử lương",
  insurance: "Bảo hiểm – Công đoàn",
  tax: "Thuế TNCN",
  dependents: "Gia đình",
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <PayrollEmployeeDetailPage userId={USER} onBack={() => {}} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const tabLabels = () => screen.queryAllByRole("tab").map((el) => el.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCan.mockReturnValue(false);
  mockUseCanExact.mockReturnValue(false);
  mockGetEmployee.mockResolvedValue({ ...EMPLOYEE, taxCode: "8001234567" });
  mockGetSettings.mockResolvedValue({
    userId: USER,
    joinsSocialInsurance: true,
    // Có chữ để không trùng khuôn «≥8 chữ số liên tiếp» mà ca số TK đang dò.
    socialInsuranceNo: "BH-0123",
    joinsUnion: false,
    bankAccountLast4: "6789",
    bankName: "VCB",
    bankBranch: null,
    accountHolder: "NGUYEN VAN A",
  });
});

describe("PAY-SCREEN-007 — tab gác theo cặp riêng", () => {
  it("[allow] đủ cả hai cặp ⇒ 5 tab, đúng thứ tự SPEC-11 §9.1", async () => {
    mockUseCanExact.mockReturnValue(true);
    renderPage();
    await screen.findAllByText("Nguyễn Văn A");
    expect(tabLabels()).toEqual([
      TAB_LABELS.general,
      TAB_LABELS.salaryHistory,
      TAB_LABELS.insurance,
      TAB_LABELS.tax,
      TAB_LABELS.dependents,
    ]);
  });

  it("[deny] chỉ `view:payroll-employee` ⇒ ẩn «Lịch sử lương» và «Thuế TNCN» (tab đòi CẢ HAI cặp), còn 3", async () => {
    mockUseCanExact.mockImplementation(
      (_action: string, resourceType: string) => resourceType === "payroll-employee",
    );
    renderPage();
    await screen.findAllByText("Nguyễn Văn A");
    expect(tabLabels()).toEqual([TAB_LABELS.general, TAB_LABELS.insurance, TAB_LABELS.dependents]);
    expect(screen.queryByText(TAB_LABELS.salaryHistory)).toBeNull();
    expect(screen.queryByText(TAB_LABELS.tax)).toBeNull();
  });

  it("[deny] chỉ `view:salary-profile` ⇒ không mở được trang (không tab, không gọi 037)", async () => {
    mockUseCanExact.mockImplementation(
      (_action: string, resourceType: string) => resourceType === "salary-profile",
    );
    renderPage();
    expect(await screen.findByText("Bạn không có quyền xem nhân viên hưởng lương.")).toBeTruthy();
    expect(tabLabels()).toEqual([]);
    expect(mockGetEmployee).not.toHaveBeenCalled();
  });

  it("[deny hook] `useCan=true` mà `useCanExact=false` ⇒ KHÔNG tab nào, KHÔNG gọi 037 (đảo hook là đỏ)", async () => {
    mockUseCan.mockReturnValue(true);
    mockUseCanExact.mockReturnValue(false);
    renderPage();
    expect(await screen.findByText("Bạn không có quyền xem nhân viên hưởng lương.")).toBeTruthy();
    expect(tabLabels()).toEqual([]);
    expect(mockGetEmployee).not.toHaveBeenCalled();
  });
});

describe("PAY-SCREEN-007 — tab «Bảo hiểm – Công đoàn» chỉ hiện 4 số cuối", () => {
  it("hiện «•••• 6789», không có chuỗi số dài nào trong DOM; tab khác KHÔNG tải khi chưa bấm", async () => {
    mockUseCanExact.mockReturnValue(true);
    renderPage();
    await screen.findAllByText("Nguyễn Văn A");
    expect(mockGetSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS.insurance }));
    await waitFor(() => expect(screen.getByTestId("bank-account-masked")).toBeTruthy());
    expect(screen.getByTestId("bank-account-masked").textContent).toBe("•••• 6789");
    expect(document.body.textContent).not.toMatch(/\d{8,}/);
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
  });
});

describe("PAY-SCREEN-007 — tab «Thuế TNCN»", () => {
  it("`taxCode` VẮNG KHOÁ ⇒ câu «không có quyền xem», không phải ô trống", async () => {
    mockUseCanExact.mockReturnValue(true);
    mockGetEmployee.mockResolvedValue({ ...EMPLOYEE });
    renderPage();
    await screen.findAllByText("Nguyễn Văn A");
    fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS.tax }));
    expect(await screen.findByText("Bạn không có quyền xem mã số thuế.")).toBeTruthy();
    expect(screen.queryByTestId("tax-code")).toBeNull();
  });

  it("[allow đối chứng] có khoá ⇒ hiện mã số thuế", async () => {
    mockUseCanExact.mockReturnValue(true);
    renderPage();
    await screen.findAllByText("Nguyễn Văn A");
    fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS.tax }));
    expect((await screen.findByTestId("tax-code")).textContent).toBe("8001234567");
  });
});
