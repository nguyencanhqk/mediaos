/**
 * S1-FND-MODULE-1 — CompanyController gate tests (deny-path RED — DoD #6a).
 *
 * (1) Decorator metadata = ĐÚNG cặp engine `view/update:foundation-company` (mig 0435) — KHÔNG phải
 *     `read/update:company` (0005). Happy-path KHÔNG bắt được drift này (admin có CẢ hai) ⇒ phải assert pair.
 * (2) PermissionGuard deny (mock can→deny) → ForbiddenException 403 TRƯỚC khi controller chạy ⇒ service/audit
 *     KHÔNG bao giờ tới (0 audit khi thiếu update:foundation-company).
 */

import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { REQUIRE_PERMISSION } from "../../permission/require-permission.decorator";
import { CompanyController } from "./company.controller";

function metaOf(handler: unknown) {
  return new Reflector().get(REQUIRE_PERMISSION, handler as never);
}

describe("CompanyController — @RequirePermission pairs (drift-guard)", () => {
  it("GET company/current = view:foundation-company (KHÔNG read:company)", () => {
    const meta = metaOf(CompanyController.prototype.getCurrent);
    expect(meta).toEqual({ action: "view", resourceType: "foundation-company" });
  });

  it("PATCH company/current = update:foundation-company (KHÔNG update:company)", () => {
    const meta = metaOf(CompanyController.prototype.updateCurrent);
    expect(meta).toEqual({ action: "update", resourceType: "foundation-company" });
  });
});

describe("PermissionGuard — deny update:foundation-company → 403", () => {
  function ctxFor(handler: unknown): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => CompanyController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: "u1", companyId: "c1" } }),
      }),
    } as unknown as ExecutionContext;
  }

  it("can()→deny ⇒ ForbiddenException (controller/audit không tới)", async () => {
    const permission = { can: vi.fn().mockResolvedValue({ allow: false, reason: "deny-default" }) };
    const guard = new PermissionGuard(new Reflector(), permission as never);
    await expect(
      guard.canActivate(ctxFor(CompanyController.prototype.updateCurrent)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Guard gọi can() với ĐÚNG cặp engine.
    expect(permission.can).toHaveBeenCalledWith(
      expect.objectContaining({ action: "update", resourceType: "foundation-company" }),
    );
  });

  it("can()→allow ⇒ pass (true)", async () => {
    const permission = { can: vi.fn().mockResolvedValue({ allow: true, reason: "allow" }) };
    const guard = new PermissionGuard(new Reflector(), permission as never);
    await expect(guard.canActivate(ctxFor(CompanyController.prototype.getCurrent))).resolves.toBe(
      true,
    );
  });
});
