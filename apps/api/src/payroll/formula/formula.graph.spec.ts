import { describe, expect, it } from "vitest";
import { D, type Dec } from "./formula.decimal";
import { FormulaError } from "./formula.errors";
import { Budget } from "./formula.evaluator";
import { compileGraph, evaluatePass, type GraphComponent, type PassInputs } from "./formula.graph";
import { BUDGET_PER_LINE } from "./formula.limits";
import { toStatutoryValues } from "./formula.statutory";
import { SYS_REFS, type SysRef } from "./formula.vocabulary";

/**
 * S15-PAYROLL-BE-2 — đồ thị phụ thuộc + 4 nút aggregate (SPEC-11 §13.6 E · §13.7 E).
 *
 * Fixture = catalog hệ thống seed (DB-13 §13.4, cùng `kind`/`pitDeductible`) + 3 thành phần BE-2 thêm
 * (`THUONG` · `PHAT` · `TAM_UNG`) + một khoản MIỄN THUẾ `AN_CA`. Số kỳ vọng tính TAY ở comment từng ca — lệch
 * 1 đồng là đỏ. Bốn vế (a)–(d) của §21.1 A2 có ca RIÊNG, không dựa vào «tổng khớp».
 *
 * 🔴 `LUONG_CO_BAN` ở fixture dùng công thức ĐÚNG theo quyết định owner 2026-09-01 (SPEC-11 §13.4 «Nghỉ KHÔNG
 * lương»: tử số pro-rate = `present + unpaid`, kẹp trần 1, GIỮ dòng khấu trừ nghỉ không lương) — KHÔNG phải
 * chuỗi đang seed ở DB-1 (chuỗi đó trừ HAI LẦN; vá ở `S15-PAYROLL-DB-1B`). Fixture chép chuỗi seed sai là ghim
 * lỗi thành hành vi đúng (plan-review BE-2 B1).
 */

const f = (
  code: string,
  kind: GraphComponent["kind"],
  valueType: GraphComponent["valueType"],
  formula: string | null = null,
  extra: Partial<GraphComponent> = {},
): GraphComponent => ({
  code,
  kind,
  valueType,
  formula,
  fixedAmount: null,
  pitDeductible: false,
  ...extra,
});

const SEED_TEMPLATE: GraphComponent[] = [
  f(
    "LUONG_CO_BAN",
    "earning",
    "formula",
    // Tử số pro-rate = present + unpaid, kẹp trần 1 — quyết định owner 2026-09-01 (xem docblock đầu file).
    "MIN(SYS_BASE_SALARY * (SYS_PRESENT_DAYS + SYS_UNPAID_LEAVE_DAYS) / SYS_WORK_DAYS, SYS_BASE_SALARY) * SYS_PAY_RATIO / 100",
  ),
  f("PHU_CAP", "earning", "profile_item"),
  f("THUONG", "earning", "formula", "SYS_BONUS_AMOUNT"),
  f("AN_CA", "tax_exempt", "fixed", null, { fixedAmount: "730000.00" }),
  f(
    "NGHI_KHONG_LUONG",
    "deduction",
    "formula",
    "SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS",
  ),
  f("PHAT", "deduction", "formula", "SYS_PENALTY_AMOUNT"),
  f("TAM_UNG", "deduction", "formula", "SYS_ADVANCE_AMOUNT"),
  f("TONG_THU_NHAP", "aggregate", "engine"),
  f(
    "BHXH_NV",
    "statutory_employee",
    "formula",
    "BH_TRAN_BHXH(SYS_INSURANCE_SALARY) * TL_BHXH_NV / 100",
    { pitDeductible: true },
  ),
  f(
    "BHYT_NV",
    "statutory_employee",
    "formula",
    "BH_TRAN_BHYT(SYS_INSURANCE_SALARY) * TL_BHYT_NV / 100",
    { pitDeductible: true },
  ),
  f(
    "BHTN_NV",
    "statutory_employee",
    "formula",
    "BH_TRAN_BHTN(SYS_INSURANCE_SALARY) * TL_BHTN_NV / 100",
    { pitDeductible: true },
  ),
  f(
    "DOAN_PHI",
    "statutory_employee",
    "formula",
    "BH_TRAN_BHXH(SYS_INSURANCE_SALARY) * TL_DOAN_PHI / 100",
  ),
  f("TONG_BH_NV", "aggregate", "engine"),
  f("THU_NHAP_CHIU_THUE", "aggregate", "engine"),
  f("TNCN", "tax", "formula", "TNCN_LUY_TIEN(THU_NHAP_CHIU_THUE)"),
  f("TONG_KHAU_TRU", "aggregate", "engine"),
  f(
    "BHXH_DN",
    "statutory_employer",
    "formula",
    "BH_TRAN_BHXH(SYS_INSURANCE_SALARY) * TL_BHXH_DN / 100",
  ),
  f(
    "BHYT_DN",
    "statutory_employer",
    "formula",
    "BH_TRAN_BHYT(SYS_INSURANCE_SALARY) * TL_BHYT_DN / 100",
  ),
  f(
    "BHTN_DN",
    "statutory_employer",
    "formula",
    "BH_TRAN_BHTN(SYS_INSURANCE_SALARY) * TL_BHTN_DN / 100",
  ),
  f("KPCD", "statutory_employer", "formula", "BH_TRAN_BHXH(SYS_INSURANCE_SALARY) * TL_KPCD / 100"),
];

