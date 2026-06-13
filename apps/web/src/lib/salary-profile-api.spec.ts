import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { salaryProfileApi } from "./salary-profile-api";

const UUID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ISO = "2026-06-13T08:00:00.000Z";
const DATE = "2026-06-13";

type FetchCall = [input: string, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Masked list item (server stripped salary): baseSalary/allowances null. */
const MASKED_LIST_ITEM = {
  id: UUID,
  userId: UUID,
  salaryType: "monthly",
  payCycle: "monthly",
  effectiveDate: DATE,
  baseSalary: null,
  allowances: null,
  status: "active",
};

/** Revealed detail (server allowed view): real numbers present. */
const REVEALED_DETAIL = {
  id: UUID,
  companyId: UUID,
  userId: UUID,
  salaryType: "monthly",
  payCycle: "monthly",
  effectiveDate: DATE,
  baseSalary: 25000000,
  allowances: [{ name: "Ăn trưa", amount: 1000000 }],
  currency: "VND",
  status: "active",
  note: null,
  createdAt: ISO,
  updatedAt: ISO,
};

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

describe("salaryProfileApi.list", () => {
  it("GETs /salary-profiles without filters", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([MASKED_LIST_ITEM]));
    const rows = await salaryProfileApi.list();
    const [url] = lastCall();
    expect(url).toContain("/salary-profiles");
    // Masked DTO survives the schema (baseSalary/allowances nullable) — no leak, no throw.
    expect(rows[0].baseSalary).toBeNull();
    expect(rows[0].allowances).toBeNull();
  });

  it("encodes userId and status as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await salaryProfileApi.list({ userId: UUID, status: "active" });
    const [url] = lastCall();
    expect(url).toContain(`userId=${UUID}`);
    expect(url).toContain("status=active");
  });
});

describe("salaryProfileApi.get", () => {
  it("GETs /salary-profiles/:id and parses a revealed detail", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(REVEALED_DETAIL));
    const row = await salaryProfileApi.get(UUID);
    const [url] = lastCall();
    expect(url).toContain(`/salary-profiles/${UUID}`);
    expect(row.baseSalary).toBe(25000000);
  });
});

describe("salaryProfileApi.create", () => {
  it("POSTs to /salary-profiles with the create payload", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...REVEALED_DETAIL, baseSalary: null, allowances: null }),
    );
    await salaryProfileApi.create({
      userId: UUID,
      salaryType: "monthly",
      payCycle: "monthly",
      effectiveDate: DATE,
      baseSalary: 25000000,
      allowances: [],
    });
    const [url, init] = lastCall();
    expect(url).toContain("/salary-profiles");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.userId).toBe(UUID);
    expect(body.baseSalary).toBe(25000000);
  });
});

describe("salaryProfileApi.update", () => {
  it("PATCHes /salary-profiles/:id with the update payload", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...REVEALED_DETAIL, baseSalary: null, allowances: null }),
    );
    await salaryProfileApi.update(UUID, { baseSalary: 30000000 });
    const [url, init] = lastCall();
    expect(url).toContain(`/salary-profiles/${UUID}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toMatchObject({ baseSalary: 30000000 });
  });
});

describe("salaryProfileApi.remove", () => {
  it("DELETEs /salary-profiles/:id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 204));
    await salaryProfileApi.remove(UUID);
    const [url, init] = lastCall();
    expect(url).toContain(`/salary-profiles/${UUID}`);
    expect(init?.method).toBe("DELETE");
  });
});
