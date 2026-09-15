import { describe, expect, it } from "vitest";
import {
  PAYROLL_STATUTORY_RATE_SEED,
  PAYROLL_SYSTEM_COMPONENTS,
} from "../payroll-master-data.seeder";
import { D, type Dec } from "./formula.decimal";
import { FormulaError } from "./formula.errors";
import { Budget } from "./formula.evaluator";
import { compileGraph, evaluatePass, type GraphComponent } from "./formula.graph";
import { BUDGET_PER_LINE, BUDGET_PER_PASS } from "./formula.limits";
import {
  evaluateLine,
  grossUp,
  lineSysInputs,
  participationStatutory,
  SOCIAL_INSURANCE_RATE_REFS,
  type LineDays,
  type LineInput,
  type LineProfile,
  type LineResult,
} from "./formula.line";
import { toStatutoryValues, type StatutoryValues } from "./formula.statutory";
import { SYS_REFS, type SysRef } from "./formula.vocabulary";

/**
 * S15-PAYROLL-BE-3 — máy tính MỘT dòng lương (plan §6.1).
 *
 * Đồ thị THẬT = catalog hệ thống seed v4 (`PAYROLL_SYSTEM_COMPONENTS`, không chép lại) + bản tỉ lệ seed. Số kỳ vọng
 * lấy từ bảng tính ĐỘC LẬP `docs/QA/evidence/S15-PAYROLL-BE-3-DOI-SOAT.md` (Python `Fraction`, không import engine) —
 * KHÔNG sinh từ engine. Lệch 1 đồng là đỏ.
 */

const toGraphComponent = (c: (typeof PAYROLL_SYSTEM_COMPONENTS)[number]): GraphComponent => ({
  code: c.code,
  kind: c.kind,
  valueType: c.valueType,
  formula: c.formula,
  fixedAmount: null,
  pitDeductible: c.pitDeductible,
});

const SEED_COMPONENTS: readonly GraphComponent[] = PAYROLL_SYSTEM_COMPONENTS.map(toGraphComponent);
const seedGraph = (extra: readonly GraphComponent[] = []) =>
  compileGraph([...SEED_COMPONENTS, ...extra], { requireEngineNodes: true });
const SEED_STATUTORY: StatutoryValues = toStatutoryValues(PAYROLL_STATUTORY_RATE_SEED);

const ENGINE_NODES: readonly GraphComponent[] = [
  "TONG_THU_NHAP",
  "TONG_BH_NV",
  "THU_NHAP_CHIU_THUE",
  "TONG_KHAU_TRU",
].map((code) => ({
  code,
  kind: "aggregate",
  valueType: "engine",
  formula: null,
  fixedAmount: null,
  pitDeductible: false,
}));
const formulaC = (
  code: string,
  kind: GraphComponent["kind"],
  formula: string,
  extra: Partial<GraphComponent> = {},
): GraphComponent => ({
  code,
  kind,
  valueType: "formula",
  formula,
  fixedAmount: null,
  pitDeductible: false,
  ...extra,
});

interface InputPatch {
  profile?: Partial<LineProfile>;
  days?: Partial<LineDays>;
  profileItems?: Record<string, string>;
  participation?: LineInput["participation"];
  dependents?: number;
  bonusAmount?: string;
  penaltyAmount?: string;
  advanceAmount?: string;
}
const line = (p: InputPatch = {}): LineInput => ({
  profile: {
    salaryType: "GROSS",
    baseSalary: "0.00",
    insuranceSalary: null,
    probationSalary: null,
    payRatioPct: "100.00",
    pitPayer: "EMPLOYEE",
    ...p.profile,
  },
  days: {
    workDays: "22.00",
    presentDays: "22.00",
    paidLeaveDays: "0.00",
    unpaidLeaveDays: "0.00",
    lateMinutes: "0",
    ...p.days,
  },
  profileItems: p.profileItems ?? {},
  participation: p.participation ?? { socialInsurance: false, union: false },
  dependents: p.dependents ?? 0,
  bonusAmount: p.bonusAmount ?? "0.00",
  penaltyAmount: p.penaltyAmount ?? "0.00",
  advanceAmount: p.advanceAmount ?? "0.00",
});

