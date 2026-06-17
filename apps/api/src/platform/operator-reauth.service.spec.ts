import {
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../db/db.service";
import type { ValkeyService } from "../permission/valkey.service";
import type { PasswordService } from "../auth/password.service";
import type { LoginRateLimiter } from "../auth/login-rate-limiter";
import {
  OperatorReauthService,
  operatorReauthKey,
} from "./operator-reauth.service";

const OPERATOR = { id: "op-1", companyId: "home-co" };
const TARGET = "target-tenant-A";

/** Minimal fakes mirroring the platform-accounts reauth unit shape. */
function makeService(opts: {
  passwordOk?: boolean;
  locked?: boolean;
  setResult?: boolean;
} = {}) {
  const { passwordOk = true, locked = false, setResult = true } = opts;

  const setCalls: Array<{ key: string; value: string; ttl: number }> = [];
  const valkey = {
    set: vi.fn(async (key: string, value: string, ttl: number) => {
      setCalls.push({ key, value, ttl });
      return setResult;
    }),
    get: vi.fn(async () => null),
  } as unknown as ValkeyService;

  // Fake withTenant: run the callback against a tx stub whose select-chain resolves to a user row,
  // so the service's password.verify(row.passwordHash, ...) path runs (mirrors the real flow).
  const txStub = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ passwordHash: "stored-hash" }] }) }),
    }),
  };
  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(txStub as unknown),
    ),
  } as unknown as DatabaseService;

  const password = {
    verify: vi.fn(async () => passwordOk),
  } as unknown as PasswordService;

  const recordFailure = vi.fn(async () => {});
  const reset = vi.fn(async () => {});
  const rateLimiter = {
    isLocked: vi.fn(async () => locked),
    recordFailure,
    reset,
  } as unknown as LoginRateLimiter;

  const svc = new OperatorReauthService(db, valkey, password, rateLimiter);
  return { svc, valkey, password, rateLimiter, setCalls, recordFailure, reset };
}

describe("OperatorReauthService (AC-0b step-up)", () => {
  it("key is scoped to (operator, targetTenant)", () => {
    expect(operatorReauthKey("op-1", "tA")).toBe("operator-reauth:op-1:tA");
    expect(operatorReauthKey("op-1", "tB")).not.toBe(operatorReauthKey("op-1", "tA"));
  });

  it("missing password → UnauthorizedException (no window written)", async () => {
    const { svc, valkey } = makeService();
    await expect(svc.stepUp(OPERATOR, TARGET, {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(valkey.set).not.toHaveBeenCalled();
  });

  it("wrong password → UnauthorizedException + records rate-limit failure, no window", async () => {
    const { svc, valkey, recordFailure } = makeService({ passwordOk: false });
    await expect(
      svc.stepUp(OPERATOR, TARGET, { password: "bad" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(valkey.set).not.toHaveBeenCalled();
  });

  it("throttled (locked) → 429 HttpException, no password check, no window", async () => {
    const { svc, valkey, password } = makeService({ locked: true });
    await expect(svc.stepUp(OPERATOR, TARGET, { password: "x" })).rejects.toMatchObject({
      status: 429,
    });
    expect(password.verify).not.toHaveBeenCalled();
    expect(valkey.set).not.toHaveBeenCalled();
  });

  it("valid password → writes window scoped to (operator, target) with TTL, resets limiter", async () => {
    const { svc, setCalls, reset } = makeService();
    const out = await svc.stepUp(OPERATOR, TARGET, { password: "good" });
    expect(out.reauthValidUntil.getTime()).toBeGreaterThan(Date.now());
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].key).toBe(operatorReauthKey(OPERATOR.id, TARGET));
    expect(setCalls[0].ttl).toBeGreaterThan(0);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("Valkey persist failure → ServiceUnavailableException (never a false-success window)", async () => {
    const { svc } = makeService({ setResult: false });
    await expect(
      svc.stepUp(OPERATOR, TARGET, { password: "good" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
