/**
 * S2-FND-BE-1 — ModuleAdminController gate tests (deny-path RED — QA-05, DoD #6a).
 *
 * (1) Decorator metadata = ĐÚNG cặp engine `view:foundation-module` (mig 0435 dòng 338, is_sensitive=false)
 *     — KHÔNG phải nhãn FE 'FOUNDATION.MODULE.VIEW' cũng KHÔNG cặp namespace cũ `read:module` (bài học
 *     pair-drift S1-FND-MODULE). Happy-path KHÔNG bắt được drift này (admin có nhiều grant) ⇒ assert pair.
 * (2) PermissionGuard deny (mock can→deny) → ForbiddenException 403 TRƯỚC khi controller/service chạy ⇒
 *     KHÔNG rò catalog cho actor thiếu view:foundation-module.
 */

import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { REQUIRE_PERMISSION } from "../../permission/require-permission.decorator";
import { ModuleAdminController } from "./module-admin.controller";

function metaOf(handler: unknown) {
  return new Reflector().get(REQUIRE_PERMISSION, handler as never);
}

describe("ModuleAdminController — @RequirePermission pairs (drift-guard)", () => {
  it("GET modules = view:foundation-module (KHÔNG read:module / FOUNDATION.MODULE.VIEW)", () => {
    const meta = metaOf(ModuleAdminController.prototype.listModules);
    expect(meta).toEqual({ action: "view", resourceType: "foundation-module" });
  });

  it("GET modules/:code = view:foundation-module", () => {
    const meta = metaOf(ModuleAdminController.prototype.getModuleDetail);
    expect(meta).toEqual({ action: "view", resourceType: "foundation-module" });
  });
});

describe("PermissionGuard — deny view:foundation-module → 403", () => {
  function ctxFor(handler: unknown): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => ModuleAdminController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: "u1", companyId: "c1" } }),
      }),
    } as unknown as ExecutionContext;
  }

  it("can()→deny trên GET modules ⇒ ForbiddenException (service không tới)", async () => {
    const permission = { can: vi.fn().mockResolvedValue({ allow: false, reason: "deny-default" }) };
    const guard = new PermissionGuard(new Reflector(), permission as never);
    await expect(
      guard.canActivate(ctxFor(ModuleAdminController.prototype.listModules)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(permission.can).toHaveBeenCalledWith(
      expect.objectContaining({ action: "view", resourceType: "foundation-module" }),
    );
  });

  it("can()→deny trên GET modules/:code ⇒ ForbiddenException", async () => {
    const permission = { can: vi.fn().mockResolvedValue({ allow: false, reason: "deny-default" }) };
    const guard = new PermissionGuard(new Reflector(), permission as never);
    await expect(
      guard.canActivate(ctxFor(ModuleAdminController.prototype.getModuleDetail)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("can()→allow ⇒ pass (company-admin sanity)", async () => {
    const permission = { can: vi.fn().mockResolvedValue({ allow: true, reason: "allow" }) };
    const guard = new PermissionGuard(new Reflector(), permission as never);
    await expect(
      guard.canActivate(ctxFor(ModuleAdminController.prototype.listModules)),
    ).resolves.toBe(true);
  });
});
