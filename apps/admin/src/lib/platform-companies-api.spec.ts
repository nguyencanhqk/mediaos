import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api-client";
import { platformCompaniesApi } from "./platform-companies-api";
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

/** URL của lần gọi fetch đầu tiên (apiFetch gọi fetch(`${API_URL}${path}`, …)). */
function urlOf(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls[0]?.[0] ?? "");
}

function initOf(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  return (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
}

const company = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Funtime Media",
  slug: "funtime-media",
  status: "active",
  timezone: "Asia/Ho_Chi_Minh",
  currency: "VND",
  language: "vi",
  createdAt: "2026-06-17T00:00:00.000Z",
  deletedAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe("platformCompaniesApi.list", () => {
  it("gọi đúng path admin/platform/companies và parse { items,total,page,limit }", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      body: { success: true, data: { items: [company], total: 1, page: 1, limit: 20 }, error: null },
    });
    const result = await platformCompaniesApi.list({ page: 1, limit: 20 });
    expect(result.total).toBe(1);
    expect(result.items[0]?.slug).toBe("funtime-media");
    expect(urlOf(fetchMock)).toContain("/admin/platform/companies");
  });

  it("đưa status/search/page/limit vào query string", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      body: { items: [], total: 0, page: 2, limit: 10 },
    });
    await platformCompaniesApi.list({ status: "suspended", search: "acme", page: 2, limit: 10 });
    const url = urlOf(fetchMock);
    expect(url).toContain("status=suspended");
    expect(url).toContain("search=acme");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=10");
  });

  it("bỏ qua filter rỗng (không thêm status/search khi không truyền)", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      body: { items: [], total: 0, page: 1, limit: 20 },
    });
    await platformCompaniesApi.list({ search: "   " });
    const url = urlOf(fetchMock);
    expect(url).not.toContain("status=");
    expect(url).not.toContain("search=");
  });
});

describe("platformCompaniesApi.create", () => {
  it("POST body + parse { company, provision }", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      body: {
        company,
        provision: {
          companyId: company.id,
          templateCode: "starter",
          rolesCreated: 3,
          workflowsCreated: 1,
          dashboardsCreated: 2,
          alreadyProvisioned: false,
        },
      },
    });
    const result = await platformCompaniesApi.create({ name: "Funtime Media", slug: "funtime-media" });
    expect(result.company.slug).toBe("funtime-media");
    expect(result.provision?.rolesCreated).toBe(3);
    expect(initOf(fetchMock).method).toBe("POST");
  });

  it("provision null khi tạo công ty rỗng", async () => {
    stubFetch({ ok: true, status: 200, body: { company, provision: null } });
    const result = await platformCompaniesApi.create({ name: "X", slug: "x-co", templateCode: null });
    expect(result.provision).toBeNull();
  });

  it("ném ApiError 409 khi slug trùng", async () => {
    stubFetch({
      ok: false,
      status: 409,
      text: JSON.stringify({ error: { code: "CONFLICT", message: "slug exists" } }),
    });
    const err = await platformCompaniesApi
      .create({ name: "X", slug: "dup" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409 });
  });
});

describe("platformCompaniesApi.suspend / configure", () => {
  it("suspend POST tới :id/suspend", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: { ...company, status: "suspended" } });
    const result = await platformCompaniesApi.suspend(company.id);
    expect(result.status).toBe("suspended");
    expect(urlOf(fetchMock)).toContain(`/admin/platform/companies/${company.id}/suspend`);
    expect(initOf(fetchMock).method).toBe("POST");
  });

  it("configure PATCH với body partial", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: { ...company, name: "New Name" } });
    const result = await platformCompaniesApi.configure(company.id, { name: "New Name" });
    expect(result.name).toBe("New Name");
    expect(initOf(fetchMock).method).toBe("PATCH");
  });
});

describe("platformCompaniesApi.setSubscription", () => {
  it("PUT tới :id/subscription và parse CompanySubscriptionDto", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      body: {
        id: "22222222-2222-2222-2222-222222222222",
        companyId: company.id,
        planId: "33333333-3333-3333-3333-333333333333",
        planCode: "pro",
        status: "active",
        currentPeriodEnd: null,
        createdAt: "2026-06-17T00:00:00.000Z",
        updatedAt: "2026-06-17T00:00:00.000Z",
      },
    });
    const result = await platformCompaniesApi.setSubscription(company.id, { planCode: "pro" });
    expect(result.planCode).toBe("pro");
    expect(urlOf(fetchMock)).toContain(`/admin/platform/companies/${company.id}/subscription`);
    expect(initOf(fetchMock).method).toBe("PUT");
  });

  it("ném ApiError 403 khi thiếu quyền (deny-path)", async () => {
    stubFetch({
      ok: false,
      status: 403,
      text: JSON.stringify({ error: { code: "FORBIDDEN", message: "no access" } }),
    });
    const err = await platformCompaniesApi
      .setSubscription(company.id, { planCode: "pro" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});
