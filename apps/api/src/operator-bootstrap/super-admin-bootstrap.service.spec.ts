import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissions, roles, userRoles, users } from "../db/schema";
import { SuperAdminBootstrapService } from "./super-admin-bootstrap.service";

// loadEnv đọc process.env thật → mock để điều khiển input từng test (cô lập khỏi env runner).
// vi.hoisted: khai báo mock TRƯỚC khi vi.mock (đã hoist) chạy factory — tránh "access before init".
const { loadEnvMock } = vi.hoisted(() => {
  const fn = vi.fn();
  fn.mockReturnValue({});
  return { loadEnvMock: fn };
});
vi.mock("../config/env.schema", () => ({
  loadEnv: () => loadEnvMock(),
}));

const COMPANY_ID = "401c90a0-dfea-4b0a-986c-4317b798cd7b";
const CATALOG = [{ id: "perm-1" }, { id: "perm-2" }, { id: "perm-3" }];

interface TxCalls {
  userInserts: number;
  userUpdates: number;
  roleInserts: number;
  rolePermInserts: number;
  rolePermValueCount: number;
  userRoleInserts: number;
}

/** tx giả: chuỗi drizzle builder, trả giá trị theo BẢNG. */
function makeTx(opts: {
  existingUser?: { id: string } | null;
  existingRole?: { id: string } | null;
  hasUserRole?: { id: string } | null;
  insertedUserId?: string;
  insertedRoleId?: string;
  catalog?: Array<{ id: string }>;
}): { tx: unknown; calls: TxCalls } {
  const calls: TxCalls = {
    userInserts: 0,
    userUpdates: 0,
    roleInserts: 0,
    rolePermInserts: 0,
    rolePermValueCount: 0,
    userRoleInserts: 0,
  };
  const catalog = opts.catalog ?? CATALOG;
  const tx = {
    select: () => ({
      from: (table: unknown) => {
        // Catalog query: `select().from(permissions)` await TRỰC TIẾP (không .where) → trả Promise[].
        if (table === permissions) return Promise.resolve(catalog);
        return {
          where: () => ({
            limit: () => {
              if (table === users) return Promise.resolve(opts.existingUser ? [opts.existingUser] : []);
              if (table === roles) return Promise.resolve(opts.existingRole ? [opts.existingRole] : []);
              if (table === userRoles) return Promise.resolve(opts.hasUserRole ? [opts.hasUserRole] : []);
              return Promise.resolve([]);
            },
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: unknown) => {
        if (table === users) {
          calls.userInserts += 1;
          return { returning: () => Promise.resolve([{ id: opts.insertedUserId ?? "new-user-id" }]) };
        }
        if (table === roles) {
          calls.roleInserts += 1;
          return { returning: () => Promise.resolve([{ id: opts.insertedRoleId ?? "new-role-id" }]) };
        }
        if (table === userRoles) {
          calls.userRoleInserts += 1;
          return Promise.resolve(undefined);
        }
        // rolePermissions: values([...]).onConflictDoNothing()
        calls.rolePermInserts += 1;
        calls.rolePermValueCount = Array.isArray(vals) ? vals.length : 0;
        return { onConflictDoNothing: () => Promise.resolve(undefined) };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          calls.userUpdates += 1;
          return Promise.resolve(undefined);
        },
      }),
    }),
  };
  return { tx, calls };
}

function makeDeps(tx: unknown) {
  const dbsvc = {
    runRaw: vi.fn().mockResolvedValue([{ id: COMPANY_ID, status: "active" }]),
    withTenant: vi.fn(async (_companyId: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const password = { hash: vi.fn().mockResolvedValue("argon2-hash") };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new SuperAdminBootstrapService(
    dbsvc as never,
    password as never,
    audit as never,
  );
  return { service, dbsvc, password, audit };
}

const FULL_ENV = {
  PLATFORM_SUPERADMIN_EMAIL: "superadmin@demo.local",
  PLATFORM_SUPERADMIN_PASSWORD: "SuperAdmin@12345",
  PLATFORM_SUPERADMIN_NAME: "Super Admin",
  PLATFORM_SUPERADMIN_COMPANY_SLUG: "demo",
};

describe("SuperAdminBootstrapService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-op khi PLATFORM_SUPERADMIN_EMAIL chưa set", async () => {
    loadEnvMock.mockReturnValue({ PLATFORM_SUPERADMIN_NAME: "Super Admin" });
    const { tx } = makeTx({});
    const { service, dbsvc, password } = makeDeps(tx);

    await service.onApplicationBootstrap();

    expect(dbsvc.runRaw).not.toHaveBeenCalled();
    expect(dbsvc.withTenant).not.toHaveBeenCalled();
    expect(password.hash).not.toHaveBeenCalled();
  });

  it("no-op khi có EMAIL nhưng thiếu PASSWORD (double-guard fail-closed)", async () => {
    loadEnvMock.mockReturnValue({ ...FULL_ENV, PLATFORM_SUPERADMIN_PASSWORD: undefined });
    const { tx } = makeTx({});
    const { service, dbsvc } = makeDeps(tx);

    await service.onApplicationBootstrap();

    expect(dbsvc.withTenant).not.toHaveBeenCalled();
  });

  it("bỏ qua khi không có công ty active khớp slug", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx } = makeTx({});
    const { service, dbsvc, password } = makeDeps(tx);
    dbsvc.runRaw.mockResolvedValue([]);

    await service.onApplicationBootstrap();

    expect(dbsvc.withTenant).not.toHaveBeenCalled();
    expect(password.hash).not.toHaveBeenCalled();
  });

  it("bỏ qua khi công ty tồn tại nhưng không active", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx } = makeTx({});
    const { service, dbsvc } = makeDeps(tx);
    dbsvc.runRaw.mockResolvedValue([{ id: COMPANY_ID, status: "suspended" }]);

    await service.onApplicationBootstrap();

    expect(dbsvc.withTenant).not.toHaveBeenCalled();
  });

  it("tạo user MỚI + role company-scoped MỚI + grant TOÀN catalog + gán role + audit", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx, calls } = makeTx({
      existingUser: null,
      existingRole: null,
      hasUserRole: null,
      insertedUserId: "u1",
      insertedRoleId: "r1",
    });
    const { service, password, audit } = makeDeps(tx);

    await service.onApplicationBootstrap();

    expect(password.hash).toHaveBeenCalledWith("SuperAdmin@12345");
    expect(calls.userInserts).toBe(1);
    expect(calls.userUpdates).toBe(0);
    expect(calls.roleInserts).toBe(1);
    expect(calls.rolePermInserts).toBe(1);
    expect(calls.rolePermValueCount).toBe(CATALOG.length); // grant TẤT CẢ quyền catalog
    expect(calls.userRoleInserts).toBe(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][1];
    expect(entry.action).toBe("platform.superadmin_bootstrapped");
    expect(entry.objectType).toBe("auth");
    expect(entry.actorUserId).toBe("u1");
    expect(entry.after).toMatchObject({
      userCreated: true,
      roleCreated: true,
      roleAssigned: true,
      roleName: "super-admin",
      permissionCount: CATALOG.length,
    });
  });

  it("idempotent: user+role+assignment đã có → UPDATE user, KHÔNG insert, vẫn re-grant catalog", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx, calls } = makeTx({
      existingUser: { id: "u9" },
      existingRole: { id: "r9" },
      hasUserRole: { id: "ur9" },
    });
    const { service, audit } = makeDeps(tx);

    await service.onApplicationBootstrap();

    expect(calls.userInserts).toBe(0);
    expect(calls.userUpdates).toBe(1);
    expect(calls.roleInserts).toBe(0);
    expect(calls.userRoleInserts).toBe(0);
    // Re-grant toàn catalog mỗi boot (self-heal quyền module mới) — idempotent qua onConflictDoNothing.
    expect(calls.rolePermInserts).toBe(1);
    expect(calls.rolePermValueCount).toBe(CATALOG.length);
    const entry = audit.record.mock.calls[0][1];
    expect(entry.after).toMatchObject({ userCreated: false, roleCreated: false, roleAssigned: false });
    expect(entry.actorUserId).toBe("u9");
  });

  it("KHÔNG bao giờ đưa mật khẩu plaintext vào audit (BẤT BIẾN #3)", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx } = makeTx({ existingUser: null, existingRole: null, hasUserRole: null });
    const { service, audit } = makeDeps(tx);

    await service.onApplicationBootstrap();

    const serialized = JSON.stringify(audit.record.mock.calls[0][1]);
    expect(serialized).not.toContain("SuperAdmin@12345");
  });

  it("KHÔNG grant khi catalog rỗng (không insert role_permissions thừa)", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx, calls } = makeTx({
      existingUser: null,
      existingRole: null,
      hasUserRole: null,
      catalog: [],
    });
    const { service } = makeDeps(tx);

    await service.onApplicationBootstrap();

    expect(calls.rolePermInserts).toBe(0);
  });

  it("fail-soft: lỗi DB KHÔNG crash boot", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx } = makeTx({});
    const { service, dbsvc } = makeDeps(tx);
    dbsvc.withTenant.mockRejectedValue(new Error("DB down"));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
