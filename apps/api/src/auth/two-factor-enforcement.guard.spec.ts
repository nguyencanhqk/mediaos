import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";

import {
  TWO_FACTOR_SETUP_REQUIRED,
  TwoFactorEnforcementGuard,
} from "./two-factor-enforcement.guard";
import type { TwoFactorService } from "./two-factor.service";
import type { DatabaseService } from "../db/db.service";
import type { SecurityPolicyService } from "../security-policy/security-policy.service";

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

/** Fake DatabaseService: withTenant chạy callback với tx giả (guard chỉ chuyển tiếp cho policy svc). */
const fakeDb = {
  withTenant: async <T>(_companyId: string, fn: (tx: never) => Promise<T>) =>
    fn(undefined as never),
} as unknown as DatabaseService;

/**
 * Fake SecurityPolicyService — getEffectiveTwoFactorRequired gói công thức fail-stricter. Ở đây mô phỏng:
 * trả `globalEnabled || companyEnforced` (đúng như impl thật khi global=false → trả company-policy).
 */
function fakeSecurityPolicy(companyEnforced: boolean): SecurityPolicyService {
  return {
    getEffectiveTwoFactorRequired: async (_tx: never, _companyId: string, globalEnabled: boolean) =>
      globalEnabled || companyEnforced,
  } as unknown as SecurityPolicyService;
}

/** Dựng guard với global flag tường minh (guard cache flag lúc construct → set env TRƯỚC). */
function makeGuard(opts: {
  global: boolean;
  reflector: Reflector;
  twoFactor: TwoFactorService;
  companyEnforced?: boolean;
}): TwoFactorEnforcementGuard {
  process.env.TWO_FACTOR_ENFORCEMENT_ENABLED = opts.global ? "true" : "false";
  // CS-9 enforcement bật để guard đọc company-policy ở nhánh global-off.
  process.env.SECURITY_POLICY_ENFORCEMENT_ENABLED = "true";
  return new TwoFactorEnforcementGuard(
    opts.reflector,
    opts.twoFactor,
    fakeDb,
    fakeSecurityPolicy(opts.companyEnforced ?? false),
  );
}

describe("TwoFactorEnforcementGuard (global=ON, role-based — hành vi cũ)", () => {
  it("DENY: role requires 2FA + chưa enroll → ForbiddenException code=TWO_FACTOR_SETUP_REQUIRED", async () => {
    const { ctx, reflector } = httpCtx({ id: "u1", companyId: "c1" });
    const guard = makeGuard({ global: true, reflector, twoFactor: fakeTwoFactor(true, false) });
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
    const guard = makeGuard({ global: true, reflector, twoFactor: fakeTwoFactor(true, true) });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("ALLOW: role KHÔNG ép + công ty KHÔNG ép → pass", async () => {
    const { ctx, reflector } = httpCtx({ id: "u1", companyId: "c1" });
    const guard = makeGuard({ global: true, reflector, twoFactor: fakeTwoFactor(false, false), companyEnforced: false });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("SKIP: route @AllowWithoutTwoFactor → pass DÙ chưa enroll (chống deadlock enroll)", async () => {
    const { ctx, reflector } = httpCtx({ id: "u1", companyId: "c1" }, { allowWithout: true });
    const guard = makeGuard({ global: true, reflector, twoFactor: fakeTwoFactor(true, false) });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("SKIP: route @Public → pass", async () => {
    const { ctx, reflector } = httpCtx(undefined, { isPublic: true });
    const guard = makeGuard({ global: true, reflector, twoFactor: fakeTwoFactor(true, false) });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("SKIP: non-http (WS) context → pass (enforcement chỉ áp REST)", async () => {
    const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
    const ctx = {
      getType: () => "ws",
      getHandler: () => () => {},
      getClass: () => class {},
    } as unknown as ExecutionContext;
    const guard = makeGuard({ global: true, reflector, twoFactor: fakeTwoFactor(true, false) });
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});

/**
 * CS-9 fail-STRICTER — 4 tổ hợp (global × company). KHÔNG tổ hợp nào hạ dưới sàn global. user KHÔNG có role
 * ép 2FA + CHƯA enroll → quyết định CHỈ dựa vào (global-role) và (company-enforce).
 */
describe("TwoFactorEnforcementGuard — 4 tổ hợp fail-stricter (global × company)", () => {
  const user = { id: "u1", companyId: "c1" };

  it("(global OFF, company OFF) → KHÔNG ép (pass) — sàn thấp nhất", async () => {
    const { ctx, reflector } = httpCtx(user);
    const guard = makeGuard({ global: false, reflector, twoFactor: fakeTwoFactor(false, false), companyEnforced: false });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("(global OFF, company ON) → ÉP (deny khi chưa enroll) — tenant NÂNG chuẩn", async () => {
    const { ctx, reflector } = httpCtx(user);
    const guard = makeGuard({ global: false, reflector, twoFactor: fakeTwoFactor(false, false), companyEnforced: true });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(global ON, company OFF/null) → VẪN ép theo role (global là sàn, company KHÔNG hạ được)", async () => {
    const { ctx, reflector } = httpCtx(user);
    // role ép + chưa enroll → deny dù company không bật.
    const guard = makeGuard({ global: true, reflector, twoFactor: fakeTwoFactor(true, false), companyEnforced: false });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(global ON, company ON) → ép cho MỌI user công ty (kể cả không role) khi chưa enroll", async () => {
    const { ctx, reflector } = httpCtx(user);
    const guard = makeGuard({ global: true, reflector, twoFactor: fakeTwoFactor(false, false), companyEnforced: true });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(global OFF, company ON) + ĐÃ enroll → pass (đủ điều kiện)", async () => {
    const { ctx, reflector } = httpCtx(user);
    const guard = makeGuard({ global: false, reflector, twoFactor: fakeTwoFactor(false, true), companyEnforced: true });
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
