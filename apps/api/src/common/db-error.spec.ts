import { describe, it, expect } from "vitest";
import {
  pgErrorCode,
  pgErrorField,
  isUniqueViolation,
  isForeignKeyViolation,
  PG_UNIQUE_VIOLATION,
  PG_FK_VIOLATION,
} from "./db-error";

/**
 * Crux: drizzle-orm ≥0.40 (bump 0.45) bọc pg error trong DrizzleQueryError → `.code` ở `.cause`,
 * KHÔNG ở top-level. Spec cũ của các service mock error PHẲNG `{code:'23505'}` nên KHÔNG chứng minh
 * được nhánh walk-`.cause` (sec-review MEDIUM). Spec này khoá đúng hành vi đó: walk cause + depth-bound +
 * null-safe — nếu ai đó hoàn nguyên về đọc top-level `.code` thì test này ĐỎ.
 */
describe("db-error — pgErrorCode walks DrizzleQueryError .cause", () => {
  it("flat pg error: reads top-level code (back-compat)", () => {
    expect(pgErrorCode({ code: "23505" })).toBe("23505");
  });

  it("drizzle 0.45 wrap: reads code from .cause (depth 1) — the real fix", () => {
    const wrapped = {
      name: "DrizzleQueryError",
      message: 'Failed query: insert into "labels" ...',
      cause: { code: "23505", constraint: "uq_labels_company_project_name" },
    };
    expect(pgErrorCode(wrapped)).toBe("23505");
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("nested .cause chain within bound (depth ≤4) → found", () => {
    expect(pgErrorCode({ cause: { cause: { cause: { code: "23503" } } } })).toBe("23503");
    expect(isForeignKeyViolation({ cause: { cause: { code: PG_FK_VIOLATION } } })).toBe(true);
  });

  it("beyond depth bound (code at depth 6) → undefined (no infinite walk)", () => {
    const deep = {
      cause: { cause: { cause: { cause: { cause: { cause: { code: "23505" } } } } } },
    };
    expect(pgErrorCode(deep)).toBeUndefined();
    expect(isUniqueViolation(deep)).toBe(false);
  });

  it("null / undefined / non-object / Error-without-code → undefined, KHÔNG ném", () => {
    expect(pgErrorCode(null)).toBeUndefined();
    expect(pgErrorCode(undefined)).toBeUndefined();
    expect(pgErrorCode("boom")).toBeUndefined();
    expect(pgErrorCode(123)).toBeUndefined();
    expect(pgErrorCode(new Error("no code"))).toBeUndefined();
    expect(pgErrorCode({ message: "no code field" })).toBeUndefined();
  });

  it("non-string code (number) KHÔNG khớp — chỉ nhận code dạng string", () => {
    expect(pgErrorCode({ code: 23505 })).toBeUndefined();
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
  });

  it("wrong code → isUniqueViolation false (không false-positive che lỗi khác)", () => {
    expect(isUniqueViolation({ cause: { code: "23503" } })).toBe(false);
    expect(isUniqueViolation({ cause: { code: PG_UNIQUE_VIOLATION } })).toBe(true);
  });

  it("pgErrorField: trích constraint/detail qua .cause", () => {
    expect(pgErrorField({ cause: { constraint: "uq_x" } }, "constraint")).toBe("uq_x");
    expect(pgErrorField({ code: "23505" }, "constraint")).toBeUndefined();
    expect(pgErrorField(null, "constraint")).toBeUndefined();
  });
});
