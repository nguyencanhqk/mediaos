// @vitest-environment jsdom
/**
 * [deny-path] S15-PAYROLL-DEBT-1 — hai nợ render của S15:
 *  (1) `BudgetFormDialog` xoá mềm 075 `{delete:true}` — hai bước, gác `manage:payroll-budget`;
 *  (2) `TemplatePreviewDialog` (054) — trước đây KHÔNG có ca render nào (nợ FE-2).
 *
 * Mỗi ca DENY đi cặp ca ALLOW đối chứng (`deny-cases-vacuous-without-allow-case`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import type { PayrollBudgetDto, StatutoryRateDto } from "@mediaos/contracts";

const granted = new Set<string>();
const allow = (...pairs: string[]) => {
  granted.clear();
  for (const p of pairs) granted.add(p);
};
const kindError = vi.hoisted(() => ({ current: null as null | { kind: string; status: number } }));

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
      status: kindError.current?.status ?? null,
      kind: kindError.current?.kind ?? null,
      message: "",
      fields: new Map(),
    }),
    orgApi: { getTree: vi.fn().mockResolvedValue([]) },
    payrollApi: {
      createPayrollBudget: vi.fn(),
      updatePayrollBudget: vi.fn(),
      listStatutoryRates: vi.fn(),
      previewPayrollTemplate: vi.fn(),
    },
    payrollKeys: {
      budgets: { allOf: () => ["payroll", "budgets"] },
      catalog: {
        allOf: () => ["payroll", "catalog"],
        statutoryRates: key("catalog", "statutory-rates"),
      },
    },
  };
});

import { payrollApi } from "@mediaos/web-core";
import { BudgetFormDialog } from "./components/BudgetFormDialog";
import { TemplatePreviewDialog } from "./components/TemplatePreviewDialog";
import { payrollErrorI18nKey } from "./payroll-errors";
import type { TemplateRow } from "./template-editor";

const api = payrollApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const tr = (k: string, o?: Record<string, unknown>) => i18n.t(`payroll:${k}`, o);

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  kindError.current = null;
  granted.clear();
});

// ── (1) BudgetFormDialog — xoá mềm 075 ─────────────────────────────────────────────────────────────

const BUDGET: PayrollBudgetDto = {
  id: "11111111-1111-4111-8111-111111111111",
  fiscalYear: 2026,
  orgUnitId: null,
  orgUnitName: null,
  plannedAmount: 120000000,
  note: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function renderBudget(budget: PayrollBudgetDto | null, onClose = vi.fn()) {
  const view = wrap(
    <BudgetFormDialog
      open
      onClose={onClose}
      budget={budget}
      defaultFiscalYear={2026}
      defaultOrgUnitId={null}
    />,
  );
  return { ...view, onClose };
}

describe("BudgetFormDialog — xoá mềm (075 delete)", () => {
  it("ALLOW: sửa + manage:payroll-budget ⇒ bấm lần 1 chỉ đổi nhãn; lần 2 gửi {delete:true}, invalidate, đóng", async () => {
    allow("manage:payroll-budget");
    api.updatePayrollBudget!.mockResolvedValue({ id: BUDGET.id, warnings: [] });
    const { onClose, invalidate } = renderBudget(BUDGET);

    const btn = await screen.findByTestId("budget-delete");
    expect(btn).toHaveTextContent(tr("budgetForm.delete"));
    fireEvent.click(btn);
    expect(btn).toHaveTextContent(tr("budgetForm.deleteConfirm"));
    expect(api.updatePayrollBudget).not.toHaveBeenCalled();

    fireEvent.click(btn);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.updatePayrollBudget).toHaveBeenCalledTimes(1);
    expect(api.updatePayrollBudget).toHaveBeenCalledWith(BUDGET.id, { delete: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["payroll", "budgets"] });
  });

  it("DENY: sửa nhưng THIẾU manage:payroll-budget ⇒ không có nút xoá", async () => {
    allow("view:payroll-budget");
    renderBudget(BUDGET);
    await screen.findByText(tr("budgetForm.editTitle"));
    expect(screen.queryByTestId("budget-delete")).toBeNull();
  });

  it("chế độ TẠO (budget=null) ⇒ không có nút xoá dù có cặp", async () => {
    allow("manage:payroll-budget");
    renderBudget(null);
    await screen.findByText(tr("budgetForm.title"));
    expect(screen.queryByTestId("budget-delete")).toBeNull();
  });

  it("075 lỗi ⇒ hiện chữ lỗi, KHÔNG đóng hộp", async () => {
    allow("manage:payroll-budget");
    kindError.current = { kind: "not-found", status: 404 };
    api.updatePayrollBudget!.mockRejectedValue(new Error("boom"));
    const { onClose } = renderBudget(BUDGET);

    const btn = await screen.findByTestId("budget-delete");
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(api.updatePayrollBudget).toHaveBeenCalledTimes(1));
    const expected = tr(
      payrollErrorI18nKey({
        code: null,
        status: 404,
        kind: "not-found",
        message: "",
        fields: new Map(),
      }),
    );
    expect(expected).not.toBe(tr("errors.generic"));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── (2) TemplatePreviewDialog — 054 ───────────────────────────────────────────────────────────────

const TEMPLATE_ID = "22222222-2222-4222-8222-222222222222";

const RATE: StatutoryRateDto = {
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
};

const row = (over: Partial<TemplateRow>): TemplateRow => ({
  componentId: "33333333-3333-4333-8333-333333333333",
  code: "LUONG_CO_BAN",
  name: "Lương cơ bản",
  kind: "earning",
  valueType: "formula",
  columnLabel: "",
  catalogFormula: "SYS_BASE_SALARY",
  formulaOverride: "",
  isVisible: true,
  ...over,
});

const ROWS: TemplateRow[] = [
  row({}),
  row({
    componentId: "44444444-4444-4444-8444-444444444444",
    code: "PHU_CAP_AN",
    name: "Phụ cấp ăn",
    valueType: "profile_item",
    catalogFormula: null,
  }),
];

const pageOf = <T,>(data: T[]) => ({
  data,
  pagination: { total: data.length, page: 1, perPage: 1 },
});

function renderPreview() {
  return wrap(
    <TemplatePreviewDialog open onClose={vi.fn()} templateId={TEMPLATE_ID} rows={ROWS} />,
  );
}

const runButton = () => screen.getByRole("button", { name: tr("templatePreview.run") });

describe("TemplatePreviewDialog — xem trước 054", () => {
  it("ALLOW: có view:statutory-rate ⇒ gửi statutory từ bản MỚI NHẤT (không baseWage), profile_item mặc định 0; bảng kết quả theo sortOrder + đánh dấu cột ẩn", async () => {
    allow("view:statutory-rate", "manage:payroll-template");
    api.listStatutoryRates!.mockResolvedValue(pageOf([RATE]));
    api.previewPayrollTemplate!.mockResolvedValue({
      columns: [
        {
          code: "PHU_CAP_AN",
          label: "Phụ cấp ăn",
          kind: "earning",
          isVisible: false,
          sortOrder: 20,
        },
        {
          code: "LUONG_CO_BAN",
          label: "Lương cơ bản",
          kind: "earning",
          isVisible: true,
          sortOrder: 10,
        },
      ],
      values: { LUONG_CO_BAN: "10000000", PHU_CAP_AN: "0" },
      formulaSetFingerprint: "a".repeat(64),
      nodesVisited: 2,
    });
    renderPreview();

    await screen.findByText(tr("templatePreview.usingRate", { date: "2026-07-01" }));
    expect(api.listStatutoryRates).toHaveBeenCalledWith({ page: 1, per_page: 1 });
    await waitFor(() => expect(runButton()).not.toBeDisabled());
    fireEvent.click(runButton());

    await waitFor(() => expect(api.previewPayrollTemplate).toHaveBeenCalledTimes(1));
    const [id, body] = api.previewPayrollTemplate!.mock.calls[0]!;
    expect(id).toBe(TEMPLATE_ID);
    expect(body.profileItems).toEqual({ PHU_CAP_AN: "0" });
    expect(body.pitPayer).toBe("EMPLOYEE");
    expect(body.inputs.SYS_WORK_DAYS).toBe("22");
    expect(body.statutory).toMatchObject({ siEmployeePct: 8, personalDeduction: 11000000 });
    expect(body.statutory).not.toHaveProperty("baseWage");
    expect(body.statutory).not.toHaveProperty("minRegionWage");

    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows.map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual([
      "LUONG_CO_BAN",
      "PHU_CAP_AN",
    ]);
    expect(within(bodyRows[1]!).getByText(tr("templatePreview.hidden"))).toBeInTheDocument();
    expect(within(bodyRows[0]!).getByText(/10\.000\.000/)).toBeInTheDocument();
  });

  it("DENY: thiếu view:statutory-rate ⇒ báo cần quyền, KHÔNG gọi 055, nút khoá", async () => {
    allow("manage:payroll-template");
    renderPreview();
    await screen.findByText(tr("templatePreview.needRates"));
    expect(api.listStatutoryRates).not.toHaveBeenCalled();
    expect(runButton()).toBeDisabled();
  });

  it("chưa có bản tỉ lệ nào ⇒ báo noRates, nút khoá (không gửi số 0)", async () => {
    allow("view:statutory-rate", "manage:payroll-template");
    api.listStatutoryRates!.mockResolvedValue(pageOf([]));
    renderPreview();
    await screen.findByText(tr("templatePreview.noRates"));
    expect(runButton()).toBeDisabled();
  });

  it("SYS_WORK_DAYS = 0 ⇒ nút khoá (054 coi là chia 0)", async () => {
    allow("view:statutory-rate", "manage:payroll-template");
    api.listStatutoryRates!.mockResolvedValue(pageOf([RATE]));
    renderPreview();
    await waitFor(() => expect(runButton()).not.toBeDisabled());
    const workDays = screen.getByText("SYS_WORK_DAYS").closest("label")!.querySelector("input")!;
    fireEvent.change(workDays, { target: { value: "0" } });
    expect(runButton()).toBeDisabled();
    // Đối chứng: trả lại khác 0 ⇒ mở khoá (khoá là do ô này, không phải lý do khác).
    fireEvent.change(workDays, { target: { value: "20" } });
    expect(runButton()).not.toBeDisabled();
  });

  it("054 422 máy công thức ⇒ hiện chữ riêng của kind (payrollErrorText), không phải «Có lỗi»", async () => {
    allow("view:statutory-rate", "manage:payroll-template");
    api.listStatutoryRates!.mockResolvedValue(pageOf([RATE]));
    kindError.current = { kind: "division-by-zero", status: 422 };
    api.previewPayrollTemplate!.mockRejectedValue(new Error("422"));
    renderPreview();
    await waitFor(() => expect(runButton()).not.toBeDisabled());
    fireEvent.click(runButton());
    expect(
      await screen.findByText(tr("errors.divisionByZero", { component: "" })),
    ).toBeInTheDocument();
    expect(screen.queryByText(tr("errors.generic"))).toBeNull();
  });
});
