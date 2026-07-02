/**
 * auth-users-api — contract/URL boundary tests (S2-FE-AUTH-3).
 *
 * Mirrors users-api.spec.ts: KHÔNG mock authUsersApi, chỉ mock apiFetch tại ranh giới ./api-client
 * để kiểm chứng mỗi method gọi ĐÚNG route theo cặp canonical S2-AUTH-BE-3 (/auth/users) +
 * G3-4 mutation-path (/permissions/users/:userId/roles) — chống trôi path (route sai → 404 runtime).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUserDto, AuthUserListDto, RoleListDto, UserRoleDto } from "@mediaos/contracts";
import { authUsersApi } from "./auth-users-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

const USER: AuthUserDto = {
  id: "user-001",
  email: "a@demo.local",
  fullName: "A",
  status: "active",
  lockedAt: null,
  lockedReason: null,
  lastLoginAt: null,
  createdAt: "2024-01-01T00:00:00.000Z",
};

const USER_LIST: AuthUserListDto = { users: [USER], total: 1 };
const ROLE_LIST: RoleListDto = {
  roles: [{ id: "role-001", name: "HR", description: null, isSystem: false }],
};
const USER_ROLE: UserRoleDto = {
  id: "ur-1",
  userId: USER.id,
  roleId: "role-001",
  companyId: "co-001",
  grantedBy: "admin-001",
  expiresAt: null,
  createdAt: "2024-01-01T00:00:00.000Z",
};

function firstCallUrl(): string {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][0] as string;
}

function firstCallInit(): RequestInit | undefined {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  return calls[0][2] as RequestInit | undefined;
}

describe("authUsersApi — contract/URL boundary", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("listUsers → GET /auth/users (no query)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(USER_LIST);
    await authUsersApi.listUsers();
    expect(firstCallUrl()).toBe("/auth/users");
  });

  it("listUsers → appends query AFTER /auth/users", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(USER_LIST);
    await authUsersApi.listUsers({ limit: 25, offset: 0, status: "active" });
    const url = firstCallUrl();
    expect(url.startsWith("/auth/users?")).toBe(true);
    const [base, qs] = url.split("?");
    expect(base).toBe("/auth/users");
    const params = new URLSearchParams(qs);
    expect(params.get("limit")).toBe("25");
    expect(params.get("status")).toBe("active");
  });

  it("getUser → GET /auth/users/:id", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(USER);
    await authUsersApi.getUser(USER.id);
    expect(firstCallUrl()).toBe(`/auth/users/${USER.id}`);
  });

  it("createUser → POST /auth/users", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(USER);
    await authUsersApi.createUser({ email: "a@demo.local", fullName: "A", password: "x" });
    expect(firstCallUrl()).toBe("/auth/users");
    expect(firstCallInit()?.method).toBe("POST");
  });

  it("updateUser → PATCH /auth/users/:id", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(USER);
    await authUsersApi.updateUser(USER.id, { fullName: "B" });
    expect(firstCallUrl()).toBe(`/auth/users/${USER.id}`);
    expect(firstCallInit()?.method).toBe("PATCH");
  });

  it("lockUser → POST /auth/users/:id/lock", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(USER);
    await authUsersApi.lockUser(USER.id, { reason: "policy" });
    expect(firstCallUrl()).toBe(`/auth/users/${USER.id}/lock`);
    expect(firstCallInit()?.method).toBe("POST");
  });

  it("unlockUser → POST /auth/users/:id/unlock", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(USER);
    await authUsersApi.unlockUser(USER.id);
    expect(firstCallUrl()).toBe(`/auth/users/${USER.id}/unlock`);
    expect(firstCallInit()?.method).toBe("POST");
  });

  it("listRoles → GET /auth/roles (catalog, NOT /org/roles)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(ROLE_LIST);
    await authUsersApi.listRoles();
    expect(firstCallUrl()).toBe("/auth/roles");
  });

  it("assignRole → POST /permissions/users/:userId/roles", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(USER_ROLE);
    await authUsersApi.assignRole(USER.id, { roleId: "role-001" });
    expect(firstCallUrl()).toBe(`/permissions/users/${USER.id}/roles`);
    expect(firstCallInit()?.method).toBe("POST");
  });

  it("revokeRole → DELETE /permissions/users/:userId/roles/:roleId", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined);
    await authUsersApi.revokeRole(USER.id, "role-001");
    expect(firstCallUrl()).toBe(`/permissions/users/${USER.id}/roles/role-001`);
    expect(firstCallInit()?.method).toBe("DELETE");
  });
});
