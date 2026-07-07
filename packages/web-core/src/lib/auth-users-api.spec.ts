/**
 * auth-users-api — contract/URL boundary tests (S2-FE-AUTH-3).
 *
 * Mirrors users-api.spec.ts: KHÔNG mock authUsersApi, chỉ mock apiFetch tại ranh giới ./api-client
 * để kiểm chứng mỗi method gọi ĐÚNG route theo cặp canonical S2-AUTH-BE-3 (/auth/users) +
 * G3-4 mutation-path (/permissions/users/:userId/roles) — chống trôi path (route sai → 404 runtime).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authUserDetailSchema,
  authUserPasswordResetResultSchema,
  authUserTwoFactorResetSchema,
  type AuthUserDto,
  type AuthUserDetailDto,
  type AuthUserListDto,
  type AuthUserPasswordResetResultDto,
  type AuthUserTwoFactorResetDto,
  type RoleListDto,
  type UserRoleDto,
} from "@mediaos/contracts";
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
  deletedAt: null, // S2-AUTH-USEROPS-1: mốc xóa mềm (null = LIVE)
};
// S2-AUTH-USEROPS-1 — kết quả admin reset mật khẩu: tempPassword hiện ĐÚNG 1 lần (KHÔNG log/cache).
const PASSWORD_RESET_RESULT: AuthUserPasswordResetResultDto = {
  tempPassword: "TempMatKhau99x",
  revokedSessionCount: 2,
};

// S2-FE-SYS-SEC-1 — detail DTO (GET /auth/users/:id) = superset của authUserSchema + khối twoFactor.
// requiredByRole/requiredByUser TÁCH nguồn ép (KHÔNG lẫn); KHÔNG chứa secret TOTP/recovery-code.
// id = UUID hợp lệ để parse thật qua authUserDetailSchema (z.string().uuid()).
const USER_DETAIL: AuthUserDetailDto = {
  ...USER,
  id: "11111111-1111-4111-8111-111111111111",
  twoFactor: { enabled: true, requiredByRole: false, requiredByUser: true },
};
// POST /auth/users/:id/2fa/reset → chỉ phơi revokedSessionCount (forensic), KHÔNG secret (BẤT BIẾN #3).
const TWO_FACTOR_RESET: AuthUserTwoFactorResetDto = { revokedSessionCount: 3 };

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

// Schema truyền ở ranh giới apiFetch (arg thứ 2) — chống trôi: getUser PHẢI parse detail schema (twoFactor),
// resetTwoFactor PHẢI parse reset schema (revokedSessionCount). apiFetch bị mock nên parse thật không chạy,
// nên khẳng định danh tính schema tại boundary + parse fixture riêng để chứng minh shape.
function firstCallSchema(): unknown {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][1];
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

  it("getUser → GET /auth/users/:id parses detail schema (khối twoFactor present)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(USER_DETAIL);
    const result = await authUsersApi.getUser(USER.id);
    expect(firstCallUrl()).toBe(`/auth/users/${USER.id}`);
    // Ranh giới contract: getUser dùng authUserDetailSchema (superset authUserSchema) → có twoFactor.
    expect(firstCallSchema()).toBe(authUserDetailSchema);
    const parsed = authUserDetailSchema.parse(USER_DETAIL);
    expect(parsed.twoFactor).toEqual({
      enabled: true,
      requiredByRole: false,
      requiredByUser: true,
    });
    expect(result.twoFactor.requiredByUser).toBe(true);
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

  it("resetTwoFactor → POST /auth/users/:id/2fa/reset parses reset schema (revokedSessionCount)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(TWO_FACTOR_RESET);
    const result = await authUsersApi.resetTwoFactor(USER.id);
    expect(firstCallUrl()).toBe(`/auth/users/${USER.id}/2fa/reset`);
    expect(firstCallInit()?.method).toBe("POST");
    // Ranh giới contract: chỉ parse revokedSessionCount — KHÔNG secret/recovery-code (BẤT BIẾN #3).
    expect(firstCallSchema()).toBe(authUserTwoFactorResetSchema);
    const parsed = authUserTwoFactorResetSchema.parse(TWO_FACTOR_RESET);
    expect(parsed.revokedSessionCount).toBe(3);
    expect(result.revokedSessionCount).toBe(3);
  });

  // ── S2-AUTH-USEROPS-1 ─────────────────────────────────────────────────────
  it("listUsers({deleted:true}) → query có deleted=true (view Đã xóa)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(USER_LIST);
    await authUsersApi.listUsers({ limit: 50, offset: 0, deleted: true });
    const url = firstCallUrl();
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("deleted")).toBe("true");
  });

  it("deleteUser → DELETE /auth/users/:id (xóa mềm)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({
      ...USER,
      deletedAt: "2026-07-07T00:00:00.000Z",
    });
    await authUsersApi.deleteUser(USER.id);
    expect(firstCallUrl()).toBe(`/auth/users/${USER.id}`);
    expect(firstCallInit()?.method).toBe("DELETE");
  });

  it("restoreUser → POST /auth/users/:id/restore", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(USER);
    await authUsersApi.restoreUser(USER.id);
    expect(firstCallUrl()).toBe(`/auth/users/${USER.id}/restore`);
    expect(firstCallInit()?.method).toBe("POST");
  });

  it("resetPassword → POST /auth/users/:id/password/reset parses result schema (tempPassword 1 lần)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(PASSWORD_RESET_RESULT);
    const result = await authUsersApi.resetPassword(USER.id);
    expect(firstCallUrl()).toBe(`/auth/users/${USER.id}/password/reset`);
    expect(firstCallInit()?.method).toBe("POST");
    expect(firstCallSchema()).toBe(authUserPasswordResetResultSchema);
    const parsed = authUserPasswordResetResultSchema.parse(PASSWORD_RESET_RESULT);
    expect(parsed.revokedSessionCount).toBe(2);
    expect(result.tempPassword).toBe(PASSWORD_RESET_RESULT.tempPassword);
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
