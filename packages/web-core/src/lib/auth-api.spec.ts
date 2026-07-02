import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthTokens, LoginResponse, MeResponse } from "@mediaos/contracts";
import { authApi } from "./auth-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

vi.mock("../stores/auth", () => ({
  getAccessToken: vi.fn(() => null),
}));

const mockTokens: AuthTokens = {
  accessToken: "access-abc",
  refreshToken: "refresh-xyz",
  expiresIn: 900,
};

const mockChallenge: LoginResponse = {
  twoFactorRequired: true,
  challengeToken: "ch-token-123",
};

const mockMe: MeResponse = {
  id: "user-1",
  companyId: "co-1",
  email: "user@test.com",
  fullName: "Test User",
  status: "active",
  capabilities: { "read:employees": true },
  mustSetupTwoFactor: false,
};

describe("authApi.login", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("returns AuthTokens when 2FA is disabled", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockTokens);

    const result = await authApi.login({
      companySlug: "my-co",
      email: "user@test.com",
      password: "pass123",
    });

    expect(result).toEqual(mockTokens);
    // FS-1b: login dùng skipAuth (KHÔNG gắn Bearer cũ + 401 sai-mật-khẩu KHÔNG kích refresh-on-401).
    expect(apiClient.apiFetch).toHaveBeenCalledWith(
      "/auth/login",
      expect.anything(),
      expect.objectContaining({ method: "POST" }),
      { skipAuth: true },
    );
  });

  it("returns TwoFactorChallenge when 2FA is enabled", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockChallenge);

    const result = await authApi.login({
      companySlug: "my-co",
      email: "user@test.com",
      password: "pass123",
    });

    expect(result).toEqual(mockChallenge);
    expect("twoFactorRequired" in result && result.twoFactorRequired).toBe(true);
  });

  it("propagates ApiError on 401", async () => {
    const { ApiError } = await import("./api-client");
    vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(
      new ApiError(401, "INVALID_CREDENTIALS", "Invalid credentials"),
    );

    await expect(
      authApi.login({ companySlug: "co", email: "bad@test.com", password: "wrong" }),
    ).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
  });
});

describe("authApi.me", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("returns MeResponse on success", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockMe);

    const result = await authApi.me();

    expect(result).toEqual(mockMe);
    expect(apiClient.apiFetch).toHaveBeenCalledWith(
      "/auth/me",
      expect.anything(),
      expect.objectContaining({ headers: {} }),
    );
  });

  it("includes Authorization header when access token is present", async () => {
    const { getAccessToken } = await import("../stores/auth");
    vi.mocked(getAccessToken).mockReturnValueOnce("my-token");
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockMe);

    await authApi.me();

    expect(apiClient.apiFetch).toHaveBeenCalledWith(
      "/auth/me",
      expect.anything(),
      expect.objectContaining({
        headers: { Authorization: "Bearer my-token" },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// S2-AUTH-BE-7 — session self-service (S2-FE-AUTH-5 · lane FE batch C)
// ---------------------------------------------------------------------------
describe("authApi — session self-service (GET/POST /auth/sessions)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("listSessions → GET /auth/sessions, KHÔNG body", async () => {
    const sessions = [
      {
        id: "sess-1",
        device_name: "Chrome",
        platform: "Windows",
        ip_address: "127.0.0.1",
        user_agent: "UA",
        last_used_at: null,
        created_at: "2026-07-01T00:00:00.000Z",
        expired_at: "2026-07-08T00:00:00.000Z",
        is_current: true,
      },
    ];
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(sessions);

    const result = await authApi.listSessions();

    expect(result).toEqual(sessions);
    const [url, , opts] = vi.mocked(apiClient.apiFetch).mock.calls[0] as [
      string,
      unknown,
      { method?: string; body?: string }?,
    ];
    expect(url).toBe("/auth/sessions");
    expect(opts?.method ?? "GET").toBe("GET");
    expect(opts?.body).toBeUndefined();
  });

  it("revokeSession → POST /auth/sessions/:id/revoke", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ ok: true, revoked_count: 1 });

    const result = await authApi.revokeSession("sess-1");

    expect(result).toEqual({ ok: true, revoked_count: 1 });
    expect(apiClient.apiFetch).toHaveBeenCalledWith(
      "/auth/sessions/sess-1/revoke",
      expect.anything(),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("revokeOtherSessions → POST /auth/sessions/revoke-others", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ ok: true, revoked_count: 2 });

    const result = await authApi.revokeOtherSessions();

    expect(result).toEqual({ ok: true, revoked_count: 2 });
    expect(apiClient.apiFetch).toHaveBeenCalledWith(
      "/auth/sessions/revoke-others",
      expect.anything(),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
