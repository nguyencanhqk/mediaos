/**
 * S2-AUTH-SEED-1 / L2-SUPERADMIN-BOOTSTRAP — unit RED-before-GREEN cho SuperAdminBootstrapService.
 *
 * Hợp đồng (env.schema PLATFORM_SUPERADMIN_* + task L2):
 *   • VẮNG PLATFORM_SUPERADMIN_EMAIL → no-op (KHÔNG resolve company, KHÔNG ghi gì, KHÔNG hash).
 *   • EMAIL set → resolve company theo PLATFORM_SUPERADMIN_COMPANY_SLUG; company KHÔNG active/không tồn
 *     tại → throw (fail-fast, KHÔNG seed god-mode account vào tenant sai/không tồn tại).
 *   • EMAIL set + company active → withTenant(companyId): tạo/sync role 'super-admin' (company-scoped,
 *     is_system=false); UPSERT user với password hash qua PasswordService.hash (argon2id — BẤT BIẾN #3);
 *     grant TOÀN BỘ catalog data_scope='System' TRỪ reveal-secret:platform-account; gán 1 user_role;
 *     phát permission.changed.
 *   • KHÔNG log password/hash (BẤT BIẾN #3) — bắt mọi log gọi và assert không chứa plaintext/hash.
 *
 * RED: SuperAdminBootstrapService chưa tồn tại → import vỡ; sau GREEN pass.
 */

import { Logger } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuperAdminBootstrapService } from "./super-admin-bootstrap.service";
import type { ISuperAdminBootstrapRepository } from "./super-admin-bootstrap.repository";
import type { PasswordService } from "../auth/password.service";

// ── Stubs ────────────────────────────────────────────────────────────────────

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const ROLE_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";
const PLAINTEXT = "Sup3rSecret!Pwd";
const FAKE_HASH = "$argon2id$v=19$m=19456,t=2,p=1$fakefakefake";

const CATALOG = [
  { id: "p1", action: "view", resourceType: "me", isSensitive: false },
  { id: "p2", action: "read", resourceType: "employee", isSensitive: false },
  { id: "p3", action: "view-sensitive", resourceType: "employee", isSensitive: true },
  // cặp PHẢI bị loại khỏi grant (break-glass per-object ADR-0010):
  { id: "p4", action: "reveal-secret", resourceType: "platform-account", isSensitive: true },
];

class FakeRepo implements ISuperAdminBootstrapRepository {
  upsertRoleCalls: Array<{ companyId: string; name: string }> = [];
  upsertUserCalls: Array<{ companyId: string; email: string; passwordHash: string }> = [];
  grantCalls: Array<{ roleId: string; permissionId: string; dataScope: string }> = [];
  assignRoleCalls: Array<{ userId: string; roleId: string; companyId: string }> = [];

  async upsertSuperAdminRole(_tx: unknown, companyId: string, name: string): Promise<string> {
    this.upsertRoleCalls.push({ companyId, name });
    return ROLE_ID;
  }
  async upsertSuperAdminUser(
    _tx: unknown,
    companyId: string,
    email: string,
    passwordHash: string,
    _fullName: string,
  ): Promise<string> {
    this.upsertUserCalls.push({ companyId, email, passwordHash });
    return USER_ID;
  }
  async listAllPermissions(
    _tx: unknown,
  ): Promise<Array<{ id: string; action: string; resourceType: string; isSensitive: boolean }>> {
    return CATALOG;
  }
  async grantPermissionWithScope(
    _tx: unknown,
    roleId: string,
    permissionId: string,
    dataScope: string,
  ): Promise<void> {
    this.grantCalls.push({ roleId, permissionId, dataScope });
  }
  async assignRole(_tx: unknown, userId: string, roleId: string, companyId: string): Promise<void> {
    this.assignRoleCalls.push({ userId, roleId, companyId });
  }
}

