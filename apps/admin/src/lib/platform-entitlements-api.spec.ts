import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import { platformEntitlementsApi } from "./platform-entitlements-api";
import { useAuthStore } from "@/stores/auth";

interface MockRes {
  ok: boolean;
  status: number;
  body?: unknown;
  text?: string;
}

function stubFetch(res: MockRes) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: async () => res.body,
    text: async () => res.text ?? JSON.stringify(res.body ?? ""),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function urlOf(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls[0]?.[0] ?? "");
}
function initOf(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  return (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
}

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";

const featureFlag = { featureKey: "advanced_analytics", enabled: true, source: "override" };
const usageLimit = {
  metricKey: "max_channels",
  limit: 100,
  used: 3,
  source: "override",
  period: "lifetime",
};
const entitlements = {
  planCode: "pro",
  features: [featureFlag],
  limits: [usageLimit],
};

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe("platformEntitlementsApi.getFeatureFlags / getUsageLimits / getEntitlements", () => {
  it("getFeatureFlags GET :id/feature-flags và parse FeatureFlagDto[]", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: [featureFlag] });
    const result = await platformEntitlementsApi.getFeatureFlags(COMPANY_ID);
    expect(result[0]?.featureKey).toBe("advanced_analytics");
    expect(urlOf(fetchMock)).toContain(`/admin/platform/companies/${COMPANY_ID}/feature-flags`);
  });

  it("getUsageLimits GET :id/usage-limits và parse UsageLimitDto[]", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: [usageLimit] });
    const result = await platformEntitlementsApi.getUsageLimits(COMPANY_ID);
    expect(result[0]?.metricKey).toBe("max_channels");
    expect(urlOf(fetchMock)).toContain(`/admin/platform/companies/${COMPANY_ID}/usage-limits`);
  });

  it("getEntitlements GET :id/entitlements và parse EffectiveEntitlementsDto", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: entitlements });
    const result = await platformEntitlementsApi.getEntitlements(COMPANY_ID);
    expect(result.planCode).toBe("pro");
    expect(result.features).toHaveLength(1);
    expect(urlOf(fetchMock)).toContain(`/admin/platform/companies/${COMPANY_ID}/entitlements`);
  });
});

describe("platformEntitlementsApi.setFeatureFlag", () => {
  it("PUT :id/feature-flags với body {featureKey,enabled} và parse FeatureFlagDto", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: featureFlag });
    const result = await platformEntitlementsApi.setFeatureFlag(COMPANY_ID, {
      featureKey: "advanced_analytics",
      enabled: true,
    });
    expect(result.enabled).toBe(true);
    expect(urlOf(fetchMock)).toContain(`/admin/platform/companies/${COMPANY_ID}/feature-flags`);
    expect(initOf(fetchMock).method).toBe("PUT");
    expect(JSON.parse(String(initOf(fetchMock).body))).toEqual({
      featureKey: "advanced_analytics",
      enabled: true,
    });
  });

  it("ném ApiError 403 khi thiếu quyền (deny-path)", async () => {
    stubFetch({
      ok: false,
      status: 403,
      text: JSON.stringify({ error: { code: "FORBIDDEN", message: "no access" } }),
    });
    const err = await platformEntitlementsApi
      .setFeatureFlag(COMPANY_ID, { featureKey: "x", enabled: false })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("platformEntitlementsApi.setUsageLimit", () => {
  it("PUT :id/usage-limits với body {metricKey,limitValue} và parse UsageLimitDto", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: usageLimit });
    const result = await platformEntitlementsApi.setUsageLimit(COMPANY_ID, {
      metricKey: "max_channels",
      limitValue: 100,
    });
    expect(result.limit).toBe(100);
    expect(urlOf(fetchMock)).toContain(`/admin/platform/companies/${COMPANY_ID}/usage-limits`);
    expect(initOf(fetchMock).method).toBe("PUT");
    expect(JSON.parse(String(initOf(fetchMock).body))).toEqual({
      metricKey: "max_channels",
      limitValue: 100,
    });
  });

  it("ném ApiError 401 khi thiếu step-up window (OperatorReauthGuard deny)", async () => {
    stubFetch({
      ok: false,
      status: 401,
      text: JSON.stringify({ error: { code: "UNAUTHORIZED", message: "step-up required" } }),
    });
    const err = await platformEntitlementsApi
      .setUsageLimit(COMPANY_ID, { metricKey: "x", limitValue: 1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401 });
  });
});