const money = (r: LineResult): Record<string, string> =>
  Object.fromEntries([...r.values].map(([code, v]) => [code, v.toFixed(2)]));
const netBeforeClamp = (r: LineResult) => r.gross.minus(r.deduction).toFixed(2);

function formulaErrorOf(fn: () => unknown): FormulaError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FormulaError) return err;
    throw err;
  }
  throw new Error("kỳ vọng FormulaError");
}

// ── Ba ca của bảng đối soát tay ─────────────────────────────────────────────────────────────────────────

/** A1 — ca «khớp từng đồng» của payroll-be2-lifecycle, viết lại v2. */
const A1 = line({
  profile: { baseSalary: "22000000.00" },
  days: { presentDays: "18.00", unpaidLeaveDays: "2.00" },
  profileItems: { PHU_CAP: "1000000.00" },
});

/** NV-G — GROSS đủ mọi khoản · BH vượt trần · 2 NPT · TNCN bậc 4. */
const NV_G = line({
  profile: { baseSalary: "45999999.99", insuranceSalary: "50000000.00" },
  days: { presentDays: "19.50", unpaidLeaveDays: "1.50" },
  profileItems: { PHU_CAP: "1005000.00" },
  participation: { socialInsurance: true, union: true },
  dependents: 2,
  bonusAmount: "2385000.00",
  penaltyAmount: "300000.00",
  advanceAmount: "1000000.00",
});

/** NV-N — NET đủ khoản · 1 NPT · lương BH vắng (⇒ căn cứ = b). */
const NV_N = line({
  profile: { salaryType: "NET", baseSalary: "25000000.00" },
  days: { presentDays: "20.00", unpaidLeaveDays: "2.00" },
  profileItems: { PHU_CAP: "500000.00" },
  participation: { socialInsurance: true, union: false },
  dependents: 1,
  bonusAmount: "1000000.00",
});

