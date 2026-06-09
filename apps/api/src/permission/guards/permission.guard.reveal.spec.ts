/**
 * G6-2b RED suite — PermissionGuard reveal-path forwarding (2e0 gap).
 *
 * Seam (permission.guard.ts:73-80): PermissionGuard.canActivate() calls permission.can() WITHOUT
 * forwarding the route :id param as `resourceId` and WITHOUT forwarding the re-auth window as
 * `ctx.reauthValidUntil`. This suite encodes the EXPECTED behaviour (post-2e0) so all cases are RED
 * until guard-forwarding is implemented.
 *
 * Why RED: guard passes neither resourceId nor ctx → can() is called with resourceId=undefined and
 * ctx=undefined. The assertions expect them to be forwarded → spy call args mismatch.
 *
 * Cases:
 *   2e0-A — reveal route with :id param + valid reauth window → can() called WITH resourceId + reauthValidUntil
 *   2e0-B — reveal route WITHOUT :id param → can() called with resourceId=null/undefined (object-tier skip)
 *   2e0-C — non-reveal route → can() called without ctx (baseline — this should already pass)
 */

import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionDecision } from '../permission.types';

// ─── Helpers mirroring permission.g3-4.spec.ts ────────────────────────────────

function makeReflector(opts: {
  isPublic?: boolean;
  permMeta?: {
    action: string;
    resourceType: string;
    isSensitive?: boolean;
    requiresReauth?: boolean;
  };
}): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === 'IS_PUBLIC') return opts.isPublic ?? false;
      if (key === 'REQUIRE_PERMISSION') return opts.permMeta ?? undefined;
      return undefined;
    }),
  } as unknown as Reflector;
}

