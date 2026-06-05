import { describe, expect, it } from "vitest";
import { z } from "zod";
import { apiResponseSchema, paginationMetaSchema, CONTRACTS_VERSION } from "./index";

describe("apiResponseSchema", () => {
  const userSchema = z.object({ id: z.string(), name: z.string() });

  it("validates a success envelope", () => {
    const schema = apiResponseSchema(userSchema);
    const parsed = schema.parse({
      success: true,
      data: { id: "1", name: "An" },
      error: null,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ id: "1", name: "An" });
  });

  it("validates an error envelope with null data", () => {
    const schema = apiResponseSchema(userSchema);
    const parsed = schema.parse({
      success: false,
      data: null,
      error: { code: "NOT_FOUND", message: "User not found" },
    });
    expect(parsed.data).toBeNull();
    expect(parsed.error?.code).toBe("NOT_FOUND");
  });

  it("accepts optional pagination meta", () => {
    const schema = apiResponseSchema(z.array(userSchema));
    const parsed = schema.parse({
      success: true,
      data: [],
      error: null,
      meta: { total: 0, page: 1, limit: 20 },
    });
    expect(parsed.meta).toEqual({ total: 0, page: 1, limit: 20 });
  });
});

describe("paginationMetaSchema", () => {
  it("rejects non-positive page", () => {
    expect(() => paginationMetaSchema.parse({ total: 0, page: 0, limit: 20 })).toThrow();
  });
});

describe("CONTRACTS_VERSION", () => {
  it("is a fixed string", () => {
    expect(typeof CONTRACTS_VERSION).toBe("string");
  });
});
