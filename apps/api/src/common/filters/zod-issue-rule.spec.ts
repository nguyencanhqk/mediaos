import { describe, expect, it } from "vitest";
import { emailParams } from "@mediaos/contracts";
import { z } from "zod";
import { aliasZodRule, zodIssuesToDetails } from "./zod-issue-rule";

const rule = (schema: z.ZodType, v: unknown) => {
  const r = schema.safeParse(v);
  if (r.success) throw new Error("expected failure");
  return aliasZodRule(r.error.issues[0]!);
};

describe("aliasZodRule — v4 → v3", () => {
  it("email → invalid_string", () => {
    expect(rule(z.string().email(emailParams()), "x")).toBe("invalid_string");
  });
  it("enum → invalid_enum_value · literal → invalid_literal", () => {
    expect(rule(z.enum(["a", "b"]), "c")).toBe("invalid_enum_value");
    expect(rule(z.literal("a"), "c")).toBe("invalid_literal");
  });
  it("discriminatedUnion sai nhánh → invalid_union_discriminator; union thường giữ invalid_union", () => {
    const du = z.discriminatedUnion("kind", [z.object({ kind: z.literal("a") })]);
    expect(rule(du, { kind: "z" })).toBe("invalid_union_discriminator");
    expect(rule(z.union([z.string(), z.number()]), true)).toBe("invalid_union");
  });
  it("date → invalid_date; type khác giữ invalid_type", () => {
    expect(rule(z.date(), "nope")).toBe("invalid_date");
    expect(rule(z.string(), 1)).toBe("invalid_type");
  });
  it("mã không khớp giữ nguyên v4", () => {
    expect(rule(z.string().min(3), "a")).toBe("too_small");
    expect(rule(z.object({}).strict(), { a: 1 })).toBe("unrecognized_keys");
  });
});

describe("zodIssuesToDetails", () => {
  it("không có issues ⇒ null (400 không details, không ném)", () => {
    expect(zodIssuesToDetails(undefined)).toBeNull();
    expect(zodIssuesToDetails({})).toBeNull();
    expect(zodIssuesToDetails({ issues: "x" })).toBeNull();
  });
  it("path chứa symbol không làm ném", () => {
    const d = zodIssuesToDetails({ issues: [{ code: "custom", path: ["a", Symbol("s"), 0], message: "m" }] });
    expect(d).toEqual([{ field: "a.Symbol(s).0", message: "m", rule: "custom" }]);
  });
});
