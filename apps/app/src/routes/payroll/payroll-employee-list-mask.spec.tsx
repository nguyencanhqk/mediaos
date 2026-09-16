// @vitest-environment jsdom
/**
 * [deny-path] PAY-SCREEN-007 danh sách — cột `taxCode` (PII chiếu có điều kiện, SPEC-11 §18.1 A hàng 2)
 * theo ĐÚNG khuôn mask cột tiền của `payroll-money-column-mask.spec.tsx`: server mask = VẮNG KHOÁ ⇒ nhãn
 * «Mã số thuế» phải vắng khỏi ⚙ «Chọn cột», và **trang RỖNG coi như mask** (fail-closed).
 *
 * Ca ALLOW đặt cạnh hai ca DENY để «nhãn vắng» không phải chỉ vì picker không render gì
 * (`deny-cases-vacuous-without-allow-case`). Assert scope TRONG `role="dialog"` của Popover; `DataTable`
 * bị thay vì header bảng dùng đúng nhãn đang đo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCanExact: vi.fn(() => true),
  orgApi: { getTree: vi.fn(async () => []) },
  payrollApi: { listEmployees: vi.fn() },
  payrollKeys: {
    employees: { list: (p: unknown) => ["payroll", "employees", "list", p] },
  },
}));

vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    DataTable: ({ data }: { data: unknown[] }) => (
      <div data-testid="data-table" data-rows={data.length} />
    ),
  };
});

import { payrollApi } from "@mediaos/web-core";
import { PayrollEmployeeListPage } from "./PayrollEmployeeListPage";

const mockList = payrollApi.listEmployees as ReturnType<typeof vi.fn>;

const ROW = {
  userId: "11111111-2222-3333-4444-555555555555",
  employeeCode: "NV001",
  fullName: "Nguyễn Văn A",
  orgUnitName: "Kế toán",
  positionName: null,
  employeeStatus: "active",
  hasSalaryProfile: true,
};

const page = <T,>(data: T[]) => ({
  data,
  pagination: { total: data.length, page: 1, perPage: 20 },
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <PayrollEmployeeListPage onOpenEmployee={() => {}} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

async function openColumnPicker() {
  fireEvent.click(await screen.findByTestId("column-picker-trigger"));
  return within(await screen.findByRole("dialog"));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("PAY-SCREEN-007 danh sách — nhãn «Mã số thuế» trong ⚙", () => {
  it("ALLOW: hàng CÓ khoá taxCode ⇒ «Mã số thuế» hiện trong ⚙", async () => {
    mockList.mockResolvedValue(page([{ ...ROW, taxCode: "8001234567" }]));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("data-table")).toHaveAttribute("data-rows", "1"));

    const picker = await openColumnPicker();
    expect(picker.getByText("Đơn vị")).toBeInTheDocument();
    expect(picker.getByText("Mã số thuế")).toBeInTheDocument();
  });

  it("DENY mask: hàng VẮNG khoá taxCode ⇒ «Mã số thuế» vắng khỏi ⚙", async () => {
    mockList.mockResolvedValue(page([ROW]));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("data-table")).toHaveAttribute("data-rows", "1"));

    const picker = await openColumnPicker();
    expect(picker.getByText("Đơn vị")).toBeInTheDocument(); // picker CÓ render — ca không rỗng
    expect(picker.queryByText("Mã số thuế")).not.toBeInTheDocument();
  });

  it("DENY fail-CLOSED: trang RỖNG ⇒ «Mã số thuế» VẪN vắng khỏi ⚙", async () => {
    mockList.mockResolvedValue(page([]));
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    const picker = await openColumnPicker();
    expect(picker.getByText("Đơn vị")).toBeInTheDocument();
    expect(picker.queryByText("Mã số thuế")).not.toBeInTheDocument();
  });
});
