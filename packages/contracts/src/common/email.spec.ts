import { describe, expect, it } from "vitest";
import { z } from "zod";
import { emailParams, emailSchema, ZOD3_EMAIL_REGEX } from "../index";

/**
 * S19-OPS-ZOD4-1 — `emailSchema` giữ ĐÚNG hành vi email của zod 3.25.76 qua lần nâng zod 4 (§9.2-5).
 * Kỳ vọng dưới đây đo trên zod 3.25.76 (regex `node_modules/zod/v3/types.js:384`). Có ca zod 4 mặc định xử
 * khác (regex v4 khác) ⇒ nếu C3 quên truyền `pattern: ZOD3_EMAIL_REGEX` thì bảng này đỏ.
 */
const GOLDEN: ReadonlyArray<readonly [string, boolean]> = [
  ["a@b.co", true],
  ["nguyen.van.a@congty.com.vn", true],
  ["a+tag@x.io", true],
  ["o'brien@x.com", true],
  ["a_b-c@sub-domain.example.org", true],
  ["A.B@EXAMPLE.COM", true],
  ["a.-b@x.com", true],
  ["a@b", false],
  ["a@b.c", false],
  [".a@b.com", false],
  ["a..b@x.com", false],
  ["a.@x.com", false],
  ["a@-b.com", false],
  ["a@b..com", false],
  ["a b@x.com", false],
  ["a@x.com ", false],
  ["", false],
  ["a@1.23", false],
  ["người@x.com", false],
  ['"a"@x.com', false],
];

describe("emailSchema — regex Y HỆT zod 3.25.76", () => {
  it.each(GOLDEN)("%j ⇒ %s", (input, ok) => {
    expect(emailSchema.safeParse(input).success).toBe(ok);
    expect(ZOD3_EMAIL_REGEX.test(input)).toBe(ok);
  });

  it("emailParams(): không thông điệp ⇒ chỉ pattern zod3 · có thông điệp ⇒ đi vào issue", () => {
    expect(emailParams()).toEqual({ pattern: ZOD3_EMAIL_REGEX });
    const res = z.string().trim().email(emailParams("khoa.i18n.email")).safeParse(" x ");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toBe("khoa.i18n.email");
  });

  it("trim TRƯỚC email giữ thứ tự check: ' a@b.co ' qua được sau trim", () => {
    expect(z.string().trim().email(emailParams()).parse(" a@b.co ")).toBe("a@b.co");
  });
});

/**
 * Bản zod 3 NGUYÊN VĂN (có cờ `i`, chép như HEAD trước vá) — chỉ để so tương đương; mã chạy dùng ZOD3_EMAIL_REGEX
 * không cờ. Dạng chuỗi `String.raw` giữ nguyên ký tự thoát của bản gốc (regex literal sẽ vướng no-useless-escape).
 */
const ZOD3_ORIGINAL_I = new RegExp(
  String.raw`^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$`,
  "i",
);

/** mulberry32 — sinh số giả ngẫu nhiên có hạt giống ⇒ tập chuỗi tái lập được. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Có cả ký tự ngoài ASCII mà toUpperCase/toLowerCase đụng tới chữ ASCII (ſ→S, K Kelvin, ı, İ) — bẫy gập chữ.
const ALPHABET = [..."abcxyzABCXYZ019._'+-@ ", "ſ", "K", "ı", "İ", "é", "É"];

function sample(next: () => number): string {
  const len = 1 + Math.floor(next() * 14);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(next() * ALPHABET.length)];
  return out;
}

describe("ZOD3_EMAIL_REGEX không cờ ≡ regex zod 3 có /i (vá FULL gate §10.8)", () => {
  it("không mang cờ nào", () => {
    expect(ZOD3_EMAIL_REGEX.flags).toBe("");
  });

  it("cùng kết quả trên 20.000 chuỗi sinh có hạt giống + biến thể hoa/thường của bảng vàng", () => {
    const next = rng(0x5eed);
    const inputs: string[] = [];
    for (let i = 0; i < 20_000; i++) inputs.push(sample(next));
    // Chuỗi có dạng gần-email để không chỉ đo nhánh trượt sớm.
    for (let i = 0; i < 5_000; i++) inputs.push(`${sample(next)}@${sample(next)}.${sample(next)}`);
    for (const [g] of GOLDEN) inputs.push(g, g.toUpperCase(), g.toLowerCase());
    const diff = inputs.filter((s) => ZOD3_EMAIL_REGEX.test(s) !== ZOD3_ORIGINAL_I.test(s));
    expect(diff).toEqual([]);
    // Chống xanh rỗng: tập phải có cả ca nhận lẫn ca từ chối.
    expect(inputs.some((s) => ZOD3_EMAIL_REGEX.test(s))).toBe(true);
    expect(inputs.some((s) => !ZOD3_EMAIL_REGEX.test(s))).toBe(true);
  });

  it.each([
    ["emailSchema", emailSchema],
    ["z.string().email(emailParams())", z.string().email(emailParams())],
  ])(
    "%s: `pattern` trong z.toJSONSchema dùng như new RegExp(pattern) KHÔNG cờ nhận cả thường lẫn hoa",
    (_n, s) => {
      const json = z.toJSONSchema(s) as { pattern?: unknown };
      expect(typeof json.pattern).toBe("string");
      const re = new RegExp(json.pattern as string);
      expect(re.test("a@b.co")).toBe(true);
      expect(re.test("A@B.CO")).toBe(true);
      expect(re.test("a@b")).toBe(false);
    },
  );
});
