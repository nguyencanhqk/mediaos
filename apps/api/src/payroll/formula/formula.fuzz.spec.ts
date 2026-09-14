import { describe, expect, it } from "vitest";
import { D } from "./formula.decimal";
import { FORMULA_ERROR_KINDS, FormulaError } from "./formula.errors";
import { Budget, evaluate } from "./formula.evaluator";
import { parseFormula } from "./formula.parser";
import { toStatutoryValues } from "./formula.statutory";

/**
 * S15-PAYROLL-BE-2 — FUZZ parser + evaluator (SPEC-11 §18.1 D · §21.1 B5).
 *
 * Yêu cầu: với MỌI đầu vào, kết quả là AST hợp lệ HOẶC `FormulaError` có `kind` thuộc bảng ĐÓNG — không bao
 * giờ exception khác (⇒ 500), không tràn stack, không treo. PRNG CÓ SEED (mulberry32) ⇒ tái lập 100%; không
 * có assert đồng hồ nào (`slow-probe-manufactures-timeout-red`).
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const statutory = toStatutoryValues({
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
});

const KNOWN_KINDS = new Set(Object.keys(FORMULA_ERROR_KINDS));

type Outcome = "ok" | "formula-error";

/** Parse + đánh giá; mọi exception KHÔNG phải FormulaError được ném lại để ca test ĐỎ. */
function probe(src: string): Outcome {
  try {
    const parsed = parseFormula(src);
    const budget = new Budget();
    budget.beginPass();
    evaluate(parsed.ast, { budget, statutory, resolveRef: () => new D("1.5") });
    return "ok";
  } catch (err) {
    if (err instanceof FormulaError && KNOWN_KINDS.has(err.kind)) return "formula-error";
    throw new Error(
      `đầu vào ${JSON.stringify(src.slice(0, 120))} ném lỗi NGOÀI bảng: ${String(err)}`,
    );
  }
}

const TOKENS = [
  "A",
  "B",
  "SYS_BASE_SALARY",
  "TL_BHXH_NV",
  "TONG_THU_NHAP",
  "IF",
  "MIN",
  "MAX",
  "ROUND",
  "ABS",
  "TNCN_LUY_TIEN",
  "BH_TRAN_BHXH",
  "AND",
  "OR",
  "(",
  ")",
  ",",
  "+",
  "-",
  "*",
  "/",
  "=",
  "<>",
  "<",
  "<=",
  ">",
  ">=",
  "0",
  "1",
  "1.5",
  "999999999999999",
  "0.000001",
  " ",
  "  ",
];
const RAW = [
  "\u0000",
  "á",
  "😀",
  "'",
  '"',
  "$",
  "[",
  "]",
  ".",
  "_",
  "a",
  "\\",
  "\n",
  "\t",
  "`",
  "{",
  "}",
  ";",
  "!",
];

describe("S15-PAYROLL-BE-2 · fuzz máy công thức", () => {
  it("1.200 chuỗi «súp token» ngẫu nhiên: luôn AST hoặc FormulaError trong bảng đóng", () => {
    const rnd = mulberry32(0x5eed_be02);
    const tally: Record<Outcome, number> = { ok: 0, "formula-error": 0 };
    for (let n = 0; n < 1200; n++) {
      const len = Math.floor(rnd() * 40);
      let src = "";
      for (let k = 0; k < len; k++) {
        src +=
          rnd() < 0.85
            ? TOKENS[Math.floor(rnd() * TOKENS.length)]
            : RAW[Math.floor(rnd() * RAW.length)];
      }
      tally[probe(src)]++;
    }
    expect(tally.ok + tally["formula-error"]).toBe(1200);
    expect(tally["formula-error"], "fuzz không chạm nhánh lỗi nào ⇒ xanh rỗng").toBeGreaterThan(
      100,
    );
  });

  it("600 công thức sinh ĐÚNG grammar: parse không bao giờ lỗi cú pháp (chỉ trần tĩnh/tính được phép)", () => {
    const rnd = mulberry32(0xc0ffee);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    const gen = (depth: number): string => {
      if (depth > 5 || rnd() < 0.3)
        return pick(["A", "B", "SYS_BASE_SALARY", "2", "0.5", "100", "0"]);
      switch (Math.floor(rnd() * 7)) {
        case 0:
          return `${gen(depth + 1)} ${pick(["+", "-", "*", "/"])} ${gen(depth + 1)}`;
        case 1:
          return `-${gen(depth + 1)}`;
        case 2:
          return `(${gen(depth + 1)})`;
        case 3:
          return `IF(${gen(depth + 1)} ${pick(["=", "<>", "<", "<=", ">", ">="])} ${gen(depth + 1)}, ${gen(depth + 1)}, ${gen(depth + 1)})`;
        case 4:
          return `${pick(["MIN", "MAX"])}(${gen(depth + 1)}, ${gen(depth + 1)})`;
        case 5:
          return `ROUND(${gen(depth + 1)}, ${pick(["-3", "0", "2"])})`;
        default:
          return `${pick(["ABS", "CEIL", "FLOOR", "TNCN_LUY_TIEN", "BH_TRAN_BHXH"])}(${gen(depth + 1)})`;
      }
    };
    const allowed = new Set([
      "formula-too-long",
      "formula-too-deep",
      "formula-too-many-nodes",
      "division-by-zero",
    ]);
    let ok = 0;
    for (let n = 0; n < 600; n++) {
      const src = gen(0);
      try {
        const parsed = parseFormula(src);
        const budget = new Budget();
        budget.beginPass();
        evaluate(parsed.ast, { budget, statutory, resolveRef: () => new D("3") });
        ok++;
      } catch (err) {
        if (!(err instanceof FormulaError) || !allowed.has(err.kind)) {
          throw new Error(`công thức ĐÚNG grammar bị từ chối: ${src} — ${String(err)}`);
        }
      }
    }
    expect(ok, "đa số công thức hợp lệ phải tính được").toBeGreaterThan(300);
  });

  it.each([
    ["ngoặc lồng 10.000 cấp", "(".repeat(10_000) + "1" + ")".repeat(10_000)],
    ["ngoặc lồng vừa trần độ dài", "(".repeat(249) + "1" + ")".repeat(250)],
    ["số 500 chữ số", "9".repeat(500)],
    [
      "byte NUL thật (escape trong nguồn — byte NUL THẬT làm grep bỏ qua cả file)",
      "SYS_BASE_SALARY \u0000+ 1",
    ],
    ["unicode", "LƯƠNG + 1"],
    ["giống JS", "constructor.prototype"],
    ["__proto__", "__proto__"],
    ["process.exit()", "process.exit()"],
    ["template literal", "`${1}`"],
    ["dấu âm 499 lớp", "-".repeat(499) + "1"],
    ["chỉ khoảng trắng", " ".repeat(500)],
    ["MIN 250 tham số", `MIN(${Array.from({ length: 250 }, () => "1").join(",")})`],
  ])("ca biên %s ⇒ FormulaError có mã, không exception lạ", (_label, src) => {
    expect(probe(src)).toBe("formula-error");
  });
});
