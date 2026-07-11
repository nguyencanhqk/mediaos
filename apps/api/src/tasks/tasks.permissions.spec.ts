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
 *   4. S4-TASK-BE-4: getComments KHÔNG còn mở — GIỜ gate read:task (data-scope "chỉ người xem được task
 *      mới comment được", SPEC-06 §14.14) → chuyển từ OPEN_READS sang GUARDED_MUTATIONS. OPEN_READS rỗng.
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

/** Mọi mutation/read-nhạy-cảm PHẢI guard (handler → quyền + độ nhạy cảm mong đợi). */
const GUARDED_MUTATIONS: ReadonlyArray<{
  handlerName: keyof TasksController;
  action: string;
  resourceType: string;
  isSensitive?: boolean;
}> = [
  { handlerName: "createTask", action: "create", resourceType: "task" },
  { handlerName: "updateStatus", action: "update", resourceType: "task" },
  // S4-TASK-BE-2: delete:task là SENSITIVE (seed 0485 is_sensitive=true) — gate kèm isSensitive.
  { handlerName: "deleteTask", action: "delete", resourceType: "task", isSensitive: true },
  // addComment là WRITE → gate comment:task (G9-2 H-1; recon S4-TASK-RECON canonical hoá về resource `task`).
  { handlerName: "addComment", action: "comment", resourceType: "task" },
  // getBoard (G9-3) là READ NHẠY CẢM hơn getMyTasks (xem việc của NGƯỜI KHÁC toàn tenant) →
  // PHẢI gate read:task (seed 0005, is_sensitive=false). User 0-quyền KHÔNG được đọc board.
  { handlerName: "getBoard", action: "read", resourceType: "task" },
  // S4-TASK-BE-2: task core CRUD/my/list gate read/update:task + data-scope (KHÔNG còn mở như getMyTasks cũ).
  { handlerName: "listTasks", action: "read", resourceType: "task" },
  { handlerName: "getMyTasks", action: "read", resourceType: "task" },
  { handlerName: "getTask", action: "read", resourceType: "task" },
  { handlerName: "updateTask", action: "update", resourceType: "task" },
  // S4-TASK-BE-3: 6 route action crown-FSM — cặp seed 0485 (mục 3). employee 403 trên assign/priority/
  // deadline là ĐÚNG THIẾT KẾ (không seed), không phải deferred → guard PHẢI khai đúng cặp.
  { handlerName: "assignTask", action: "assign", resourceType: "task" },
  { handlerName: "changeTaskStatus", action: "update-status", resourceType: "task" },
  { handlerName: "changeTaskPriority", action: "update-priority", resourceType: "task" },
  { handlerName: "changeTaskDeadline", action: "update-deadline", resourceType: "task" },
  { handlerName: "addWatcher", action: "watch", resourceType: "task" },
  { handlerName: "removeWatcher", action: "watch", resourceType: "task" },
  // S4-TASK-BE-4 (additive) — comment/mention · checklist/items · activity feed + move (Kanban).
  { handlerName: "moveTask", action: "update-status", resourceType: "task" },
  { handlerName: "getComments", action: "read", resourceType: "task" },
  { handlerName: "updateComment", action: "comment", resourceType: "task" },
  { handlerName: "deleteComment", action: "comment", resourceType: "task" },
  { handlerName: "listChecklists", action: "read", resourceType: "task" },
  { handlerName: "createChecklist", action: "update", resourceType: "task" },
  { handlerName: "updateChecklist", action: "update", resourceType: "task" },
  { handlerName: "deleteChecklist", action: "update", resourceType: "task" },
  { handlerName: "addChecklistItem", action: "update", resourceType: "task" },
  { handlerName: "updateChecklistItem", action: "update", resourceType: "task" },
  { handlerName: "deleteChecklistItem", action: "update", resourceType: "task" },
  // view:task-audit-log là SENSITIVE (seed 0485 is_sensitive=true, CHỈ hr/company-admin @Company).
  {
    handlerName: "listActivity",
    action: "view",
    resourceType: "task-audit-log",
    isSensitive: true,
  },
];

/** Read intentionally open cho mọi user tenant — HIỆN RỖNG (getComments đã chuyển sang gate ở trên). */
const OPEN_READS: ReadonlyArray<keyof TasksController> = [];

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
    ({ handlerName, action, resourceType, isSensitive }) => {
      it("declares @RequirePermission with the expected action + resource", () => {
        const meta = Reflect.getMetadata(REQUIRE_PERMISSION, handlerOf(handlerName)) as
          | RequirePermissionMeta
          | undefined;
        expect(meta).toBeDefined();
        expect(meta).toMatchObject({ action, resourceType });
        // Độ nhạy cảm khớp seed 0485 (delete:task sensitive; read/create/update/comment KHÔNG).
        expect(meta?.isSensitive ?? false).toBe(isSensitive ?? false);
      });

      it("is wired with PermissionGuard via @UseGuards", () => {
        const guards =
          (Reflect.getMetadata("__guards__", handlerOf(handlerName)) as unknown[]) ?? [];
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
