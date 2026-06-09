/**
 * F2 (G5-FIX) RED suite — Org + Team permission guard wiring.
 *
 * Vulnerability (plan §14.1, ORG-002/003): OrgController had NEITHER @UseGuards(PermissionGuard) NOR
 * @RequirePermission on any mutation → any authenticated tenant member could create/update/delete
 * org_units + teams and reassign leaders (global pipeline is JWT + Company only, app.module.ts:47-48).
 *
 * Expected behaviour (post-F2): every MUTATION carries @UseGuards(PermissionGuard) +
 * @RequirePermission('manage','org_unit') for org_units and ('manage','team') for teams.
 * Action is the bare verb 'manage' (seed catalog convention 0005/0019/0027), not a compound code;
 * the (action, resource_type) pair is what permissions.can() matches. Seeded in migration 0030.
 * Reads stay on JWT + Company (non-sensitive, RLS-tenant-isolated) and are intentionally NOT asserted here.
 *
 * Why RED before F2: the controller has no metadata/guard → both the metadata reflection and the
 * deny-path guard behaviour assertions fail.
 */

import 'reflect-metadata';
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

// NestJS stores @UseGuards() under this metadata key (GUARDS_METADATA in @nestjs/common/constants).
const GUARDS_METADATA = '__guards__';

interface MutationCase {
  method: keyof OrgController;
  action: string;
  resourceType: string;
}

// Every state-changing route on OrgController and the permission it must demand.
const ORG_MUTATIONS: MutationCase[] = [
  { method: 'createOrgUnit', action: 'manage', resourceType: 'org_unit' },
  { method: 'updateOrgUnit', action: 'manage', resourceType: 'org_unit' },
  { method: 'deleteOrgUnit', action: 'manage', resourceType: 'org_unit' },
  { method: 'createDepartmentLegacy', action: 'manage', resourceType: 'org_unit' },
  { method: 'createTeam', action: 'manage', resourceType: 'team' },
  { method: 'updateTeam', action: 'manage', resourceType: 'team' },
  { method: 'assignTeamLeader', action: 'manage', resourceType: 'team' },
  { method: 'deleteTeam', action: 'manage', resourceType: 'team' },
  { method: 'addTeamMember', action: 'manage', resourceType: 'team' },
  { method: 'removeTeamMember', action: 'manage', resourceType: 'team' },
];

function handlerOf(method: keyof OrgController): (...args: unknown[]) => unknown {
  return OrgController.prototype[method] as unknown as (...args: unknown[]) => unknown;
}

/** Collect class-level + method-level guards declared via @UseGuards(). */
function guardsFor(method: keyof OrgController): unknown[] {
  const classGuards = (Reflect.getMetadata(GUARDS_METADATA, OrgController) as unknown[]) ?? [];
  const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handlerOf(method)) as unknown[]) ?? [];
  return [...classGuards, ...methodGuards];
}

/** Minimal ExecutionContext pointing at a real controller handler so the guard reads real metadata. */
function makeCtx(method: keyof OrgController, user: { id: string; companyId: string }): ExecutionContext {
  const req = { params: {}, user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handlerOf(method),
    getClass: () => OrgController,
  } as unknown as ExecutionContext;
}

describe('F2 — Org/Team mutations are permission-guarded (RED)', () => {
  const reflector = new Reflector();
  const normalUser = { id: 'user-normal', companyId: '11111111-1111-1111-1111-111111111111' };

  it.each(ORG_MUTATIONS)(
    '$method declares @RequirePermission($action, $resourceType)',
    ({ method, action, resourceType }) => {
      const meta = reflector.get<RequirePermissionMeta>(REQUIRE_PERMISSION, handlerOf(method));
      expect(meta, `${method} is missing @RequirePermission`).toBeDefined();
      expect(meta.action).toBe(action);
      expect(meta.resourceType).toBe(resourceType);
    },
  );

  it.each(ORG_MUTATIONS)('$method is protected by PermissionGuard', ({ method }) => {
    expect(guardsFor(method)).toContain(PermissionGuard);
  });

  describe('deny-path: a normal user (no manage-* grant) is rejected with 403', () => {
    let mockPermSvc: { can: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockPermSvc = { can: vi.fn() };
    });

    it.each(ORG_MUTATIONS)('$method → ForbiddenException when can() denies', async ({ method }) => {
      mockPermSvc.can.mockResolvedValue({
        allow: false,
        reason: 'deny-default',
        auditRequired: false,
      } satisfies PermissionDecision);

      const guard = new PermissionGuard(reflector, mockPermSvc as never);
      await expect(guard.canActivate(makeCtx(method, normalUser))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockPermSvc.can).toHaveBeenCalledOnce();
    });

    it.each(ORG_MUTATIONS)('$method → allowed when can() grants', async ({ method, action, resourceType }) => {
      mockPermSvc.can.mockResolvedValue({
        allow: true,
        reason: 'allow',
        auditRequired: false,
      } satisfies PermissionDecision);

      const guard = new PermissionGuard(reflector, mockPermSvc as never);
      await expect(guard.canActivate(makeCtx(method, normalUser))).resolves.toBe(true);
      expect(mockPermSvc.can).toHaveBeenCalledWith(
        expect.objectContaining({ action, resourceType, companyId: normalUser.companyId }),
      );
    });
  });
});
