/**
 * users-api — contract/URL tests (S2-FE-HR-3-FIX-1).
 *
 * Mục tiêu: đảm bảo listUsers gọi đúng path /users/admin (AdminUsersController).
 * Không mock path ra khỏi kiểm tra — mock apiFetch để kiểm tra tham số URL.
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

describe("usersApi.listUsers — contract/URL", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("calls GET /users/admin (not /users) when no query provided", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(MOCK_LIST);

    await usersApi.listUsers();

    expect(apiClient.apiFetch).toHaveBeenCalledOnce();
    const [url] = vi.mocked(apiClient.apiFetch).mock.calls[0];
    expect(url).toBe("/users/admin");
    expect(url).not.toBe("/users");
  });

  it("calls /users/admin with query string appended when query provided", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(MOCK_LIST);

    await usersApi.listUsers({ q: "test", limit: 10 });

    const [url] = vi.mocked(apiClient.apiFetch).mock.calls[0];
    expect(url).toMatch(/^\/users\/admin\?/);
    expect(url).not.toMatch(/^\/users\?/);
  });

  it("never calls the non-existent /users route (would 404 on backend)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(MOCK_LIST);

    await usersApi.listUsers({ status: "active" });

    const [url] = vi.mocked(apiClient.apiFetch).mock.calls[0];
    // Must not be the old buggy path
    expect(url).not.toBe("/users");
    expect(url).not.toMatch(/^\/users\?/);
  });

  it("passes the adminUserListSchema as Zod validator (second argument)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(MOCK_LIST);

    await usersApi.listUsers();

    // Second arg is the Zod schema — confirm it's an object with .parse (ZodObject)
    const [, schema] = vi.mocked(apiClient.apiFetch).mock.calls[0];
    expect(schema).toBeDefined();
    expect(typeof (schema as { parse?: unknown }).parse).toBe("function");
  });
});
