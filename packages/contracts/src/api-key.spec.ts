import { describe, expect, it } from "vitest";
import {
  API_KEY_TOKEN_PREFIX,
  apiKeySchema,
  createApiKeyRequestSchema,
  createApiKeyResponseSchema,
} from "./api-key";

/**
 * AC-5 contract test (DoD): list DTO KHÔNG được lộ token material; create response trả plaintext 1 lần.
 * RED-first — symbol/field chưa tồn tại tới khi AC-5 land.
 */

describe("apiKeySchema (list DTO — KHÔNG token material)", () => {
  const valid = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "CI deploy bot",
    tokenPrefix: "mok_ab12",
    scopePermissionIds: ["22222222-2222-2222-2222-222222222222"],
    status: "active",
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: "2026-06-17T00:00:00.000Z",
  };

  it("parses a valid list DTO", () => {
    expect(apiKeySchema.parse(valid)).toMatchObject({ name: "CI deploy bot", status: "active" });
  });

  it("has NO tokenHash / token field in the schema shape (anti-leak)", () => {
    const keys = Object.keys(apiKeySchema.shape);
    expect(keys).not.toContain("tokenHash");
    expect(keys).not.toContain("token");
    expect(keys).not.toContain("token_hash");
  });

  it("STRIPS an injected token plaintext (strict-ish: extra key not surfaced)", () => {
    const parsed = apiKeySchema.parse({ ...valid, token: "mok_leak", tokenHash: "deadbeef" });
    expect(parsed).not.toHaveProperty("token");
    expect(parsed).not.toHaveProperty("tokenHash");
  });

  it.each(["active", "expired", "revoked"])("accepts derived status %s", (s) => {
    expect(apiKeySchema.parse({ ...valid, status: s }).status).toBe(s);
  });

  it("rejects an unknown status", () => {
    expect(() => apiKeySchema.parse({ ...valid, status: "paused" })).toThrow();
  });
});

describe("createApiKeyRequestSchema", () => {
  it("requires at least one scope permission id (fail-closed: no empty-scope key)", () => {
    expect(() => createApiKeyRequestSchema.parse({ name: "x", scopePermissionIds: [] })).toThrow();
  });

  it("requires scope ids to be uuids (catalog ref, not free text)", () => {
    expect(() =>
      createApiKeyRequestSchema.parse({ name: "x", scopePermissionIds: ["read:task"] }),
    ).toThrow();
  });

  it("accepts a valid create body with null expiry", () => {
    const body = {
      name: "bot",
      scopePermissionIds: ["22222222-2222-2222-2222-222222222222"],
      expiresAt: null,
    };
    expect(createApiKeyRequestSchema.parse(body)).toMatchObject({ name: "bot" });
  });
});

describe("createApiKeyResponseSchema (plaintext returned ONCE on create)", () => {
  it("carries plaintext token + the safe apiKey DTO", () => {
    const res = createApiKeyResponseSchema.parse({
      token: `${API_KEY_TOKEN_PREFIX}abcdef`,
      apiKey: {
        id: "11111111-1111-1111-1111-111111111111",
        name: "bot",
        tokenPrefix: "mok_abcd",
        scopePermissionIds: ["22222222-2222-2222-2222-222222222222"],
        status: "active",
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: "2026-06-17T00:00:00.000Z",
      },
    });
    expect(res.token.startsWith(API_KEY_TOKEN_PREFIX)).toBe(true);
    // The nested apiKey is the SAFE DTO (no token material).
    expect(Object.keys(res.apiKey)).not.toContain("tokenHash");
  });
});
