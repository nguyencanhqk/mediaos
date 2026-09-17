/**
 * S15-PAYROLL-FE-2 — logic THUẦN của track B: tách token công thức (tô màu/gợi ý) · soạn danh sách thành phần
 * của mẫu (053) · cột động + hàng tổng của bảng lương kỳ · FSM «đổi mẫu» · dấu vân tay dòng · payload 056.
 *
 * Mỗi ca DENY đi cặp một ca ALLOW đối chứng (`deny-cases-vacuous-without-allow-case`).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  PayrollPeriodLineDto,
  PayrollPeriodStatus,
  PayrollTemplateDetailDto,
  SalaryComponentDto,
  StatutoryRateDto,
} from "@mediaos/contracts";
import {
  filterSuggestions,
  insertSuggestion,
  tokenizeFormula,
  wordAtCaret,
} from "./formula-tokens";
import {
  addComponent,
  canOverrideFormula,
  canRemoveRow,
  isTemplateDirty,
  moveRow,
  removeRow,
  rowsFromDetail,
  toPutPayload,
  updateRow,
} from "./template-editor";
import {
  computeLineTotals,
  deriveComponentColumns,
  isWholePeriod,
  sumMoney,
  toLineRows,
} from "./period-line-columns";
import { canChangePeriodTemplate } from "./payroll-actions";
import { hasTemplateDrift, lineFingerprintFor } from "./use-template-drift";
import {
  emptyRateForm,
  formToPayload,
  PIT_BRACKET_COUNT,
  rateToForm,
} from "./components/StatutoryRateFormDialog";
import { statutoryForPreview } from "./components/TemplatePreviewDialog";

// ── formula-tokens ──────────────────────────────────────────────────────────────────────────────

describe("tokenizeFormula — phân loại để tô màu", () => {
  const known = new Set(["LUONG_CO_BAN", "PHU_CAP"]);

  it("mã catalog · SYS_ · TL_/GT_ · hàm · mã LẠ · số · toán tử", () => {
    const toks = tokenizeFormula("ROUND(LUONG_CO_BAN * SYS_PRORATE + X_LA - TL_BHXH_NV, 2)", known)
      .filter((t) => t.kind !== "space")
      .map((t) => [t.text, t.kind]);
    expect(toks).toEqual([
      ["ROUND", "function"],
      ["(", "operator"],
      ["LUONG_CO_BAN", "component"],
      ["*", "operator"],
      ["SYS_PRORATE", "system"],
      ["+", "operator"],
      ["X_LA", "unknown"],
      ["-", "operator"],
      ["TL_BHXH_NV", "statutory"],
      [",", "operator"],
      ["2", "number"],
      [")", "operator"],
    ]);
  });

  it("vị trí `start` cùng hệ với `pos` của server (UTF-16 từ 0) — ghép lại ra đúng chuỗi gốc", () => {
    const src = "IF(PHU_CAP > 0, PHU_CAP, 0)";
    const toks = tokenizeFormula(src, known);
    expect(toks.map((t) => t.text).join("")).toBe(src);
    for (const t of toks) expect(src.slice(t.start, t.start + t.text.length)).toBe(t.text);
  });

  it("AND/OR là toán tử, không phải mã lạ; ký tự rác không ném", () => {
    const kinds = tokenizeFormula("A AND B $", new Set(["A", "B"])).map((t) => t.kind);
    expect(kinds).toContain("operator");
    expect(kinds).not.toContain("unknown");
  });
});

describe("gợi ý mã tại con trỏ", () => {
  it("từ đang gõ + thay đúng đoạn đó", () => {
    expect(wordAtCaret("MAX(LUONG_", 10)).toEqual({ word: "LUONG_", start: 4 });
    expect(insertSuggestion("MAX(LUONG_, 0)", 10, "LUONG_CO_BAN")).toEqual({
      formula: "MAX(LUONG_CO_BAN, 0)",
      caret: 16,
    });
  });

  it("[deny] không gõ gì ⇒ không gợi ý; [allow] tiền tố ⇒ lọc, bỏ mã trùng khớp hoàn toàn", () => {
    expect(filterSuggestions(["A", "AB"], "")).toEqual([]);
    expect(filterSuggestions(["SYS_A", "SYS_B", "LUONG"], "sys_")).toEqual(["SYS_A", "SYS_B"]);
    expect(filterSuggestions(["LUONG"], "LUONG")).toEqual([]);
  });
});

// ── template-editor ─────────────────────────────────────────────────────────────────────────────

const comp = (
  code: string,
  valueType: PayrollTemplateDetailDto["components"][number]["valueType"],
  sortOrder: number,
): PayrollTemplateDetailDto["components"][number] => ({
  componentId: `00000000-0000-4000-8000-${String(sortOrder).padStart(12, "0")}`,
  code,
  name: code.toLowerCase(),
  kind: valueType === "engine" ? "aggregate" : "earning",
  valueType,
  columnLabel: null,
  catalogFormula: valueType === "formula" ? "SYS_BASE_SALARY" : null,
  formulaOverride: null,
  isVisible: true,
  sortOrder,
});

const DETAIL: PayrollTemplateDetailDto = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "TPL",
  name: "Mẫu",
  scope: "company",
  orgUnitId: null,
  isActive: true,
  updatedAt: "2026-09-16T00:00:00.000Z",
  formulaSetFingerprint: "a".repeat(64),
  components: [
    comp("TONG_THU_NHAP", "engine", 30),
    comp("LUONG_CO_BAN", "formula", 10),
    comp("PHU_CAP", "profile_item", 20),
  ],
};

describe("template-editor — soạn danh sách thành phần (053)", () => {
  it("rowsFromDetail sắp theo sortOrder; payload đánh lại sortOrder = vị trí × 10", () => {
    const rows = rowsFromDetail(DETAIL);
    expect(rows.map((r) => r.code)).toEqual(["LUONG_CO_BAN", "PHU_CAP", "TONG_THU_NHAP"]);
    expect(toPutPayload(moveRow(rows, 2, 0)).components.map((c) => c.sortOrder)).toEqual([
      0, 10, 20,
    ]);
    expect(isTemplateDirty(rows, DETAIL)).toBe(false);
    expect(isTemplateDirty(moveRow(rows, 0, 1), DETAIL)).toBe(true);
  });

  it("[deny] không gỡ được nút engine; [allow] gỡ được thành phần thường", () => {
    const rows = rowsFromDetail(DETAIL);
    expect(canRemoveRow(rows[2]!)).toBe(false);
    expect(removeRow(rows, 2)).toHaveLength(3);
    expect(canRemoveRow(rows[0]!)).toBe(true);
    expect(removeRow(rows, 0).map((r) => r.code)).toEqual(["PHU_CAP", "TONG_THU_NHAP"]);
  });

  it("[deny] ghi đè công thức bị bỏ ở engine/profile_item; [allow] giữ ở formula", () => {
    const rows = rowsFromDetail(DETAIL);
    expect(canOverrideFormula(rows[1]!)).toBe(false);
    const withProfileOverride = updateRow(rows, 1, { formulaOverride: "1" });
    expect(withProfileOverride[1]!.formulaOverride).toBe("");
    const withFormulaOverride = updateRow(rows, 0, { formulaOverride: "  SYS_BASE_SALARY * 2 " });
    const payload = toPutPayload(withFormulaOverride).components;
    expect(payload[0]!.formulaOverride).toBe("SYS_BASE_SALARY * 2");
    expect(payload[1]!.formulaOverride).toBeNull();
  });

  it("nhãn rỗng ⇒ null (dùng tên catalog); thêm trùng ⇒ không đổi", () => {
    const rows = updateRow(rowsFromDetail(DETAIL), 0, { columnLabel: "  " });
    expect(toPutPayload(rows).components[0]!.columnLabel).toBeNull();
    const catalogItem = {
      id: rows[0]!.componentId,
      code: "LUONG_CO_BAN",
      name: "x",
      kind: "earning",
      valueType: "formula",
      formula: "1",
      fixedAmount: null,
      pitDeductible: false,
      isSystem: false,
      isActive: true,
      sortOrder: 0,
      updatedAt: "",
    } satisfies SalaryComponentDto;
    expect(addComponent(rows, catalogItem)).toHaveLength(3);
    const fresh = { ...catalogItem, id: "22222222-2222-4222-8222-222222222222", code: "MOI" };
    expect(addComponent(rows, fresh).at(-1)?.code).toBe("MOI");
  });
});

// ── period-line-columns ─────────────────────────────────────────────────────────────────────────

const line = (id: string, extra: Partial<PayrollPeriodLineDto>): PayrollPeriodLineDto => ({
  id,
  payrollPeriodId: "p",
  userId: `u-${id}`,
  salaryProfileId: null,
  workDays: 22,
  presentDays: 22,
  paidLeaveDays: 0,
  unpaidLeaveDays: 0,
  lateMinutes: 0,
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
  ...extra,
});

const components = (base: number) => [
  {
    code: "LUONG",
    label: "Lương",
    kind: "earning" as const,
    isVisible: true,
    sortOrder: 20,
    value: base,
  },
  {
    code: "AN_TRUA",
    label: "Ăn trưa",
    kind: "tax_exempt" as const,
    isVisible: true,
    sortOrder: 10,
    value: 0.1,
  },
  {
    code: "NOI_BO",
    label: "Nội bộ",
    kind: "earning" as const,
    isVisible: false,
    sortOrder: 5,
    value: 1,
  },
];

describe("period-line-columns — cột động + hàng tổng (D9)", () => {
  it("cột = thành phần isVisible, sắp theo sortOrder; dòng v1 ⇒ không cột động", () => {
    expect(deriveComponentColumns([line("a", { components: components(1) })])).toEqual([
      { code: "AN_TRUA", label: "Ăn trưa" },
      { code: "LUONG", label: "Lương" },
    ]);
    expect(deriveComponentColumns([line("v1", { gross: 1 })])).toEqual([]);
  });

  it("tổng cộng theo XU — 0.1 + 0.2 ra đúng 0.3 (số thực thì 0.30000000000000004)", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    const lines = [
      line("a", { components: components(1000000.1), net: 0.1 }),
      line("b", { components: components(2000000.2), net: 0.2 }),
    ];
    const totals = computeLineTotals(lines, deriveComponentColumns(lines));
    expect(totals.byCode.LUONG).toBe(3000000.3);
    expect(totals.byCode.AN_TRUA).toBe(0.2);
    expect(totals.net).toBe(0.3);
  });

  it("[deny] một dòng bị che ⇒ tổng cột đó undefined (không cộng thiếu âm thầm); [allow] đủ ⇒ có số", () => {
    expect(sumMoney([1, undefined])).toBeUndefined();
    expect(sumMoney([])).toBeUndefined();
    expect(sumMoney([1, 2])).toBe(3);
  });

  it("hàng tổng đứng CUỐI và chỉ khi có dòng; nhãn «Tổng» chỉ khi cả kỳ trong một trang", () => {
    expect(toLineRows([], [])).toEqual([]);
    const rows = toLineRows([line("a", { net: 1 })], []);
    expect(rows.map((r) => r.kind)).toEqual(["line", "total"]);
    expect(isWholePeriod(1, 5, 5)).toBe(true);
    expect(isWholePeriod(1, 20, 45)).toBe(false);
    expect(isWholePeriod(2, 5, 25)).toBe(false);
    expect(isWholePeriod(1, 5, undefined)).toBe(false);
  });
});

// ── FSM «đổi mẫu» (D10) ─────────────────────────────────────────────────────────────────────────

describe("canChangePeriodTemplate — FSM ∩ manage:payroll-period ∩ view:payroll-template", () => {
  const subject = (status: PayrollPeriodStatus) => ({
    status,
    payslipsGeneratedAt: null,
    submittedBy: null,
  });
  const ALL: readonly PayrollPeriodStatus[] = [
    "Draft",
    "CollectingData",
    "Calculated",
    "Reviewing",
    "Approved",
    "Published",
    "Paid",
    "Locked",
  ];

  it("đủ quyền: CHỈ Draft/CollectingData (mirror 409 template-locked của 004)", () => {
    const allowed = ALL.filter((s) => canChangePeriodTemplate(subject(s), true, true));
    expect(allowed).toEqual(["Draft", "CollectingData"]);
  });

  it("[deny] thiếu một trong hai cặp ⇒ ẩn kể cả ở Draft", () => {
    expect(canChangePeriodTemplate(subject("Draft"), false, true)).toBe(false);
    expect(canChangePeriodTemplate(subject("Draft"), true, false)).toBe(false);
  });
});

// ── fingerprint (D11) ───────────────────────────────────────────────────────────────────────────

describe("lineFingerprintFor — mirror lineFingerprint của BE", () => {
  const nodeLineFp = (setFp: string, rateId: string | null) =>
    createHash("sha256")
      .update(`${setFp}:${rateId ?? "none"}`, "utf8")
      .digest("hex");
  const SET_FP = "b".repeat(64);
  const RATE = "33333333-3333-4333-8333-333333333333";

  it("khớp sha256 của node cho cả hai nhánh rateId", async () => {
    expect(await lineFingerprintFor(SET_FP, RATE)).toBe(nodeLineFp(SET_FP, RATE));
    expect(await lineFingerprintFor(SET_FP, null)).toBe(nodeLineFp(SET_FP, null));
  });

  it("[allow] dòng tính bằng tập công thức hiện tại ⇒ không lệch; [deny] tập khác ⇒ lệch", async () => {
    const same = [{ templateFingerprint: nodeLineFp(SET_FP, RATE), statutoryRateId: RATE }];
    expect(await hasTemplateDrift(SET_FP, same)).toBe(false);
    const stale = [
      { templateFingerprint: nodeLineFp("c".repeat(64), RATE), statutoryRateId: RATE },
    ];
    expect(await hasTemplateDrift(SET_FP, stale)).toBe(true);
    // Dòng v1 (không fingerprint) không bị coi là lệch.
    expect(
      await hasTemplateDrift(SET_FP, [{ templateFingerprint: null, statutoryRateId: null }]),
    ).toBe(false);
  });
});

// ── form tỉ lệ luật định (D14) + preview (D8) ───────────────────────────────────────────────────

const RATE_DTO: StatutoryRateDto = {
  id: "44444444-4444-4444-8444-444444444444",
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
  pitBrackets: [
    { upTo: 5000000, rate: 5 },
    { upTo: 10000000, rate: 10 },
    { upTo: 18000000, rate: 15 },
    { upTo: 32000000, rate: 20 },
    { upTo: 52000000, rate: 25 },
    { upTo: 80000000, rate: 30 },
    { upTo: null, rate: 35 },
  ],
  note: null,
  inUse: true,
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("StatutoryRateFormDialog — form ⇄ payload 056", () => {
  it("bản có sẵn ⇒ form ⇒ payload giữ nguyên số; bậc cuối null", () => {
    const payload = formToPayload(rateToForm(RATE_DTO, false));
    expect(payload).not.toBeNull();
    expect(payload?.pitBrackets).toEqual(RATE_DTO.pitBrackets);
    expect(payload?.siCap).toBe(46800000);
    expect(payload?.effectiveFrom).toBe("2026-07-01");
  });

  it("[deny] «sao chép» bỏ ngày hiệu lực ⇒ chưa lưu được tới khi nhập ngày MỚI; [allow] nhập ngày ⇒ được", () => {
    const copy = rateToForm(RATE_DTO, true);
    expect(copy.effectiveFrom).toBe("");
    expect(formToPayload(copy)).toBeNull();
    expect(formToPayload({ ...copy, effectiveFrom: "2027-01-01" })).not.toBeNull();
  });

  it("[deny] form rỗng · tỉ lệ > 100 · trần = 0 · ngưỡng bậc giữa trống ⇒ null", () => {
    expect(formToPayload(emptyRateForm())).toBeNull();
    const base = rateToForm(RATE_DTO, false);
    expect(formToPayload({ ...base, values: { ...base.values, siEmployeePct: "101" } })).toBeNull();
    expect(formToPayload({ ...base, values: { ...base.values, siCap: "0" } })).toBeNull();
    const holes = base.brackets.map((b, i) => (i === 3 ? { ...b, upTo: "" } : b));
    expect(formToPayload({ ...base, brackets: holes })).toBeNull();
    expect(base.brackets).toHaveLength(PIT_BRACKET_COUNT);
  });

  it("preview: khối statutory bỏ baseWage/minRegionWage (054 `.strict()`)", () => {
    const st = statutoryForPreview(RATE_DTO);
    expect(st).not.toHaveProperty("baseWage");
    expect(st).not.toHaveProperty("minRegionWage");
    expect(st).not.toHaveProperty("id");
    expect(st.pitBrackets).toHaveLength(7);
  });
});