describe("S15-PAYROLL-BE-3 · formula.line — đối soát tay từng đồng", () => {
  it("A1 (§3.4 lỗi thuế): NGHI_KHONG_LUONG là earning âm ⇒ TNCN 550.000 (không phải 750.000), net 18.450.000", () => {
    const r = evaluateLine(seedGraph(), SEED_STATUTORY, A1);
    expect(money(r)).toMatchObject({
      LUONG_CO_BAN: "20000000.00",
      PHU_CAP: "1000000.00",
      NGHI_KHONG_LUONG: "-2000000.00",
      TONG_THU_NHAP: "19000000.00",
      TONG_BH_NV: "0.00",
      THU_NHAP_CHIU_THUE: "8000000.00",
      TNCN: "550000.00",
      TONG_KHAU_TRU: "550000.00",
    });
    expect(netBeforeClamp(r)).toBe("18450000.00");
    expect(r.baseAmount.toFixed(2)).toBe("20000000.00");
    expect(r.allowanceAmount.toFixed(2)).toBe("1000000.00");
    expect(r.grossUp).toBeNull();
  });

  it("NV-G GROSS đủ khoản: từng thành phần + 4 nút + net-trước-clamp khớp bảng tay", () => {
    const r = evaluateLine(seedGraph(), SEED_STATUTORY, NV_G);
    expect(money(r)).toEqual({
      LUONG_CO_BAN: "43909090.90",
      PHU_CAP: "1005000.00",
      THUONG: "2385000.00",
      NGHI_KHONG_LUONG: "-3136363.64",
      PHAT: "300000.00",
      TAM_UNG: "1000000.00",
      TONG_THU_NHAP: "44162727.26",
      BHXH_NV: "3744000.00",
      BHYT_NV: "702000.00",
      BHTN_NV: "500000.00",
      DOAN_PHI: "468000.00",
      TONG_BH_NV: "4946000.00",
      THU_NHAP_CHIU_THUE: "19416727.26",
      TNCN: "2233345.45",
      TONG_KHAU_TRU: "8947345.45",
      BHXH_DN: "8190000.00",
      BHYT_DN: "1404000.00",
      BHTN_DN: "500000.00",
      KPCD: "936000.00",
    });
    expect(netBeforeClamp(r)).toBe("35215381.81");
    expect(r.gross.toFixed(2)).toBe("44162727.26");
    expect(r.deduction.toFixed(2)).toBe("8947345.45");
    expect(r.baseAmount.toFixed(2)).toBe("43909090.90");
    expect(r.bonusAmount.toFixed(2)).toBe("2385000.00");
    expect(r.penaltyAmount.toFixed(2)).toBe("300000.00");
  });

  it("NV-N NET (M2): b* = 28.281.300,97 sau ĐÚNG 12 vòng; F(b*) trong ±1 đ; lượt cuối khớp bảng tay", () => {
    const graph = seedGraph();
    const r = evaluateLine(graph, SEED_STATUTORY, NV_N);
    expect(r.grossUp?.base.toFixed(2)).toBe("28281300.97");
    expect(r.grossUp?.iterations).toBe(12);
    expect(r.grossUp?.targetNet.toFixed(2)).toBe("25000000.00");
    // Căn cứ BH vắng ⇒ `b*` (O-4) — đột biến «fallback = N» đổi b* và làm ca này đỏ.
    expect(r.sys.SYS_INSURANCE_SALARY.toFixed(2)).toBe("28281300.97");
    expect(money(r)).toEqual({
      LUONG_CO_BAN: "28281300.97",
      PHU_CAP: "500000.00",
      THUONG: "1000000.00",
      NGHI_KHONG_LUONG: "-2571027.36",
      PHAT: "0.00",
      TAM_UNG: "0.00",
      TONG_THU_NHAP: "27210273.61",
      BHXH_NV: "2262504.08",
      BHYT_NV: "424219.51",
      BHTN_NV: "282813.01",
      DOAN_PHI: "0.00",
      TONG_BH_NV: "2969536.60",
      THU_NHAP_CHIU_THUE: "8840737.01",
      TNCN: "634073.70",
      TONG_KHAU_TRU: "3603610.30",
      BHXH_DN: "4949227.67",
      BHYT_DN: "848439.03",
      BHTN_DN: "282813.01",
      KPCD: "565626.02",
    });
    expect(netBeforeClamp(r)).toBe("23606663.31");

    // F(b*) trên đầu vào «công đủ» — cột cuối của bảng lặp trong evidence.
    const full = evaluatePass(
      graph,
      {
        sys: lineSysInputs(NV_N, new D("28281300.97"), true),
        profileItems: { PHU_CAP: new D("500000.00") },
        pitPayer: "EMPLOYEE",
        statutory: participationStatutory(SEED_STATUTORY, NV_N.participation),
      },
      new Budget(),
    );
    const f = (full.get("TONG_THU_NHAP") as Dec).minus(full.get("TONG_KHAU_TRU") as Dec);
    expect(f.toFixed(2)).toBe("24999999.71");
  });

  it("O-4 NET nửa tháng: b* BẰNG ca công đủ (gross-up độc lập công) ⇒ net ≈ nửa, KHÔNG lĩnh đủ NET", () => {
    const half = line({
      ...NV_N,
      days: { ...NV_N.days, presentDays: "11.00", unpaidLeaveDays: "0.00" },
      bonusAmount: "0.00",
    });
    const r = evaluateLine(seedGraph(), SEED_STATUTORY, half);
    expect(r.grossUp?.base.toFixed(2)).toBe("28281300.97");
    expect(r.grossUp?.iterations).toBe(12);
    expect(money(r)).toMatchObject({
      LUONG_CO_BAN: "14140650.49",
      TONG_THU_NHAP: "14640650.49",
      TONG_BH_NV: "2969536.60",
      TNCN: "0.00",
    });
    expect(netBeforeClamp(r)).toBe("11671113.89");
  });
});