function makeService(opts: {
  env: Record<string, string | undefined>;
  resolveResult?: { id: string; status: string } | null;
}): {
  service: SuperAdminBootstrapService;
  repo: FakeRepo;
  hashSpy: ReturnType<typeof vi.fn>;
  enqueueSpy: ReturnType<typeof vi.fn>;
  resolveSpy: ReturnType<typeof vi.fn>;
  withTenantSpy: ReturnType<typeof vi.fn>;
} {
  const repo = new FakeRepo();
  const hashSpy = vi.fn(async (_plain: string) => FAKE_HASH);
  const password = { hash: hashSpy } as unknown as PasswordService;
  const enqueueSpy = vi.fn(async () => "evt-id");
  const outbox = { enqueue: enqueueSpy };
  const audit = { record: vi.fn(async () => undefined) };
  const resolveSpy = vi.fn(async () =>
    opts.resolveResult === undefined ? { id: COMPANY_ID, status: "active" } : opts.resolveResult,
  );
  const withTenantSpy = vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({} as unknown),
  );
  const dbsvc = { withTenant: withTenantSpy };

  const service = new SuperAdminBootstrapService(
    dbsvc as never,
    password,
    repo,
    audit as never,
    outbox as never,
  );
  // Inject test seams: env loader + company resolver (protected methods overridden via cast).
  (service as unknown as { loadConfig: () => typeof opts.env }).loadConfig = () => opts.env;
  (service as unknown as { resolveCompanyBySlug: typeof resolveSpy }).resolveCompanyBySlug =
    resolveSpy;

  return { service, repo, hashSpy, enqueueSpy, resolveSpy, withTenantSpy };
}

