import "reflect-metadata";
/**
 * Deny-path suite cho LmsSsoController — quyền "mở LMS" thuộc hệ phân quyền MediaOS (cặp access:lms,
 * seed 0508). Khoá hành vi: endpoint sso-link CHỈ cho user có access:lms (admin thu hồi per-role được).
 *
 * Gọi thẳng PermissionGuard với metadata THẬT của controller (Reflector thật) → enforcement end-to-end
 * mà không cần boot Nest/DB. Mirror tasks.permissions.spec.ts.
 */
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LmsSsoController } from "./lms-sso.controller";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../../permission/require-permission.decorator";
import type { PermissionDecision } from "../../permission/permission.types";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
};
const ALLOW: PermissionDecision = { allow: true, reason: "allow", auditRequired: false };
const DENY: PermissionDecision = { allow: false, reason: "deny-default", auditRequired: false };

function ssoHandler(): (...args: unknown[]) => unknown {
  return LmsSsoController.prototype.getSsoLink as (...args: unknown[]) => unknown;
}

function ctx(): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: USER, params: {} }) }),
    getHandler: () => ssoHandler(),
    getClass: () => LmsSsoController,
  } as unknown as ExecutionContext;
}

describe("LmsSsoController — permission guard (access:lms)", () => {
  let permSvc: { can: ReturnType<typeof vi.fn> };
  let guard: PermissionGuard;

  beforeEach(() => {
    permSvc = { can: vi.fn() };
    guard = new PermissionGuard(new Reflector(), permSvc as never);
  });

  it("khai báo @RequirePermission access:lms (non-sensitive)", () => {
    const meta = Reflect.getMetadata(REQUIRE_PERMISSION, ssoHandler()) as
      | RequirePermissionMeta
      | undefined;
    expect(meta).toBeDefined();
    expect(meta).toMatchObject({ action: "access", resourceType: "lms" });
    expect(meta?.isSensitive ?? false).toBe(false);
  });

  it("được bọc PermissionGuard qua @UseGuards cấp class", () => {
    const guards = (Reflect.getMetadata("__guards__", LmsSsoController) as unknown[]) ?? [];
    expect(guards).toContain(PermissionGuard);
  });

  it("DENY: user thiếu access:lms → 403 ForbiddenException", async () => {
    permSvc.can.mockResolvedValue(DENY);
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(ForbiddenException);
    expect(permSvc.can).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "access",
        resourceType: "lms",
        userId: USER.id,
        companyId: USER.companyId,
      }),
    );
  });

  it("ALLOW: user có access:lms → qua guard", async () => {
    permSvc.can.mockResolvedValue(ALLOW);
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
  });
});
