/**
 * users-api — contract/URL tests (S2-FE-HR-3-FIX-2).
 *
 * GIÁ TRỊ: vá khoảng trống test khiến defect lọt — UsersPage.spec.tsx mock TOÀN BỘ
 * usersApi.listUsers nên xanh-giả, che việc gọi sai endpoint (`/users` → 404 trên backend).
 * Ở đây KHÔNG mock usersApi; chỉ mock apiFetch tại ranh giới `./api-client` (đúng pattern
 * auth-api.spec.ts) để kiểm chứng listUsers gọi apiFetch với path BẮT ĐẦU bằng `/users/admin`
 * (AdminUsersController @Controller('users/admin')), KHÔNG phải `/users`.
 *
 * Tính RED/GREEN: trên code cũ (path `/users`) các assertion path FAIL; sau FIX-1
 * (path `/users/admin`) PASS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUserListDto } from "@mediaos/contracts";
import { usersApi } from "./users-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

const MOCK_LIST: AdminUserListDto = {
  users: [],
  total: 0,
};

/** Lấy URL (arg đầu) của lần gọi apiFetch gần nhất. */
function firstCallUrl(): string {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][0] as string;
}

describe("usersApi.listUsers — contract/URL boundary", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue(MOCK_LIST);
  });

  it("calls apiFetch with path STARTING '/users/admin' (not '/users') when no query", async () => {
    await usersApi.listUsers();

    expect(apiClient.apiFetch).toHaveBeenCalledOnce();
    const url = firstCallUrl();
    // Path phải khớp route thật AdminUsersController GET /users/admin.
    expect(url).toBe("/users/admin");
    expect(url.startsWith("/users/admin")).toBe(true);
    // KHÔNG được là path cũ /users (backend không có route → 404 runtime).
    expect(url).not.toBe("/users");
    expect(url.startsWith("/users?")).toBe(false);
  });

  it("appends full query (limit/offset/status/q) AFTER '/users/admin'", async () => {
    await usersApi.listUsers({
      limit: 25,
      offset: 50,
      status: "active",
      q: "nguyen",
    });

    const url = firstCallUrl();
    // Phải bắt đầu bằng base path đúng rồi mới tới '?<query>'.
    expect(url.startsWith("/users/admin?")).toBe(true);
    expect(url).not.toMatch(/^\/users\?/);

    const [base, queryString] = url.split("?");
    expect(base).toBe("/users/admin");

    // Mọi field query phải có mặt trong query-string nối sau base.
    const params = new URLSearchParams(queryString);
    expect(params.get("limit")).toBe("25");
    expect(params.get("offset")).toBe("50");
    expect(params.get("status")).toBe("active");
    expect(params.get("q")).toBe("nguyen");
  });

  it("passes adminUserListSchema (Zod) as the response validator (2nd arg)", async () => {
    await usersApi.listUsers();

    const [, schema] = vi.mocked(apiClient.apiFetch).mock.calls[0];
    expect(schema).toBeDefined();
    expect(typeof (schema as { parse?: unknown }).parse).toBe("function");
  });

  it("returns the AdminUserListDto produced by apiFetch (no client-side reshape)", async () => {
    const result = await usersApi.listUsers();
    expect(result).toEqual(MOCK_LIST);
  });
});
