import 'reflect-metadata';
/**
 * G5-FIX F2 — Deny-path RED suite for OrgController permission guards.
 *
 * Hiện trạng (RED): org.controller.ts KHÔNG có @UseGuards(PermissionGuard) lẫn @RequirePermission →
 * mọi user đăng nhập tạo/sửa/xoá phòng ban/team + đổi leader (vi phạm ORG-002/003).
 *
 * Suite này khoá hành vi MONG MUỐN (post-F2):
 *   1. Mỗi MUTATION khai báo đúng @RequirePermission(action, resource) + được PermissionGuard bọc.
 *   2. DENY: user thiếu quyền → ForbiddenException (403).
 *   3. ALLOW: user có quyền → qua guard (true).
 *   4. READ (list/tree/members) GIỮ mở cho mọi user tenant (cơ cấu tổ chức không nhạy cảm) → KHÔNG guard.
 *
 * Test gọi thẳng PermissionGuard với metadata THẬT của controller (Reflector thật) → chứng minh
 * enforcement end-to-end mà không cần boot Nest/DB (đồng bộ style permission.guard.reveal.spec.ts).
 */
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgController } from './org.controller';
import { PermissionGuard } from '../permission/guards/permission.guard';
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from '../permission/require-permission.decorator';
import type { PermissionDecision } from '../permission/permission.types';

const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  companyId: '22222222-2222-2222-2222-222222222222',
};

const ALLOW: PermissionDecision = { allow: true, reason: 'allow', auditRequired: false };
const DENY: PermissionDecision = { allow: false, reason: 'deny-default', auditRequired: false };

/** Mọi mutation PHẢI guard (handler → quyền mong đợi). */
const GUARDED_MUTATIONS: ReadonlyArray<{
  handlerName: keyof OrgController;
  action: string;
  resourceType: string;
}> = [
  { handlerName: 'createOrgUnit', action: 'create', resourceType: 'org_unit' },
  { handlerName: 'updateOrgUnit', action: 'update', resourceType: 'org_unit' },
  { handlerName: 'deleteOrgUnit', action: 'delete', resourceType: 'org_unit' },
  { handlerName: 'createDepartmentLegacy', action: 'create', resourceType: 'org_unit' },
  { handlerName: 'createTeam', action: 'create', resourceType: 'team' },
  { handlerName: 'updateTeam', action: 'update', resourceType: 'team' },
  { handlerName: 'assignTeamLeader', action: 'update', resourceType: 'team' },
  { handlerName: 'deleteTeam', action: 'delete', resourceType: 'team' },
  { handlerName: 'addTeamMember', action: 'update', resourceType: 'team' },
  { handlerName: 'removeTeamMember', action: 'update', resourceType: 'team' },
];

/** Read intentionally open cho mọi user tenant (JWT+Company guard toàn cục vẫn ép tenant). */
const OPEN_READS: ReadonlyArray<keyof OrgController> = [
  'listOrgUnits',
  'getOrgTree',
  'listDepartmentsLegacy',
  'listTeams',
  'listTeamMembers',
  'listEmployees',
  'listRoles',
];

function handlerOf(name: keyof OrgController): (...args: unknown[]) => unknown {
  return OrgController.prototype[name] as (...args: unknown[]) => unknown;
}

function ctxFor(name: keyof OrgController): ExecutionContext {
  const handler = handlerOf(name);
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: USER, params: {} }) }),
    getHandler: () => handler,
    getClass: () => OrgController,
  } as unknown as ExecutionContext;
}

describe('OrgController — permission guard (F2)', () => {
  let permSvc: { can: ReturnType<typeof vi.fn> };
  let guard: PermissionGuard;

  beforeEach(() => {
    permSvc = { can: vi.fn() };
    guard = new PermissionGuard(new Reflector(), permSvc as never);
  });

  describe.each(GUARDED_MUTATIONS)(
    'mutation $handlerName → $action:$resourceType',
    ({ handlerName, action, resourceType }) => {
      it('declares @RequirePermission with the expected action + resource', () => {
        const meta = Reflect.getMetadata(REQUIRE_PERMISSION, handlerOf(handlerName)) as
          | RequirePermissionMeta
          | undefined;
        expect(meta).toBeDefined();
        expect(meta).toMatchObject({ action, resourceType });
        // Cơ cấu tổ chức KHÔNG nhạy cảm → không bật isSensitive/requiresReauth.
        expect(meta?.isSensitive ?? false).toBe(false);
      });

      it('is wired with PermissionGuard via @UseGuards', () => {
        const guards = (Reflect.getMetadata('__guards__', handlerOf(handlerName)) as unknown[]) ?? [];
        expect(guards).toContain(PermissionGuard);
      });

      it('DENY: user without permission → 403 ForbiddenException', async () => {
        permSvc.can.mockResolvedValue(DENY);
        await expect(guard.canActivate(ctxFor(handlerName))).rejects.toBeInstanceOf(ForbiddenException);
        expect(permSvc.can).toHaveBeenCalledWith(
          expect.objectContaining({
            action,
            resourceType,
            userId: USER.id,
            companyId: USER.companyId,
          }),
        );
      });

      it('ALLOW: user with permission → guard passes', async () => {
        permSvc.can.mockResolvedValue(ALLOW);
        await expect(guard.canActivate(ctxFor(handlerName))).resolves.toBe(true);
      });
    },
  );

  describe.each(OPEN_READS)('read %s stays open', (name) => {
    it('has no @RequirePermission (unguarded read — tenant-scoped by global guards)', () => {
      expect(Reflect.getMetadata(REQUIRE_PERMISSION, handlerOf(name))).toBeUndefined();
    });
  });
});
