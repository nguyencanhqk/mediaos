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

describe("authApi.forgotPassword", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("posts to /auth/forgot-password with skipAuth (no session yet)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ ok: true });

    const result = await authApi.forgotPassword({ companySlug: "demo", email: "u@co.com" });

    expect(result).toEqual({ ok: true });
    expect(apiClient.apiFetch).toHaveBeenCalledWith(
      "/auth/forgot-password",
      expect.anything(),
      expect.objectContaining({ method: "POST" }),
      { skipAuth: true },
    );
  });

  it("propagates ApiError on rate-limit (429)", async () => {
    const { ApiError } = await import("./api-client");
    vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(
      new ApiError(429, "RATE_LIMIT", "Too many"),
    );

    await expect(
      authApi.forgotPassword({ companySlug: "demo", email: "u@co.com" }),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe("authApi.resetPassword", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("posts to /auth/reset-password with skipAuth", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ ok: true });

    const result = await authApi.resetPassword({ token: "tok-123", newPassword: "newpass123" });

    expect(result).toEqual({ ok: true });
    expect(apiClient.apiFetch).toHaveBeenCalledWith(
      "/auth/reset-password",
      expect.anything(),
      expect.objectContaining({ method: "POST" }),
      { skipAuth: true },
    );
  });

  it("propagates ApiError on invalid/expired token", async () => {
    const { ApiError } = await import("./api-client");
    vi.mocked(apiClient.apiFetch).mockRejectedValueOnce(
      new ApiError(400, "INVALID_TOKEN", "Invalid or expired token"),
    );

    await expect(
      authApi.resetPassword({ token: "bad-tok", newPassword: "newpass123" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
