import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  apiResponseSchema,
  paginationMetaSchema,
  paginationSchema,
  CONTRACTS_VERSION,
} from "./index";

const META = { request_id: "req-1", timestamp: "2026-06-23T00:00:00.000Z" };

describe("apiResponseSchema", () => {
  const userSchema = z.object({ id: z.string(), name: z.string() });

  it("validates a success envelope (message + meta required, error null)", () => {
    const schema = apiResponseSchema(userSchema);
    const parsed = schema.parse({
      success: true,
      message: "OK",
      data: { id: "1", name: "An" },
      error: null,
      meta: META,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.message).toBe("OK");
    expect(parsed.data).toEqual({ id: "1", name: "An" });
    expect(parsed.meta.request_id).toBe("req-1");
  });

  it("validates an error envelope (error {code,type,details}, null data)", () => {
    const schema = apiResponseSchema(userSchema);
    const parsed = schema.parse({
      success: false,
      message: "Không tìm thấy",
      data: null,
      error: {
        code: "RESOURCE-ERR-NOT-FOUND",
        message: "User not found",
        type: "NotFoundException",
        details: null,
      },
      meta: META,
    });
    expect(parsed.data).toBeNull();
    expect(parsed.error?.code).toBe("RESOURCE-ERR-NOT-FOUND");
    expect(parsed.error?.type).toBe("NotFoundException");
  });

  it("accepts a validation error with field-level details[]", () => {
    const schema = apiResponseSchema(z.null());
    const parsed = schema.parse({
      success: false,
      message: "Dữ liệu không hợp lệ",
      data: null,
      error: {
        code: "VALIDATION-ERR-001",
        message: "Validation failed",
        type: "ZodValidationException",
        details: [{ field: "email", message: "Required", rule: "invalid_type" }],
      },
      meta: META,
    });
    expect(parsed.error?.details?.[0]?.field).toBe("email");
  });

  it("rejects an envelope missing meta (meta is required)", () => {
    const schema = apiResponseSchema(z.null());
    expect(() => schema.parse({ success: true, message: "OK", data: null, error: null })).toThrow();
  });

  it("accepts an optional pagination block (separate from meta)", () => {
    const schema = apiResponseSchema(z.array(z.unknown()));
    const parsed = schema.parse({
      success: true,
      message: "OK",
      data: [],
      error: null,
      meta: META,
      pagination: {
        page: 1,
        per_page: 20,
        total: 0,
        total_pages: 0,
        has_next: false,
        has_prev: false,
      },
    });
    expect(parsed.pagination?.page).toBe(1);
  });
});

describe("paginationSchema (API-01 §16.1)", () => {
  it("accepts a full pagination block", () => {
    const parsed = paginationSchema.parse({
      page: 2,
      per_page: 20,
      total: 100,
      total_pages: 5,
      has_next: true,
      has_prev: true,
    });
    expect(parsed.total_pages).toBe(5);
  });

  it("rejects when a field is missing", () => {
    expect(() => paginationSchema.parse({ page: 1, per_page: 20 })).toThrow();
  });
});

describe("paginationMetaSchema (deprecated alias)", () => {
  it("rejects non-positive page", () => {
    expect(() => paginationMetaSchema.parse({ total: 0, page: 0, limit: 20 })).toThrow();
  });
});

describe("CONTRACTS_VERSION", () => {
  it("is a fixed string", () => {
    expect(typeof CONTRACTS_VERSION).toBe("string");
  });
});
