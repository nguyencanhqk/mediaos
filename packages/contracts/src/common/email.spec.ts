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