describe("SuperAdminBootstrapService", () => {
  let captured: unknown[][];

  beforeEach(() => {
    captured = [];
    const capture = (...args: unknown[]): undefined => {
      captured.push(args);
      return undefined;
    };
    // Capture every Logger output to assert NO password/hash leaks (BẤT BIẾN #3).
    vi.spyOn(Logger.prototype, "log").mockImplementation(capture);
    vi.spyOn(Logger.prototype, "error").mockImplementation(capture);
    vi.spyOn(Logger.prototype, "warn").mockImplementation(capture);
    vi.spyOn(Logger.prototype, "debug").mockImplementation(capture);
  });

  it("VẮNG PLATFORM_SUPERADMIN_EMAIL → no-op (KHÔNG resolve, KHÔNG hash, KHÔNG ghi)", async () => {
    const { service, repo, hashSpy, resolveSpy } = makeService({ env: {} });

    await service.onApplicationBootstrap();

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(hashSpy).not.toHaveBeenCalled();
    expect(repo.upsertUserCalls).toHaveLength(0);
    expect(repo.upsertRoleCalls).toHaveLength(0);
  });

  it("EMAIL set + company KHÔNG active → throw (fail-fast, KHÔNG ghi)", async () => {
    const { service, repo, hashSpy } = makeService({
      env: {
        PLATFORM_SUPERADMIN_EMAIL: "sa@demo.local",
        PLATFORM_SUPERADMIN_PASSWORD: PLAINTEXT,
        PLATFORM_SUPERADMIN_COMPANY_SLUG: "demo",
      },
      resolveResult: { id: COMPANY_ID, status: "suspended" },
    });

    await expect(service.onApplicationBootstrap()).rejects.toThrow();
    expect(repo.upsertUserCalls).toHaveLength(0);
    expect(hashSpy).not.toHaveBeenCalled();
  });

  it("EMAIL set + company không tồn tại → throw (fail-fast)", async () => {
    const { service, repo } = makeService({
      env: {
        PLATFORM_SUPERADMIN_EMAIL: "sa@demo.local",
        PLATFORM_SUPERADMIN_PASSWORD: PLAINTEXT,
        PLATFORM_SUPERADMIN_COMPANY_SLUG: "ghost",
      },
      resolveResult: null,
    });

    await expect(service.onApplicationBootstrap()).rejects.toThrow();
    expect(repo.upsertUserCalls).toHaveLength(0);
  });

  it("BẤT BIẾN #3: EMAIL set NHƯNG thiếu PASSWORD → throw fail-fast (KHÔNG resolve company, KHÔNG hash, KHÔNG ghi)", async () => {
    // Double-guard của readConfig(): superRefine ở env.schema đã ép, nhưng nếu lọt (loadConfig seam trả env
    // thô không qua superRefine) service PHẢI fail-fast — KHÔNG seed god-mode account KHÔNG mật khẩu.
    const { service, repo, hashSpy, resolveSpy } = makeService({
      env: {
        PLATFORM_SUPERADMIN_EMAIL: "sa@demo.local",
        // PLATFORM_SUPERADMIN_PASSWORD cố tình VẮNG
        PLATFORM_SUPERADMIN_COMPANY_SLUG: "demo",
      },
    });

    await expect(service.onApplicationBootstrap()).rejects.toThrow(/PLATFORM_SUPERADMIN_PASSWORD/);
    // fail-fast NGAY ở readConfig → KHÔNG chạm company resolver, KHÔNG hash, KHÔNG ghi role/user.
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(hashSpy).not.toHaveBeenCalled();
    expect(repo.upsertRoleCalls).toHaveLength(0);
    expect(repo.upsertUserCalls).toHaveLength(0);
  });

  it("EMAIL set + company active → tạo role + user (hash argon2id) + grant catalog TRỪ reveal-secret + 1 user_role + emit permission.changed", async () => {
    const { service, repo, hashSpy, enqueueSpy, withTenantSpy } = makeService({
      env: {
        PLATFORM_SUPERADMIN_EMAIL: "sa@demo.local",
        PLATFORM_SUPERADMIN_PASSWORD: PLAINTEXT,
        PLATFORM_SUPERADMIN_COMPANY_SLUG: "demo",
        PLATFORM_SUPERADMIN_NAME: "Super Admin",
      },
    });

    await service.onApplicationBootstrap();

    // mọi ghi đi qua withTenant (BẤT BIẾN #1 — company_id ép ở DB)
    expect(withTenantSpy).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));

    // role company-scoped 'super-admin'
    expect(repo.upsertRoleCalls).toEqual([{ companyId: COMPANY_ID, name: "super-admin" }]);

    // password hash qua PasswordService.hash (argon2id) — KHÔNG literal hash
    expect(hashSpy).toHaveBeenCalledTimes(1);
    expect(hashSpy).toHaveBeenCalledWith(PLAINTEXT);
    expect(repo.upsertUserCalls).toEqual([
      { companyId: COMPANY_ID, email: "sa@demo.local", passwordHash: FAKE_HASH },
    ]);

    // grant TOÀN BỘ catalog data_scope='System' TRỪ reveal-secret:platform-account
    const grantedIds = repo.grantCalls.map((g) => g.permissionId).sort();
    expect(grantedIds).toEqual(["p1", "p2", "p3"]); // p4 (reveal-secret) bị loại
    expect(repo.grantCalls.every((g) => g.dataScope === "System")).toBe(true);
    expect(repo.grantCalls.find((g) => g.permissionId === "p4")).toBeUndefined();

    // 1 user_role idempotent
    expect(repo.assignRoleCalls).toEqual([
      { userId: USER_ID, roleId: ROLE_ID, companyId: COMPANY_ID },
    ]);

    // emit permission.changed sau grant
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(expect.anything(), {
      eventType: "permission.changed",
      payload: { userId: USER_ID, companyId: COMPANY_ID },
    });
  });

  it("BẤT BIẾN #3: KHÔNG log password plaintext / hash ở bất kỳ Logger call nào", async () => {
    const { service } = makeService({
      env: {
        PLATFORM_SUPERADMIN_EMAIL: "sa@demo.local",
        PLATFORM_SUPERADMIN_PASSWORD: PLAINTEXT,
        PLATFORM_SUPERADMIN_COMPANY_SLUG: "demo",
      },
    });

    await service.onApplicationBootstrap();

    const allLogs = JSON.stringify(captured);
    expect(allLogs).not.toContain(PLAINTEXT);
    expect(allLogs).not.toContain(FAKE_HASH);
    expect(allLogs.toLowerCase()).not.toContain("password");
  });
});