const RATE = {
  siEmployeePct: "8.00",
  hiEmployeePct: "1.50",
  uiEmployeePct: "1.00",
  siEmployerPct: "17.50",
  hiEmployerPct: "3.00",
  uiEmployerPct: "1.00",
  unionEmployerPct: "2.00",
  unionEmployeePct: "1.00",
  siCap: "46800000.00",
  hiCap: "46800000.00",
  uiCap: "99200000.00",
  personalDeduction: "11000000.00",
  dependentDeduction: "4400000.00",
  pitBrackets: [
    { upTo: 5000000, rate: 5 },
    { upTo: 10000000, rate: 10 },
    { upTo: 18000000, rate: 15 },
    { upTo: 32000000, rate: 20 },
    { upTo: 52000000, rate: 25 },
    { upTo: 80000000, rate: 30 },
    { upTo: null, rate: 35 },
  ],
};

function inputs(
  over: {
    sys?: Partial<Record<SysRef, string>>;
    rate?: Partial<typeof RATE>;
    pitPayer?: "EMPLOYEE" | "COMPANY";
  } = {},
): PassInputs {
  const sys = Object.fromEntries(SYS_REFS.map((k) => [k, new D(0)])) as Record<SysRef, Dec>;
  const base: Partial<Record<SysRef, string>> = {
    SYS_BASE_SALARY: "20000000",
    SYS_PAY_RATIO: "100",
    SYS_PRESENT_DAYS: "22",
    SYS_WORK_DAYS: "22",
    SYS_INSURANCE_SALARY: "20000000",
    SYS_DEPENDENTS: "1",
    SYS_BONUS_AMOUNT: "500000",
    SYS_PENALTY_AMOUNT: "100000",
    ...over.sys,
  };
  for (const [k, v] of Object.entries(base)) sys[k as SysRef] = new D(v as string);
  return {
    sys,
    profileItems: { PHU_CAP: new D("1000000") },
    pitPayer: over.pitPayer ?? "EMPLOYEE",
    statutory: toStatutoryValues({ ...RATE, ...over.rate }),
  };
}

const values = (components: GraphComponent[], inp: PassInputs = inputs()) => {
  const out = evaluatePass(
    compileGraph(components, { requireEngineNodes: true }),
    inp,
    new Budget(),
  );
  return (code: string) => (out.get(code) as Dec).toFixed(2);
};

function failure(fn: () => unknown): FormulaError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FormulaError) return err;
    throw err;
  }
  throw new Error("kỳ vọng FormulaError");
}

