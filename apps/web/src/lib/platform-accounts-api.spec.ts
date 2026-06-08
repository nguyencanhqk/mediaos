import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { platformAccountsApi } from "./platform-accounts-api";

const UUID = "11111111-1111-1111-1111-111111111111";

/** Masked DTO hợp lệ (12 cột an toàn) — không có cột secret/recovery. */
const SAFE_ACCOUNT = {
  id: UUID,
  companyId: UUID,
  platformId: UUID,
  accountName: "Kênh chính",
  accountEmail: "ops@example.com",
  accountIdentifier: "@kenh-chinh",
  ownerUserId: UUID,
  securityLevel: "high",
  status: "active",
  lastRotatedAt: "2026-06-01T00:00:00.000Z",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

type FetchCall = [input: string, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastCall(): FetchCall {
  return fetchMock.mock.calls.at(-1) as FetchCall;
}

describe("platformAccountsApi.list", () => {
  it("GETs /platform-accounts and parses the masked array", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([SAFE_ACCOUNT]));
    const result = await platformAccountsApi.list();
    const [url, init] = lastCall();
    expect(url).toContain("/platform-accounts");
    expect(init?.method ?? "GET").toBe("GET");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(UUID);
  });

  it("encodes filters as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await platformAccountsApi.list({ platformId: UUID, status: "active", q: "kênh" });
    const [url] = lastCall();
    expect(url).toContain(`platformId=${UUID}`);
    expect(url).toContain("status=active");
    expect(url).toContain("q=");
  });

  it("STRIPS any leaked secret/recovery fields from the response (masking contract)", async () => {
    const leaky = {
      ...SAFE_ACCOUNT,
      secretCiphertext: "DEADBEEF",
      recoveryEmail: "leak@example.com",
      twoFactorNote: "totp: 12345",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse([leaky]));
    const [row] = await platformAccountsApi.list();
    expect(row).not.toHaveProperty("secretCiphertext");
    expect(row).not.toHaveProperty("recoveryEmail");
    expect(row).not.toHaveProperty("twoFactorNote");
  });
});

describe("platformAccountsApi.get", () => {
  it("GETs /platform-accounts/:id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SAFE_ACCOUNT));
    const result = await platformAccountsApi.get(UUID);
    const [url] = lastCall();
    expect(url).toContain(`/platform-accounts/${UUID}`);
    expect(result.status).toBe("active");
  });
});

describe("platformAccountsApi.create", () => {
  it("POSTs the create body to /platform-accounts", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SAFE_ACCOUNT));
    await platformAccountsApi.create({ platformId: UUID, secret: "s3cr3t" });
    const [url, init] = lastCall();
    expect(url).toContain("/platform-accounts");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ platformId: UUID, secret: "s3cr3t" });
  });
});

describe("platformAccountsApi.updateSecret", () => {
  it("PATCHes /platform-accounts/:id/secret", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SAFE_ACCOUNT));
    await platformAccountsApi.updateSecret(UUID, { secret: "rotated" });
    const [url, init] = lastCall();
    expect(url).toContain(`/platform-accounts/${UUID}/secret`);
    expect(init?.method).toBe("PATCH");
  });
});

describe("platformAccountsApi.reauth / reveal", () => {
  it("POSTs the step-up body to /platform-accounts/reauth", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ reauthValidUntil: "2026-06-08T00:05:00.000Z" }),
    );
    const res = await platformAccountsApi.reauth({ accountId: UUID, password: "pw" });
    const [url, init] = lastCall();
    expect(url).toContain("/platform-accounts/reauth");
    expect(init?.method).toBe("POST");
    expect(res.reauthValidUntil).toBe("2026-06-08T00:05:00.000Z");
  });

  it("POSTs /platform-accounts/:id/reveal and returns { secret }", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ secret: "plaintext-pw" }));
    const res = await platformAccountsApi.reveal(UUID);
    const [url, init] = lastCall();
    expect(url).toContain(`/platform-accounts/${UUID}/reveal`);
    expect(init?.method).toBe("POST");
    expect(res.secret).toBe("plaintext-pw");
  });
});

describe("platformAccountsApi.revealWithReauth", () => {
  it("calls reauth BEFORE reveal and returns the plaintext", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ reauthValidUntil: "2026-06-08T00:05:00.000Z" }))
      .mockResolvedValueOnce(jsonResponse({ secret: "plaintext-pw" }));

    const secret = await platformAccountsApi.revealWithReauth(UUID, "pw");

    expect(secret).toBe("plaintext-pw");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstUrl = String((fetchMock.mock.calls[0] as FetchCall)[0]);
    const secondUrl = String((fetchMock.mock.calls[1] as FetchCall)[0]);
    expect(firstUrl).toContain("/platform-accounts/reauth");
    expect(secondUrl).toContain(`/platform-accounts/${UUID}/reveal`);
  });

  it("does NOT call reveal when reauth fails (no plaintext fetch on bad step-up)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "bad password" }, 401));

    await expect(platformAccountsApi.revealWithReauth(UUID, "wrong")).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = lastCall();
    expect(url).toContain("/platform-accounts/reauth");
    expect(url).not.toContain("/reveal");
  });
});
