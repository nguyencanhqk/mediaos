/**
 * error-mapper.spec.ts — Unit tests cho mapApiErrorToUi + isValidationDetails (FRONTEND-04 §22, §23).
 *
 * RED phase: viết trước khi implement. Confirm FAIL, rồi GREEN sau BƯỚC 6.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "./api-client";
import type { ApiErrorKind } from "./api-error-kind";
import { isValidationDetails, mapApiErrorToUi } from "./error-mapper";

// Helper: tạo ApiError với kind (dùng object-arg overload — RED: chưa có overload)
function makeApiError(kind: ApiErrorKind, message = "test error", requestId?: string): ApiError {
  return new ApiError({ message, kind, status: 200, requestId });
}

describe("mapApiErrorToUi", () => {
  it("UNAUTHENTICATED → REDIRECT_LOGIN", () => {
    const err = makeApiError("UNAUTHENTICATED");
    const result = mapApiErrorToUi(err);
    expect(result.behavior).toBe("REDIRECT_LOGIN");
  });

  it("TOKEN_EXPIRED → REDIRECT_LOGIN", () => {
    const err = makeApiError("TOKEN_EXPIRED");
    const result = mapApiErrorToUi(err);
    expect(result.behavior).toBe("REDIRECT_LOGIN");
  });

  it("FORBIDDEN → FORBIDDEN_PAGE", () => {
    const err = makeApiError("FORBIDDEN");
    const result = mapApiErrorToUi(err);
    expect(result.behavior).toBe("FORBIDDEN_PAGE");
  });

  it("SCOPE_DENIED → FORBIDDEN_PAGE", () => {
    const err = makeApiError("SCOPE_DENIED");
    const result = mapApiErrorToUi(err);
    expect(result.behavior).toBe("FORBIDDEN_PAGE");
  });

  it("VALIDATION → FORM_ERRORS", () => {
    const err = makeApiError("VALIDATION");
    const result = mapApiErrorToUi(err);
    expect(result.behavior).toBe("FORM_ERRORS");
  });

  it("NOT_FOUND → NOT_FOUND_PAGE", () => {
    const err = makeApiError("NOT_FOUND");
    const result = mapApiErrorToUi(err);
    expect(result.behavior).toBe("NOT_FOUND_PAGE");
  });

  it("CONFLICT → INLINE_ALERT", () => {
    const err = makeApiError("CONFLICT");
    const result = mapApiErrorToUi(err);
    expect(result.behavior).toBe("INLINE_ALERT");
  });

  it("NETWORK → ERROR_STATE với canRetry", () => {
    const err = makeApiError("NETWORK");
    const result = mapApiErrorToUi(err);
    expect(result.behavior).toBe("ERROR_STATE");
    expect(result.canRetry).toBe(true);
  });

  it("SERVER → ERROR_STATE với canRetry", () => {
    const err = makeApiError("SERVER");
    const result = mapApiErrorToUi(err);
    expect(result.behavior).toBe("ERROR_STATE");
    expect(result.canRetry).toBe(true);
  });

  it("UNKNOWN → ERROR_STATE", () => {
    const err = makeApiError("UNKNOWN");
    const result = mapApiErrorToUi(err);
    expect(result.behavior).toBe("ERROR_STATE");
  });

  it("requestId được mang theo", () => {
    const err = makeApiError("SERVER", "internal error", "req_abc-123");
    const result = mapApiErrorToUi(err);
    expect(result.requestId).toBe("req_abc-123");
  });

  it("non-ApiError (Error thường) → TOAST_ERROR message mặc định", () => {
    const result = mapApiErrorToUi(new Error("random error"));
    expect(result.behavior).toBe("TOAST_ERROR");
    expect(result.message).toBeTruthy();
  });

  it("non-ApiError (string) → TOAST_ERROR", () => {
    const result = mapApiErrorToUi("some string error");
    expect(result.behavior).toBe("TOAST_ERROR");
  });
});

describe("isValidationDetails", () => {
  it("mảng ApiValidationDetail hợp lệ → true", () => {
    const details = [{ field: "name", message: "required" }];
    expect(isValidationDetails(details)).toBe(true);
  });

  it("mảng thiếu field → false", () => {
    const details = [{ message: "required" }];
    expect(isValidationDetails(details)).toBe(false);
  });

  it("mảng thiếu message → false", () => {
    const details = [{ field: "name" }];
    expect(isValidationDetails(details)).toBe(false);
  });

  it("không phải mảng → false", () => {
    expect(isValidationDetails({ field: "name", message: "x" })).toBe(false);
  });

  it("null → false", () => {
    expect(isValidationDetails(null)).toBe(false);
  });

  it("undefined → false", () => {
    expect(isValidationDetails(undefined)).toBe(false);
  });

  it("mảng rỗng → true (valid empty list)", () => {
    expect(isValidationDetails([])).toBe(true);
  });
});
