import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { positionsApi } from "./positions-api";

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";
const ISO = "2026-06-01T00:00:00.000Z";

const POSITION = {
  id: UUID,
  companyId: UUID,
  name: "Trưởng nhóm",
  status: "active",
  createdAt: ISO,
  updatedAt: ISO,
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

describe("positionsApi.listPositions", () => {
  it("GETs /org/positions without a filter", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([POSITION]));
    await positionsApi.listPositions();
    const [url] = lastCall();
    expect(url).toContain("/org/positions");
    expect(url).not.toContain("orgUnitId");
  });

  it("encodes the orgUnitId filter as a query param", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await positionsApi.listPositions(UUID2);
    const [url] = lastCall();
    expect(url).toContain(`orgUnitId=${UUID2}`);
  });
});

describe("positionsApi.createPosition", () => {
  it("POSTs the create body to /org/positions", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(POSITION));
    await positionsApi.createPosition({ name: "Editor", defaultRoleId: UUID2 });
    const [url, init] = lastCall();
    expect(url).toContain("/org/positions");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ name: "Editor", defaultRoleId: UUID2 });
  });
});

describe("positionsApi.updatePosition", () => {
  it("PATCHes /org/positions/:id with the patch body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...POSITION, name: "Renamed" }));
    await positionsApi.updatePosition(UUID, { name: "Renamed", defaultRoleId: null });
    const [url, init] = lastCall();
    expect(url).toContain(`/org/positions/${UUID}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Renamed", defaultRoleId: null });
  });
});

describe("positionsApi.deletePosition", () => {
  it("DELETEs /org/positions/:id and tolerates a 204", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 204));
    await expect(positionsApi.deletePosition(UUID)).resolves.toBeUndefined();
    const [url, init] = lastCall();
    expect(url).toContain(`/org/positions/${UUID}`);
    expect(init?.method).toBe("DELETE");
  });
});

describe("positionsApi.listRoles", () => {
  it("GETs /org/roles and parses {id,name} options", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: UUID2, name: "Editor" }]));
    const roles = await positionsApi.listRoles();
    const [url] = lastCall();
    expect(url).toContain("/org/roles");
    expect(roles[0]).toEqual({ id: UUID2, name: "Editor" });
  });
});
