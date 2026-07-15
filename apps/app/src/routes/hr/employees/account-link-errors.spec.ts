import { describe, expect, it } from "vitest";
import { ApiError } from "@mediaos/web-core";
import { linkUserErrorKey, unlinkUserErrorKey } from "./account-link-errors";

describe("linkUserErrorKey", () => {
  it("maps 409 'employee already has a linked user' → HR-ERR-027 key", () => {
    const err = new ApiError(409, "RESOURCE-ERR-CONFLICT", "Employee already has a linked user");
    expect(linkUserErrorKey(err)).toBe("accountLink.errors.employeeAlreadyLinked");
  });

  it("maps 409 'user already linked to another active employee' → HR-ERR-028 key", () => {
    const err = new ApiError(
      409,
      "RESOURCE-ERR-CONFLICT",
      "User is already linked to another active employee",
    );
    expect(linkUserErrorKey(err)).toBe("accountLink.errors.userAlreadyLinked");
  });

  it("maps 404 'Employee not found' → employeeNotFound", () => {
    const err = new ApiError(404, "RESOURCE-ERR-NOT-FOUND", "Employee not found");
    expect(linkUserErrorKey(err)).toBe("accountLink.errors.employeeNotFound");
  });

  it("maps other 404 → userNotFound", () => {
    const err = new ApiError(404, "RESOURCE-ERR-NOT-FOUND", "User not found in this company");
    expect(linkUserErrorKey(err)).toBe("accountLink.errors.userNotFound");
  });

  it("maps 403 → forbidden", () => {
    const err = new ApiError(403, "AUTH-ERR-FORBIDDEN", "Forbidden");
    expect(linkUserErrorKey(err)).toBe("accountLink.errors.forbidden");
  });

  it("falls back to generic for unknown/non-ApiError", () => {
    expect(linkUserErrorKey(new Error("boom"))).toBe("accountLink.errors.generic");
    expect(linkUserErrorKey(undefined)).toBe("accountLink.errors.generic");
  });
});

describe("unlinkUserErrorKey", () => {
  it("maps 409 (employee has no linked user) → noLinkedUser", () => {
    const err = new ApiError(409, "RESOURCE-ERR-CONFLICT", "Employee has no linked user");
    expect(unlinkUserErrorKey(err)).toBe("accountLink.errors.noLinkedUser");
  });

  it("maps 403 self-unlink message → cannotUnlinkSelf", () => {
    const err = new ApiError(403, "AUTH-ERR-FORBIDDEN", "You cannot unlink your own account");
    expect(unlinkUserErrorKey(err)).toBe("accountLink.errors.cannotUnlinkSelf");
  });

  it("maps other 403 → forbidden", () => {
    const err = new ApiError(403, "AUTH-ERR-FORBIDDEN", "Forbidden");
    expect(unlinkUserErrorKey(err)).toBe("accountLink.errors.forbidden");
  });

  it("maps 404 → employeeNotFound", () => {
    const err = new ApiError(404, "RESOURCE-ERR-NOT-FOUND", "Employee not found");
    expect(unlinkUserErrorKey(err)).toBe("accountLink.errors.employeeNotFound");
  });

  it("falls back to generic for unknown/non-ApiError", () => {
    expect(unlinkUserErrorKey(new Error("boom"))).toBe("accountLink.errors.generic");
  });
});
