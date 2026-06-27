/**
 * S3-FND-SEEDRUN-1 — MasterDataSeedRunner integration trên Postgres THẬT, DB CÔ LẬP (mediaos_<lane>).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB
 * ⇒ đỏ-giả trên DB dev chung. Colocated trong src/foundation/seed → vitest gom qua include glob của src.
 *
 * Chạy qua ĐƯỜNG THẬT: new MasterDataSeedRunner(DatabaseService, SeedTrackingService, registry) với app role
 * (mediaos_app, RLS+FORCE) — KHÔNG owner/migrator. Đăng ký FAKE seeder (good = INSERT company_settings trong
 * tenant tx + track; bad = throw). Phủ:
 *   G1 — seeder ran: company_settings row TỒN TẠI + seed_items ghi (track) cho good batch (status Success).
 *   I2 — idempotent: chạy lần 2 ⇒ batch reused (1 row), markItem Skipped (track trả 'Skipped'), KHÔNG dup
 *        company_settings, KHÔNG dup seed_items.
 *   F3 — fail-safe: bad seeder throw ⇒ batch của bad = Failed (+ sentinel item), NHƯNG good vẫn Success
 *        (KHÔNG abort), reconcile KHÔNG throw.
 *   E4 — reconcileAllCompanies() (enumerate qua withPlatformContext) bao gồm company test, KHÔNG throw.
 */

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../db/db.service";
import { companySettings } from "../../db/schema/settings";
import { directPool, hasDb } from "../../../test/helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../../../test/helpers/seed";
import { MasterDataSeedRunner } from "./master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "./master-data-seeder.registry";
import type { MasterDataSeedContext, ModuleMasterDataSeeder } from "./master-data-seeder.types";
import { SeedTrackingService } from "./seed-tracking.service";
import type { MarkItemResult } from "./seed-tracking.types";

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

const TAG = randomUUID().slice(0, 8);
const GOOD_KEY = `test.seedrun.good.${TAG}`;
const BAD_KEY = `test.seedrun.bad.${TAG}`;
const SETTING_KEY = `seedrun-test-${TAG}`;

async function countSeedBatches(direct: Pool, companyId: string, seedKey: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM seed_batches WHERE company_id = $1 AND seed_key = $2",
    [companyId, seedKey],
  );
  return r.rows[0].n as number;
}

async function getBatch(
  direct: Pool,
  companyId: string,
  seedKey: string,
): Promise<{ id: string; status: string } | undefined> {
  const r = await direct.query(
    "SELECT id, status FROM seed_batches WHERE company_id = $1 AND seed_key = $2 LIMIT 1",
    [companyId, seedKey],
  );
  return r.rows[0];
}

async function countSeedItems(direct: Pool, batchId: string, targetTable: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM seed_items WHERE seed_batch_id = $1 AND target_table = $2",
    [batchId, targetTable],
  );
  return r.rows[0].n as number;
}

