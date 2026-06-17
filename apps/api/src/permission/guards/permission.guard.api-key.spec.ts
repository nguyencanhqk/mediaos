import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { REQUIRE_PERMISSION, type RequirePermissionMeta } from "../require-permission.decorator";
import type { PermissionService } from "../permission.service";
import { PermissionGuard } from "./permission.guard";

/**
 * AC-5 — PermissionGuard mở rộng cho PAT (viaApiKey). RED-first.
 *
 * Hiệu lực PAT = scope (đã resolve sang key "action:resourceType" ở ApiKeyAuthGuard) ∩ grant THỰC user.
 * Fail-closed: thiếu 1 trong 2 → 403; KHÔNG vượt quyền user. Đường JWT thường (không viaApiKey) y NGUYÊN.
 */

interface ApiKeyUser {
  id: string;
  companyId: string;
  viaApiKey?: boolean;
  scopeKeys?: string[];
}

function ctxFor(
  user: ApiKeyUser,
  meta: RequirePermissionMeta,
): { ctx: ExecutionContext; reflector: Reflector } {
  const req = { user, params: {} };
  const ctx = {
    getType: () => "http",
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: (key: string) => (key === REQUIRE_PERMISSION ? meta : false),
  } as unknown as Reflector;
  return { ctx, reflector };
}

const READ_TASK: RequirePermissionMeta = { action: "read", resourceType: "task" };

describe("PermissionGuard — PAT scope ∩ grant (AC-5)", () => {
  it("in-scope AND user has grant → allow", async () => {
    const permission = {
      can: vi.fn(async () => ({ allow: true, reason: "allow", auditRequired: false })),
    } as unknown as PermissionService;
    const { ctx, reflector } = ctxFor(
      { id: "u1", companyId: "c1", viaApiKey: true, scopeKeys: ["read:task"] },
      READ_TASK,
    );
    const guard = new PermissionGuard(reflector, permission);
    expect(await guard.canActivate(ctx)).toBe(true);
    // STILL calls permission.can() — grant THỰC của user phải được ép.
    expect(permission.can).toHaveBeenCalled();
  });

  it("OUT of scope (key not in scopeKeys) → 403 even if user grant would allow", async () => {
    const permission = {
      can: vi.fn(async () => ({ allow: true, reason: "allow", auditRequired: false })),
    } as unknown as PermissionService;
    const { ctx, reflector } = ctxFor(
      { id: "u1", companyId: "c1", viaApiKey: true, scopeKeys: ["read:notification"] },
      READ_TASK,
    );
    const guard = new PermissionGuard(reflector, permission);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    // Out-of-scope deny short-circuits — user grant never consulted.
    expect(permission.can).not.toHaveBeenCalled();
  });

  it("in-scope BUT user lacks grant → 403 (PAT cannot exceed user)", async () => {
    const permission = {
      can: vi.fn(async () => ({ allow: false, reason: "deny-default", auditRequired: false })),
    } as unknown as PermissionService;
    const { ctx, reflector } = ctxFor(
      { id: "u1", companyId: "c1", viaApiKey: true, scopeKeys: ["read:task"] },
      READ_TASK,
    );
    const guard = new PermissionGuard(reflector, permission);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("missing scopeKeys on a viaApiKey user → 403 (fail-closed, no scope = no access)", async () => {
    const permission = {
      can: vi.fn(async () => ({ allow: true, reason: "allow", auditRequired: false })),
    } as unknown as PermissionService;
    const { ctx, reflector } = ctxFor(
      { id: "u1", companyId: "c1", viaApiKey: true },
      READ_TASK,
    );
    const guard = new PermissionGuard(reflector, permission);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(permission.can).not.toHaveBeenCalled();
  });

  it("normal JWT user (NOT viaApiKey) → scope check skipped, only user grant decides", async () => {
    const permission = {
      can: vi.fn(async () => ({ allow: true, reason: "allow", auditRequired: false })),
    } as unknown as PermissionService;
    // No scopeKeys at all — JWT path must be untouched (regression guard for risk #1).
    const { ctx, reflector } = ctxFor({ id: "u1", companyId: "c1" }, READ_TASK);
    const guard = new PermissionGuard(reflector, permission);
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(permission.can).toHaveBeenCalled();
  });
});
