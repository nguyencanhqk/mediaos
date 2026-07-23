import "reflect-metadata";
/**
 * S5-LMS-BE-3 (RED trước) — deny-path + hàng rào IDOR cho MeTrainingController.
 *
 * 1. Gate quyền: cặp `access:lms` (seed 0508 — KHÔNG seed permission mới), non-sensitive. Gọi thẳng
 *    PermissionGuard với metadata THẬT (Reflector thật) ⇒ enforcement end-to-end không cần boot Nest/DB.
 *    Mirror lms-sso.permissions.spec.ts.
 * 2. HÀNG RÀO IDOR (security-review S5-LMS-APP-3 M3): handler CẤM khai @Query/@Body/@Param/@Headers —
 *    email 100% từ req.user. Test này là thứ duy nhất bắt được PR sau này lỡ thêm param.
 */
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { RouteParamtypes } from "@nestjs/common/enums/route-paramtypes.enum";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeTrainingController } from "./me-training.controller";
import { PermissionGuard } from "../permission/guards/permission.guard";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import type { PermissionDecision } from "../permission/permission.types";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
  email: "a@congty.test",
};
const ALLOW: PermissionDecision = { allow: true, reason: "allow", auditRequired: false };
const DENY: PermissionDecision = { allow: false, reason: "deny-default", auditRequired: false };

function handler(): (...args: unknown[]) => unknown {
  return MeTrainingController.prototype.getMyTraining as (...args: unknown[]) => unknown;
}

function ctx(): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: USER, params: {} }) }),
    getHandler: () => handler(),
    getClass: () => MeTrainingController,
  } as unknown as ExecutionContext;
}

describe("MeTrainingController — permission guard (access:lms)", () => {
  let permSvc: { can: ReturnType<typeof vi.fn> };
  let guard: PermissionGuard;

  beforeEach(() => {
    permSvc = { can: vi.fn() };
    guard = new PermissionGuard(new Reflector(), permSvc as never);
  });

  it("khai báo @RequirePermission access:lms (non-sensitive — cặp seed 0508, KHÔNG tạo pair mới)", () => {
    const meta =
      (Reflect.getMetadata(REQUIRE_PERMISSION, handler()) as RequirePermissionMeta | undefined) ??
      (Reflect.getMetadata(REQUIRE_PERMISSION, MeTrainingController) as
        | RequirePermissionMeta
        | undefined);
    expect(meta).toBeDefined();
    expect(meta).toMatchObject({ action: "access", resourceType: "lms" });
    expect(meta?.isSensitive ?? false).toBe(false);
  });

  it("được bọc PermissionGuard qua @UseGuards cấp class", () => {
    const guards = (Reflect.getMetadata("__guards__", MeTrainingController) as unknown[]) ?? [];
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

describe("MeTrainingController — hàng rào IDOR (M3)", () => {
  it("handler CHỈ nhận @Req(): KHÔNG có @Query/@Body/@Param/@Headers", () => {
    const args =
      (Reflect.getMetadata(ROUTE_ARGS_METADATA, MeTrainingController, "getMyTraining") as
        | Record<string, unknown>
        | undefined) ?? {};
    const paramTypes = Object.keys(args).map((k) => Number(k.split(":")[0]));
    expect(paramTypes.length).toBeGreaterThan(0);
    for (const t of paramTypes) {
      expect(t).toBe(RouteParamtypes.REQUEST);
    }
    expect(paramTypes).not.toContain(RouteParamtypes.QUERY);
    expect(paramTypes).not.toContain(RouteParamtypes.BODY);
    expect(paramTypes).not.toContain(RouteParamtypes.PARAM);
    expect(paramTypes).not.toContain(RouteParamtypes.HEADERS);
  });

  it("service nhận ĐÚNG req.user (không nhận input nào khác)", async () => {
    const svc = { getMyTraining: vi.fn().mockResolvedValue({ status: "ok", progress: null }) };
    const controller = new MeTrainingController(svc as never);
    const req = { user: USER, query: { email: "victim@congty.test" }, body: { email: "x" } };
    await controller.getMyTraining(req as never);
    expect(svc.getMyTraining).toHaveBeenCalledTimes(1);
    expect(svc.getMyTraining).toHaveBeenCalledWith(USER);
  });
});