describe("S15-PAYROLL-BE-2 · đồ thị công thức + 4 nút aggregate", () => {
  describe("đối soát TAY một nhân sự GROSS (lương 20tr · phụ cấp 1tr · thưởng 500k · phạt 100k · ăn ca 730k · 1 NPT)", () => {
    const v = values(SEED_TEMPLATE);

    it("thu nhập + bảo hiểm NV", () => {
      expect(v("LUONG_CO_BAN")).toBe("20000000.00");
      expect(v("THUONG")).toBe("500000.00");
      expect(v("BHXH_NV")).toBe("1600000.00"); // 20tr × 8%
      expect(v("BHYT_NV")).toBe("300000.00"); // × 1,5%
      expect(v("BHTN_NV")).toBe("200000.00"); // × 1%
      expect(v("DOAN_PHI")).toBe("200000.00"); // × 1%
    });

    it("TONG_THU_NHAP = 20tr + 1tr + 500k + 730k (tax_exempt) = 22.230.000", () => {
      expect(v("TONG_THU_NHAP")).toBe("22230000.00");
    });

    it("TONG_BH_NV = 1,6tr + 300k + 200k = 2.100.000 (KHÔNG có đoàn phí)", () => {
      expect(v("TONG_BH_NV")).toBe("2100000.00");
    });

    it("THU_NHAP_CHIU_THUE = 22.230.000 − 2.100.000 − 11tr − 4,4tr×1 − 730k = 4.000.000 · TNCN = 200.000", () => {
      expect(v("THU_NHAP_CHIU_THUE")).toBe("4000000.00");
      expect(v("TNCN")).toBe("200000.00");
    });

    it("TONG_KHAU_TRU = phạt 100k + BH NV 2,3tr (CÓ đoàn phí) + thuế 200k = 2.600.000", () => {
      expect(v("TONG_KHAU_TRU")).toBe("2600000.00");
    });

    it("phần DN vẫn được TÍNH (chi phí lương) — BHXH_DN 3,5tr · KPCĐ 400k", () => {
      expect(v("BHXH_DN")).toBe("3500000.00");
      expect(v("KPCD")).toBe("400000.00");
    });
  });

  it("(a) phần DN KHÔNG vào lương NV: đổi tỉ lệ DN ⇒ TONG_KHAU_TRU KHÔNG đổi", () => {
    const v = values(
      SEED_TEMPLATE,
      inputs({ rate: { siEmployerPct: "50.00", unionEmployerPct: "30.00" } }),
    );
    expect(v("BHXH_DN")).toBe("10000000.00");
    expect(v("TONG_KHAU_TRU")).toBe("2600000.00");
  });

  it("(b) tax_exempt ĐƯỢC TRẢ: có trong TONG_THU_NHAP và bị trừ khỏi thu nhập tính thuế", () => {
    const without = values(SEED_TEMPLATE.filter((c) => c.code !== "AN_CA"));
    expect(without("TONG_THU_NHAP")).toBe("21500000.00"); // thiếu đúng 730k
    expect(without("THU_NHAP_CHIU_THUE")).toBe("4000000.00"); // thuế KHÔNG đổi — khoản miễn thuế không làm tăng thuế
  });

  it("(c) đoàn phí KHÔNG giảm thuế: bỏ đoàn phí ⇒ thu nhập tính thuế KHÔNG đổi, chỉ khấu trừ giảm", () => {
    const v = values(SEED_TEMPLATE, inputs({ rate: { unionEmployeePct: "0.00" } }));
    expect(v("THU_NHAP_CHIU_THUE")).toBe("4000000.00");
    expect(v("TONG_KHAU_TRU")).toBe("2400000.00");
  });

  it("(d) pit_payer = COMPANY: TONG_KHAU_TRU giảm ĐÚNG bằng thuế, thuế VẪN được tính", () => {
    const v = values(SEED_TEMPLATE, inputs({ pitPayer: "COMPANY" }));
    expect(v("TNCN")).toBe("200000.00");
    expect(v("TONG_KHAU_TRU")).toBe("2400000.00");
  });

  it("thứ tự topo: thành phần đứng sau mọi thứ nó phụ thuộc (kể cả cạnh NGẦM của aggregate)", () => {
    const { order } = compileGraph(SEED_TEMPLATE, { requireEngineNodes: true });
    const at = (c: string) => order.indexOf(c);
    expect(at("LUONG_CO_BAN")).toBeLessThan(at("TONG_THU_NHAP"));
    expect(at("AN_CA")).toBeLessThan(at("THU_NHAP_CHIU_THUE"));
    expect(at("THU_NHAP_CHIU_THUE")).toBeLessThan(at("TNCN"));
    expect(at("TNCN")).toBeLessThan(at("TONG_KHAU_TRU"));
    expect(order).toHaveLength(SEED_TEMPLATE.length);
  });

  it("làm tròn MỘT lần khi ghi: thành phần sau đọc giá trị ĐÃ tròn (0,005 ⇒ 0,01 ⇒ ×3 = 0,03, không 0,02)", () => {
    const tpl = [
      ...SEED_TEMPLATE,
      f("LE", "earning", "fixed", null, { fixedAmount: "0.005" }),
      f("LE_X3", "earning", "formula", "LE * 3"),
    ];
    const v = values(tpl);
    expect(v("LE")).toBe("0.01");
    expect(v("LE_X3")).toBe("0.03");
  });

  describe("PAYROLL-ERR-019 — vòng, kèm chu trình ĐẦY ĐỦ", () => {
    const cycleOf = (tpl: GraphComponent[], requireEngineNodes = false) =>
      failure(() => compileGraph(tpl, { requireEngineNodes }));

    it("trực tiếp A → A", () => {
      const err = cycleOf([f("A", "earning", "formula", "A + 1")]);
      expect(err.kind).toBe("formula-cycle");
      expect(err.code).toBe("PAYROLL-ERR-019");
      expect(err.details.cycle).toEqual(["A", "A"]);
    });

    it("gián tiếp A → B → C → A", () => {
      const err = cycleOf([
        f("A", "earning", "formula", "B"),
        f("B", "earning", "formula", "C"),
        f("C", "earning", "formula", "A"),
      ]);
      expect(err.details.cycle).toEqual(["A", "B", "C", "A"]);
    });

    it("qua nút aggregate: earning tham chiếu TONG_THU_NHAP (nó nằm trong chính tổng đó)", () => {
      const err = cycleOf(
        [...SEED_TEMPLATE, f("HOA_HONG", "earning", "formula", "TONG_THU_NHAP * 0.1")],
        true,
      );
      expect(err.kind).toBe("formula-cycle");
      expect(err.details.cycle).toContain("TONG_THU_NHAP");
      expect(err.details.cycle).toContain("HOA_HONG");
      const cycle = err.details.cycle as readonly string[];
      expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    });

    it("tax_exempt tham chiếu THU_NHAP_CHIU_THUE là vòng thật (nó bị trừ trong chính đại lượng đó)", () => {
      expect(
        cycleOf(
          [...SEED_TEMPLATE, f("MIEN", "tax_exempt", "formula", "THU_NHAP_CHIU_THUE / 10")],
          true,
        ).kind,
      ).toBe("formula-cycle");
    });

    it("KHÔNG vòng giả: khoản khấu trừ tính theo TONG_THU_NHAP là hợp lệ", () => {
      expect(() =>
        compileGraph(
          [
            ...SEED_TEMPLATE,
            f("CONG_DOAN_TU_NGUYEN", "deduction", "formula", "TONG_THU_NHAP * 0.01"),
          ],
          {
            requireEngineNodes: true,
          },
        ),
      ).not.toThrow();
    });
  });

  describe("PAYROLL-ERR-018 — phạm vi REF + nút engine", () => {
    it("mẫu thiếu nút aggregate ⇒ template-missing-engine-nodes (fail-closed, KHÔNG tính ra 0)", () => {
      const err = failure(() =>
        compileGraph(
          SEED_TEMPLATE.filter((c) => c.code !== "TONG_KHAU_TRU"),
          { requireEngineNodes: true },
        ),
      );
      expect(err.kind).toBe("template-missing-engine-nodes");
      expect(err.details.missing).toEqual(["TONG_KHAU_TRU"]);
    });

    it("không đòi nút engine ở ngữ cảnh catalog", () => {
      expect(() =>
        compileGraph([f("A", "earning", "fixed", null, { fixedAmount: "1" })], {
          requireEngineNodes: false,
        }),
      ).not.toThrow();
    });

    it.each(["KHONG_CO", "SYS_FOO", "TL_FOO", "GT_FOO"])(
      "REF %s không phân giải được ⇒ formula-unknown-ref",
      (ref) => {
        const err = failure(() =>
          compileGraph([f("A", "earning", "formula", `${ref} + 1`)], { requireEngineNodes: false }),
        );
        expect(err.kind).toBe("formula-unknown-ref");
        expect(err.details).toMatchObject({ ref, component: "A" });
      },
    );

    it("lỗi cú pháp mang theo MÃ thành phần", () => {
      const err = failure(() =>
        compileGraph([f("A", "earning", "formula", "1 +")], { requireEngineNodes: false }),
      );
      expect(err.kind).toBe("formula-syntax");
      expect(err.details.component).toBe("A");
    });
  });

  describe("PAYROLL-ERR-020 — lỗi lúc tính mang theo MÃ thành phần", () => {
    it("SYS_WORK_DAYS = 0 ⇒ division-by-zero ở LUONG_CO_BAN", () => {
      const err = failure(() => values(SEED_TEMPLATE, inputs({ sys: { SYS_WORK_DAYS: "0" } })));
      expect(err.kind).toBe("division-by-zero");
      expect(err.details.component).toBe("LUONG_CO_BAN");
    });

    it("giá trị vượt numeric(18,2) ⇒ numeric-overflow", () => {
      const err = failure(() =>
        values([...SEED_TEMPLATE, f("TO", "earning", "formula", "999999999999999 * 1000")]),
      );
      expect(err.kind).toBe("numeric-overflow");
      expect(err.details.component).toBe("TO");
    });
  });

  it("🔴 ĐỐI CHỨNG DƯƠNG ngân sách: mẫu thực tế chạy 31 lượt trên CÙNG một Budget KHÔNG vượt trần", () => {
    const graph = compileGraph(SEED_TEMPLATE, { requireEngineNodes: true });
    const budget = new Budget();
    const inp = inputs();
    for (let pass = 0; pass < 31; pass++) evaluatePass(graph, inp, budget);
    expect(budget.visitsInLine).toBeLessThan(BUDGET_PER_LINE);
    expect(budget.visitsInLine % 31).toBe(0); // mỗi lượt tốn ĐÚNG bằng nhau — tất định
  });

  describe("nhánh biên TỚI ĐƯỢC của đồ thị", () => {
    it("thành phần `formula` thiếu công thức ⇒ formula-syntax reason=formula-missing (KHÔNG coi là 0)", () => {
      const err = failure(() =>
        compileGraph([f("X", "earning", "formula", null)], { requireEngineNodes: false }),
      );
      expect(err.kind).toBe("formula-syntax");
      expect(err.details).toMatchObject({ component: "X", reason: "formula-missing" });
    });

    it("nút engine lạ ⇒ template-missing-engine-nodes reason=unknown-engine-node", () => {
      const err = failure(() =>
        compileGraph([f("LA_LUNG", "aggregate", "engine")], { requireEngineNodes: false }),
      );
      expect(err.kind).toBe("template-missing-engine-nodes");
      expect(err.details.reason).toBe("unknown-engine-node");
    });

    it("profile_item vắng định mức ⇒ 0 (không có định mức = không có khoản đó)", () => {
      expect(values(SEED_TEMPLATE, { ...inputs(), profileItems: {} })("PHU_CAP")).toBe("0.00");
    });

    it("thu nhập thấp ⇒ THU_NHAP_CHIU_THUE KẸP về 0 (không âm) ⇒ TNCN 0", () => {
      const v = values(
        SEED_TEMPLATE,
        inputs({ sys: { SYS_BASE_SALARY: "5000000", SYS_INSURANCE_SALARY: "5000000" } }),
      );
      expect(v("THU_NHAP_CHIU_THUE")).toBe("0.00");
      expect(v("TNCN")).toBe("0.00");
    });

    it("đồ thị biên dịch KHÔNG đòi đủ nút engine mà thiếu TONG_BH_NV ⇒ lúc TÍNH vẫn fail-closed (không trừ 0)", () => {
      const graph = compileGraph(
        [
          f("LUONG", "earning", "fixed", null, { fixedAmount: "1000" }),
          f("TONG_THU_NHAP", "aggregate", "engine"),
          f("THU_NHAP_CHIU_THUE", "aggregate", "engine"),
        ],
        { requireEngineNodes: false },
      );
      const err = failure(() => evaluatePass(graph, inputs(), new Budget()));
      expect(err.kind).toBe("template-missing-engine-nodes");
      expect(err.details.missing).toEqual(["TONG_BH_NV"]);
    });
  });
});
