import { HttpException, HttpStatus } from "@nestjs/common";
import type { ErrorDetail } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import {
  RETRY_AFTER_FIELD,
  RETRY_AFTER_MAX_SEC,
  RETRY_AFTER_RULE,
  TOO_MANY_REQUESTS_MESSAGE,
  retryAfterHeaderValue,
  tooManyRequests,
} from "./retry-after";

/** `getResponse()` của HttpException — payload object mà `AllExceptionsFilter` sẽ soi. */
function payloadOf(err: HttpException): Record<string, unknown> {
  const p = err.getResponse();
  expect(typeof p).toBe("object");
  return p as Record<string, unknown>;
}

function detail(over: Partial<ErrorDetail> = {}): ErrorDetail {
  return { field: RETRY_AFTER_FIELD, message: "900", rule: RETRY_AFTER_RULE, ...over };
}

describe("tooManyRequests — hợp đồng 429 (một chỗ duy nhất định nghĩa)", () => {
  it("có số giây ⇒ ĐÚNG 1 ErrorDetail {retryAfterSec, <giây>, retry-after} + status 429", () => {
    const err = tooManyRequests(900);

    expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(payloadOf(err).details).toEqual([
      { field: RETRY_AFTER_FIELD, message: "900", rule: RETRY_AFTER_RULE },
    ]);
  });

  it("`null` (Valkey rớt / hết TTL giữa chừng) ⇒ KHÔNG khai `details` NHƯNG `message` GIỮ NGUYÊN", () => {
    const err = tooManyRequests(null);

    // Nest `initMessage()` chỉ lấy `message` khi payload là object có `message: string`. Payload `{}`
    // sẽ cho `exception.message` = tên lớp ⇒ envelope đổi chữ mà không ai thấy.
    expect(err.message).toBe(TOO_MANY_REQUESTS_MESSAGE);
    expect(payloadOf(err)).not.toHaveProperty("details");
    expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it("`message` của envelope KHÔNG đổi một ký tự ở CẢ hai nhánh", () => {
    expect(tooManyRequests(900).message).toBe(TOO_MANY_REQUESTS_MESSAGE);
    expect(tooManyRequests(null).message).toBe(TOO_MANY_REQUESTS_MESSAGE);
  });

  it("RÀNG BUỘC #1 — KHÔNG phải lớp con: `type` của envelope vẫn là 'HttpException'", () => {
    // `all-exceptions.filter.ts:124` lấy `type: exception.name`. Một `class TooManyRequestsException
    // extends HttpException` sẽ đổi hợp đồng API mà không có ca nào bắt.
    for (const err of [tooManyRequests(900), tooManyRequests(null)]) {
      expect(err.constructor).toBe(HttpException);
      expect(err.name).toBe("HttpException");
    }
  });

  it("RÀNG BUỘC #2 — payload KHÔNG có khoá `code` (nếu có sẽ thắng httpStatusToCode ⇒ mất SYSTEM-ERR-RATE-LIMIT)", () => {
    for (const err of [tooManyRequests(900), tooManyRequests(null)]) {
      expect(payloadOf(err)).not.toHaveProperty("code");
    }
  });

  it("số ngoài dải hợp lệ ⇒ KHÔNG khai `details` (fail-safe: mất tiện ích, không mất control)", () => {
    for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, RETRY_AFTER_MAX_SEC + 1]) {
      expect(payloadOf(tooManyRequests(bad))).not.toHaveProperty("details");
    }
    expect(payloadOf(tooManyRequests(RETRY_AFTER_MAX_SEC)).details).toEqual([
      { field: RETRY_AFTER_FIELD, message: String(RETRY_AFTER_MAX_SEC), rule: RETRY_AFTER_RULE },
    ]);
    expect(payloadOf(tooManyRequests(1)).details).toEqual([
      { field: RETRY_AFTER_FIELD, message: "1", rule: RETRY_AFTER_RULE },
    ]);
  });
});

describe("retryAfterHeaderValue — header suy TỪ `details` (một nguồn ⇒ body/header không lệch)", () => {
  it("detail hợp lệ ⇒ chuỗi giây", () => {
    expect(retryAfterHeaderValue([detail()])).toBe("900");
  });

  it("`null` / mảng rỗng ⇒ null", () => {
    expect(retryAfterHeaderValue(null)).toBeNull();
    expect(retryAfterHeaderValue([])).toBeNull();
  });

  it("`rule` sai hoặc `field` sai ⇒ null (không nhận nhầm detail của lỗi khác)", () => {
    expect(retryAfterHeaderValue([detail({ rule: "too_small" })])).toBeNull();
    expect(retryAfterHeaderValue([detail({ field: "email" })])).toBeNull();
  });

  it("số hỏng / ngoài dải RFC 9110 §10.2.3 ⇒ null", () => {
    for (const bad of ["0", "-5", "abc", "", " ", "1.5", "9 00", String(RETRY_AFTER_MAX_SEC + 1)]) {
      expect(retryAfterHeaderValue([detail({ message: bad })])).toBeNull();
    }
  });

  it("bỏ qua detail lạ, lấy đúng detail retry-after trong mảng nhiều phần tử", () => {
    expect(
      retryAfterHeaderValue([
        { field: "email", message: "Bắt buộc", rule: "required" },
        detail({ message: "42" }),
      ]),
    ).toBe("42");
  });
});
