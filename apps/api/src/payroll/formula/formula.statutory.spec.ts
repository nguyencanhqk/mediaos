import { describe, expect, it } from "vitest";
import { FormulaError } from "./formula.errors";
import { assertBracketsContinuous, toStatutoryValues } from "./formula.statutory";

/**
 * S15-PAYROLL-BE-2 — kiểm LIÊN TỤC bậc TNCN (DB-13 §13.7: CHECK chỉ ép hình dạng mảng 7 phần tử). Ca test ghim
 * TỪNG hình dạng hỏng mà DB-13 liệt kê: hở · chồng · không tăng dần · bậc cuối có `upTo` · 6 bậc · 8 bậc.
 */

const SEED = [
  { upTo: 5000000, rate: 5 },
  { upTo: 10000000, rate: 10 },
  { upTo: 18000000, rate: 15 },
  { upTo: 32000000, rate: 20 },
  { upTo: 52000000, rate: 25 },
  { upTo: 80000000, rate: 30 },
  { upTo: null, rate: 35 },
];

const withBracket = (index: number, patch: Record<string, unknown>) =>
  SEED.map((b, i) => (i === index ? { ...b, ...patch } : b));

function reasonOf(raw: unknown): { reason?: string; pos?: number } {
  try {
    assertBracketsContinuous(raw);
  } catch (err) {
    if (err instanceof FormulaError) {
      expect(err.kind).toBe("statutory-rate-incomplete");
      expect(err.code).toBe("PAYROLL-ERR-022");
      return { reason: err.details.reason, pos: err.details.pos };
    }
    throw err;
  }
  throw new Error("kỳ vọng statutory-rate-incomplete");
}

describe("S15-PAYROLL-BE-2 · bậc thuế TNCN + giá trị luật định", () => {
  it("bảng seed 7 bậc hợp lệ; `upTo` dạng chuỗi (jsonb/numeric) cũng nhận", () => {
    expect(assertBracketsContinuous(SEED)).toHaveLength(7);
    expect(() => assertBracketsContinuous(withBracket(0, { upTo: "5000000" }))).not.toThrow();
  });

  it.each([
    [
      "6 bậc",
      SEED.slice(0, 6)
        .concat([{ upTo: null, rate: 35 }])
        .slice(1),
      "count",
      undefined,
    ],
    ["8 bậc", [{ upTo: 1000000, rate: 1 }, ...SEED], "count", undefined],
    ["không phải mảng", { upTo: null }, "count", undefined],
    ["CHỒNG — upTo bằng bậc trước", withBracket(1, { upTo: 5000000 }), "not-increasing", 1],
    [
      "không tăng dần — upTo nhỏ hơn bậc trước",
      withBracket(2, { upTo: 9000000 }),
      "not-increasing",
      2,
    ],
    ["upTo bằng 0", withBracket(0, { upTo: 0 }), "not-increasing", 0],
    ["HỞ — bậc giữa để trống upTo", withBracket(3, { upTo: null }), "open-not-last", 3],
    ["bậc cuối có upTo", withBracket(6, { upTo: 999999999 }), "last-not-open", 6],
    ["thuế suất > 100", withBracket(4, { rate: 101 }), "rate-range", 4],
    ["thuế suất âm", withBracket(4, { rate: -1 }), "rate-range", 4],
    [
      "phần tử null",
      withBracket(5, null as unknown as Record<string, unknown>).map((b, i) =>
        i === 5 ? null : b,
      ),
      "shape",
      5,
    ],
    ["upTo không phải số", withBracket(2, { upTo: "abc " }), "shape", 2],
  ])("%s ⇒ %s", (_label, raw, reason, pos) => {
    const got = reasonOf(raw);
    expect(got.reason).toBe(reason);
    if (pos !== undefined) expect(got.pos).toBe(pos);
  });

  it("toStatutoryValues ánh xạ TL_* là PHẦN TRĂM, GT_* là TIỀN, trần giữ NGUYÊN (không nhân hệ số)", () => {
    const v = toStatutoryValues({
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
      pitBrackets: SEED,
    });
    expect(v.refs.TL_BHXH_NV.toFixed(2)).toBe("8.00");
    expect(v.refs.TL_BHXH_DN.toFixed(2)).toBe("17.50");
    expect(v.refs.TL_DOAN_PHI.toFixed(2)).toBe("1.00");
    expect(v.refs.GT_NPT.toFixed(0)).toBe("4400000");
    expect(v.caps.BHXH.toFixed(0)).toBe("46800000");
    expect(v.caps.BHTN.toFixed(0)).toBe("99200000");
    expect(v.pitBrackets[6].upTo).toBeNull();
  });

  it("toStatutoryValues KIỂM LẠI bậc (dữ liệu có thể đã bị ghi thẳng DB sau lúc lưu)", () => {
    expect(() =>
      toStatutoryValues({
        siEmployeePct: 8,
        hiEmployeePct: 1.5,
        uiEmployeePct: 1,
        siEmployerPct: 17.5,
        hiEmployerPct: 3,
        uiEmployerPct: 1,
        unionEmployerPct: 2,
        unionEmployeePct: 1,
        siCap: 1,
        hiCap: 1,
        uiCap: 1,
        personalDeduction: 0,
        dependentDeduction: 0,
        pitBrackets: SEED.slice(0, 6),
      }),
    ).toThrow(FormulaError);
  });

  it("thuế suất KHÔNG phải số ⇒ shape (không để new D() ném lỗi thư viện ra ngoài)", () => {
    expect(reasonOf(withBracket(1, { rate: "x" }))).toMatchObject({ reason: "shape", pos: 1 });
  });
});
