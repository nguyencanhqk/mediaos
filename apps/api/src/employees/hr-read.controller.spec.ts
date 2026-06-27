/**
 * S2-HR-BE-1 — HrReadController route-guard RED suite (FULL gate).
 *
 * Every read route on HrReadController MUST carry @UseGuards(PermissionGuard) +
 * @RequirePermission(<action>, <resourceType>) using the ENGINE pairs already seeded (read:employee /
 * read:department / read:position / manage:master-data / preview:employee-code). A caller missing the
 * pair is rejected with 403 by PermissionGuard BEFORE the handler runs — no row reaches the service.
 */

import "reflect-metadata";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HrReadController } from "./hr-read.controller";
import { PermissionGuard } from "../permission/guards/permission.guard";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import type { PermissionDecision } from "../permission/permission.types";

const GUARDS_METADATA = "__guards__";

interface RouteCase {
  method: keyof HrReadController;
  action: string;
  resourceType: string;
}

const HR_READ_ROUTES: RouteCase[] = [
  { method: "listEmployees", action: "read", resourceType: "employee" },
  { method: "getEmployee", action: "read", resourceType: "employee" },
  { method: "getMyProfile", action: "read", resourceType: "employee" },
  { method: "listDepartments", action: "read", resourceType: "department" },
  { method: "listPositions", action: "read", resourceType: "position" },
  { method: "listJobLevels", action: "manage", resourceType: "master-data" },
  { method: "listContractTypes", action: "manage", resourceType: "master-data" },
  { method: "previewEmployeeCode", action: "preview", resourceType: "employee-code" },
];

function handlerOf(method: keyof HrReadController): (...args: unknown[]) => unknown {
  return HrReadController.prototype[method] as unknown as (...args: unknown[]) => unknown;
}

function guardsFor(method: keyof HrReadController): unknown[] {
  const classGuards = (Reflect.getMetadata(GUARDS_METADATA, HrReadController) as unknown[]) ?? [];
  const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handlerOf(method)) as unknown[]) ?? [];
  return [...classGuards, ...methodGuards];
}

function makeCtx(
  method: keyof HrReadController,
  user: { id: string; companyId: string },
): ExecutionContext {
  const req = { params: {}, user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handlerOf(method),
    getClass: () => HrReadController,
  } as unknown as ExecutionContext;
}

describe("HrReadController — read routes are permission-guarded (RED)", () => {
  const reflector = new Reflector();
  const normalUser = { id: "user-normal", companyId: "11111111-1111-1111-1111-111111111111" };

  it.each(HR_READ_ROUTES)(
    "$method declares @RequirePermission($action, $resourceType)",
    ({ method, action, resourceType }) => {
      const meta = reflector.get<RequirePermissionMeta>(REQUIRE_PERMISSION, handlerOf(method));
      expect(meta, `${method} is missing @RequirePermission`).toBeDefined();
      expect(meta.action).toBe(action);
      expect(meta.resourceType).toBe(resourceType);
    },
  );

  it.each(HR_READ_ROUTES)("$method is protected by PermissionGuard", ({ method }) => {
    expect(guardsFor(method)).toContain(PermissionGuard);
  });

  describe("deny-path: caller without the pair is rejected with 403", () => {
    let mockPermSvc: { can: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockPermSvc = { can: vi.fn() };
    });

    it.each(HR_READ_ROUTES)(
      "$method → ForbiddenException when can() denies",
      async ({ method }) => {
        mockPermSvc.can.mockResolvedValue({
          allow: false,
          reason: "deny-default",
          auditRequired: false,
        } satisfies PermissionDecision);

        const guard = new PermissionGuard(reflector, mockPermSvc as never);
        await expect(guard.canActivate(makeCtx(method, normalUser))).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(mockPermSvc.can).toHaveBeenCalledOnce();
      },
    );

    it.each(HR_READ_ROUTES)(
      "$method → allowed when can() grants the pair",
      async ({ method, action, resourceType }) => {
        mockPermSvc.can.mockResolvedValue({
          allow: true,
          reason: "allow",
          auditRequired: false,
        } satisfies PermissionDecision);

        const guard = new PermissionGuard(reflector, mockPermSvc as never);
        await expect(guard.canActivate(makeCtx(method, normalUser))).resolves.toBe(true);
        expect(mockPermSvc.can).toHaveBeenCalledWith(
          expect.objectContaining({ action, resourceType, companyId: normalUser.companyId }),
        );
      },
    );
  });
});