describe("S15-PAYROLL-BE-3 · formula.line — luật định theo dòng (O-2) + §21.1 bốn vế độc lập", () => {
  const SI_UNION_CODES = ["BHXH_NV", "BHYT_NV", "BHTN_NV", "BHXH_DN", "BHYT_DN", "BHTN_DN", "KPCD"];

  it("O-2: không tham gia BH ⇒ 7 thành phần BH/KPCĐ = 0.00 VẪN có mặt; tham gia ⇒ khác 0", () => {
    const off = money(
      evaluateLine(seedGraph(), SEED_STATUTORY, { ...NV_G, participation: { socialInsurance: false, union: false } }),
    );
    for (const code of [...SI_UNION_CODES, "DOAN_PHI"]) expect(off[code], code).toBe("0.00");
    const on = money(evaluateLine(seedGraph(), SEED_STATUTORY, NV_G));
    for (const code of SI_UNION_CODES) expect(on[code], code).not.toBe("0.00");
    expect(SOCIAL_INSURANCE_RATE_REFS).toHaveLength(7);
  });

  it("(a) đổi tỉ lệ BH phần DN ⇒ gross/khấu trừ/net KHÔNG đổi", () => {
    const base = evaluateLine(seedGraph(), SEED_STATUTORY, NV_G);
    const other = toStatutoryValues({ ...PAYROLL_STATUTORY_RATE_SEED, siEmployerPct: "20.00" });
    const r = evaluateLine(seedGraph(), other, NV_G);
    expect(money(r).BHXH_DN).not.toBe(money(base).BHXH_DN);
    expect(r.gross.toFixed(2)).toBe(base.gross.toFixed(2));
    expect(r.deduction.toFixed(2)).toBe(base.deduction.toFixed(2));
  });

  it("(b) tax_exempt vào TONG_THU_NHAP nhưng KHÔNG vào thu nhập chịu thuế", () => {
    const base = money(evaluateLine(seedGraph(), SEED_STATUTORY, NV_G));
    const withExempt = money(
      evaluateLine(
        seedGraph([
          { code: "AN_CA", kind: "tax_exempt", valueType: "fixed", formula: null, fixedAmount: "730000.00", pitDeductible: false },
        ]),
        SEED_STATUTORY,
        NV_G,
      ),
    );
    expect(new D(withExempt.TONG_THU_NHAP).minus(base.TONG_THU_NHAP).toFixed(2)).toBe("730000.00");
    expect(withExempt.THU_NHAP_CHIU_THUE).toBe(base.THU_NHAP_CHIU_THUE);
  });

  it("(c) bật/tắt công đoàn ⇒ chịu thuế KHÔNG đổi, khấu trừ đổi đúng bằng DOAN_PHI", () => {
    const on = evaluateLine(seedGraph(), SEED_STATUTORY, NV_G);
    const off = evaluateLine(seedGraph(), SEED_STATUTORY, {
      ...NV_G,
      participation: { socialInsurance: true, union: false },
    });
    expect(money(off).THU_NHAP_CHIU_THUE).toBe(money(on).THU_NHAP_CHIU_THUE);
    expect(money(off).DOAN_PHI).toBe("0.00");
    expect(on.deduction.minus(off.deduction).toFixed(2)).toBe("468000.00");
  });

  it("(d) pit_payer = COMPANY ⇒ TONG_KHAU_TRU giảm đúng TNCN, TNCN vẫn tính", () => {
    const emp = evaluateLine(seedGraph(), SEED_STATUTORY, NV_G);
    const co = evaluateLine(seedGraph(), SEED_STATUTORY, {
      ...NV_G,
      profile: { ...NV_G.profile, pitPayer: "COMPANY" },
    });
    expect(money(co).TNCN).toBe("2233345.45");
    expect(emp.deduction.minus(co.deduction).toFixed(2)).toBe("2233345.45");
  });

  it("SYS_DEPENDENTS đi vào GT_NPT × n (2 NPT ⇒ chịu thuế thấp hơn đúng 8.800.000)", () => {
    const two = money(evaluateLine(seedGraph(), SEED_STATUTORY, NV_G));
    const none = money(evaluateLine(seedGraph(), SEED_STATUTORY, { ...NV_G, dependents: 0 }));
    expect(new D(none.THU_NHAP_CHIU_THUE).minus(two.THU_NHAP_CHIU_THUE).toFixed(2)).toBe("8800000.00");
  });

  it("§3.11 căn cứ BH = COALESCE(probation, insurance, base) — thử việc thắng lương BH", () => {
    const r = evaluateLine(seedGraph(), SEED_STATUTORY, {
      ...NV_G,
      profile: { ...NV_G.profile, probationSalary: "5000000.00" },
    });
    expect(r.sys.SYS_INSURANCE_SALARY.toFixed(2)).toBe("5000000.00");
    expect(r.sys.SYS_PROBATION_SALARY.toFixed(2)).toBe("5000000.00");
    expect(money(r).BHXH_NV).toBe("400000.00");
    const noIns = evaluateLine(seedGraph(), SEED_STATUTORY, {
      ...A1,
      profile: { ...A1.profile, insuranceSalary: null },
    });
    expect(noIns.sys.SYS_INSURANCE_SALARY.toFixed(2)).toBe("22000000.00");
    expect(noIns.sys.SYS_PROBATION_SALARY.toFixed(2)).toBe("0.00");
  });

  it("participationStatutory KHÔNG đột biến bản tỉ lệ dùng chung của kỳ", () => {
    const frozen: StatutoryValues = Object.freeze({
      refs: Object.freeze({ ...SEED_STATUTORY.refs }),
      caps: SEED_STATUTORY.caps,
      pitBrackets: SEED_STATUTORY.pitBrackets,
    });
    const out = participationStatutory(frozen, { socialInsurance: false, union: false });
    expect(out.refs).not.toBe(frozen.refs);
    expect(out.refs.TL_BHXH_NV.toFixed(2)).toBe("0.00");
    expect(frozen.refs.TL_BHXH_NV.toFixed(2)).toBe("8.00");
    expect(frozen.refs.TL_DOAN_PHI.toFixed(2)).toBe("1.00");
    expect(out.refs.GT_NPT.toFixed(2)).toBe("4400000.00");
  });

  it("SYS_* lượt thật: PRORATE kẹp 1 · DAILY_RATE · trễ/phép có lương đi thẳng; 15 biến đủ mặt", () => {
    const sys = lineSysInputs(
      line({
        profile: { baseSalary: "22000000.00", payRatioPct: "85.00" },
        days: { presentDays: "23.00", unpaidLeaveDays: "1.00", paidLeaveDays: "1.50", lateMinutes: "45" },
      }),
      new D("22000000.00"),
      false,
    );
    expect(Object.keys(sys).sort()).toEqual([...SYS_REFS].sort());
    expect(sys.SYS_PRORATE.toFixed(2)).toBe("1.00");
    expect(sys.SYS_DAILY_RATE.toFixed(2)).toBe("1000000.00");
    expect(sys.SYS_PAID_LEAVE_DAYS.toFixed(2)).toBe("1.50");
    expect(sys.SYS_LATE_MINUTES.toFixed(0)).toBe("45");
    expect(sys.SYS_PAY_RATIO.toFixed(2)).toBe("85.00");
    const full = lineSysInputs(line({ profile: { payRatioPct: "85.00" }, days: { presentDays: "3.00" } }), new D("1"), true);
    const zeroed: SysRef[] = ["SYS_PAID_LEAVE_DAYS", "SYS_UNPAID_LEAVE_DAYS", "SYS_LATE_MINUTES", "SYS_BONUS_AMOUNT", "SYS_PENALTY_AMOUNT", "SYS_ADVANCE_AMOUNT"];
    for (const k of zeroed) expect(full[k].isZero(), k).toBe(true);
    expect(full.SYS_PRESENT_DAYS.toFixed(2)).toBe("22.00");
    expect(full.SYS_PRORATE.toFixed(0)).toBe("1");
    expect(full.SYS_PAY_RATIO.toFixed(0)).toBe("100");
  });
});