async function countCompanySettings(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM company_settings WHERE company_id = $1 AND setting_key = $2",
    [companyId, SETTING_KEY],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!runDb)("S3-FND-SEEDRUN-1 master-data seed runner (DB, app role)", () => {
  let direct: Pool;
  let A: SeededTenant;
  let runner: MasterDataSeedRunner;
  let allowed: Set<string>;
  // track() trả về của good seeder ở lần chạy GẦN NHẤT cho company test (assert Success → Skipped).
  let lastGoodTrack: MarkItemResult | undefined;

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "seedrun");
    allowed = new Set([A.companyId]);

    const goodSeeder: ModuleMasterDataSeeder = {
      seedKey: GOOD_KEY,
      seedVersion: "v1",
      seed: async (ctx: MasterDataSeedContext) => {
        // Guard: CHỈ tác động company test (reconcileAllCompanies quét mọi company — tránh nhiễu suite khác).
        if (!allowed.has(ctx.companyId)) return;
        // Domain INSERT trong TENANT TX do runner cấp (RLS WITH CHECK ép company_id) — idempotent ON CONFLICT.
        await ctx.tx
          .insert(companySettings)
          .values({
            companyId: ctx.companyId,
            settingKey: SETTING_KEY,
            settingValue: { tag: TAG },
            valueType: "JSON",
            category: "seed-test",
            moduleCode: "TEST",
          })
          .onConflictDoNothing();
        // track per-row — payload ỔN ĐỊNH giữa các lần ⇒ lần 2 checksum không đổi ⇒ Skipped.
        lastGoodTrack = await ctx.track({
          targetTable: "company_settings",
          targetKey: SETTING_KEY,
          operation: "Upsert",
          payload: { tag: TAG, key: SETTING_KEY },
        });
      },
    };

    const badSeeder: ModuleMasterDataSeeder = {
      seedKey: BAD_KEY,
      seedVersion: "v1",
      seed: async (ctx: MasterDataSeedContext) => {
        if (!allowed.has(ctx.companyId)) return;
        throw new Error("intentional seeder failure (fail-safe test)");
      },
    };

    const dbsvc = new DatabaseService();
    const tracking = new SeedTrackingService(dbsvc);
    const registry = new MasterDataSeederRegistry();
    // bad ĐĂNG KÝ TRƯỚC → chứng minh good vẫn chạy dù bad throw.
    registry.register(badSeeder);
    registry.register(goodSeeder);
    runner = new MasterDataSeedRunner(dbsvc, tracking, registry);
  });

  afterAll(async () => {
    if (direct) {
      await direct.query(
        "DELETE FROM seed_items WHERE seed_batch_id IN (SELECT id FROM seed_batches WHERE seed_key = ANY($1))",
        [[GOOD_KEY, BAD_KEY]],
      );
      await direct.query("DELETE FROM seed_batches WHERE seed_key = ANY($1)", [
        [GOOD_KEY, BAD_KEY],
      ]);
      await direct.query("DELETE FROM company_settings WHERE setting_key = $1", [SETTING_KEY]);
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
    }
  });

  it("G1 — reconcileAllCompanies(): good seeder chạy → company_settings + seed_items ghi (Success)", async () => {
    const summary = await runner.reconcileAllCompanies();
    // Company test có trong enumerate (qua withPlatformContext).
    expect(summary.companiesScanned).toBeGreaterThanOrEqual(1);

    // Domain row tồn tại (đúng 1).
    expect(await countCompanySettings(direct, A.companyId)).toBe(1);

    // track ghi seed_items cho good batch.
    const goodBatch = await getBatch(direct, A.companyId, GOOD_KEY);
    expect(goodBatch).toBeTruthy();
    expect(goodBatch?.status).toBe("Success");
    expect(await countSeedItems(direct, goodBatch!.id, "company_settings")).toBe(1);

    // track() lần đầu = Success.
    expect(lastGoodTrack?.status).toBe("Success");
  });

  it("F3 — bad seeder Failed nhưng KHÔNG abort good (batch bad=Failed + sentinel item)", async () => {
    const badBatch = await getBatch(direct, A.companyId, BAD_KEY);
    expect(badBatch).toBeTruthy();
    expect(badBatch?.status).toBe("Failed");
    // Sentinel item Failed (target_table='(seeder)') để truy vết.
    expect(await countSeedItems(direct, badBatch!.id, "(seeder)")).toBe(1);

    // Good vẫn Success (chứng minh không bị bad chặn).
    const goodBatch = await getBatch(direct, A.companyId, GOOD_KEY);
    expect(goodBatch?.status).toBe("Success");
  });

  it("I2 — chạy lại idempotent: batch reused, markItem Skipped, KHÔNG dup row", async () => {
    const before = await getBatch(direct, A.companyId, GOOD_KEY);

    const summary = await runner.reconcileAllCompanies();
    expect(summary).toBeTruthy(); // KHÔNG throw

    // Batch reused (cùng id, vẫn 1 row).
    const after = await getBatch(direct, A.companyId, GOOD_KEY);
    expect(after?.id).toBe(before?.id);
    expect(await countSeedBatches(direct, A.companyId, GOOD_KEY)).toBe(1);

    // markItem checksum không đổi ⇒ Skipped (track trả 'Skipped').
    expect(lastGoodTrack?.status).toBe("Skipped");

    // KHÔNG dup domain row / seed_items.
    expect(await countCompanySettings(direct, A.companyId)).toBe(1);
    expect(await countSeedItems(direct, after!.id, "company_settings")).toBe(1);
  });

  it("E4 — reconcileCompany(1 company) chạy mọi seeder, KHÔNG throw", async () => {
    const outcomes = await runner.reconcileCompany(A.companyId);
    expect(outcomes.map((o) => o.seedKey).sort()).toEqual([BAD_KEY, GOOD_KEY].sort());
    expect(outcomes.find((o) => o.seedKey === GOOD_KEY)?.ok).toBe(true);
    expect(outcomes.find((o) => o.seedKey === BAD_KEY)?.ok).toBe(false);
  });
});
