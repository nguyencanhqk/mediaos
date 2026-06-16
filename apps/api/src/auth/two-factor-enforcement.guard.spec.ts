import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { beforeAll, describe, expect, it } from "vitest";

// Vitest env đặt TWO_FACTOR_ENFORCEMENT_ENABLED='false' (kill-switch cho e2e cũ). Test guard này CHỦ ĐÍCH
// kiểm logic DENY khi BẬT → bật tường minh TRƯỚC khi import/construct guard (guard cache flag lúc khởi tạo).
process.env.TWO_FACTOR_ENFORCEMENT_ENABLED = "true";

import {
  TWO_FACTOR_SETUP_REQUIRED,
  TwoFactorEnforcementGuard,
} from "./two-factor-enforcement.guard";
import type { TwoFactorService } from "./two-factor.service";

beforeAll(() => {
  process.env.TWO_FACTOR_ENFORCEMENT_ENABLED = "true";
});

/** Mock ExecutionContext HTTP với req.user + metadata flags cho reflector. */
function httpCtx(
  user: { id: string; companyId: string } | undefined,
  flags: { isPublic?: boolean; allowWithout?: boolean } = {},
): { ctx: ExecutionContext; reflector: Reflector } {
  const ctx = {
    getType: () => "http",
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === "IS_PUBLIC" ? !!flags.isPublic : !!flags.allowWithout,
  } as unknown as Reflector;
  return { ctx, reflector };
}

function fakeTwoFactor(required: boolean, enabled: boolean): TwoFactorService {
  return {
    requiresTwoFactor: async () => required,
    isEnabled: async () => enabled,
  } as unknown as TwoFactorService;
}

describe("TwoFactorEnforcementGuard", () => {
  it("DENY: role requires 2FA + chưa enroll → ForbiddenException code=TWO_FACTOR_SETUP_REQUIRED", async () => {
    const { ctx, reflector } = httpCtx({ id: "u1", companyId: "c1" });
    const guard = new TwoFactorEnforcementGuard(reflector, fakeTwoFactor(true, false));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await guard.canActivate(ctx);
    } catch (e) {
      const res = (e as ForbiddenException).getResponse() as { code: string };
      expect(res.code).toBe(TWO_FACTOR_SETUP_REQUIRED);
    }
  });

  it("ALLOW: role requires 2FA + ĐÃ enroll → pass", async () => {
    const { ctx, reflector } = httpCtx({ id: "u1", companyId: "c1" });
    const guard = new TwoFactorEnforcementGuard(reflector, fakeTwoFactor(true, true));
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("ALLOW: role KHÔNG ép 2FA → pass (không gọi isEnabled)", async () => {
    const { ctx, reflector } = httpCtx({ id: "u1", companyId: "c1" });
    const guard = new TwoFactorEnforcementGuard(reflector, fakeTwoFactor(false, false));
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("SKIP: route @AllowWithoutTwoFactor → pass DÙ chưa enroll (chống deadlock enroll)", async () => {
    const { ctx, reflector } = httpCtx({ id: "u1", companyId: "c1" }, { allowWithout: true });
    const guard = new TwoFactorEnforcementGuard(reflector, fakeTwoFactor(true, false));
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("SKIP: route @Public → pass", async () => {
    const { ctx, reflector } = httpCtx(undefined, { isPublic: true });
    const guard = new TwoFactorEnforcementGuard(reflector, fakeTwoFactor(true, false));
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("SKIP: non-http (WS) context → pass (enforcement chỉ áp REST)", async () => {
    const reflector = {
      getAllAndOverride: () => false,
    } as unknown as Reflector;
    const ctx = {
      getType: () => "ws",
      getHandler: () => () => {},
      getClass: () => class {},
    } as unknown as ExecutionContext;
    const guard = new TwoFactorEnforcementGuard(reflector, fakeTwoFactor(true, false));
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