describe("S15-PAYROLL-BE-3 · formula.line — lỗi có tên (không bao giờ số 0 âm thầm)", () => {
  it("gross-up dao động quanh ngưỡng IF ⇒ grossup-not-converged sau ĐÚNG 30 vòng (021)", () => {
    const graph = compileGraph(
      [
        ...ENGINE_NODES,
        formulaC("LUONG", "earning", "SYS_BASE_SALARY"),
        formulaC("DAO", "earning", "IF(SYS_BASE_SALARY > 25000000, 10000000, -10000000)"),
      ],
      { requireEngineNodes: true },
    );
    const err = formulaErrorOf(() =>
      evaluateLine(graph, SEED_STATUTORY, line({ profile: { salaryType: "NET", baseSalary: "25000000.00" } })),
    );
    expect(err.kind).toBe("grossup-not-converged");
    expect(err.code).toBe("PAYROLL-ERR-021");
    expect(err.details).toEqual({ iterations: 30, reason: "not-converged" });
  });

  it("căn cứ lặp ≤ 0 ⇒ non-positive-base (m1: phụ cấp hồ sơ lớn hơn N — SPEC «b₀ = N chặn dưới» sai)", () => {
    const err = formulaErrorOf(() =>
      evaluateLine(
        seedGraph(),
        SEED_STATUTORY,
        line({ profile: { salaryType: "NET", baseSalary: "5000000.00" }, profileItems: { PHU_CAP: "6000000.00" } }),
      ),
    );
    expect(err.kind).toBe("grossup-not-converged");
    expect(err.details).toEqual({ iterations: 1, reason: "non-positive-base" });
  });

  it("negative-total: tổng thu nhập âm hoặc tổng khấu trừ âm ⇒ 020 trước khi ra cột", () => {
    const negIncome = compileGraph([...ENGINE_NODES, formulaC("AM", "earning", "0 - SYS_BASE_SALARY")], {
      requireEngineNodes: true,
    });
    const e1 = formulaErrorOf(() =>
      evaluateLine(negIncome, SEED_STATUTORY, line({ profile: { baseSalary: "1000.00" } })),
    );
    expect(e1.kind).toBe("negative-total");
    expect(e1.code).toBe("PAYROLL-ERR-020");
    expect(e1.details.component).toBe("TONG_THU_NHAP");

    const negDeduction = compileGraph(
      [...ENGINE_NODES, formulaC("LUONG", "earning", "SYS_BASE_SALARY"), formulaC("TRU_AM", "deduction", "-SYS_BASE_SALARY")],
      { requireEngineNodes: true },
    );
    const e2 = formulaErrorOf(() =>
      evaluateLine(negDeduction, SEED_STATUTORY, line({ profile: { baseSalary: "1000.00" } })),
    );
    expect(e2.kind).toBe("negative-total");
    expect(e2.details.component).toBe("TONG_KHAU_TRU");
  });

  it("ngân sách: MỘT Budget cho cả dòng NET — mẫu mặc định nằm trong trần; trần dòng nhỏ ⇒ per-line ở lượt > 1", () => {
    const budget = new Budget();
    evaluateLine(seedGraph(), SEED_STATUTORY, NV_N, budget);
    expect(budget.visitsInLine).toBeGreaterThan(0);
    expect(budget.visitsInLine).toBeLessThanOrEqual(BUDGET_PER_LINE);

    const err = formulaErrorOf(() =>
      evaluateLine(seedGraph(), SEED_STATUTORY, NV_N, new Budget(BUDGET_PER_PASS, 400)),
    );
    expect(err.kind).toBe("formula-budget-exceeded");
    expect(err.details.limit).toBe("per-line");
    expect(err.details.pass).toBeGreaterThan(1);
  });

  it("ngày công chuẩn = 0 ⇒ division-by-zero (không Infinity, không 0)", () => {
    const err = formulaErrorOf(() =>
      evaluateLine(seedGraph(), SEED_STATUTORY, line({ profile: { baseSalary: "1000.00" }, days: { workDays: "0.00" } })),
    );
    expect(err.kind).toBe("division-by-zero");
    expect(err.details.reason).toBe("work-days-zero");
  });

  it("thiếu nút tổng hợp ở đồ thị không kiểm (requireEngineNodes=false) ⇒ ném, KHÔNG coi là 0", () => {
    const graph = compileGraph([formulaC("LUONG", "earning", "SYS_BASE_SALARY")], { requireEngineNodes: false });
    const err = formulaErrorOf(() => evaluateLine(graph, SEED_STATUTORY, line({ profile: { baseSalary: "1.00" } })));
    expect(err.kind).toBe("template-missing-engine-nodes");
    const errNet = formulaErrorOf(() =>
      grossUp(graph, SEED_STATUTORY, line({ profile: { salaryType: "NET", baseSalary: "1.00" } }), new Budget()),
    );
    expect(errNet.kind).toBe("template-missing-engine-nodes");
  });
});

