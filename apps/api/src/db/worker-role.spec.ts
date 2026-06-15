import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertWorkerRoleSafe } from "./worker-role";

/**
 * Fake workerDb: chỉ cần `execute()` trả về `{ rows }` mô phỏng kết quả `SELECT current_user, rolsuper,
 * rolbypassrls FROM pg_roles`. KHÔNG cần Postgres thật → test nhanh + tất định.
 */
function fakeDb(rows: unknown[]) {
  return { execute: vi.fn(async () => ({ rows })) } as unknown as Parameters<typeof assertWorkerRoleSafe>[0];
}

const SAFE = [{ role: "mediaos_worker", rolsuper: false, rolbypassrls: false }];
const SUPER = [{ role: "postgres", rolsuper: true, rolbypassrls: false }];
const BYPASS = [{ role: "owner", rolsuper: false, rolbypassrls: true }];

describe("assertWorkerRoleSafe (BẤT BIẾN #1 — chặn worker BYPASS RLS)", () => {
  const origEnv = process.env.NODE_ENV;
  const origFlag = process.env.ALLOW_SUPERUSER_TEST;
  beforeEach(() => {
    delete process.env.ALLOW_SUPERUSER_TEST;
  });
  afterEach(() => {
    process.env.NODE_ENV = origEnv;
    if (origFlag === undefined) delete process.env.ALLOW_SUPERUSER_TEST;
    else process.env.ALLOW_SUPERUSER_TEST = origFlag;
  });

  it("role an toàn (non-super, non-bypass) → KHÔNG ném, KHÔNG cảnh báo", async () => {
    const warn = vi.fn();
    await expect(
      assertWorkerRoleSafe(fakeDb(SAFE), { context: "X", mode: "prod-only", logger: { warn } }),
    ).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("mode prod-only + role super + NODE_ENV=production → NÉM", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      assertWorkerRoleSafe(fakeDb(SUPER), { context: "OutboxWorker", mode: "prod-only" }),
    ).rejects.toThrow(/BYPASS RLS/);
  });

  it("mode prod-only + role super + NODE_ENV=test → cảnh báo, KHÔNG ném", async () => {
    process.env.NODE_ENV = "test";
    const warn = vi.fn();
    await expect(
      assertWorkerRoleSafe(fakeDb(SUPER), { context: "OutboxWorker", mode: "prod-only", logger: { warn } }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("mode strict + role bypassrls + cờ override KHÔNG set → NÉM (mọi env)", async () => {
    process.env.NODE_ENV = "test";
    await expect(
      assertWorkerRoleSafe(fakeDb(BYPASS), {
        context: "SecretRotationService",
        mode: "strict",
        overrideEnvVar: "ALLOW_SUPERUSER_TEST",
      }),
    ).rejects.toThrow(/BYPASS RLS/);
  });

  it("mode strict + cờ override='true' → cảnh báo, KHÔNG ném (KHÔNG lộ tên role ra log)", async () => {
    process.env.ALLOW_SUPERUSER_TEST = "true";
    const warn = vi.fn();
    await expect(
      assertWorkerRoleSafe(fakeDb(SUPER), {
        context: "SecretRotationService",
        mode: "strict",
        overrideEnvVar: "ALLOW_SUPERUSER_TEST",
        logger: { warn },
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    const logged = warn.mock.calls[0][0] as string;
    expect(logged).not.toContain("postgres"); // tên role không bao giờ vào log
  });

  it("KHÔNG đọc được role (current_user vắng trong pg_roles) → NÉM (fail-closed)", async () => {
    await expect(
      assertWorkerRoleSafe(fakeDb([]), { context: "X", mode: "prod-only" }),
    ).rejects.toThrow(/fail-closed|pg_roles/);
  });
});
