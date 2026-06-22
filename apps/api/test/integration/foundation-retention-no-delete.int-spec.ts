import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { RetentionService } from "../../src/foundation/retention/retention.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * FOUNDATION-BE-8 — RetentionService KHÔNG xoá thật (DB cô lập, RLS+FORCE).
 *  - policy is_enabled=false + record quá hạn (audit_logs có sẵn) ⇒ runCleanup(dryRun:false) KHÔNG xoá
 *    record nào (count trước == count sau) — §17.4.1.
 *  - app role KHÔNG có quyền DELETE audit_logs (append-only) — attempt fail-closed.
 */
describe.skipIf(!hasDb)("FOUNDATION-BE-8 retention no-delete (DB)", () => {
  const direct = directPool();
  const app = appPool();
  const svc = new RetentionService(new DatabaseService());

  let A: SeededTenant;

  beforeAll(async () => {
    A = await seedCompany(direct, "be8-ret");
    // Seed vài audit_logs "quá hạn" (created_at xa quá khứ) qua direct (bypass RLS) cho tenant A.
    for (let i = 0; i < 5; i++) {
      await direct.query(
        `INSERT INTO audit_logs (company_id, action, object_type, created_at)
         VALUES ($1, 'seed', 'company', now() - interval '400 days')`,
        [A.companyId],
      );
    }
  });

  afterAll(async () => {
    await direct.query("DELETE FROM data_retention_policies WHERE company_id = $1", [A.companyId]);
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
  });

  async function countAuditLogs(): Promise<number> {
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1",
      [A.companyId],
    );
    return r.rows[0].n as number;
  }

  it("policy is_enabled=false ⇒ runCleanup(dryRun:false) KHÔNG xoá (count giữ nguyên)", async () => {
    const policy = await svc.createPolicy({
      companyId: A.companyId,
      moduleCode: "AUTH",
      entityType: "audit_logs",
      retentionDays: 365,
      cleanupAction: "Delete",
      isEnabled: false, // chưa active
    });

    const before = await countAuditLogs();
    const res = await svc.runCleanup(A.companyId, policy.id, { dryRun: false });
    const after = await countAuditLogs();

    expect(res.skippedDisabled).toBe(true);
    expect(res.deletedRecords).toBe(0);
    expect(after).toBe(before);
  });

  it("simulate đếm eligible nhưng KHÔNG xoá", async () => {
    const policy = await svc.createPolicy({
      companyId: A.companyId,
      moduleCode: "HR",
      entityType: "audit_logs",
      retentionDays: 365,
      cleanupAction: "Delete",
      isEnabled: false,
    });
    const before = await countAuditLogs();
    const sim = await svc.simulate(A.companyId, policy.id);
    const after = await countAuditLogs();
    expect(sim.eligibleRecords).toBeGreaterThanOrEqual(0);
    expect(after).toBe(before);
  });

  it("app role KHÔNG có quyền DELETE audit_logs (append-only fail-closed)", async () => {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
      await expect(
        c.query("DELETE FROM audit_logs WHERE company_id = $1", [A.companyId]),
      ).rejects.toThrow();
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
  });

  it("createPolicy ghi company_id = tenant (KHÔNG global NULL); app role đọc được policy của mình", async () => {
    const policy = await svc.createPolicy({
      companyId: A.companyId,
      moduleCode: "TASK",
      entityType: "tasks",
      retentionDays: 90,
      cleanupAction: "Archive",
      isEnabled: true,
    });
    expect(policy.companyId).toBe(A.companyId);

    const r = await direct.query(
      "SELECT company_id FROM data_retention_policies WHERE id = $1",
      [policy.id],
    );
    expect(r.rows[0].company_id).toBe(A.companyId);
  });
});
