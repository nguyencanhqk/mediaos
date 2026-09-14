import { integerLiteralOf, type CallNode, type FormulaNode } from "./formula.ast";
import { D, intermediate, ONE, ZERO, type Dec } from "./formula.decimal";
import { FormulaError } from "./formula.errors";
import { BUDGET_PER_LINE, BUDGET_PER_PASS } from "./formula.limits";
import type { StatutoryValues } from "./formula.statutory";

/**
 * S15-PAYROLL-BE-2 — evaluator đi trên AST (SPEC-11 §13.6 A · C · F).
 *
 * - Mọi phép `+ − × ÷` cắt về scale trung gian 10 NGAY sau phép tính (`intermediate`).
 * - `÷ 0` ⇒ 020 `division-by-zero` — KHÔNG trả 0, KHÔNG `Infinity`.
 * - So sánh / `AND` / `OR` trả `1` hoặc `0`. `IF` · `AND` · `OR` đánh giá **mọi** tham số (không
 *   short-circuit): không có tác dụng phụ nên kết quả không đổi, còn ngân sách node thì TẤT ĐỊNH.
 * - Ngân sách = SỐ LƯỢT THĂM NODE (`Budget`), không đồng hồ.
 */

/**
 * Bộ đếm ngân sách của MỘT DÒNG lương. Hai trần ĐỒNG THỜI (§13.6 C): mỗi lượt chạy đồ thị ≤ `perPass`, tổng
 * cả dòng ≤ `perLine`. Tạo MỘT `Budget` cho mỗi dòng, gọi `beginPass()` trước mỗi lượt (gross-up của BE-3
 * chạy tới 31 lượt trên CÙNG một `Budget`).
 */
export class Budget {
  private passVisits = 0;
  private lineVisits = 0;
  private passIndex = 0;

  constructor(
    readonly perPass: number = BUDGET_PER_PASS,
    readonly perLine: number = BUDGET_PER_LINE,
  ) {}

  beginPass(): void {
    this.passIndex++;
    this.passVisits = 0;
  }

  visit(count: number, component?: string): void {
    this.passVisits += count;
    this.lineVisits += count;
    if (this.passVisits > this.perPass) throw this.exceeded("per-pass", component);
    if (this.lineVisits > this.perLine) throw this.exceeded("per-line", component);
  }

  get visitsInPass(): number {
    return this.passVisits;
  }

  get visitsInLine(): number {
    return this.lineVisits;
  }

  private exceeded(limit: "per-pass" | "per-line", component?: string): FormulaError {
    return new FormulaError(
      "formula-budget-exceeded",
      limit === "per-pass"
        ? `Mẫu bảng lương vượt ngân sách đánh giá của một lượt (${this.perPass} bước).`
        : `Dòng lương vượt tổng ngân sách đánh giá (${this.perLine} bước) ở lượt thứ ${this.passIndex}.`,
      { limit, pass: this.passIndex, component },
    );
  }
}

export interface EvalScope {
  /** Giá trị của một REF đã phân giải lúc biên dịch (biến SYS, hằng TL/GT, hoặc mã thành phần). */
  readonly resolveRef: (name: string, pos: number) => Dec;
  readonly statutory: StatutoryValues;
  readonly budget: Budget;
  /** Mã thành phần đang đánh giá — chỉ để gắn vào `details` khi lỗi. */
  readonly component?: string;
}

export function evaluate(node: FormulaNode, scope: EvalScope): Dec {
  scope.budget.visit(1, scope.component);
  switch (node.t) {
    case "num":
      return new D(node.value);
    case "ref":
      return scope.resolveRef(node.name, node.pos);
    case "neg":
      return intermediate(evaluate(node.arg, scope).neg());
    case "add": {
      let acc = evaluate(node.terms[0].node, scope);
      for (let k = 1; k < node.terms.length; k++) {
        const v = evaluate(node.terms[k].node, scope);
        acc = intermediate(node.terms[k].sign === "+" ? acc.plus(v) : acc.minus(v));
      }
      return acc;
    }
    case "mul": {
      let acc = evaluate(node.factors[0].node, scope);
      for (let k = 1; k < node.factors.length; k++) {
        const f = node.factors[k];
        const v = evaluate(f.node, scope);
        if (f.op === "/") {
          if (v.isZero()) {
            throw new FormulaError("division-by-zero", `Công thức chia cho 0 tại vị trí ${f.pos + 1}.`, {
              pos: f.pos,
              component: scope.component,
            });
          }
          acc = intermediate(acc.div(v));
        } else {
          acc = intermediate(acc.times(v));
        }
      }
      return acc;
    }
    case "cmp": {
      const l = evaluate(node.left, scope);
      const r = evaluate(node.right, scope);
      return truth(compare(node.op, l, r));
    }
    case "and": {
      const vals = node.args.map((a) => evaluate(a, scope));
      return truth(vals.every((v) => !v.isZero()));
    }
    case "or": {
      const vals = node.args.map((a) => evaluate(a, scope));
      return truth(vals.some((v) => !v.isZero()));
    }
    case "call":
      return evaluateCall(node, scope);
    // KHÔNG `default`: switch EXHAUSTIVE trên `node.t` — thêm một loại node mà quên nhánh là LỖI KIỂU
    // («Function lacks ending return statement»), không phải nhánh chết lúc chạy.
  }
}

