import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TokenService } from "../../auth/token.service";
import { API_KEY_TOKEN_PREFIX } from "@mediaos/contracts";
import {
  ApiKeyAuthGuard,
  type ApiKeyAuthRecord,
  type ApiKeyAuthLookup,
} from "./api-key-auth.guard";

const TEST_SECRET = "z".repeat(40);

/**
 * AC-5 ApiKeyAuthGuard — unit-level. RED-first (symbol chưa tồn tại).
 *
 * Hợp đồng chốt:
 *   (a) Token KHÔNG bắt đầu `mok_` (JWT thường, hoặc header vắng) → PASS-THROUGH `true` (KHÔNG nuốt JWT;
 *       JwtAuthGuard xử lý sau). Đây là rào chống "guard nuốt nhầm JWT" (rủi ro #2).
 *   (b) Token `mok_` hợp lệ (hash khớp + chưa expired + chưa revoked) → set req.user{viaApiKey,scope,...} → true.
 *   (c) Token `mok_` sai hash → 401. (d) expired → 401. (e) revoked → 401. (f) prefix không tra được → 401.
 *   (g) ghi api_key_usages best-effort: lỗi ghi KHÔNG chặn request (vẫn true).
 */

function httpCtx(authHeader: string | undefined): {
  ctx: ExecutionContext;
  req: { headers: Record<string, string>; user?: unknown };
} {
  const req: { headers: Record<string, string>; user?: unknown } = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  const ctx = {
    getType: () => "http",
    getHandler: () => () => {},
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function makeRecord(over: Partial<ApiKeyAuthRecord> = {}): ApiKeyAuthRecord {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    userId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    tokenHash: "",
    scopePermissionIds: ["dddddddd-dddd-dddd-dddd-dddddddddddd"],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ...over,
  };
}

/**
 * Mock lookup: trả record khi token_hash khớp record.tokenHash (mô phỏng WHERE token_hash = $1 thật).
 * record.tokenHash rỗng/khác → trả null (không có hàng) → guard 401 (case forged/unknown).
 */
function lookupFor(record: ApiKeyAuthRecord | null): ApiKeyAuthLookup {
  return {
    findByTokenHash: vi.fn(async (hash: string) =>
      record && record.tokenHash === hash ? record : null,
    ),
    recordUsage: vi.fn(async () => {}),
    touchLastUsed: vi.fn(async () => {}),
  };
}

describe("ApiKeyAuthGuard", () => {
  const prev = process.env.JWT_SECRET;
  const tokens = new TokenService();
  beforeAll(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    process.env.JWT_SECRET = prev;
  });

  it("(a) non-mok_ Bearer (JWT) → PASS-THROUGH true, req.user untouched", async () => {
    const { ctx, req } = httpCtx("Bearer eyJhbGciOi.jwt.token");
    const lookup = lookupFor(null);
    const guard = new ApiKeyAuthGuard(tokens, lookup);
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(req.user).toBeUndefined();
    expect(lookup.findByTokenHash).not.toHaveBeenCalled();
  });

  it("(a) missing Authorization header → PASS-THROUGH true", async () => {
    const { ctx } = httpCtx(undefined);
    const guard = new ApiKeyAuthGuard(tokens, lookupFor(null));
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("(a) non-http context (WS) → PASS-THROUGH true", async () => {
    const ctx = { getType: () => "ws" } as unknown as ExecutionContext;
    const guard = new ApiKeyAuthGuard(tokens, lookupFor(null));
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it("(b) valid mok_ token → sets req.user viaApiKey with scope + tenant, returns true", async () => {
    const plaintext = `${API_KEY_TOKEN_PREFIX}supersecrettoken`;
    const record = makeRecord({ tokenHash: tokens.hashToken(plaintext) });
    const lookup = lookupFor(record);
    const { ctx, req } = httpCtx(`Bearer ${plaintext}`);
    const guard = new ApiKeyAuthGuard(tokens, lookup);

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(req.user).toMatchObject({
      id: record.userId,
      companyId: record.companyId,
      viaApiKey: true,
      apiKeyId: record.id,
      scopePermissionIds: record.scopePermissionIds,
      aud: "tenant",
    });
    expect(lookup.recordUsage).toHaveBeenCalled();
  });

  it("(c) wrong hash (prefix matches but token differs) → 401", async () => {
    const record = makeRecord({ tokenHash: tokens.hashToken(`${API_KEY_TOKEN_PREFIX}realtoken`) });
    const { ctx } = httpCtx(`Bearer ${API_KEY_TOKEN_PREFIX}forgedtoken`);
    const guard = new ApiKeyAuthGuard(tokens, lookupFor(record));
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("(d) expired token → 401 (fail-closed)", async () => {
    const plaintext = `${API_KEY_TOKEN_PREFIX}expiredtoken`;
    const record = makeRecord({
      tokenHash: tokens.hashToken(plaintext),
      expiresAt: new Date(Date.now() - 1000),
    });
    const { ctx } = httpCtx(`Bearer ${plaintext}`);
    const guard = new ApiKeyAuthGuard(tokens, lookupFor(record));
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("(e) revoked token → 401 (fail-closed)", async () => {
    const plaintext = `${API_KEY_TOKEN_PREFIX}revokedtoken`;
    const record = makeRecord({
      tokenHash: tokens.hashToken(plaintext),
      revokedAt: new Date(Date.now() - 1000),
    });
    const { ctx } = httpCtx(`Bearer ${plaintext}`);
    const guard = new ApiKeyAuthGuard(tokens, lookupFor(record));
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("(f) prefix not found → 401 (no key for this prefix)", async () => {
    const { ctx } = httpCtx(`Bearer ${API_KEY_TOKEN_PREFIX}unknowntoken`);
    const guard = new ApiKeyAuthGuard(tokens, lookupFor(null));
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it("(g) usage logging failure does NOT block the request (best-effort)", async () => {
    const plaintext = `${API_KEY_TOKEN_PREFIX}goodtoken`;
    const record = makeRecord({ tokenHash: tokens.hashToken(plaintext) });
    const lookup: ApiKeyAuthLookup = {
      findByTokenHash: vi.fn(async () => record),
      recordUsage: vi.fn(async () => {
        throw new Error("usage insert failed");
      }),
      touchLastUsed: vi.fn(async () => {}),
    };
    const { ctx, req } = httpCtx(`Bearer ${plaintext}`);
    const guard = new ApiKeyAuthGuard(tokens, lookup);
    expect(await guard.canActivate(ctx)).toBe(true);
    expect((req.user as { viaApiKey?: boolean }).viaApiKey).toBe(true);
  });
});
