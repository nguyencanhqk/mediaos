import { describe, expect, it } from "vitest";
import { FormulaError, type FormulaErrorKind } from "./formula.errors";
import { FORMULA_MAX_DEPTH, FORMULA_MAX_LENGTH, FORMULA_MAX_NODES } from "./formula.limits";
import { parseFormula } from "./formula.parser";

/**
 * S15-PAYROLL-BE-2 — grammar ĐÓNG của SPEC-11 §13.6 A + giới hạn TĨNH §13.6 B, đo ĐÚNG BIÊN (n hợp lệ ·
 * n+1 lỗi). Mọi ca lỗi assert CẢ `kind` lẫn `pos`/`reason` — FE tô đỏ theo `pos`, rẽ nhánh theo `kind`.
 */

function failure(src: string): FormulaError {
  try {
    parseFormula(src);
  } catch (err) {
    if (err instanceof FormulaError) return err;
    throw err;
  }
  throw new Error(`kỳ vọng lỗi cho ${JSON.stringify(src.slice(0, 40))}`);
}

const expectKind = (src: string, kind: FormulaErrorKind) => {
  const err = failure(src);
  expect(err.kind, err.message).toBe(kind);
  return err;
};

describe("S15-PAYROLL-BE-2 · parser công thức", () => {
  describe("cú pháp hợp lệ", () => {
    it("ưu tiên toán tử: × ÷ trước + −, so sánh sau cộng, AND trước OR", () => {
      const p = parseFormula("A + B * C > D AND E OR F");
      expect(p.ast.t).toBe("or");
      if (p.ast.t !== "or") return;
      expect(p.ast.args[0].t).toBe("and");
      expect(p.refs).toEqual(["A", "B", "C", "D", "E", "F"]);
    });

    it("công thức seed thật parse được và thu đúng REF theo thứ tự xuất hiện, không trùng", () => {
      const p = parseFormula(
        "SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_PRESENT_DAYS / SYS_WORK_DAYS",
      );
      expect(p.refs).toEqual([
        "SYS_BASE_SALARY",
        "SYS_PAY_RATIO",
        "SYS_PRESENT_DAYS",
        "SYS_WORK_DAYS",
      ]);
      expect(parseFormula("B + A + B").refs).toEqual(["B", "A"]);
      expect(parseFormula("TNCN_LUY_TIEN(THU_NHAP_CHIU_THUE)").refs).toEqual([
        "THU_NHAP_CHIU_THUE",
      ]);
    });

    it("chuỗi cộng DÀI là node n-ngôi: 25 số hạng có độ sâu 2, không phải 25", () => {
      const src = Array.from({ length: 25 }, (_, i) => `PC_${i}`).join(" + ");
      const p = parseFormula(src);
      expect(p.depth).toBe(2);
      expect(p.nodes).toBe(26);
    });

    it("số thập phân giữ NGUYÊN VĂN literal (không đi qua số thực)", () => {
      const p = parseFormula("19999999.99");
      expect(p.ast).toEqual({ t: "num", pos: 0, value: "19999999.99" });
    });

    it("ROUND nhận tham số thứ hai là số nguyên -6..6 (kể cả dấu âm)", () => {
      expect(() => parseFormula("ROUND(A, -3)")).not.toThrow();
      expect(() => parseFormula("ROUND(A, 6)")).not.toThrow();
      expect(() => parseFormula("ROUND(A)")).not.toThrow();
    });

    it("khoảng trắng · tab · xuống dòng được bỏ qua", () => {
      expect(parseFormula("A\t+\r\nB").refs).toEqual(["A", "B"]);
    });
  });

  describe("§13.6 B — giới hạn TĨNH đo đúng biên", () => {
    it(`độ dài: ${FORMULA_MAX_LENGTH} ký tự hợp lệ · ${FORMULA_MAX_LENGTH + 1} ⇒ formula-too-long`, () => {
      expect(() => parseFormula("1" + " ".repeat(FORMULA_MAX_LENGTH - 1))).not.toThrow();
      const err = expectKind("1" + " ".repeat(FORMULA_MAX_LENGTH), "formula-too-long");
      expect(err.code).toBe("PAYROLL-ERR-018");
    });

    it("chuỗi 10 MB bị chặn bởi trần độ dài TRƯỚC khi tokenize (không quét ký tự nào)", () => {
      expectKind("\u0000".repeat(10_000_000), "formula-too-long");
    });

    it(`số node: ${FORMULA_MAX_NODES} hợp lệ · ${FORMULA_MAX_NODES + 1} ⇒ formula-too-many-nodes`, () => {
      // "1" + "+1"×k ⇒ (k+1) số + 1 node add.
      expect(parseFormula("1" + "+1".repeat(FORMULA_MAX_NODES - 2)).nodes).toBe(FORMULA_MAX_NODES);
      expectKind("1" + "+1".repeat(FORMULA_MAX_NODES - 1), "formula-too-many-nodes");
    });

    it(`lồng ngoặc: ${FORMULA_MAX_DEPTH - 1} cấp hợp lệ · ${FORMULA_MAX_DEPTH} cấp ⇒ formula-too-deep`, () => {
      const nest = (k: number) => "(".repeat(k) + "1" + ")".repeat(k);
      expect(() => parseFormula(nest(FORMULA_MAX_DEPTH - 1))).not.toThrow();
      expectKind(nest(FORMULA_MAX_DEPTH), "formula-too-deep");
    });

    it("ngoặc lồng 10.000 cấp và 10.000 dấu âm dừng ở trần — không tràn stack", () => {
      expectKind("(".repeat(10_000) + "1" + ")".repeat(10_000), "formula-too-long");
      // Trần độ dài chặn trước; dựng chuỗi ≤ 500 ký tự để chạm đúng cổng độ sâu:
      expectKind("(".repeat(240) + "1" + ")".repeat(240), "formula-too-deep");
      expectKind("-".repeat(499) + "1", "formula-too-deep");
    });

    it(`dấu âm: ${FORMULA_MAX_DEPTH - 1} lớp hợp lệ (độ sâu ${FORMULA_MAX_DEPTH}) · ${FORMULA_MAX_DEPTH} lớp ⇒ too-deep`, () => {
      expect(parseFormula("-".repeat(FORMULA_MAX_DEPTH - 1) + "1").depth).toBe(FORMULA_MAX_DEPTH);
      expectKind("-".repeat(FORMULA_MAX_DEPTH) + "1", "formula-too-deep");
    });

    it("độ sâu AST vượt trần dù mức lồng ngoặc còn trong hạn ⇒ formula-too-deep (cổng thứ hai)", () => {
      // Mỗi cấp "1+2*(X)" cộng 2 độ sâu AST nhưng chỉ 1 mức lồng: 9 cấp = 19 · 10 cấp = 21.
      const build = (k: number): string => (k === 0 ? "1" : `1+2*(${build(k - 1)})`);
      expect(parseFormula(build(9)).depth).toBe(19);
      expectKind(build(10), "formula-too-deep");
    });
  });

  describe("formula-syntax — kèm vị trí", () => {
    it.each([
      ["", 0, "unexpected-end"],
      ["1 +", 3, "unexpected-end"],
      ["A B", 2, "unexpected-token"],
      ["(1", 2, "missing-close-paren"],
      ["1)", 1, "unexpected-token"],
      ["A < B < C", 6, "unexpected-token"],
      ["1..2", 1, "number-missing-fraction"],
      ["1.", 1, "number-missing-fraction"],
      [".5", 0, "invalid-character"],
      ["1234567890123456", 0, "number-too-long"],
      ["1.1234567", 2, "number-too-long"],
      ["12ABC", 2, "number-malformed"],
      ["1.5.2", 3, "number-malformed"],
      ["MIN", 0, "function-without-call"],
      ["AND", 0, "unexpected-keyword"],
      ["A AND", 5, "unexpected-end"],
      ["+5", 0, "unexpected-token"],
      ["A == B", 3, "unexpected-token"],
    ])("%j ⇒ pos %i · %s", (src, pos, reason) => {
      const err = expectKind(src, "formula-syntax");
      expect(err.details.pos).toBe(pos);
      expect(err.details.reason).toBe(reason);
    });

    it.each([
      ["SYS_BASE_SALARY + á", 18],
      ["a", 0],
      ["1\u00002", 1],
      ["'x'", 0],
      ['"x"', 0],
      ["A[0]", 1],
      ["A != B", 2],
      ["$A", 0],
      ["A; B", 1],
      ["😀", 0],
    ])("ký tự ngoài bảng chữ cái %j ⇒ invalid-character tại %i", (src, pos) => {
      const err = expectKind(src, "formula-syntax");
      expect(err.details).toMatchObject({ pos, reason: "invalid-character" });
    });

    it("định danh dài hơn 32 ký tự ⇒ identifier-too-long", () => {
      expect(() => parseFormula("A".repeat(32))).not.toThrow();
      expect(expectKind("A".repeat(33), "formula-syntax").details.reason).toBe(
        "identifier-too-long",
      );
    });

    it.each(["constructor", "__proto__", "process.exit()", "eval(1)", "this", "globalThis"])(
      "chuỗi giống JS %j KHÔNG BAO GIỜ thành lời gọi — sai cú pháp tại vị trí 0",
      (src) => {
        expect(expectKind(src, "formula-syntax").details.pos).toBe(0);
      },
    );
  });

  describe("hàm — danh sách ĐÓNG + arity", () => {
    it("tên hàm ngoài danh sách ⇒ formula-unknown-function", () => {
      const err = expectKind("SQRT(4)", "formula-unknown-function");
      expect(err.details).toMatchObject({ pos: 0, func: "SQRT" });
      expectKind("A + FUNCTION(1)", "formula-unknown-function");
    });

    it.each([
      ["IF(1, 2)", "argument-count"],
      ["IF(1, 2, 3, 4)", "argument-count"],
      ["MIN(1)", "argument-count"],
      ["MAX()", "argument-count"],
      ["ABS(1, 2)", "argument-count"],
      ["TNCN_LUY_TIEN()", "argument-count"],
      ["BH_TRAN_BHXH(1, 2)", "argument-count"],
      ["ROUND(1, 2, 3)", "argument-count"],
      ["ROUND(1, 7)", "round-digits"],
      ["ROUND(1, -7)", "round-digits"],
      ["ROUND(1, 10)", "round-digits"],
      ["ROUND(1, 1.5)", "round-digits"],
      ["ROUND(1, A)", "round-digits"],
      ["ROUND(1, 1 + 1)", "round-digits"],
    ])("%j ⇒ formula-arity (%s)", (src, reason) => {
      expect(expectKind(src, "formula-arity").details.reason).toBe(reason);
    });

    it("MIN/MAX không trần trên số tham số (vẫn chịu trần node)", () => {
      expect(() =>
        parseFormula(`MIN(${Array.from({ length: 50 }, () => "1").join(",")})`),
      ).not.toThrow();
    });
  });

  it("OR có vế phải NÔNG hơn vế trái vẫn giữ độ sâu lớn nhất; lời gọi hàm thiếu ngoặc đóng ⇒ missing-close-paren", () => {
    expect(parseFormula("A + B OR C").depth).toBe(3);
    const err = expectKind("MIN(1, 2", "formula-syntax");
    expect(err.details).toMatchObject({ pos: 8, reason: "missing-close-paren" });
  });
});
