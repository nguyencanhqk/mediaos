import "reflect-metadata";
/**
 * G9-2 — Deny-path RED suite cho TasksController permission guards.
 *
 * Bối cảnh: giao việc tay (office task) là hành động permission-gated trên resource `task`
 * (actions create/update/delete có sẵn ở seed 0005, is_sensitive=false). Trước khi wire guard,
 * mọi user đăng nhập có thể tạo/đổi-status/xoá task — vi phạm TASK-001 + bài học G4-1 (ORG-002/003).
 *
 * Suite khoá hành vi MONG MUỐN (post-wire), mirror org.permissions.spec.ts:
 *   1. Mỗi MUTATION khai báo đúng @RequirePermission(action, 'task') + được PermissionGuard bọc.
 *   2. DENY: user thiếu quyền → ForbiddenException (403); PermissionService.can gọi đúng action/resource.
 *   3. ALLOW: user có quyền → qua guard (true).
 *   4. READ (getMyTasks/getComments) GIỮ mở — user luôn xem việc của mình + thread (tenant-scoped
 *      bởi JwtAuthGuard + CompanyGuard toàn cục) → KHÔNG guard.
 *
 * Gọi thẳng PermissionGuard với metadata THẬT của controller (Reflector thật) → enforcement
 * end-to-end mà không cần boot Nest/DB.
 */
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TasksController } from "./tasks.controller";
import { PermissionGuard } from "../permission/guards/permission.guard";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";
import type { PermissionDecision } from "../permission/permission.types";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
};

const ALLOW: PermissionDecision = { allow: true, reason: "allow", auditRequired: false };
const DENY: PermissionDecision = { allow: false, reason: "deny-default", auditRequired: false };

/** Mọi mutation PHẢI guard (handler → quyền mong đợi). */
const GUARDED_MUTATIONS: ReadonlyArray<{
  handlerName: keyof TasksController;
  action: string;
  resourceType: string;
}> = [
  { handlerName: "createTask", action: "create", resourceType: "task" },
  { handlerName: "updateStatus", action: "update", resourceType: "task" },
  { handlerName: "deleteTask", action: "delete", resourceType: "task" },
];

/** Read + comment intentionally open cho mọi user tenant (global JWT+Company guard vẫn ép tenant). */
const OPEN_READS: ReadonlyArray<keyof TasksController> = [
  "getMyTasks",
  "getComments",
  "addComment",
];

function handlerOf(name: keyof TasksController): (...args: unknown[]) => unknown {
  return TasksController.prototype[name] as (...args: unknown[]) => unknown;
}

function ctxFor(name: keyof TasksController): ExecutionContext {
  const handler = handlerOf(name);
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: USER, params: {} }) }),
    getHandler: () => handler,
    getClass: () => TasksController,
  } as unknown as ExecutionContext;
}

describe("TasksController — permission guard (G9-2)", () => {
  let permSvc: { can: ReturnType<typeof vi.fn> };
  let guard: PermissionGuard;

  beforeEach(() => {
    permSvc = { can: vi.fn() };
    guard = new PermissionGuard(new Reflector(), permSvc as never);
  });

  describe.each(GUARDED_MUTATIONS)(
    "mutation $handlerName → $action:$resourceType",
    ({ handlerName, action, resourceType }) => {
      it("declares @RequirePermission with the expected action + resource", () => {
        const meta = Reflect.getMetadata(REQUIRE_PERMISSION, handlerOf(handlerName)) as
          | RequirePermissionMeta
          | undefined;
        expect(meta).toBeDefined();
        expect(meta).toMatchObject({ action, resourceType });
        // Giao việc tay KHÔNG nhạy cảm → không bật isSensitive/requiresReauth.
        expect(meta?.isSensitive ?? false).toBe(false);
      });

      it("is wired with PermissionGuard via @UseGuards", () => {
        const guards = (Reflect.getMetadata("__guards__", handlerOf(handlerName)) as unknown[]) ?? [];
        expect(guards).toContain(PermissionGuard);
      });

      it("DENY: user without permission → 403 ForbiddenException", async () => {
        permSvc.can.mockResolvedValue(DENY);
        await expect(guard.canActivate(ctxFor(handlerName))).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(permSvc.can).toHaveBeenCalledWith(
          expect.objectContaining({
            action,
            resourceType,
            userId: USER.id,
            companyId: USER.companyId,
          }),
        );
      });

      it("ALLOW: user with permission → guard passes", async () => {
        permSvc.can.mockResolvedValue(ALLOW);
        await expect(guard.canActivate(ctxFor(handlerName))).resolves.toBe(true);
      });
    },
  );

  describe.each(OPEN_READS)("open route %s stays unguarded", (name) => {
    it("has no @RequirePermission (tenant-scoped by global guards)", () => {
      expect(Reflect.getMetadata(REQUIRE_PERMISSION, handlerOf(name))).toBeUndefined();
    });
  });
});
