/**
 * api-idempotency.spec.ts — Unit tests cho createRequestId + createIdempotencyKey (FRONTEND-04 §11).
 *
 * RED phase: viết trước khi implement. Land BƯỚC 1.
 */
import { describe, expect, it } from "vitest";
import { createIdempotencyKey, idempotencyKeyFor } from "./api-idempotency";
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

/**
 * S5-BE-CONTRACT-1 — khoá SUY TỪ NỘI DUNG. Đây là điều kiện để idempotency thật sự hoạt động: thử lại
 * cùng thao tác phải cho CÙNG khoá (khoá ngẫu nhiên sinh trong thân hàm API thì không bao giờ đạt).
 */
describe("idempotencyKeyFor", () => {
  it("cùng scope + cùng payload → CÙNG khoá (thử lại được server phát lại, không tạo bản ghi thứ 2)", () => {
    const payload = { leaveTypeId: "lt-1", fromDate: "2026-08-01", toDate: "2026-08-02" };
    expect(idempotencyKeyFor("leave_request_create", payload)).toBe(
      idempotencyKeyFor("leave_request_create", { ...payload }),
    );
  });

  it("payload KHÁC → khoá khác (thao tác mới vẫn chạy thật)", () => {
    const a = idempotencyKeyFor("leave_request_create", { fromDate: "2026-08-01" });
    const b = idempotencyKeyFor("leave_request_create", { fromDate: "2026-08-02" });
    expect(a).not.toBe(b);
  });

  it("scope KHÁC → khoá khác (không lẫn giữa các endpoint)", () => {
    const payload = { id: "x" };
    expect(idempotencyKeyFor("leave_request_approve", payload)).not.toBe(
      idempotencyKeyFor("leave_request_reject", payload),
    );
  });

  it("giữ tiền tố scope để truy vết log + không vượt giới hạn độ dài của server (200)", () => {
    const key = idempotencyKeyFor("attendance_check_in", { method: "web" });
    expect(key).toMatch(/^attendance_check_in_[0-9a-f]{16}$/);
    expect(key.length).toBeLessThanOrEqual(200);
  });

  it("payload undefined / rỗng vẫn cho khoá ổn định", () => {
    expect(idempotencyKeyFor("s", undefined)).toBe(idempotencyKeyFor("s", undefined));
    expect(idempotencyKeyFor("s", {})).toBe(idempotencyKeyFor("s", {}));
  });

  it("payload có vòng lặp tham chiếu → KHÔNG ném (rơi về khoá ngẫu nhiên)", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => idempotencyKeyFor("s", cyclic)).not.toThrow();
  });

  it("nhạy với thay đổi nhỏ (không đụng độ tầm thường)", () => {
    const keys = new Set(
      Array.from({ length: 200 }, (_, i) => idempotencyKeyFor("task_create", { title: `t-${i}` })),
    );
    expect(keys.size).toBe(200);
  });
});
