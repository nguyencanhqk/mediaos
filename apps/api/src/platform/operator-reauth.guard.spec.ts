import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ValkeyService } from "../permission/valkey.service";
import { OperatorReauthGuard } from "./operator-reauth.guard";
import { operatorReauthKey } from "./operator-reauth.service";

/**
 * AC-0b — OperatorReauthGuard mirrors ReauthGuard: it is NOT an authz gate (always true). It only
 * populates req.reauthContext from the (operatorId, targetTenantId) Valkey window so the downstream
 * step-up route sees a valid window. The window is scoped to the route :id (target tenant).
 */
function ctxFor(
  userId: string | undefined,
  targetId: string | undefined,
): { ctx: ExecutionContext; req: Record<string, unknown> } {
  const req: Record<string, unknown> = {
    user: userId ? { id: userId } : undefined,
    params: targetId ? { id: targetId } : {},
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function fakeValkey(value: string | null): ValkeyService {
  return { get: vi.fn(async () => value) } as unknown as ValkeyService;
}

describe("OperatorReauthGuard (AC-0b)", () => {
  it("reads the (operator, target) key and sets reauthContext when window valid", async () => {
    const future = String(Date.now() + 60_000);
    const valkey = fakeValkey(future);
    const guard = new OperatorReauthGuard(valkey);
    const { ctx, req } = ctxFor("op-1", "tA");
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(valkey.get).toHaveBeenCalledWith(operatorReauthKey("op-1", "tA"));
    expect((req.reauthContext as { reauthValidUntil?: Date }).reauthValidUntil).toBeInstanceOf(Date);
  });

  it("no window (null) → reauthContext unset (step-up route will deny)", async () => {
    const guard = new OperatorReauthGuard(fakeValkey(null));
    const { ctx, req } = ctxFor("op-1", "tA");
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(req.reauthContext).toBeUndefined();
  });

  it("expired window → reauthContext unset", async () => {
    const past = String(Date.now() - 60_000);
    const guard = new OperatorReauthGuard(fakeValkey(past));
    const { ctx, req } = ctxFor("op-1", "tA");
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(req.reauthContext).toBeUndefined();
  });

  it("missing identity/target → true, no lookup", async () => {
    const valkey = fakeValkey(String(Date.now() + 60_000));
    const guard = new OperatorReauthGuard(valkey);
    const { ctx } = ctxFor(undefined, "tA");
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(valkey.get).not.toHaveBeenCalled();
  });
});
