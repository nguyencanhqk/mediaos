import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { twoFactorApi } from "./two-factor-api";
import { useAuthStore } from "@/stores/auth";

type FetchCall = [input: string, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ success: true, data: body, error: null }),
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const UUID = "11111111-1111-1111-1111-111111111111";

describe("twoFactorApi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useAuthStore.getState().setTokens("test-access-token", "test-refresh-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.getState().logout();
  });

  function lastCall(): FetchCall {
    return fetchMock.mock.calls.at(-1) as FetchCall;
  }

  it("status() GET kèm Bearer token, parse {enabled, required}", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ enabled: true, required: false }));
    const res = await twoFactorApi.status();
    expect(res).toEqual({ enabled: true, required: false });
    const [url, init] = lastCall();
    expect(url).toContain("/auth/2fa/status");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-access-token");
  });

  it("enroll() POST, parse otpauthUri + recoveryCodes", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ otpauthUri: "otpauth://totp/MediaOS:a", recoveryCodes: ["a", "b"] }),
    );
    const res = await twoFactorApi.enroll();
    expect(res.recoveryCodes).toHaveLength(2);
    const [url, init] = lastCall();
    expect(url).toContain("/auth/2fa/enroll");
    expect(init?.method).toBe("POST");
  });

  it("enable(token) POST body {token}", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await twoFactorApi.enable("123456");
    const [url, init] = lastCall();
    expect(url).toContain("/auth/2fa/enable");
    expect(JSON.parse(init?.body as string)).toEqual({ token: "123456" });
  });

  it("disable(password) POST body {password} + Bearer", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await twoFactorApi.disable("pw");
    const [url, init] = lastCall();
    expect(url).toContain("/auth/2fa/disable");
    expect(JSON.parse(init?.body as string)).toEqual({ password: "pw" });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-access-token");
  });

  it("verifyLogin() POST /auth/2fa/verify (public — KHÔNG Bearer) parse tokens", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ accessToken: "at", refreshToken: `${UUID}.rt`, expiresIn: 900 }),
    );
    const res = await twoFactorApi.verifyLogin("challenge-tok", "123456");
    expect(res.accessToken).toBe("at");
    const [url, init] = lastCall();
    expect(url).toContain("/auth/2fa/verify");
    expect(JSON.parse(init?.body as string)).toEqual({ challengeToken: "challenge-tok", code: "123456" });
    // public endpoint — không gắn Authorization
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });
});
