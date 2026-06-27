import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../../db/db.service";
import { MasterDataSeedRunner } from "./master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "./master-data-seeder.registry";
import type { MasterDataSeedContext, ModuleMasterDataSeeder } from "./master-data-seeder.types";
import type { SeedTrackingService } from "./seed-tracking.service";

/**
 * S3-FND-SEEDRUN-1 — unit (KHÔNG DB): registry + fail-safe logic của runner.
 *  - Registry: register/list/size + throw khi seedKey rỗng/version rỗng/trùng (fail-fast cấu hình).
 *  - Runner FAIL-SAFE: 1 seeder throw KHÔNG chặn seeder/company khác; reconcile KHÔNG throw; mark batch Failed.
 *  - Runner gọi startBatch/finishBatch mỗi (company, seeder); track bơm đúng companyId/batchId vào markItem.
 *  - Enumerate company lỗi (withPlatformContext throw) ⇒ summary rỗng, KHÔNG throw (boot không sập).
 */

const C1 = "11111111-1111-1111-1111-111111111111";
const C2 = "22222222-2222-2222-2222-222222222222";

/** Fake tx — seeder unit KHÔNG dùng tx (chỉ track/throw); chỉ cần object placeholder. */
const FAKE_TX = {} as never;

function makeDb(opts: { companyIds?: string[]; enumerateThrows?: boolean }): {
  db: DatabaseService;
  withTenant: ReturnType<typeof vi.fn>;
  withPlatform: ReturnType<typeof vi.fn>;
} {
  const withPlatform = vi.fn(async (fn: (tx: unknown) => unknown) => {
    if (opts.enumerateThrows) throw new Error("db down");
    // Giả lập tx.select({id}).from(companies).where(...) → mảng rows.
    const ids = opts.companyIds ?? [];
    const tx = {
      select: () => ({ from: () => ({ where: async () => ids.map((id) => ({ id })) }) }),
    };
    return fn(tx);
  });
  const withTenant = vi.fn(async (_cid: string, fn: (tx: unknown) => unknown) => fn(FAKE_TX));
  const db = { withPlatformContext: withPlatform, withTenant } as unknown as DatabaseService;
  return { db, withTenant, withPlatform };
}

function makeSeedTracking(): {
  svc: SeedTrackingService;
  startBatch: ReturnType<typeof vi.fn>;
  markItem: ReturnType<typeof vi.fn>;
  finishBatch: ReturnType<typeof vi.fn>;
  markItemFailed: ReturnType<typeof vi.fn>;
} {
  const startBatch = vi.fn(
    async (input: { companyId: string; seedKey: string; seedVersion: string }) => ({
      id: `batch-${input.companyId}-${input.seedKey}`,
      companyId: input.companyId,
      seedKey: input.seedKey,
      seedVersion: input.seedVersion,
      status: "Running",
      reused: false,
    }),
  );
  const markItem = vi.fn(async () => ({ itemId: "i", status: "Success", operation: "Upsert" }));
  const finishBatch = vi.fn(async (_cid: string, batchId: string) => ({
    batchId,
    status: "Success",
    finishedAt: new Date(),
  }));
  const markItemFailed = vi.fn(async () => ({
    itemId: "i",
    status: "Failed",
    operation: "Upsert",
  }));
  const svc = {
    startBatch,
    markItem,
    finishBatch,
    markItemFailed,
  } as unknown as SeedTrackingService;
  return { svc, startBatch, markItem, finishBatch, markItemFailed };
}

function goodSeeder(
  seedKey: string,
  onRun?: (ctx: MasterDataSeedContext) => void,
): ModuleMasterDataSeeder {
  return {
    seedKey,
    seedVersion: "v1",
    seed: async (ctx) => {
      onRun?.(ctx);
      await ctx.track({ targetTable: "t", targetKey: "k", payload: { a: 1 } });
    },
  };
}

function badSeeder(seedKey: string): ModuleMasterDataSeeder {
  return {
    seedKey,
    seedVersion: "v1",
    seed: async () => {
      throw new Error("boom");
    },
  };
}

describe("MasterDataSeederRegistry", () => {
  let registry: MasterDataSeederRegistry;
  beforeEach(() => {
    registry = new MasterDataSeederRegistry();
  });

  it("register + list + size", () => {
    registry.register(goodSeeder("att.master-data"));
    registry.register(goodSeeder("leave.master-data"));
    expect(registry.size()).toBe(2);
    expect(registry.list().map((s) => s.seedKey)).toEqual(["att.master-data", "leave.master-data"]);
  });

  it("throw khi seedKey trùng (duy nhất toàn hệ)", () => {
    registry.register(goodSeeder("dup"));
    expect(() => registry.register(goodSeeder("dup"))).toThrow(/trùng/);
  });

  it("throw khi seedKey rỗng", () => {
    expect(() =>
      registry.register({ seedKey: "  ", seedVersion: "v1", seed: async () => {} }),
    ).toThrow(/seedKey/);
  });

  it("throw khi seedVersion rỗng", () => {
    expect(() =>
      registry.register({ seedKey: "x", seedVersion: "", seed: async () => {} }),
    ).toThrow(/seedVersion/);
  });
});

