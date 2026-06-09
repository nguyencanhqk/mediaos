import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orgApi } from "./org-api";

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";
const ISO = "2026-06-01T00:00:00.000Z";

const ORG_UNIT = {
  id: UUID,
  companyId: UUID,
  parentId: null,
  name: "Phòng Kế toán",
  type: "department",
  status: "active",
  createdAt: ISO,
  updatedAt: ISO,
};

const TEAM = {
  id: UUID,
  companyId: UUID,
  orgUnitId: null,
  name: "Team Sản xuất",
  type: "production_team",
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

describe("orgApi.getOrgTree", () => {
  it("GETs /org/units/tree", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await orgApi.getOrgTree();
    const [url, init] = lastCall();
    expect(url).toContain("/org/units/tree");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("parses a nested tree response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: UUID, name: "Khối", type: "division", status: "active", children: [] }]),
    );
    const tree = await orgApi.getOrgTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toEqual([]);
  });
});

describe("orgApi.updateOrgUnit", () => {
  it("PATCHes /org/units/:id with the patch body (toggle status)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...ORG_UNIT, status: "inactive" }));
    await orgApi.updateOrgUnit(UUID, { status: "inactive" });
    const [url, init] = lastCall();
    expect(url).toContain(`/org/units/${UUID}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "inactive" });
  });

  it("sends headUserId when assigning a head", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...ORG_UNIT, headUserId: UUID2 }));
    await orgApi.updateOrgUnit(UUID, { headUserId: UUID2 });
    const [, init] = lastCall();
    expect(JSON.parse(String(init?.body))).toEqual({ headUserId: UUID2 });
  });
});

describe("orgApi.assignTeamLeader", () => {
  it("PATCHes /org/teams/:id/leader with { leaderId }", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...TEAM, leaderUserId: UUID2 }));
    await orgApi.assignTeamLeader(UUID, UUID2);
    const [url, init] = lastCall();
    expect(url).toContain(`/org/teams/${UUID}/leader`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ leaderId: UUID2 });
  });
});

describe("orgApi.removeTeamMember", () => {
  it("DELETEs the member and tolerates a 204 (no body)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 204));
    await expect(orgApi.removeTeamMember(UUID, UUID2)).resolves.toBeUndefined();
    const [url, init] = lastCall();
    expect(url).toContain(`/org/teams/${UUID}/members/${UUID2}`);
    expect(init?.method).toBe("DELETE");
  });
});
