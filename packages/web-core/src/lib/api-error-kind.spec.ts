/**
 * api-error-kind.spec.ts — Unit tests cho mapStatusToErrorKind (FRONTEND-04 §10.2).
 *
 * RED phase: viết trước khi implement. Confirm FAIL, rồi GREEN sau BƯỚC 3.
 */
import { describe, expect, it } from "vitest";
import { mapStatusToErrorKind } from "./api-error-kind";

describe("mapStatusToErrorKind", () => {
  it("401 → UNAUTHENTICATED", () => {
    expect(mapStatusToErrorKind(401)).toBe("UNAUTHENTICATED");
  });

  it("401 + code AUTH-ERR-TOKEN-EXPIRED → TOKEN_EXPIRED (forward-compat)", () => {
    expect(mapStatusToErrorKind(401, "AUTH-ERR-TOKEN-EXPIRED")).toBe("TOKEN_EXPIRED");
  });

  it("403 → FORBIDDEN", () => {
    expect(mapStatusToErrorKind(403)).toBe("FORBIDDEN");
  });

  it("403 + code AUTH-ERR-SCOPE-DENIED → SCOPE_DENIED (forward-compat)", () => {
    expect(mapStatusToErrorKind(403, "AUTH-ERR-SCOPE-DENIED")).toBe("SCOPE_DENIED");
  });

  it("404 → NOT_FOUND", () => {
    expect(mapStatusToErrorKind(404)).toBe("NOT_FOUND");
  });

  it("409 → CONFLICT", () => {
    expect(mapStatusToErrorKind(409)).toBe("CONFLICT");
  });

  // §3.2: 422 + VALIDATION-ERR-001 (BE maps 422 → VALIDATION-ERR-001) → VALIDATION, NOT BUSINESS_RULE
  it("422 với code='VALIDATION-ERR-001' → VALIDATION (KHÔNG phải BUSINESS_RULE)", () => {
    expect(mapStatusToErrorKind(422, "VALIDATION-ERR-001")).toBe("VALIDATION");
  });

  it("400 → VALIDATION", () => {
    expect(mapStatusToErrorKind(400)).toBe("VALIDATION");
  });

  it("400 + code='VALIDATION-ERR-001' → VALIDATION", () => {
    expect(mapStatusToErrorKind(400, "VALIDATION-ERR-001")).toBe("VALIDATION");
  });

  it("429 → RATE_LIMIT", () => {
    expect(mapStatusToErrorKind(429)).toBe("RATE_LIMIT");
  });

  it("500 → SERVER", () => {
    expect(mapStatusToErrorKind(500)).toBe("SERVER");
  });

  it("503 → MAINTENANCE", () => {
    expect(mapStatusToErrorKind(503)).toBe("MAINTENANCE");
  });

  it("422 + type='BusinessRuleError' → BUSINESS_RULE (module-specific, không phải VALIDATION-ERR)", () => {
    expect(mapStatusToErrorKind(422, undefined, "BusinessRuleError")).toBe("BUSINESS_RULE");
  });

  it("status lạ (418) → UNKNOWN", () => {
    expect(mapStatusToErrorKind(418)).toBe("UNKNOWN");
  });
});
