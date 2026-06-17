import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TokenService } from "../../auth/token.service";
import { OPERATOR_ONLY } from "../../auth/operator-only.decorator";
import { JwtAuthGuard, type AuthRequest } from "./jwt-auth.guard";

const TEST_SECRET = "y".repeat(40);

/**
 * AC-0b — JwtAuthGuard audience routing. Default (unmarked) route expects a TENANT token (legacy
 * unchanged); @OperatorOnly route expects an OPERATOR token. Cross-audience tokens are rejected both
 * directions. The resolved `aud` is carried into req.user.
 */
function httpCtx(
  authHeader: string | undefined,
  flags: { isPublic?: boolean; operatorOnly?: boolean } = {},
): { ctx: ExecutionContext; reflector: Reflector; req: Partial<AuthRequest> } {
  const req: Partial<AuthRequest> = {
    headers: authHeader ? { authorization: authHeader } : {},
  } as Partial<AuthRequest>;
  const ctx = {
    getType: () => "http",
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === OPERATOR_ONLY ? !!flags.operatorOnly : !!flags.isPublic,
  } as unknown as Reflector;
  return { ctx, reflector, req };
}

describe("JwtAuthGuard audience routing (AC-0b)", () => {
  const prev = process.env.JWT_SECRET;
  const tokens = new TokenService();
  beforeAll(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    process.env.JWT_SECRET = prev;
  });

  it("tenant route: tenant token allowed, aud carried into req.user", () => {
    const t = tokens.signAccessToken({ sub: "u1", companyId: "c1", email: "a@b.c", aud: "tenant" });
    const { ctx, reflector, req } = httpCtx(`Bearer ${t}`);
    const guard = new JwtAuthGuard(reflector, tokens);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.user?.aud).toBe("tenant");
  });

  it("tenant route: legacy token (no aud) allowed (backward-compat)", () => {
    const t = tokens.signAccessToken({ sub: "u1", companyId: "c1", email: "a@b.c" });
    const { ctx, reflector, req } = httpCtx(`Bearer ${t}`);
    const guard = new JwtAuthGuard(reflector, tokens);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.user?.aud).toBe("tenant");
  });

  it("tenant route: operator token REJECTED (wrong audience → 401)", () => {
    const t = tokens.signAccessToken({ sub: "u1", companyId: "c1", email: "a@b.c", aud: "operator" });
    const { ctx, reflector } = httpCtx(`Bearer ${t}`);
    const guard = new JwtAuthGuard(reflector, tokens);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("@OperatorOnly route: operator token allowed, aud=operator in req.user", () => {
    const t = tokens.signAccessToken({ sub: "u1", companyId: "c1", email: "a@b.c", aud: "operator" });
    const { ctx, reflector, req } = httpCtx(`Bearer ${t}`, { operatorOnly: true });
    const guard = new JwtAuthGuard(reflector, tokens);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.user?.aud).toBe("operator");
  });

  it("@OperatorOnly route: tenant token REJECTED (wrong audience → 401)", () => {
    const t = tokens.signAccessToken({ sub: "u1", companyId: "c1", email: "a@b.c", aud: "tenant" });
    const { ctx, reflector } = httpCtx(`Bearer ${t}`, { operatorOnly: true });
    const guard = new JwtAuthGuard(reflector, tokens);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("@OperatorOnly route: legacy token (no aud=tenant) REJECTED", () => {
    const t = tokens.signAccessToken({ sub: "u1", companyId: "c1", email: "a@b.c" });
    const { ctx, reflector } = httpCtx(`Bearer ${t}`, { operatorOnly: true });
    const guard = new JwtAuthGuard(reflector, tokens);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("missing Authorization header → 401", () => {
    const { ctx, reflector } = httpCtx(undefined);
    const guard = new JwtAuthGuard(reflector, tokens);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it("@Public route bypasses auth entirely", () => {
    const { ctx, reflector } = httpCtx(undefined, { isPublic: true });
    const guard = new JwtAuthGuard(reflector, tokens);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
