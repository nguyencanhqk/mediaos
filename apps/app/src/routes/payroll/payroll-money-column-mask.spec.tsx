// @vitest-environment jsdom
/**
 * [deny-path] Cột TIỀN bị server mask phải VẮNG khỏi ⚙ «Chọn cột» — kể cả khi trang RỖNG.
 *
 * UI-07 §10.4 mục 10 (S15-UI-SHELL-1): liệt kê tên trường tiền cho đúng vai KHÔNG được đọc trường
 * đó là biến picker thành bảng chỉ mục PII. Ô tiền vẫn render `—` (`formatPayrollMoney`) nên đây
 * là rò **NHÃN CỘT**, không rò **giá trị** — vì thế nó MEDIUM, không HIGH.
 *
 * ── VÌ SAO CA NÀY TỒN TẠI ────────────────────────────────────────────────────────────────────────
 * Phép đo mask lấy mẫu từ hàng ĐANG TẢI (`rows.every(... === undefined)`). Bản đầu của
 * S15-UI-SHELL-1 viết `rows.length > 0 && …` ⇒ trang rỗng cho ra `false` = "KHÔNG mask" ⇒ nhãn
 * trường tiền hiện lại với đúng vai bị mask, chỉ cần lọc một bộ lọc không khớp gì. Bản vá đổi sang
 * fail-CLOSED (`rows.length === 0 ||`) nhưng vào PR #504 khi CHƯA CÓ CA NEO: WO sau đổi ngược lại
 * là lỗ mở lại mà không ai đỏ (`tests-can-pin-a-hole-open` nhìn từ chiều ngược).
 *
 * ── CHỐNG XANH-RỖNG ─────────────────────────────────────────────────────────────────────────────
 * Mỗi màn có ca ALLOW (hàng CÓ tiền ⇒ nhãn tiền PHẢI hiện) đặt cạnh hai ca DENY. Không có ca ALLOW
 * thì "nhãn vắng" có thể chỉ vì picker không render gì — ca DENY xanh mà chẳng chứng minh điều gì
 * (`deny-cases-vacuous-without-allow-case`). Mọi assert scope TRONG `role="dialog"` của Popover để
 * không ăn nhầm chữ giống nhau ở chỗ khác trên trang.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";

vi.mock("@mediaos/web-core", () => ({
  useCanExact: vi.fn(() => false),
  useAuthStore: vi.fn(() => "user-self"),
  payrollIdempotencyKey: vi.fn(() => "idem-key"),
  payrollApi: {
    listSalaryProfiles: vi.fn(),
    listBonusPenalties: vi.fn(),
    pickerPeople: vi.fn(async () => []),
    createSalaryProfile: vi.fn(),
    createBonusPenalty: vi.fn(),
    approveBonusPenalty: vi.fn(),
    rejectBonusPenalty: vi.fn(),
  },
  payrollKeys: {
    salaryProfiles: { list: (p: unknown) => ["payroll", "salary-profiles", p] },
    bonusPenalties: {
      list: (p: unknown) => ["payroll", "bonus-penalties", p],
      allOf: () => ["payroll", "bonus-penalties"],
    },
    pickers: { people: (p: unknown) => ["payroll", "pickers", "people", p] },
  },
}));

// DataTable bị thay: header bảng dùng ĐÚNG những nhãn ta đang đo ("Lương cơ bản", "Số tiền"…) nên
// để nguyên là mọi assert đều có thể ăn header thay vì nội dung picker.
vi.mock("@mediaos/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/ui")>();
  return {
    ...actual,
    DataTable: ({ data }: { data: unknown[] }) => (
      <div data-testid="data-table" data-rows={data.length} />
    ),
  };
});

import { payrollApi, useCanExact } from "@mediaos/web-core";
import { SalaryProfileListPage } from "./SalaryProfileListPage";
import { BonusPenaltyListPage } from "./BonusPenaltyListPage";

const mockUseCanExact = useCanExact as ReturnType<typeof vi.fn>;
const mockListSalaryProfiles = payrollApi.listSalaryProfiles as ReturnType<typeof vi.fn>;
const mockListBonusPenalties = payrollApi.listBonusPenalties as ReturnType<typeof vi.fn>;

/** Chỉ cấp cặp ĐỌC; cặp manage/approve = false ⇒ không dialog, không nút quyết định chen vào DOM. */
function grantReadOnly() {
  mockUseCanExact.mockImplementation((action: string) => action === "view");
}

