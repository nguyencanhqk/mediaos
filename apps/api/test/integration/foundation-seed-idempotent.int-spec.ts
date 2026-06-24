import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * FOUNDATION-BE-8 — SeedTrackingService idempotent THẬT ở tầng DB (RLS+FORCE + uq).
 *  - startBatch 2 lần cùng (company,seedKey,seedVersion) ⇒ CHỈ 1 row seed_batches (uq DB ép), reused=true.
 *  - markItem 2 lần cùng (batch,table,key) ⇒ CHỈ 1 row seed_items; lần 2 checksum không đổi ⇒ Skipped.
 *  Khẳng định idempotent ở DB, KHÔNG chỉ mock.
 */
describe.skipIf(!hasDb)("FOUNDATION-BE-8 seed tracking idempotent (DB)", () => {
  const direct = directPool();
  const app = appPool();
  const svc = new SeedTrackingService(new DatabaseService());

  let A: SeededTenant;

  beforeAll(async () => {
    A = await seedCompany(direct, "be8-seed");
  });

  afterAll(async () => {
    // Xoá tường minh con→cha (company_id ON DELETE CASCADE cũng phủ qua cleanupTenants).
    await direct.query("DELETE FROM seed_items WHERE company_id = $1", [A.companyId]);
    await direct.query("DELETE FROM seed_batches WHERE company_id = $1", [A.companyId]);
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
  });

  it("startBatch 2 lần cùng key ⇒ 1 row seed_batches + reused=true", async () => {
    const input = {
      companyId: A.companyId,
      seedKey: "be8.modules.catalog",
      seedVersion: "v1",
    };
    const first = await svc.startBatch(input);
    const second = await svc.startBatch(input);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.id).toBe(first.id);

    const count = await new DatabaseService().withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`select count(*)::int as n from seed_batches where company_id = ${A.companyId} and seed_key = ${input.seedKey} and seed_version = ${input.seedVersion}`,
      );
      return (r.rows[0] as { n: number }).n;
    });
    expect(count).toBe(1);
  });

  it("markItem 2 lần cùng key: 1 row seed_items; lần 2 checksum không đổi ⇒ Skipped", async () => {
    const batch = await svc.startBatch({
      companyId: A.companyId,
      seedKey: "be8.modules.catalog",
      seedVersion: "v1",
    });

    const itemInput = {
      companyId: A.companyId,
      batchId: batch.id,
      targetTable: "modules",
      targetKey: "AUTH",
      operation: "Upsert" as const,
      payload: { name: "AUTH", sort: 1 },
    };

    const r1 = await svc.markItem(itemInput);
    const r2 = await svc.markItem(itemInput);

    expect(r1.status).toBe("Success");
    expect(r2.status).toBe("Skipped");
    expect(r2.operation).toBe("Skip");

    const count = await new DatabaseService().withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`select count(*)::int as n from seed_items where seed_batch_id = ${batch.id} and target_table = 'modules' and target_key = 'AUTH'`,
      );
      return (r.rows[0] as { n: number }).n;
    });
    expect(count).toBe(1);
  });

  it("markItem checksum ĐỔI ⇒ Update, vẫn 1 row (cùng key)", async () => {
    const batch = await svc.startBatch({
      companyId: A.companyId,
      seedKey: "be8.modules.catalog",
      seedVersion: "v1",
    });

    await svc.markItem({
      companyId: A.companyId,
      batchId: batch.id,
      targetTable: "modules",
      targetKey: "HR",
      payload: { name: "HR", sort: 2 },
    });
    const updated = await svc.markItem({
      companyId: A.companyId,
      batchId: batch.id,
      targetTable: "modules",
      targetKey: "HR",
      payload: { name: "HR-renamed", sort: 2 },
    });

    expect(updated.operation).toBe("Update");

    const count = await new DatabaseService().withTenant(A.companyId, async (tx) => {
      const r = await tx.execute(
        sql`select count(*)::int as n from seed_items where seed_batch_id = ${batch.id} and target_table = 'modules' and target_key = 'HR'`,
      );
      return (r.rows[0] as { n: number }).n;
    });
    expect(count).toBe(1);
  });

  it("finishBatch suy status Success khi không có item Failed", async () => {
    const batch = await svc.startBatch({
      companyId: A.companyId,
      seedKey: "be8.finish.ok",
      seedVersion: "v1",
    });
    await svc.markItem({
      companyId: A.companyId,
      batchId: batch.id,
      targetTable: "modules",
      targetKey: "TASK",
      payload: { name: "TASK" },
    });
    const res = await svc.finishBatch(A.companyId, batch.id);
    expect(res.status).toBe("Success");
  });
});
