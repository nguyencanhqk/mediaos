/**
 * G3-4 — RED suite for guards + cache (written BEFORE implementation, plan §4 G3-4).
 *
 * Coverage targets (plan §4 G3-4):
 *   - JwtAuthGuard: no token → 401; invalid token → 401; valid → user attached; @Public → pass
 *   - CompanyGuard: @Public → pass; missing companyId → 403; has companyId → pass
 *   - PermissionGuard: @Public → pass; no decorator → 403 (fail-closed); can()=ALLOW → pass; can()=DENY → 403
 *   - CachedPermissionRepository: cache hit skips DB; cache miss queries DB + caches; invalidate → DEL
 *   - Valkey down → DB fallback (no 500); DB down → fail-closed DENY
 *   - Role revoke → invalidate → next can() sees 403
 *   - Privilege-escalation: user grants self → 403 (guard on PATCH /permissions/object)
 */

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionDecision } from './permission.types';

// ─── Minimal mocks ────────────────────────────────────────────────────────────

function makeCtx(opts: {
  authorization?: string;
  user?: { id: string; companyId: string; email: string };
  handler?: string;
  isPublic?: boolean;
  permMeta?: { action: string; resourceType: string; isSensitive?: boolean };
}): ExecutionContext {
  const req = {
    headers: { authorization: opts.authorization },
    user: opts.user,
  };
  const handler = { name: opts.handler ?? 'testHandler' };
  return {
    // Guards short-circuit non-http contexts (WS auth enforced at handshake);
    // these are HTTP guard unit tests so the mock context reports 'http'.
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    getHandler: () => handler,
    getClass: () => ({ name: 'TestController' }),
    _req: req,
    _isPublic: opts.isPublic ?? false,
    _permMeta: opts.permMeta,
  } as unknown as ExecutionContext;
}

function makeReflector(opts: {
  isPublic?: boolean;
  permMeta?: { action: string; resourceType: string; isSensitive?: boolean };
}): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string) => {
      if (key === 'IS_PUBLIC') return opts.isPublic ?? false;
      if (key === 'REQUIRE_PERMISSION') return opts.permMeta;
      return undefined;
    }),
  } as unknown as Reflector;
}

// ─── JwtAuthGuard tests ───────────────────────────────────────────────────────

