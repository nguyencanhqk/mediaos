import { describe, expect, it } from "vitest";
import { ApiError, retryAfterSecFromError } from "./api-client";

/** 429 y như server ném (`apps/api/src/common/filters/retry-after.ts`). */
function locked(sec: string, over: { field?: string; rule?: string } = {}): ApiError {
  return new ApiError({
    status: 429,
    code: "SYSTEM-ERR-RATE-LIMIT",
    message: "Quá nhiều lần thử. Vui lòng thử lại sau.",
    details: [
      { field: over.field ?? "retryAfterSec", message: sec, rule: over.rule ?? "retry-after" },
    ],
  });
}

describe("retryAfterSecFromError — bóc số giây khỏi 429 (S18-AUTH-RETRYAFTER-1)", () => {
  it("429 + detail đúng hình ⇒ số", () => {
    expect(retryAfterSecFromError(locked("900"))).toBe(900);
    expect(retryAfterSecFromError(locked("1"))).toBe(1);
    expect(retryAfterSecFromError(locked("86400"))).toBe(86400);
  });

  it("status ≠ 429 ⇒ null (detail cùng hình của lỗi khác KHÔNG được nhận nhầm)", () => {
    const err = new ApiError({
      status: 403,
      code: "AUTH-ERR-FORBIDDEN",
      message: "x",
      details: [{ field: "retryAfterSec", message: "900", rule: "retry-after" }],
    });
    expect(retryAfterSecFromError(err)).toBeNull();
  });

  it("`rule` sai hoặc `field` sai ⇒ null", () => {
    expect(retryAfterSecFromError(locked("900", { rule: "too_small" }))).toBeNull();
    expect(retryAfterSecFromError(locked("900", { field: "email" }))).toBeNull();
  });

  it("`message` không phải số nguyên ⇒ null (KHÔNG parseInt nuốt hậu tố)", () => {
    for (const bad of ["abc", "", " ", "1.5", "9 00", "900s", "1e3", "+900"]) {
      expect(retryAfterSecFromError(locked(bad))).toBeNull();
    }
  });

  it("ngoài dải 1..86400 ⇒ null (không bao giờ hiện '0 giây')", () => {
    for (const bad of ["0", "-5", "86401", "99999999"]) {
      expect(retryAfterSecFromError(locked(bad))).toBeNull();
    }
  });

  it("`details` thiếu / không phải mảng / rỗng ⇒ null (429 cũ vẫn chạy y như trước)", () => {
    const bare = new ApiError({ status: 429, code: "SYSTEM-ERR-RATE-LIMIT", message: "x" });
    expect(retryAfterSecFromError(bare)).toBeNull();
    for (const details of [null, "nope", 42, {}, []]) {
      expect(
        retryAfterSecFromError(
          new ApiError({ status: 429, code: "SYSTEM-ERR-RATE-LIMIT", message: "x", details }),
        ),
      ).toBeNull();
    }
  });

  it("phần tử hỏng hình trong mảng ⇒ bỏ qua, KHÔNG ném", () => {
    const err = new ApiError({
      status: 429,
      code: "SYSTEM-ERR-RATE-LIMIT",
      message: "x",
      details: [null, "x", { field: "retryAfterSec" }, { field: 1, message: 2, rule: 3 }],
    });
    expect(retryAfterSecFromError(err)).toBeNull();
  });

  it("không phải ApiError (lỗi mạng / undefined) ⇒ null", () => {
    for (const notApi of [undefined, null, new Error("network"), { status: 429 }, "429"]) {
      expect(retryAfterSecFromError(notApi)).toBeNull();
    }
  });
});
