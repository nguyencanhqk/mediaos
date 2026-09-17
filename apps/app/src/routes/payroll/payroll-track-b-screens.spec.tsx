// @vitest-environment jsdom
/**
 * [deny-path] S15-PAYROLL-FE-2 — màn track B (PAY-SCREEN-009/010/011) + khối mẫu của chi tiết kỳ + breakdown
 * phiếu theo thành phần. Cặp track B đều SENSITIVE ⇒ gate bằng `useCanExact`; mock trả theo TỪNG cặp.
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
  PayrollPeriodDto,
  PayslipDetailDto,
  SalaryComponentDto,
  StatutoryRateDto,
} from "@mediaos/contracts";

const granted = new Set<string>();
const allow = (...pairs: string[]) => {
  granted.clear();
  for (const p of pairs) granted.add(p);
};

vi.mock("@mediaos/web-core", () => {
  const key =
    (...parts: string[]) =>
    (x?: unknown) => ["payroll", ...parts, x];
  return {
    useCan: vi.fn((a: string, r: string) => granted.has(`${a}:${r}`)),
    useCanExact: vi.fn((a: string, r: string) => granted.has(`${a}:${r}`)),
    formatNumber: (v: number, o?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat("vi-VN", o).format(v),
    formatCurrency: (v: number) => `${new Intl.NumberFormat("vi-VN").format(v)} ₫`,
    parseKindError: () => ({
      code: null,
      status: null,
      kind: null,
      message: "",
      fields: new Map(),
    }),
    payrollApi: {
      listSalaryComponents: vi.fn(),
      getSalaryComponent: vi.fn(),
      validateFormula: vi.fn(),
      listPayrollTemplates: vi.fn(),
      getPayrollTemplate: vi.fn(),
      listStatutoryRates: vi.fn(),
      updatePeriod: vi.fn(),
    },
    payrollKeys: {
      catalog: {
        allOf: () => ["payroll", "catalog"],
        components: key("catalog", "components"),
        componentDetail: key("catalog", "component-detail"),
        templates: key("catalog", "templates"),
        templateDetail: key("catalog", "template-detail"),
        statutoryRates: key("catalog", "statutory-rates"),
      },
    },
  };
});

import { payrollApi } from "@mediaos/web-core";
import { SalaryComponentListPage } from "./SalaryComponentListPage";
import { PayrollTemplateListPage } from "./PayrollTemplateListPage";
import { StatutoryRateListPage } from "./StatutoryRateListPage";
import { PayrollTemplateDetailPage } from "./PayrollTemplateDetailPage";
import { FormulaEditor } from "./components/FormulaEditor";
import { PeriodTemplateBlock } from "./components/PeriodTemplateBlock";
import { PayslipBreakdown } from "./components/PayslipBreakdown";

const api = payrollApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

function wrap(
  node: ReactNode,
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
}

const page = <T,>(data: T[]) => ({
  data,
  pagination: { total: data.length, page: 1, perPage: 20 },
});

const component = (over: Partial<SalaryComponentDto>): SalaryComponentDto => ({
  id: "55555555-5555-4555-8555-555555555555",
  code: "PHU_CAP_XANG",
  name: "Phụ cấp xăng",
  kind: "earning",
  valueType: "fixed",
  formula: null,
  fixedAmount: 500000,
  pitDeductible: false,
  isSystem: false,
  isActive: true,
  sortOrder: 10,
  updatedAt: "2026-09-16T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  granted.clear();
  api.listSalaryComponents!.mockResolvedValue(page([]));
  api.listPayrollTemplates!.mockResolvedValue(page([]));
  api.listStatutoryRates!.mockResolvedValue(page([]));
  api.validateFormula!.mockResolvedValue({ valid: true, errors: [], refs: [], depth: 1, nodes: 1 });
});

describe("PAY-SCREEN-009 «Thành phần lương»", () => {
  it("[deny] thiếu view:salary-component ⇒ màn không quyền, 0 lượt gọi 044", async () => {
    allow("access:payroll");
    wrap(<SalaryComponentListPage />);
    expect(await screen.findByText(/không có quyền xem danh mục/i)).toBeTruthy();
    expect(api.listSalaryComponents).not.toHaveBeenCalled();
  });

  it("[allow] hàng hệ thống: có «Sửa», KHÔNG «Xoá»/«Ngưng»; hàng tự thêm: có cả hai", async () => {
    allow("view:salary-component", "manage:salary-component");
    api.listSalaryComponents!.mockResolvedValue(
      page([
        component({
          id: "66666666-6666-4666-8666-666666666666",
          code: "BHXH_NV",
          name: "BHXH NLĐ",
          isSystem: true,
        }),
        component({}),
      ]),
    );
    wrap(<SalaryComponentListPage />);
    const systemRow = (await screen.findByText("BHXH NLĐ")).closest("tr") as HTMLElement;
    const customRow = screen.getByText("Phụ cấp xăng").closest("tr") as HTMLElement;
    expect(within(systemRow).getByText("Hệ thống")).toBeTruthy();
    expect(within(systemRow).getByRole("button", { name: "Sửa" })).toBeTruthy();
    expect(within(systemRow).queryByRole("button", { name: "Xoá" })).toBeNull();
    expect(within(systemRow).queryByRole("button", { name: "Ngưng dùng" })).toBeNull();
    expect(within(customRow).getByRole("button", { name: "Xoá" })).toBeTruthy();
    expect(within(customRow).getByRole("button", { name: "Ngưng dùng" })).toBeTruthy();
  });

  it("[deny] chỉ có view ⇒ không nút ghi nào", async () => {
    allow("view:salary-component");
    api.listSalaryComponents!.mockResolvedValue(page([component({})]));
    wrap(<SalaryComponentListPage />);
    await screen.findByText("Phụ cấp xăng");
    expect(screen.queryByRole("button", { name: "Sửa" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Thêm thành phần/ })).toBeNull();
  });
});

describe("FormulaEditor — kiểm tại chỗ 048 gác cặp GHI", () => {
  it("[deny] canValidate=false ⇒ KHÔNG gọi 048 dù đã gõ; nói rõ lỗi hiện khi lưu", async () => {
    wrap(
      <FormulaEditor
        label="CT"
        value="SYS_BASE_SALARY"
        onChange={() => {}}
        knownCodes={[]}
        canValidate={false}
      />,
    );
    expect(await screen.findByText(/Không kiểm tra tại chỗ được/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 500));
    expect(api.validateFormula).not.toHaveBeenCalled();
  });

  it("[allow] canValidate=true ⇒ gọi 048 sau debounce, kèm context kind", async () => {
    wrap(
      <FormulaEditor
        label="CT"
        value="SYS_BASE_SALARY"
        onChange={() => {}}
        knownCodes={[]}
        canValidate
        context={{ kind: "earning" }}
      />,
    );
    await waitFor(() => expect(api.validateFormula).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(api.validateFormula).toHaveBeenCalledWith({
      formula: "SYS_BASE_SALARY",
      kind: "earning",
    });
    expect(await screen.findByText(/Công thức hợp lệ/)).toBeTruthy();
  });

  it("lỗi 048 hiện CÂU giải thích có vị trí (không «Có lỗi xảy ra»)", async () => {
    api.validateFormula!.mockResolvedValue({
      valid: false,
      errors: [
        {
          code: "PAYROLL-ERR-018",
          kind: "formula-unknown-ref",
          message: "",
          pos: 0,
          ref: "LUONG_X",
        },
      ],
      refs: [],
      depth: 0,
      nodes: 0,
    });
    wrap(
      <FormulaEditor label="CT" value="LUONG_X" onChange={() => {}} knownCodes={[]} canValidate />,
    );
    expect(await screen.findByText(/«LUONG_X».*ký tự thứ 1/, {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText(/Có lỗi xảy ra/)).toBeNull();
  });
});

describe("PAY-SCREEN-010 «Mẫu bảng lương» — danh sách", () => {
  it("[deny] thiếu view:payroll-template ⇒ 0 lượt gọi 049", async () => {
    allow("view:salary-component");
    wrap(<PayrollTemplateListPage onOpenTemplate={() => {}} />);
    expect(await screen.findByText(/không có quyền xem mẫu bảng lương/i)).toBeTruthy();
    expect(api.listPayrollTemplates).not.toHaveBeenCalled();
  });

  it("[allow] có view ⇒ gọi 049; không có manage ⇒ không nút «Thêm mẫu»", async () => {
    allow("view:payroll-template");
    wrap(<PayrollTemplateListPage onOpenTemplate={() => {}} />);
    await waitFor(() => expect(api.listPayrollTemplates).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: /Thêm mẫu/ })).toBeNull();
  });
});

const rate = (over: Partial<StatutoryRateDto>): StatutoryRateDto => ({
  id: "77777777-7777-4777-8777-777777777777",
  effectiveFrom: "2026-07-01",
  siEmployeePct: 8,
  hiEmployeePct: 1.5,
  uiEmployeePct: 1,
  siEmployerPct: 17.5,
  hiEmployerPct: 3,
  uiEmployerPct: 1,
  unionEmployerPct: 2,
  unionEmployeePct: 1,
  siCap: 46800000,
  hiCap: 46800000,
  uiCap: 99200000,
  baseWage: 2340000,
  minRegionWage: 4960000,
  personalDeduction: 11000000,
  dependentDeduction: 4400000,
  pitBrackets: [],
  note: null,
  inUse: false,
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

describe("PAY-SCREEN-011 «Tỉ lệ luật định»", () => {
  it("băng cảnh báo §3.11 luôn hiện; bản inUse ⇒ KHÔNG «Sửa», chỉ «Tạo bản mới»; bản chưa dùng ⇒ có «Sửa»", async () => {
    allow("view:statutory-rate", "manage:statutory-rate");
    api.listStatutoryRates!.mockResolvedValue(
      page([
        rate({
          id: "88888888-8888-4888-8888-888888888888",
          effectiveFrom: "2026-01-01",
          inUse: true,
        }),
        rate({ effectiveFrom: "2026-12-01", inUse: false }),
      ]),
    );
    wrap(<StatutoryRateListPage />);
    expect(await screen.findByText(/KHÔNG khẳng định/)).toBeTruthy();
    const usedRow = (await screen.findByText("2026-01-01")).closest("tr") as HTMLElement;
    const freshRow = screen.getByText("2026-12-01").closest("tr") as HTMLElement;
    expect(within(usedRow).queryByRole("button", { name: "Sửa" })).toBeNull();
    expect(within(usedRow).getByRole("button", { name: /Tạo bản mới/ })).toBeTruthy();
    expect(within(freshRow).getByRole("button", { name: "Sửa" })).toBeTruthy();
  });

  it("[deny] officer (chỉ view) ⇒ thấy bảng, 0 nút ghi", async () => {
    allow("view:statutory-rate");
    api.listStatutoryRates!.mockResolvedValue(page([rate({})]));
    wrap(<StatutoryRateListPage />);
    await screen.findByText("2026-07-01");
    expect(screen.queryByRole("button", { name: "Sửa" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tạo bản mới/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Thêm bản tỉ lệ/ })).toBeNull();
  });
});

const period = (over: Partial<PayrollPeriodDto>): PayrollPeriodDto => ({
  id: "99999999-9999-4999-8999-999999999999",
  companyId: "cccccccc-3333-4333-8333-333333333333",
  periodMonth: "2026-09",
  status: "Draft",
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
  ...over,
});

describe("Chi tiết kỳ — khối «Mẫu bảng lương» (D10)", () => {
  it("[allow] Draft + đủ hai cặp ⇒ nút «Gắn mẫu» + băng nhắc chưa gắn", async () => {
    allow("manage:payroll-period", "view:payroll-template");
    wrap(<PeriodTemplateBlock period={period({})} onChanged={() => {}} />);
    expect(await screen.findByRole("button", { name: "Gắn mẫu" })).toBeTruthy();
    expect(screen.getByText(/gắn mẫu trước khi tính lương/)).toBeTruthy();
  });

  it("[deny] Calculated ⇒ KHÔNG nút đổi (thay vì 409 template-locked), không băng nhắc", async () => {
    allow("manage:payroll-period", "view:payroll-template");
    api.getPayrollTemplate!.mockResolvedValue({
      id: "aaaaaaaa-1111-4111-8111-111111111111",
      code: "TPL",
      name: "Mẫu văn phòng",
      scope: "company",
      orgUnitId: null,
      isActive: true,
      updatedAt: "",
      components: [],
      formulaSetFingerprint: "a".repeat(64),
    });
    wrap(
      <PeriodTemplateBlock
        period={period({
          status: "Calculated",
          templateId: "aaaaaaaa-1111-4111-8111-111111111111",
        })}
        onChanged={() => {}}
      />,
    );
    expect(await screen.findByText("Mẫu văn phòng (TPL)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Đổi mẫu|Gắn mẫu/ })).toBeNull();
    expect(screen.queryByText(/gắn mẫu trước khi tính lương/)).toBeNull();
  });

  it("[deny] thiếu view:payroll-template ⇒ không gọi 051, không đoán tên, không nút", async () => {
    allow("manage:payroll-period");
    wrap(
      <PeriodTemplateBlock
        period={period({ templateId: "aaaaaaaa-1111-4111-8111-111111111111" })}
        onChanged={() => {}}
      />,
    );
    expect(await screen.findByText("Đã gắn mẫu")).toBeTruthy();
    expect(api.getPayrollTemplate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Đổi mẫu/ })).toBeNull();
  });
});

const payslip = (items: PayslipDetailDto["items"]): PayslipDetailDto => ({
  id: "bbbbbbbb-2222-4222-8222-222222222222",
  companyId: "cccccccc-3333-4333-8333-333333333333",
  payrollPeriodId: "99999999-9999-4999-8999-999999999999",
  userId: "dddddddd-4444-4444-8444-444444444444",
  salaryProfileId: null,
  status: "Published",
  gross: 10000000,
  net: 8950000,
  deductionAmount: 1050000,
  adjustmentAmount: 0,
  workDays: 22,
  presentDays: 22,
  paidLeaveDays: 0,
  unpaidLeaveDays: 0,
  lateMinutes: 0,
  createdBy: "eeeeeeee-5555-4555-8555-555555555555",
  createdAt: "2026-09-30T00:00:00.000Z",
  acknowledgedAt: null,
  items,
});

const item = (
  n: number,
  itemType: PayslipDetailDto["items"][number]["itemType"],
  label: string,
  amount: number | undefined,
  meta: Record<string, unknown> | null | undefined,
) => ({
  id: `ffffffff-0000-4000-8000-${String(n).padStart(12, "0")}`,
  payslipId: "bbbbbbbb-2222-4222-8222-222222222222",
  itemType,
  label,
  amount,
  sortOrder: n,
  meta,
  createdAt: "2026-09-30T00:00:00.000Z",
});

describe("PayslipBreakdown v2 — theo thành phần (D12)", () => {
  it("[allow] meta đủ ⇒ nhóm Thu nhập/Khấu trừ, hiện mã thành phần, item ẩn vẫn hiện (mờ)", () => {
    wrap(
      <PayslipBreakdown
        payslip={payslip([
          item(10, "earning", "Lương cơ bản", 10000000, {
            componentCode: "LUONG_CO_BAN",
            kind: "earning",
            isVisible: true,
          }),
          item(20, "deduction", "BHXH", -800000, {
            componentCode: "BHXH_NV",
            kind: "statutory_employee",
            isVisible: true,
          }),
          item(30, "deduction", "Nội bộ", -250000, {
            componentCode: "KT_NOI_BO",
            kind: "deduction",
            isVisible: false,
          }),
        ])}
      />,
    );
    const v2 = screen.getByTestId("payslip-breakdown-v2");
    expect(within(v2).getByText("Thu nhập")).toBeTruthy();
    expect(within(v2).getByText("Khấu trừ")).toBeTruthy();
    expect(within(v2).getByText("BHXH_NV")).toBeTruthy();
    expect(within(v2).getByText(/không hiện trên bảng lương/)).toBeTruthy();
  });

  it("[deny] meta vắng (v1 hoặc bị che) ⇒ bảng v1 theo khoản mục, KHÔNG dựng nhóm", () => {
    wrap(
      <PayslipBreakdown
        payslip={payslip([item(10, "earning", "Lương cơ bản", undefined, undefined)])}
      />,
    );
    expect(screen.queryByTestId("payslip-breakdown-v2")).toBeNull();
    // Bảng v1 có cột «Khoản mục» (itemType earning cũng dịch là «Lương cơ bản») + cột «Nội dung».
    expect(screen.getByRole("columnheader", { name: "Khoản mục" })).toBeTruthy();
    expect(screen.getAllByText("Lương cơ bản")).toHaveLength(2);
  });
});

const TPL_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const tplDetail = (over: Record<string, unknown> = {}) => ({
  id: TPL_ID,
  code: "TPL",
  name: "Mẫu văn phòng",
  scope: "company" as const,
  orgUnitId: null,
  isActive: true,
  updatedAt: "2026-09-16T00:00:00.000Z",
  formulaSetFingerprint: "a".repeat(64),
  components: [
    {
      componentId: "bbbbbbbb-1111-4111-8111-111111111111",
      code: "LUONG_CO_BAN",
      name: "Lương cơ bản",
      kind: "earning" as const,
      valueType: "formula" as const,
      columnLabel: null,
      catalogFormula: "SYS_BASE_SALARY",
      formulaOverride: null,
      isVisible: true,
      sortOrder: 0,
    },
  ],
  ...over,
});

describe("PAY-SCREEN-010 chi tiết — bản 051 mới KHÔNG đè thay đổi chưa lưu (TS review FE-2, HIGH)", () => {
  const label = () =>
    screen.getByRole("textbox", { name: "Nhãn cột của LUONG_CO_BAN" }) as HTMLInputElement;

  it("[deny] đang sửa dở + 051 về bản mới (vd vừa «Ngưng dùng») ⇒ nhãn đang gõ VẪN còn, băng «chưa lưu» vẫn hiện", async () => {
    allow("view:payroll-template", "manage:payroll-template", "view:salary-component");
    api.getPayrollTemplate!.mockResolvedValue(tplDetail());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrap(<PayrollTemplateDetailPage templateId={TPL_ID} onBack={() => {}} />, qc);
    await screen.findByText("Mẫu văn phòng");
    fireEvent.change(label(), { target: { value: "Lương chính" } });
    expect(await screen.findByText("Có thay đổi chưa lưu.")).toBeTruthy();

    qc.setQueryData(
      ["payroll", "catalog", "template-detail", TPL_ID],
      tplDetail({ isActive: false }),
    );

    await screen.findByText("Ngưng dùng");
    expect(label().value).toBe("Lương chính");
    expect(screen.getByText("Có thay đổi chưa lưu.")).toBeTruthy();
  });

  it("[allow đối chứng] chưa sửa gì + 051 về bản mới ⇒ bảng đồng bộ theo server", async () => {
    allow("view:payroll-template", "manage:payroll-template", "view:salary-component");
    api.getPayrollTemplate!.mockResolvedValue(tplDetail());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrap(<PayrollTemplateDetailPage templateId={TPL_ID} onBack={() => {}} />, qc);
    await screen.findByText("Mẫu văn phòng");
    const fresh = tplDetail();
    fresh.components[0]!.columnLabel = "Lương từ server" as unknown as null;
    qc.setQueryData(["payroll", "catalog", "template-detail", TPL_ID], fresh);
    await waitFor(() => expect(label().value).toBe("Lương từ server"));
    expect(screen.queryByText("Có thay đổi chưa lưu.")).toBeNull();
  });
});
