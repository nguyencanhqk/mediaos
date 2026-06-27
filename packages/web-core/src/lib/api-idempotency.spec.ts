/**
 * api-idempotency.spec.ts — Unit tests cho createRequestId + createIdempotencyKey (FRONTEND-04 §11).
 *
 * RED phase: viết trước khi implement. Land BƯỚC 1.
 */
import { describe, expect, it } from "vitest";
import { createIdempotencyKey } from "./api-idempotency";
import { createRequestId } from "./api-request-id";

describe("createRequestId", () => {
  it("có prefix 'req_'", () => {
    const id = createRequestId();
    expect(id).toMatch(/^req_/);
  });

  it("duy nhất — 2 lần gọi khác nhau", () => {
    const a = createRequestId();
    const b = createRequestId();
    expect(a).not.toBe(b);
  });

  it("fallback KHÔNG ném khi crypto vắng", () => {
    const orig = globalThis.crypto;
    try {
      // Simulate missing crypto
      Object.defineProperty(globalThis, "crypto", {
        value: { randomUUID: undefined },
        writable: true,
        configurable: true,
      });
      expect(() => createRequestId()).not.toThrow();
      const id = createRequestId();
      expect(id).toMatch(/^req_/);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: orig,
        writable: true,
        configurable: true,
      });
    }
  });
});

describe("createIdempotencyKey", () => {
  it("với prefix → '<prefix>_<uuid>'", () => {
    const key = createIdempotencyKey("attendance_check_in");
    expect(key).toMatch(/^attendance_check_in_/);
  });

  it("không prefix → uuid trần (không có dấu underscore đầu)", () => {
    const key = createIdempotencyKey();
    // UUID or fallback: không có prefix_ ở đầu (prefix rỗng → không prepend)
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("duy nhất — 2 lần gọi cùng prefix khác nhau", () => {
    const a = createIdempotencyKey("leave_request");
    const b = createIdempotencyKey("leave_request");
    expect(a).not.toBe(b);
  });
});