function evaluateCall(node: CallNode, scope: EvalScope): Dec {
  const args = node.args.map((a) => evaluate(a, scope));
  switch (node.name) {
    case "IF":
      return args[0].isZero() ? args[2] : args[1];
    case "MIN":
      return args.reduce((m, v) => (v.lessThan(m) ? v : m));
    case "MAX":
      return args.reduce((m, v) => (v.greaterThan(m) ? v : m));
    case "ROUND":
      // Parser đã chốt tham số thứ hai là literal nguyên trong [-6, 6] (`formula-arity`) ⇒ không có nhánh «không phải số».
      return roundTo(args[0], node.args.length === 2 ? (integerLiteralOf(node.args[1]) as number) : 0);
    case "ABS":
      return args[0].abs();
    case "CEIL":
      return args[0].ceil();
    case "FLOOR":
      return args[0].floor();
    case "TNCN_LUY_TIEN":
      return progressiveTax(args[0], scope.statutory);
    case "BH_TRAN_BHXH":
      return minOf(args[0], scope.statutory.caps.BHXH);
    case "BH_TRAN_BHYT":
      return minOf(args[0], scope.statutory.caps.BHYT);
    case "BH_TRAN_BHTN":
      return minOf(args[0], scope.statutory.caps.BHTN);
    // KHÔNG `default`: exhaustive trên `FormulaFunc` — thêm hàm vào danh sách đóng mà quên nhánh là lỗi kiểu.
  }
}

/** `ROUND(x, n)` — `ROUND_HALF_UP`; `n < 0` làm tròn tới hàng chục/trăm/nghìn… (`n = -3` ⇒ nghìn đồng). */
function roundTo(x: Dec, digits: number): Dec {
  if (digits >= 0) return x.toDecimalPlaces(digits, D.ROUND_HALF_UP);
  const unit = new D(10).pow(-digits);
  return x.div(unit).toDecimalPlaces(0, D.ROUND_HALF_UP).times(unit);
}

/**
 * TNCN luỹ tiến từng phần (§13.7 E). Bậc đã được `assertBracketsContinuous` kiểm lúc LƯU bản tỉ lệ và lúc
 * dựng `StatutoryValues`, nên ở đây coi như liên tục. `x ≤ 0` ⇒ 0.
 */
function progressiveTax(x: Dec, statutory: StatutoryValues): Dec {
  if (x.lessThanOrEqualTo(ZERO)) return ZERO;
  let tax = ZERO;
  let lower = ZERO;
  for (const bracket of statutory.pitBrackets) {
    const upper = bracket.upTo;
    const top = upper === null || x.lessThan(upper) ? x : upper;
    if (top.greaterThan(lower)) {
      tax = intermediate(tax.plus(intermediate(top.minus(lower).times(bracket.rate).div(100))));
    }
    if (upper === null || x.lessThanOrEqualTo(upper)) break;
    lower = upper;
  }
  return tax;
}

const minOf = (a: Dec, b: Dec): Dec => (a.lessThan(b) ? a : b);

const truth = (b: boolean): Dec => (b ? ONE : ZERO);

function compare(op: CallNodeCmp, l: Dec, r: Dec): boolean {
  switch (op) {
    case "=":
      return l.equals(r);
    case "<>":
      return !l.equals(r);
    case "<":
      return l.lessThan(r);
    case "<=":
      return l.lessThanOrEqualTo(r);
    case ">":
      return l.greaterThan(r);
    case ">=":
      return l.greaterThanOrEqualTo(r);
  }
}

type CallNodeCmp = "=" | "<>" | "<" | "<=" | ">" | ">=";