function renderPage(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Mở ⚙ và trả về phạm vi NỘI DUNG popover — assert ngoài phạm vi này là assert sai chỗ. */
async function openColumnPicker() {
  const trigger = await screen.findByTestId("column-picker-trigger");
  fireEvent.click(trigger);
  return within(await screen.findByRole("dialog"));
}

const SALARY_ROW = {
  id: "sp-1",
  userId: "11111111-2222-3333-4444-555555555555",
  effectiveDate: "2026-09-01",
  note: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const BONUS_ROW = {
  id: "bp-1",
  userId: "11111111-2222-3333-4444-555555555555",
  kind: "Bonus" as const,
  periodMonth: "2026-09",
  reason: "Thưởng dự án",
  status: "Pending" as const,
  payrollPeriodId: null,
  createdBy: "user-other",
  decidedBy: null,
  decisionNote: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const page = <T,>(data: T[]) => ({
  data,
  pagination: { total: data.length, page: 1, perPage: 20 },
});

beforeEach(() => {
  vi.clearAllMocks();
  // useColumnVisibility persist per-user/per-table; bộ cột ẩn sót lại đổi TICK, không đổi DANH SÁCH
  // option — vẫn dọn để ca sau không đọc trạng thái ca trước.
  localStorage.clear();
  grantReadOnly();
});

describe("PAY-SCREEN-004 hồ sơ lương — nhãn cột tiền trong ⚙", () => {
  it("ALLOW: hàng CÓ baseSalary ⇒ «Lương cơ bản» + «Phụ cấp» hiện trong ⚙", async () => {
    mockListSalaryProfiles.mockResolvedValue(
      page([
        {
          ...SALARY_ROW,
          baseSalary: "20000000",
          allowances: [{ name: "Ăn trưa", amount: "500000" }],
        },
      ]),
    );
    renderPage(<SalaryProfileListPage />);
    await waitFor(() => expect(screen.getByTestId("data-table")).toHaveAttribute("data-rows", "1"));

    const picker = await openColumnPicker();
    expect(picker.getByText("Lương cơ bản")).toBeInTheDocument();
    expect(picker.getByText("Phụ cấp")).toBeInTheDocument();
  });

  it("DENY mask: hàng VẮNG khoá baseSalary ⇒ hai nhãn tiền vắng khỏi ⚙", async () => {
    mockListSalaryProfiles.mockResolvedValue(page([SALARY_ROW]));
    renderPage(<SalaryProfileListPage />);
    await waitFor(() => expect(screen.getByTestId("data-table")).toHaveAttribute("data-rows", "1"));

    const picker = await openColumnPicker();
    expect(picker.getByText("Hiệu lực từ")).toBeInTheDocument(); // picker CÓ render — ca không rỗng
    expect(picker.queryByText("Lương cơ bản")).not.toBeInTheDocument();
    expect(picker.queryByText("Phụ cấp")).not.toBeInTheDocument();
  });

  it("DENY fail-CLOSED: trang RỖNG (lọc không khớp gì) ⇒ hai nhãn tiền VẪN vắng khỏi ⚙", async () => {
    mockListSalaryProfiles.mockResolvedValue(page([]));
    renderPage(<SalaryProfileListPage />);
    await waitFor(() => expect(mockListSalaryProfiles).toHaveBeenCalled());

    const picker = await openColumnPicker();
    expect(picker.getByText("Hiệu lực từ")).toBeInTheDocument();
    expect(picker.queryByText("Lương cơ bản")).not.toBeInTheDocument();
    expect(picker.queryByText("Phụ cấp")).not.toBeInTheDocument();
  });
});

describe("PAY-SCREEN-005 thưởng/phạt — nhãn cột tiền trong ⚙", () => {
  it("ALLOW: hàng CÓ amount ⇒ «Số tiền» hiện trong ⚙", async () => {
    mockListBonusPenalties.mockResolvedValue(page([{ ...BONUS_ROW, amount: "1500000" }]));
    renderPage(<BonusPenaltyListPage />);
    await waitFor(() => expect(screen.getByTestId("data-table")).toHaveAttribute("data-rows", "1"));

    const picker = await openColumnPicker();
    expect(picker.getByText("Số tiền")).toBeInTheDocument();
  });

  it("DENY mask: hàng VẮNG khoá amount ⇒ «Số tiền» vắng khỏi ⚙", async () => {
    mockListBonusPenalties.mockResolvedValue(page([BONUS_ROW]));
    renderPage(<BonusPenaltyListPage />);
    await waitFor(() => expect(screen.getByTestId("data-table")).toHaveAttribute("data-rows", "1"));

    const picker = await openColumnPicker();
    expect(picker.getByText("Lý do")).toBeInTheDocument(); // picker CÓ render — ca không rỗng
    expect(picker.queryByText("Số tiền")).not.toBeInTheDocument();
  });

  it("DENY fail-CLOSED: trang RỖNG ⇒ «Số tiền» VẪN vắng khỏi ⚙", async () => {
    mockListBonusPenalties.mockResolvedValue(page([]));
    renderPage(<BonusPenaltyListPage />);
    await waitFor(() => expect(mockListBonusPenalties).toHaveBeenCalled());

    const picker = await openColumnPicker();
    expect(picker.getByText("Lý do")).toBeInTheDocument();
    expect(picker.queryByText("Số tiền")).not.toBeInTheDocument();
  });
});