describe('JwtAuthGuard', () => {
  let guard: import('./guards/jwt-auth.guard').JwtAuthGuard;
  let mockTokens: { verifyAccessToken: ReturnType<typeof vi.fn> };
  let reflector: Reflector;
  let JwtAuthGuardClass: typeof import('./guards/jwt-auth.guard').JwtAuthGuard;

  beforeEach(async () => {
    const mod = await import('./guards/jwt-auth.guard');
    JwtAuthGuardClass = mod.JwtAuthGuard;
    mockTokens = { verifyAccessToken: vi.fn() };
    reflector = makeReflector({});
    guard = new JwtAuthGuardClass(reflector, mockTokens as never);
  });

  it('(1) throws 401 when Authorization header is missing', () => {
    const ctx = makeCtx({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('(2) throws 401 when token is invalid/expired', () => {
    mockTokens.verifyAccessToken.mockImplementation(() => { throw new Error('jwt expired'); });
    const ctx = makeCtx({ authorization: 'Bearer bad-token' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('(3) attaches user to request when token is valid', () => {
    mockTokens.verifyAccessToken.mockReturnValue({ sub: 'u1', companyId: 'co1', email: 'a@b.com' });
    const ctx = makeCtx({ authorization: 'Bearer valid-token' });
    const req = ctx.switchToHttp().getRequest() as { user?: unknown };
    guard.canActivate(ctx);
    expect(req.user).toEqual({ id: 'u1', companyId: 'co1', email: 'a@b.com' });
  });

  it('(4) passes without checking token when route is @Public', () => {
    reflector = makeReflector({ isPublic: true });
    guard = new JwtAuthGuardClass(reflector, mockTokens as never);
    const ctx = makeCtx({ isPublic: true });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(mockTokens.verifyAccessToken).not.toHaveBeenCalled();
  });
});

// ─── CompanyGuard tests ───────────────────────────────────────────────────────

describe('CompanyGuard', () => {
  let guard: import('./guards/company.guard').CompanyGuard;

  beforeEach(async () => {
    const { CompanyGuard } = await import('./guards/company.guard');
    guard = new CompanyGuard(makeReflector({}));
  });

  it('(5) passes when route is @Public (no user needed)', async () => {
    const { CompanyGuard } = await import('./guards/company.guard');
    guard = new CompanyGuard(makeReflector({ isPublic: true }));
    const ctx = makeCtx({ isPublic: true });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('(6) throws 403 when user has no companyId', () => {
    const ctx = makeCtx({ user: { id: 'u1', companyId: '', email: 'a@b.com' } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('(7) passes when user has companyId', () => {
    const ctx = makeCtx({ user: { id: 'u1', companyId: 'co1', email: 'a@b.com' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

// ─── PermissionGuard tests ────────────────────────────────────────────────────

describe('PermissionGuard', () => {
  let mockPermSvc: { can: ReturnType<typeof vi.fn> };
  let PermissionGuardClass: typeof import('./guards/permission.guard').PermissionGuard;

  function makeGuard(
    reflector: Reflector,
  ): import('./guards/permission.guard').PermissionGuard {
    return new PermissionGuardClass(reflector, mockPermSvc as never);
  }

  beforeEach(async () => {
    const mod = await import('./guards/permission.guard');
    PermissionGuardClass = mod.PermissionGuard;
    mockPermSvc = { can: vi.fn() };
  });

  it('(8) passes when route is @Public', async () => {
    const guard = makeGuard(makeReflector({ isPublic: true }));
    const ctx = makeCtx({ isPublic: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockPermSvc.can).not.toHaveBeenCalled();
  });

  it('(9) throws 403 (fail-closed) when route has NO @RequirePermission decorator', async () => {
    const guard = makeGuard(makeReflector({}));
    const ctx = makeCtx({ user: { id: 'u1', companyId: 'co1', email: 'a@b.com' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(mockPermSvc.can).not.toHaveBeenCalled();
  });

  it('(10) passes when can() returns ALLOW', async () => {
    const guard = makeGuard(makeReflector({ permMeta: { action: 'read', resourceType: 'project' } }));
    mockPermSvc.can.mockResolvedValue({ allow: true, reason: 'allow', auditRequired: false } satisfies PermissionDecision);
    const ctx = makeCtx({ user: { id: 'u1', companyId: 'co1', email: 'a@b.com' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('(11) throws 403 when can() returns DENY (deny-explicit)', async () => {
    const guard = makeGuard(makeReflector({ permMeta: { action: 'delete', resourceType: 'project', isSensitive: true } }));
    mockPermSvc.can.mockResolvedValue({ allow: false, reason: 'deny-explicit', auditRequired: true } satisfies PermissionDecision);
    const ctx = makeCtx({ user: { id: 'u1', companyId: 'co1', email: 'a@b.com' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('(12) throws 403 when can() returns deny-sensitive (sensitive + no explicit grant)', async () => {
    const guard = makeGuard(makeReflector({ permMeta: { action: 'view-salary', resourceType: 'payslip', isSensitive: true } }));
    mockPermSvc.can.mockResolvedValue({ allow: false, reason: 'deny-sensitive', auditRequired: true } satisfies PermissionDecision);
    const ctx = makeCtx({ user: { id: 'u1', companyId: 'co1', email: 'a@b.com' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('(13) throws 403 (fail-closed) when can() throws (DB/infra error)', async () => {
    const guard = makeGuard(makeReflector({ permMeta: { action: 'read', resourceType: 'project' } }));
    mockPermSvc.can.mockRejectedValue(new Error('DB connection lost'));
    const ctx = makeCtx({ user: { id: 'u1', companyId: 'co1', email: 'a@b.com' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('(14) privilege-escalation: user without grant-object-permission → 403', async () => {
    const guard = makeGuard(makeReflector({ permMeta: { action: 'grant-object-permission', resourceType: 'permission', isSensitive: true } }));
    mockPermSvc.can.mockResolvedValue({ allow: false, reason: 'deny-default', auditRequired: false } satisfies PermissionDecision);
    const ctx = makeCtx({ user: { id: 'u1', companyId: 'co1', email: 'a@b.com' } });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});

// ─── CachedPermissionRepository tests ────────────────────────────────────────

describe('CachedPermissionRepository', () => {
  let innerRepo: {
    getCompanyRoleGrants: ReturnType<typeof vi.fn>;
    getObjectGrants: ReturnType<typeof vi.fn>;
  };
  let mockValkey: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    innerRepo = {
      getCompanyRoleGrants: vi.fn(),
      getObjectGrants: vi.fn(),
    };
    mockValkey = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(true), // ValkeyService.del() now returns boolean
    };
  });

  async function makeRepo(): Promise<import('./permission.cache').CachedPermissionRepository> {
    const { CachedPermissionRepository } = await import('./permission.cache');
    return new CachedPermissionRepository(innerRepo as never, mockValkey as never);
  }

  it('(15) cache miss: queries DB and stores result in Valkey', async () => {
    const grants = [{ action: 'read', resourceType: 'project', isSensitive: false, effect: 'ALLOW', expiresAt: null }];
    innerRepo.getCompanyRoleGrants.mockResolvedValue(grants);

    const repo = await makeRepo();
    const result = await repo.getCompanyRoleGrants('u1', 'co1');

    expect(innerRepo.getCompanyRoleGrants).toHaveBeenCalledWith('u1', 'co1');
    expect(mockValkey.set).toHaveBeenCalledWith('perm:cap:co1:u1', expect.any(String), 300);
    expect(result).toEqual(grants);
  });

  it('(16) cache hit: returns cached value WITHOUT querying DB', async () => {
    const grants = [{ action: 'read', resourceType: 'project', isSensitive: false, effect: 'ALLOW', expiresAt: null }];
    mockValkey.get.mockResolvedValue(JSON.stringify(grants));

    const repo = await makeRepo();
    const result = await repo.getCompanyRoleGrants('u1', 'co1');

    expect(innerRepo.getCompanyRoleGrants).not.toHaveBeenCalled();
    expect(result).toMatchObject([expect.objectContaining({ action: 'read' })]);
  });

  it('(17) cache hit with expiresAt string: deserializes to Date', async () => {
    const future = new Date(Date.now() + 3_600_000);
    const grants = [{ action: 'read', resourceType: 'project', isSensitive: false, effect: 'ALLOW', expiresAt: future.toISOString() }];
    mockValkey.get.mockResolvedValue(JSON.stringify(grants));

    const repo = await makeRepo();
    const result = await repo.getCompanyRoleGrants('u1', 'co1');

    expect(result[0]?.expiresAt).toBeInstanceOf(Date);
  });

  it('(18) invalidateUser: DELs the cap cache key', async () => {
    const repo = await makeRepo();
    await repo.invalidateUser('co1', 'u1');

    expect(mockValkey.del).toHaveBeenCalledWith(expect.stringContaining('perm:cap:co1:u1'));
  });

  it('(19) Valkey get throws: falls back to DB (no error propagated)', async () => {
    mockValkey.get.mockRejectedValue(new Error('Valkey down'));
    innerRepo.getCompanyRoleGrants.mockResolvedValue([]);

    const repo = await makeRepo();
    const result = await repo.getCompanyRoleGrants('u1', 'co1');

    expect(innerRepo.getCompanyRoleGrants).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('(20) Valkey set throws: silently ignored (cache is best-effort)', async () => {
    mockValkey.get.mockResolvedValue(null);
    mockValkey.set.mockRejectedValue(new Error('Valkey write failed'));
    innerRepo.getCompanyRoleGrants.mockResolvedValue([]);

    const repo = await makeRepo();
    await expect(repo.getCompanyRoleGrants('u1', 'co1')).resolves.toEqual([]);
  });
});