/** Build a minimal ExecutionContext that mirrors what the real HTTP layer provides. */
function makeRevealCtx(opts: {
  accountId?: string;
  reauthValidUntil?: Date;
  userId?: string;
  companyId?: string;
}): import('@nestjs/common').ExecutionContext {
  const req = {
    params: opts.accountId ? { id: opts.accountId } : {},
    user: {
      id: opts.userId ?? 'user-a',
      companyId: opts.companyId ?? 'company-a',
    },
    // The re-auth window comes from the request context (set by ReauthGuard / reauth endpoint).
    // Seam 2e0: guard must extract this and pass as ctx.reauthValidUntil to can().
    reauthContext: opts.reauthValidUntil ? { reauthValidUntil: opts.reauthValidUntil } : undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({ name: 'revealSecret' }),
    getClass: () => ({ name: 'PlatformAccountsController' }),
  } as unknown as import('@nestjs/common').ExecutionContext;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('PermissionGuard — reveal-path forwarding (2e0 RED)', () => {
  let mockPermSvc: { can: ReturnType<typeof vi.fn> };
  let PermissionGuardClass: typeof import('./permission.guard').PermissionGuard;

  const REVEAL_META = {
    action: 'reveal-secret',
    resourceType: 'platform-account',
    isSensitive: true,
    requiresReauth: true,
  };

  beforeEach(async () => {
    const mod = await import('./permission.guard');
    PermissionGuardClass = mod.PermissionGuard;
    mockPermSvc = { can: vi.fn() };
  });

  it('2e0-A — reveal route with :id param + valid reauth window: can() MUST be called with resourceId AND reauthValidUntil', async () => {
    // Arrange
    const accountId = 'acct-1111-2222-3333-4444';
    const reauthValidUntil = new Date(Date.now() + 300_000); // 5 min from now
    const reflector = makeReflector({ permMeta: REVEAL_META });
    const guard = new PermissionGuardClass(reflector, mockPermSvc as never);
    const ctx = makeRevealCtx({ accountId, reauthValidUntil });

    // Return ALLOW so the guard doesn't throw before we can inspect the call
    mockPermSvc.can.mockResolvedValue({
      allow: true,
      reason: 'allow',
      auditRequired: true,
    } satisfies PermissionDecision);

    // Act
    await guard.canActivate(ctx);

    // Assert — Seam gap: guard currently does NOT forward resourceId or ctx.reauthValidUntil
    // (permission.guard.ts:73-80). After 2e0, this assertion must pass.
    expect(mockPermSvc.can).toHaveBeenCalledOnce();
    const callArg = mockPermSvc.can.mock.calls[0][0] as Record<string, unknown>;

    // RED: guard passes resourceId=undefined (missing), so this assertion fails.
    expect(callArg['resourceId']).toBe(accountId);

    // RED: guard passes ctx=undefined (missing), so this assertion fails.
    expect(callArg['ctx']).toBeDefined();
    expect((callArg['ctx'] as { reauthValidUntil?: Date })['reauthValidUntil']).toEqual(reauthValidUntil);
  });

  it('2e0-B — reveal route with :id param but NO reauth window: can() called with resourceId + no reauthValidUntil (→ deny-reauth-required)', async () => {
    // Arrange
    const accountId = 'acct-aaaa-bbbb-cccc-dddd';
    const reflector = makeReflector({ permMeta: REVEAL_META });
    const guard = new PermissionGuardClass(reflector, mockPermSvc as never);
    const ctx = makeRevealCtx({ accountId }); // no reauthValidUntil

    // Return DENY so guard throws 403
    mockPermSvc.can.mockResolvedValue({
      allow: false,
      reason: 'deny-reauth-required',
      requiresReauth: true,
      auditRequired: true,
    } satisfies PermissionDecision);

    // Act + Assert: should throw 403
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);

    // The call must still have forwarded resourceId (even if reauth is missing)
    expect(mockPermSvc.can).toHaveBeenCalledOnce();
    const callArg = mockPermSvc.can.mock.calls[0][0] as Record<string, unknown>;
    // RED: resourceId is not forwarded by current guard
    expect(callArg['resourceId']).toBe(accountId);
  });

  it('2e0-C — non-sensitive route without :id: can() called with resourceId=undefined and no ctx (baseline)', async () => {
    // This case should already pass (guard doesn't need to forward anything extra for non-reveal).
    const reflector = makeReflector({
      permMeta: { action: 'read', resourceType: 'platform-account', isSensitive: false },
    });
    const guard = new PermissionGuardClass(reflector, mockPermSvc as never);
    const ctx = makeRevealCtx({}); // no accountId, no reauth

    mockPermSvc.can.mockResolvedValue({
      allow: true,
      reason: 'allow',
      auditRequired: false,
    } satisfies PermissionDecision);

    await guard.canActivate(ctx);

    expect(mockPermSvc.can).toHaveBeenCalledOnce();
    // For non-reveal routes, resourceId=undefined is acceptable (type-level check).
    // This assertion merely verifies can() was called — not that resourceId was forwarded.
    expect(mockPermSvc.can.mock.calls[0][0]).toMatchObject({
      action: 'read',
      resourceType: 'platform-account',
    });
  });

  it('2e0-D — reauth window present but expired: can() called WITH reauthValidUntil (past date) → guard throws 403', async () => {
    const accountId = 'acct-expired-window';
    const expiredReauth = new Date(Date.now() - 60_000); // 1 minute ago
    const reflector = makeReflector({ permMeta: REVEAL_META });
    const guard = new PermissionGuardClass(reflector, mockPermSvc as never);
    const ctx = makeRevealCtx({ accountId, reauthValidUntil: expiredReauth });

    mockPermSvc.can.mockResolvedValue({
      allow: false,
      reason: 'deny-reauth-required',
      requiresReauth: true,
      auditRequired: true,
    } satisfies PermissionDecision);

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);

    // RED: guard does not forward resourceId or ctx — assert the forwarding happens
    const callArg = mockPermSvc.can.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg['resourceId']).toBe(accountId);
    expect((callArg['ctx'] as { reauthValidUntil?: Date })['reauthValidUntil']).toEqual(expiredReauth);
  });
});
