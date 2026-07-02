/**
 * role-admin-api — contract/URL boundary tests (S2-FE-AUTH-4 · lane FE batch C).
 *
 * KHÔNG mock roleAdminApi; chỉ mock apiFetch tại ranh giới `./api-client` (đúng pattern
 * foundation-api.spec.ts) để kiểm chứng mỗi method gọi ĐÚNG path+method của controller
 * role-admin.controller.ts / auth-roles-permissions.controller.ts + validator Zod đúng.
 *
 * BẤT BIẾN kiểm ở đây:
 *  - FE KHÔNG tự forward company_id (server resolve từ AuthContext) — body sạch.
 *  - listRoles/listPermissions unwrap `.roles`/`.permissions` (envelope không lộ ra ngoài).
 *  - assignPermission KHÔNG cho phép dataScope='System' ở type-level (Zod enum request).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  roleListSchema,
  permissionListSchema,
  roleWriteResultSchema,
  rolePermissionGrantSchema,
} from "@mediaos/contracts";
import { roleAdminApi } from "./role-admin-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

function lastCall(): [string, unknown, { method?: string; body?: string }?] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

describe("roleAdminApi — read catalogs (GET /auth/roles · /auth/permissions)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
  });

  it("listRoles → GET /auth/roles + roleListSchema, unwrap .roles", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({
      roles: [{ id: "r1", name: "HR Manager", description: null, isSystem: false }],
    } as never);
    const roles = await roleAdminApi.listRoles();
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/auth/roles");
    expect(schema).toBe(roleListSchema);
    expect(opts?.method ?? "GET").toBe("GET");
    expect(roles).toEqual([{ id: "r1", name: "HR Manager", description: null, isSystem: false }]);
  });

  it("listPermissions → GET /auth/permissions + permissionListSchema, unwrap .permissions", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({
      permissions: [{ id: "p1", action: "view", resourceType: "role", isSensitive: false }],
    } as never);
    const permissions = await roleAdminApi.listPermissions();
    const [url, schema] = lastCall();
    expect(url).toBe("/auth/permissions");
    expect(schema).toBe(permissionListSchema);
    expect(permissions).toEqual([
      { id: "p1", action: "view", resourceType: "role", isSensitive: false },
    ]);
  });
});

describe("roleAdminApi — role write (POST/PATCH /auth/roles)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
  });

  it("createRole → POST /auth/roles + roleWriteResultSchema + body sạch (KHÔNG company_id)", async () => {
    await roleAdminApi.createRole({ name: "Kế toán", description: null });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/auth/roles");
    expect(schema).toBe(roleWriteResultSchema);
    expect(opts?.method).toBe("POST");
    const body = opts?.body ?? "";
    expect(JSON.parse(body)).toEqual({ name: "Kế toán", description: null });
    expect(body).not.toContain("company_id");
    expect(body).not.toContain("isSystem");
  });

  it("updateRole → PATCH /auth/roles/:id + roleWriteResultSchema (dirty-fields patch)", async () => {
    await roleAdminApi.updateRole("role-1", { name: "Kế toán trưởng" });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/auth/roles/role-1");
    expect(schema).toBe(roleWriteResultSchema);
    expect(opts?.method).toBe("PATCH");
    expect(JSON.parse(opts?.body ?? "{}")).toEqual({ name: "Kế toán trưởng" });
  });
});

describe("roleAdminApi — assign/revoke permission (POST/DELETE /auth/roles/:id/permissions)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
  });

  it("assignPermission → POST .../permissions + rolePermissionGrantSchema", async () => {
    await roleAdminApi.assignPermission("role-1", {
      action: "view",
      resourceType: "department",
      dataScope: "Company",
    });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/auth/roles/role-1/permissions");
    expect(schema).toBe(rolePermissionGrantSchema);
    expect(opts?.method).toBe("POST");
    expect(JSON.parse(opts?.body ?? "{}")).toEqual({
      action: "view",
      resourceType: "department",
      dataScope: "Company",
    });
  });

  it("revokePermission → DELETE .../permissions với body xác định cặp cần gỡ", async () => {
    await roleAdminApi.revokePermission("role-1", { action: "view", resourceType: "department" });
    const [url, , opts] = lastCall();
    expect(url).toBe("/auth/roles/role-1/permissions");
    expect(opts?.method).toBe("DELETE");
    expect(JSON.parse(opts?.body ?? "{}")).toEqual({ action: "view", resourceType: "department" });
  });
});