describe("MasterDataSeedRunner (fail-safe)", () => {
  it("1 company × 1 seeder ok → startBatch+seed+finishBatch, summary đếm đúng", async () => {
    const { db } = makeDb({ companyIds: [C1] });
    const t = makeSeedTracking();
    const registry = new MasterDataSeederRegistry();
    registry.register(goodSeeder("good"));
    const runner = new MasterDataSeedRunner(db, t.svc, registry);

    const summary = await runner.reconcileAllCompanies();

    expect(summary).toMatchObject({
      companiesScanned: 1,
      seedersRegistered: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(t.startBatch).toHaveBeenCalledTimes(1);
    expect(t.finishBatch).toHaveBeenCalledTimes(1);
    // track → markItem với companyId + batchId của batch hiện tại.
    expect(t.markItem).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: C1, batchId: "batch-" + C1 + "-good" }),
    );
  });

  it("seeder lỗi KHÔNG chặn seeder khác; reconcile KHÔNG throw; batch lỗi mark Failed", async () => {
    const { db } = makeDb({ companyIds: [C1] });
    const t = makeSeedTracking();
    const registry = new MasterDataSeederRegistry();
    // bad ĐĂNG KÝ TRƯỚC → chứng minh good vẫn chạy SAU khi bad throw.
    registry.register(badSeeder("bad"));
    let goodRan = false;
    registry.register(goodSeeder("good", () => (goodRan = true)));
    const runner = new MasterDataSeedRunner(db, t.svc, registry);

    const summary = await runner.reconcileAllCompanies();

    expect(goodRan).toBe(true);
    expect(summary).toMatchObject({
      companiesScanned: 1,
      seedersRegistered: 2,
      succeeded: 1,
      failed: 1,
    });
    // bad: markItemFailed gọi đúng 1 lần; good: markItem (track) gọi.
    expect(t.markItemFailed).toHaveBeenCalledTimes(1);
    expect(t.markItem).toHaveBeenCalledTimes(1);
    // finishBatch gọi cho CẢ good (success) LẪN bad (qua markBatchFailed).
    expect(t.finishBatch).toHaveBeenCalledTimes(2);
    const outcome = summary.outcomes.find((o) => o.seedKey === "bad");
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toContain("boom");
  });

  it("nhiều company → mỗi company chạy mọi seeder", async () => {
    const { db } = makeDb({ companyIds: [C1, C2] });
    const t = makeSeedTracking();
    const registry = new MasterDataSeederRegistry();
    registry.register(goodSeeder("good"));
    const runner = new MasterDataSeedRunner(db, t.svc, registry);

    const summary = await runner.reconcileAllCompanies();

    expect(summary.companiesScanned).toBe(2);
    expect(summary.succeeded).toBe(2);
    expect(t.startBatch).toHaveBeenCalledTimes(2);
  });

  it("KHÔNG seeder nào đăng ký → no-op, KHÔNG enumerate company", async () => {
    const { db, withPlatform } = makeDb({ companyIds: [C1] });
    const t = makeSeedTracking();
    const runner = new MasterDataSeedRunner(db, t.svc, new MasterDataSeederRegistry());

    const summary = await runner.reconcileAllCompanies();

    expect(summary).toMatchObject({ companiesScanned: 0, seedersRegistered: 0 });
    expect(withPlatform).not.toHaveBeenCalled();
    expect(t.startBatch).not.toHaveBeenCalled();
  });

  it("enumerate company lỗi → summary rỗng, KHÔNG throw (boot không sập)", async () => {
    const { db } = makeDb({ enumerateThrows: true });
    const t = makeSeedTracking();
    const registry = new MasterDataSeederRegistry();
    registry.register(goodSeeder("good"));
    const runner = new MasterDataSeedRunner(db, t.svc, registry);

    const summary = await runner.reconcileAllCompanies();

    expect(summary).toMatchObject({
      companiesScanned: 0,
      seedersRegistered: 1,
      succeeded: 0,
      failed: 0,
    });
    expect(t.startBatch).not.toHaveBeenCalled();
  });

  it("reconcileCompany(1 company) chạy mọi seeder, KHÔNG throw khi 1 seeder lỗi", async () => {
    const { db } = makeDb({});
    const t = makeSeedTracking();
    const registry = new MasterDataSeederRegistry();
    registry.register(goodSeeder("good"));
    registry.register(badSeeder("bad"));
    const runner = new MasterDataSeedRunner(db, t.svc, registry);

    const outcomes = await runner.reconcileCompany(C1);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.find((o) => o.seedKey === "good")?.ok).toBe(true);
    expect(outcomes.find((o) => o.seedKey === "bad")?.ok).toBe(false);
  });
});
