import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rbacApi } from "./rbac-api";
import { useAuthStore } from "@/stores/auth";

const ROLE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OBJECT_ID = "33333333-3333-4333-8333-333333333333";

interface MockRes {
  ok: boolean;
  status: number;
  body?: unknown;
}

function stubFetch(res: MockRes) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: async () => res.body,
    text: async () => JSON.stringify(res.body ?? ""),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** [url, init] của lần fetch đầu tiên. */
function callOf(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return [url, init];
}

beforeEach(() => {
  useAuthStore.getState().setTokens("tok-123", "refresh-xyz");
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe("rbacApi — read (org catalogs)", () => {
  it("listRoles GETs /org/roles và parse { id, name }", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: [{ id: ROLE_ID, name: "Admin" }] });
    const roles = await rbacApi.listRoles();
    expect(roles).toEqual([{ id: ROLE_ID, name: "Admin" }]);
    const [url, init] = callOf(fetchMock);
    expect(url).toContain("/org/roles");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("listUsers GETs /org/employees", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      body: [{ id: USER_ID, email: "a@x.test", fullName: "Ann", status: "active", teams: [] }],
    });
    const users = await rbacApi.listUsers();
    expect(users[0]?.email).toBe("a@x.test");
    expect(callOf(fetchMock)[0]).toContain("/org/employees");
  });
});

describe("rbacApi — assign / revoke role", () => {
  it("assignRole POSTs đúng path + body (roleId, expiresAt)", async () => {
    const created = {
      id: OBJECT_ID,
      userId: USER_ID,
      roleId: ROLE_ID,
      companyId: "44444444-4444-4444-8444-444444444444",
      grantedBy: null,
      expiresAt: null,
      createdAt: "2026-06-17T00:00:00.000Z",
    };
    const fetchMock = stubFetch({ ok: true, status: 201, body: created });
    const res = await rbacApi.assignRole(USER_ID, { roleId: ROLE_ID, expiresAt: null });
    expect(res.roleId).toBe(ROLE_ID);
    const [url, init] = callOf(fetchMock);
    expect(url).toContain(`/permissions/users/${USER_ID}/roles`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ roleId: ROLE_ID, expiresAt: null });
  });

  it("revokeRole DELETEs đúng path và trả undefined cho 204", async () => {
    const fetchMock = stubFetch({ ok: true, status: 204 });
    await expect(rbacApi.revokeRole(USER_ID, ROLE_ID)).resolves.toBeUndefined();
    const [url, init] = callOf(fetchMock);
    expect(url).toContain(`/permissions/users/${USER_ID}/roles/${ROLE_ID}`);
    expect(init.method).toBe("DELETE");
  });
});

describe("rbacApi — object-permission", () => {
  const base = {
    subjectType: "user" as const,
    subjectId: USER_ID,
    action: "read",
    resourceType: "media",
    objectType: "content_item",
    objectId: OBJECT_ID,
    effect: "ALLOW" as const,
  };

  it("setObjectPermission PUTs /permissions/object với DTO đầy đủ", async () => {
    const fetchMock = stubFetch({
      ok: true,
      status: 200,
      body: {
        id: OBJECT_ID,
        companyId: "44444444-4444-4444-8444-444444444444",
        permissionId: "55555555-5555-4555-8555-555555555555",
        ...base,
        grantedBy: null,
        createdAt: "2026-06-17T00:00:00.000Z",
      },
    });
    const res = await rbacApi.setObjectPermission(base);
    expect(res.effect).toBe("ALLOW");
    const [url, init] = callOf(fetchMock);
    expect(url).toContain("/permissions/object");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(base);
  });

  it("removeObjectPermission DELETEs /permissions/object (204 → undefined)", async () => {
    const fetchMock = stubFetch({ ok: true, status: 204 });
    await expect(rbacApi.removeObjectPermission(base)).resolves.toBeUndefined();
    const [url, init] = callOf(fetchMock);
    expect(url).toContain("/permissions/object");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual(base);
  });
});
