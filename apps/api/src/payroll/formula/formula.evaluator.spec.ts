import { describe, expect, it } from "vitest";
import { D, toMoney } from "./formula.decimal";
import { FormulaError } from "./formula.errors";
import { Budget, evaluate } from "./formula.evaluator";
import {
  BUDGET_PER_LINE,
  BUDGET_PER_PASS,
  FORMULA_MAX_NODES,
  TEMPLATE_MAX_COMPONENTS,
} from "./formula.limits";
import { parseFormula } from "./formula.parser";
import { toStatutoryValues } from "./formula.statutory";

/**
 * S15-PAYROLL-BE-2 — evaluator (SPEC-11 §13.6 A · C · F).
 *
 * 🔴 Fixture CỐ Ý số lẻ (`1.005` · `0.385` · `19999999.99`) — fixture toàn số tròn làm ca «cấm float» xanh
 * RỖNG: `Math.round(1.005 * 100) / 100` ra `1` còn `ROUND_HALF_UP` thật ra `1.01`.
 */

/** Số seed PAY-DEC-014 (owner xác nhận 02/09/2026) — chép TAY có chủ đích: ca này ghim SỐ, không ghim nguồn. */
const SEED_RATE = {
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
const statutory = toStatutoryValues(SEED_RATE);

function run(src: string, refs: Record<string, string> = {}, budget = new Budget()): string {
  budget.beginPass();
  return evaluate(parseFormula(src).ast, {
    budget,
    statutory,
    resolveRef: (name) => {
      if (!(name in refs)) throw new Error(`fixture thiếu REF ${name}`);
      return new D(refs[name]);
    },
  }).toFixed();
}

function failure(fn: () => unknown): FormulaError {
  try {
    fn();
  } catch (err) {
    if (err instanceof FormulaError) return err;
    throw err;
  }
  throw new Error("kỳ vọng FormulaError");
}

describe("S15-PAYROLL-BE-2 · evaluator công thức", () => {
  describe("§13.6 F — số học thập phân, ROUND_HALF_UP", () => {
    it("số lẻ thật: 1.005 · 0.385 làm tròn LÊN (float cho ra 1.00 · 0.38)", () => {
      expect(run("ROUND(1.005, 2)")).toBe("1.01");
      expect(run("ROUND(0.385, 2)")).toBe("0.39");
      expect(toMoney(new D("1.005")).toFixed(2)).toBe("1.01");
    });

    it("19.999.999,99 × 8% giữ đủ 10 chữ số trung gian, làm tròn tiền MỘT lần ở cuối", () => {
      expect(run("19999999.99 * 8 / 100")).toBe("1599999.9992");
      expect(toMoney(new D(run("19999999.99 * 8 / 100"))).toFixed(2)).toBe("1600000.00");
    });

    it("phép trung gian cắt về scale 10 sau MỖI phép (tất định, không trôi)", () => {
      expect(run("10 / 3")).toBe("3.3333333333");
      expect(run("1 / 3 * 3")).toBe("0.9999999999");
    });

    it("ROUND với n âm làm tròn tới nghìn đồng", () => {
      expect(run("ROUND(1234500, -3)")).toBe("1235000");
      expect(run("ROUND(1234499, -3)")).toBe("1234000");
      expect(run("ROUND(-1500, -3)")).toBe("-2000");
    });

    it("dấu âm · cộng trừ n-ngôi", () => {
      expect(run("-A + B - -C", { A: "1.5", B: "10", C: "0.25" })).toBe("8.75");
    });
  });

  describe("hàm", () => {
    it("MIN/MAX nhiều tham số · ABS · CEIL · FLOOR", () => {
      expect(run("MIN(3, 1.5, 2)")).toBe("1.5");
      expect(run("MAX(3, 1.5, 7)")).toBe("7");
      expect(run("ABS(-5.25)")).toBe("5.25");
      expect(run("CEIL(1.2)")).toBe("2");
      expect(run("FLOOR(-1.2)")).toBe("-2");
    });

    it("so sánh · AND · OR trả 1/0", () => {
      expect(run("1 = 1")).toBe("1");
      expect(run("1 <> 1")).toBe("0");
      expect(run("2 >= 2 AND 1 < 2")).toBe("1");
      expect(run("0 OR 0")).toBe("0");
      expect(run("0 OR 2")).toBe("1");
    });

    it("IF chọn nhánh theo điều kiện khác 0", () => {
      expect(run("IF(1 > 2, 10, 20)")).toBe("20");
      expect(run("IF(A, 10, 20)", { A: "0.01" })).toBe("10");
    });

    it("IF đánh giá CẢ HAI nhánh (không short-circuit): chia 0 ở nhánh không chọn vẫn là lỗi", () => {
      expect(failure(() => run("IF(1, 5, 1 / 0)")).kind).toBe("division-by-zero");
    });

    it("BH_TRAN_* kẹp theo trần LƯU THÀNH TIỀN (không nhân lại hệ số)", () => {
      expect(run("BH_TRAN_BHXH(50000000)")).toBe("46800000");
      expect(run("BH_TRAN_BHXH(10000000)")).toBe("10000000");
      expect(run("BH_TRAN_BHYT(46800000.01)")).toBe("46800000");
      expect(run("BH_TRAN_BHTN(120000000)")).toBe("99200000");
    });

    it.each([
      ["0", "0"],
      ["-1", "0"],
      ["5000000", "250000"],
      ["7500000", "500000"],
      ["10000000", "750000"],
      ["100000000", "25150000"],
    ])("TNCN_LUY_TIEN(%s) = %s theo 7 bậc seed", (income, tax) => {
      expect(run(`TNCN_LUY_TIEN(${income})`)).toBe(tax);
    });
  });

  describe("PAYROLL-ERR-020 — lỗi lúc TÍNH", () => {
    it("chia cho 0 ⇒ division-by-zero kèm vị trí mẫu số, KHÔNG trả 0/Infinity", () => {
      const err = failure(() => run("10 / (5 - 5)"));
      expect(err.kind).toBe("division-by-zero");
      expect(err.code).toBe("PAYROLL-ERR-020");
      expect(err.details.pos).toBe(6);
    });
  });

  describe("§13.6 C — ngân sách = SỐ LƯỢT THĂM NODE (tất định, không đồng hồ)", () => {
    // 200 node: 199 số + 1 node add.
    const full = parseFormula("1" + "+1".repeat(FORMULA_MAX_NODES - 2));
    const evalFull = (budget: Budget) =>
      evaluate(full.ast, { budget, statutory, resolveRef: () => new D(0) });

    it("mỗi lượt: đúng BUDGET_PER_PASS lượt thăm KHÔNG lỗi · thêm 1 ⇒ formula-budget-exceeded per-pass", () => {
      const budget = new Budget();
      budget.beginPass();
      for (let k = 0; k < BUDGET_PER_PASS / FORMULA_MAX_NODES; k++) evalFull(budget);
      expect(budget.visitsInPass).toBe(BUDGET_PER_PASS);
      const err = failure(() => budget.visit(1, "X"));
      expect(err.kind).toBe("formula-budget-exceeded");
      expect(err.details).toMatchObject({ limit: "per-pass", pass: 1, component: "X" });
    });

    it("🔴 ĐỐI CHỨNG DƯƠNG — mẫu ĐẦY 120×200 chạy 31 lượt (30 vòng gross-up + 1) KHÔNG vượt trần nào", () => {
      const budget = new Budget();
      for (let pass = 1; pass <= 31; pass++) {
        budget.beginPass();
        budget.visit(TEMPLATE_MAX_COMPONENTS * FORMULA_MAX_NODES);
      }
      expect(budget.visitsInLine).toBe(31 * TEMPLATE_MAX_COMPONENTS * FORMULA_MAX_NODES);
      expect(budget.visitsInLine).toBeLessThanOrEqual(BUDGET_PER_LINE);
    });

    it("tổng dòng: mỗi lượt trong hạn nhưng tổng vượt ⇒ per-line, details nêu lượt thứ mấy", () => {
      const budget = new Budget();
      for (let pass = 1; pass <= 31; pass++) {
        budget.beginPass();
        budget.visit(BUDGET_PER_PASS);
      }
      expect(budget.visitsInLine).toBe(BUDGET_PER_LINE);
      budget.beginPass();
      const err = failure(() => budget.visit(1));
      expect(err.details).toMatchObject({ limit: "per-line", pass: 32 });
    });

    it("ngân sách đếm TRONG lúc đánh giá thật (không chỉ ở bộ đếm)", () => {
      const budget = new Budget(150, BUDGET_PER_LINE);
      budget.beginPass();
      expect(failure(() => evalFull(budget)).details.limit).toBe("per-pass");
    });
  });

  it("ROUND một tham số làm tròn về số nguyên, HALF_UP xa số 0", () => {
    expect(run("ROUND(2.5)")).toBe("3");
    expect(run("ROUND(-2.5)")).toBe("-3");
    expect(run("ROUND(2.49)")).toBe("2");
  });
});
