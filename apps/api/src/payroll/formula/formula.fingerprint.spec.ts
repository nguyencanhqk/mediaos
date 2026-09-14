import { describe, expect, it } from "vitest";
import {
  formulaSetFingerprint,
  lineFingerprint,
  type FingerprintComponent,
} from "./formula.fingerprint";

/** S15-PAYROLL-BE-2 — fingerprint tập công thức (SPEC-11 §13.6 G): tất định, nhạy với MỌI trường đổi tiền. */

const BASE: FingerprintComponent[] = [
  {
    code: "LUONG_CO_BAN",
    kind: "earning",
    valueType: "formula",
    formula: "SYS_BASE_SALARY",
    fixedAmount: null,
    pitDeductible: false,
    isVisible: true,
    sortOrder: 10,
  },
  {
    code: "AN_CA",
    kind: "tax_exempt",
    valueType: "fixed",
    formula: null,
    fixedAmount: "730000.00",
    pitDeductible: false,
    isVisible: true,
    sortOrder: 20,
  },
];

describe("S15-PAYROLL-BE-2 · fingerprint tập công thức", () => {
  const fp = formulaSetFingerprint(BASE);

  it("SHA-256 hex 64 ký tự, không phụ thuộc thứ tự đầu vào", () => {
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(formulaSetFingerprint([...BASE].reverse())).toBe(fp);
  });

  it("fixedAmount chuẩn hoá: '730000' và '730000.00' cho CÙNG hash", () => {
    expect(formulaSetFingerprint([BASE[0], { ...BASE[1], fixedAmount: "730000" }])).toBe(fp);
  });

  it.each([
    ["công thức", { formula: "SYS_BASE_SALARY * 2" }],
    ["kind", { kind: "deduction" }],
    ["valueType", { valueType: "profile_item" }],
    ["pitDeductible", { pitDeductible: true }],
    ["ẩn/hiện", { isVisible: false }],
    ["thứ tự", { sortOrder: 30 }],
    ["mã", { code: "LUONG_CB" }],
  ])("đổi %s ⇒ đổi hash", (_label, patch) => {
    expect(formulaSetFingerprint([{ ...BASE[0], ...patch }, BASE[1]])).not.toBe(fp);
  });

  it("đổi số tiền cố định ⇒ đổi hash", () => {
    expect(formulaSetFingerprint([BASE[0], { ...BASE[1], fixedAmount: "730000.01" }])).not.toBe(fp);
  });

  it("lineFingerprint tách theo bản tỉ lệ; không có bản ⇒ khác mọi bản có id", () => {
    const a = lineFingerprint(fp, "11111111-1111-1111-1111-111111111111");
    const b = lineFingerprint(fp, "22222222-2222-2222-2222-222222222222");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(lineFingerprint(fp, null)).not.toBe(a);
    expect(lineFingerprint(fp, null)).toBe(lineFingerprint(fp, null));
  });

  it("thứ tự BẰNG nhau ⇒ phân định theo MÃ, không phụ thuộc thứ tự đầu vào (fingerprint tất định)", () => {
    const a = { ...BASE[0], code: "A_CODE", sortOrder: 5 };
    const b = { ...BASE[1], code: "B_CODE", sortOrder: 5 };
    expect(formulaSetFingerprint([a, b])).toBe(formulaSetFingerprint([b, a]));
    expect(formulaSetFingerprint([a, b])).not.toBe(formulaSetFingerprint([{ ...a, sortOrder: 6 }, b]));
  });
});