describe("S15-PAYROLL-BE-3 · §3.4 lưới làm tròn: |NGHI_KHONG_LUONG v4| = v3 từng xu", () => {
  const V3 = "SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS";
  const V4 = PAYROLL_SYSTEM_COMPONENTS.find((c) => c.code === "NGHI_KHONG_LUONG");
  const one = (formula: string, kind: GraphComponent["kind"]) =>
    compileGraph([formulaC("X", kind, formula)], { requireEngineNodes: false });
  const zeroSys = () => Object.fromEntries(SYS_REFS.map((k) => [k, new D(0)])) as Record<SysRef, Dec>;
  const valueOf = (formula: string, kind: GraphComponent["kind"], patch: Partial<Record<SysRef, string>>) => {
    const sys = zeroSys();
    for (const [k, v] of Object.entries(patch)) sys[k as SysRef] = new D(v as string);
    return evaluatePass(one(formula, kind), { sys, profileItems: {}, pitPayer: "EMPLOYEE", statutory: SEED_STATUTORY }, new Budget()).get("X") as Dec;
  };

  it("hằng seed v4 = earning, công thức ÂM của đúng chuỗi v3", () => {
    expect(V4?.kind).toBe("earning");
    expect(V4?.formula).toBe(`-(${V3})`);
  });

  it("≥ 500 ca biên HOÀ nửa xu + lưới 720 ca thường: v4 = −v3 chính xác", () => {
    let ties = 0;
    let total = 0;
    const check = (patch: Partial<Record<SysRef, string>>) => {
      const v3 = valueOf(V3, "deduction", patch);
      const v4 = valueOf(V4?.formula as string, "earning", patch);
      expect(v4.neg().toFixed(2), JSON.stringify(patch)).toBe(v3.toFixed(2));
      total++;
    };
    // Ca HOÀ: base có xu LẺ, ratio 100, unpaid 1, work 2 ⇒ base/2 kết thúc đúng bằng …5 ở chữ số thứ ba.
    for (let i = 0; i < 520; i++) {
      const cents = new D(2).times(new D(1_000_000_00).plus(new D(i).times(9973))).plus(1);
      const base = cents.div(100).toFixed(2);
      const exact = new D(base).div(2);
      if (exact.decimalPlaces() === 3 && exact.toFixed(3).endsWith("5")) ties++;
      check({ SYS_BASE_SALARY: base, SYS_PAY_RATIO: "100", SYS_UNPAID_LEAVE_DAYS: "1", SYS_WORK_DAYS: "2" });
    }
    for (const base of ["19999999.99", "22000000.00", "45999999.99", "7777777.77", "12345678.95", "30000000.05", "9999999.99", "15500000.50"]) {
      for (const unpaid of ["0.50", "1.00", "1.50", "2.00", "2.50", "3.38"]) {
        for (const work of ["20", "21", "22", "23", "26"]) {
          for (const ratio of ["100.00", "85.50", "70.00"]) {
            check({ SYS_BASE_SALARY: base, SYS_PAY_RATIO: ratio, SYS_UNPAID_LEAVE_DAYS: unpaid, SYS_WORK_DAYS: work });
          }
        }
      }
    }
    expect(ties).toBeGreaterThanOrEqual(500);
    expect(total).toBe(520 + 720);
  });
});
