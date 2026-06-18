import { beforeEach, describe, expect, it, vi } from "vitest";
import { userRoles, users } from "../db/schema";
import { OperatorBootstrapService } from "./operator-bootstrap.service";

// loadEnv đọc process.env thật → mock để điều khiển input từng test (cô lập khỏi env runner).
// vi.hoisted: khai báo mock TRƯỚC khi vi.mock (đã hoist) chạy factory — tránh "access before init".
// Default {} để db/index.ts (gọi loadEnv() lúc module-load) KHÔNG crash trên env undefined; clearAllMocks
// GIỮ return value nên default sống qua mọi test, từng test override bằng mockReturnValue.
const { loadEnvMock } = vi.hoisted(() => {
  const fn = vi.fn();
  fn.mockReturnValue({});
  return { loadEnvMock: fn };
});
vi.mock("../config/env.schema", () => ({
  loadEnv: () => loadEnvMock(),
}));

const COMPANY_ID = "401c90a0-dfea-4b0a-986c-4317b798cd7b";
const ROLE_F0 = "00000000-0000-0000-0000-0000000000f0";

interface TxCalls {
  userInserts: number;
  userUpdates: number;
  roleInserts: number;
}

/** tx giả: chuỗi drizzle builder, trả giá trị theo BẢNG (users vs userRoles). */
function makeTx(opts: {
  existingUser?: { id: string } | null;
  hasRole?: { id: string } | null;
  insertedUserId?: string;
}): { tx: unknown; calls: TxCalls } {
  const calls: TxCalls = { userInserts: 0, userUpdates: 0, roleInserts: 0 };
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            if (table === users) return Promise.resolve(opts.existingUser ? [opts.existingUser] : []);
            if (table === userRoles) return Promise.resolve(opts.hasRole ? [opts.hasRole] : []);
            return Promise.resolve([]);
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: () => {
        if (table === users) {
          calls.userInserts += 1;
          return {
            returning: () => Promise.resolve([{ id: opts.insertedUserId ?? "new-user-id" }]),
          };
        }
        calls.roleInserts += 1;
        return Promise.resolve(undefined);
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
    withTenant: vi.fn(
      async (_companyId: string, fn: (t: unknown) => Promise<unknown>) => fn(tx),
    ),
  };
  const password = { hash: vi.fn().mockResolvedValue("argon2-hash") };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new OperatorBootstrapService(
    dbsvc as never,
    password as never,
    audit as never,
  );
  return { service, dbsvc, password, audit };
}

const FULL_ENV = {
  PLATFORM_OPERATOR_EMAIL: "operator@demo.local",
  PLATFORM_OPERATOR_PASSWORD: "Operator@12345",
  PLATFORM_OPERATOR_NAME: "Operator Demo",
  PLATFORM_OPERATOR_COMPANY_SLUG: "demo",
};

describe("OperatorBootstrapService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-op khi PLATFORM_OPERATOR_EMAIL chưa set", async () => {
    loadEnvMock.mockReturnValue({ PLATFORM_OPERATOR_NAME: "Platform Operator" });
    const { tx } = makeTx({});
    const { service, dbsvc, password } = makeDeps(tx);

    await service.onApplicationBootstrap();

    expect(dbsvc.runRaw).not.toHaveBeenCalled();
    expect(dbsvc.withTenant).not.toHaveBeenCalled();
    expect(password.hash).not.toHaveBeenCalled();
  });

  it("no-op khi có EMAIL nhưng thiếu PASSWORD (double-guard fail-closed)", async () => {
    loadEnvMock.mockReturnValue({ ...FULL_ENV, PLATFORM_OPERATOR_PASSWORD: undefined });
    const { tx } = makeTx({});
    const { service, dbsvc } = makeDeps(tx);

    await service.onApplicationBootstrap();

    expect(dbsvc.withTenant).not.toHaveBeenCalled();
  });

  it("bỏ qua khi không có công ty active khớp slug", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx } = makeTx({});
    const { service, dbsvc, password } = makeDeps(tx);
    dbsvc.runRaw.mockResolvedValue([]); // resolve_company_by_slug → rỗng

    await service.onApplicationBootstrap();

    expect(dbsvc.runRaw).toHaveBeenCalledTimes(1);
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

  it("tạo user MỚI + gán role …f0 + audit khi chưa tồn tại", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx, calls } = makeTx({ existingUser: null, hasRole: null, insertedUserId: "u1" });
    const { service, password, audit } = makeDeps(tx);

    await service.onApplicationBootstrap();

    expect(password.hash).toHaveBeenCalledWith("Operator@12345");
    expect(calls.userInserts).toBe(1);
    expect(calls.userUpdates).toBe(0);
    expect(calls.roleInserts).toBe(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][1];
    expect(entry.action).toBe("platform.operator_bootstrapped");
    expect(entry.objectType).toBe("auth");
    expect(entry.actorUserId).toBe("u1");
    expect(entry.after).toMatchObject({ userCreated: true, roleGranted: true, roleId: ROLE_F0 });
  });

  it("idempotent: user + role đã có → UPDATE, KHÔNG insert, audit vẫn ghi", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx, calls } = makeTx({ existingUser: { id: "u9" }, hasRole: { id: "r9" } });
    const { service, audit } = makeDeps(tx);

    await service.onApplicationBootstrap();

    expect(calls.userInserts).toBe(0);
    expect(calls.userUpdates).toBe(1);
    expect(calls.roleInserts).toBe(0);
    const entry = audit.record.mock.calls[0][1];
    expect(entry.after).toMatchObject({ userCreated: false, roleGranted: false });
    expect(entry.actorUserId).toBe("u9");
  });

  it("KHÔNG bao giờ đưa mật khẩu plaintext vào audit (BẤT BIẾN #3)", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx } = makeTx({ existingUser: null, hasRole: null, insertedUserId: "u1" });
    const { service, audit } = makeDeps(tx);

    await service.onApplicationBootstrap();

    const serialized = JSON.stringify(audit.record.mock.calls[0][1]);
    expect(serialized).not.toContain("Operator@12345");
  });

  it("fail-soft: lỗi DB KHÔNG crash boot", async () => {
    loadEnvMock.mockReturnValue(FULL_ENV);
    const { tx } = makeTx({});
    const { service, dbsvc } = makeDeps(tx);
    dbsvc.withTenant.mockRejectedValue(new Error("DB down"));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
