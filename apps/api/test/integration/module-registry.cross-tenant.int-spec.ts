import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { SaasRepository } from "../../src/saas/saas.repository";
import { FeatureFlagService } from "../../src/saas/feature-flag.service";
import { OperatorActionAuditService } from "../../src/platform/operator-action-audit.service";
import { ModuleRegistryRepository } from "../../src/platform/module-registry.repository";
import { ModuleRegistryService } from "../../src/platform/module-registry.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * AC-7 module-registry cross-tenant leak (DB cô lập mediaos_ac7) — operator A bật module CHO tenant B:
 *
 *  (1) audit_logs row có company_id = B (KHÔNG phải A/operator) — forensic operator→tenant.
 *  (2) withTenant(C) thấy 0 audit row của B (RLS không rò chéo).
 *  (3) flag chỉ thay đổi trong company_feature_flags của B (A & C không bị chạm).
 *
 * Dùng module seed 'media' (feature_keys của 0330) — set qua service THẬT (withTenant(B) + recordOperatorAction
 * cùng tx). Audit company_id = B do GUC tx = B (default company_id resolve target).
 */
describe.skipIf(!hasDb)("AC-7 module-registry cross-tenant", () => {
  const direct = directPool();
  let A: SeededTenant; // operator home tenant
  let B: SeededTenant; // target tenant
  let C: SeededTenant; // bystander tenant
  let operatorId: string;
  let svc: ModuleRegistryService;
  let moduleKey: string;
  let moduleFeatureKeys: string[];

  beforeAll(async () => {
    A = await seedCompany(direct, "modA");
    B = await seedCompany(direct, "modB");
    C = await seedCompany(direct, "modC");
    operatorId = await seedUser(direct, A.companyId, `op-${randomUUID().slice(0, 8)}@a.test`);

    const db = new DatabaseService();
    svc = new ModuleRegistryService(
      db,
      new ModuleRegistryRepository(),
      new SaasRepository(),
      new FeatureFlagService(db, new SaasRepository()),
      new OperatorActionAuditService(new AuditService()),
    );

    // Lấy 1 module catalog seed (0330) — không phụ thuộc depends_on để bật trực tiếp.
    const row = await direct.query(
      `SELECT key, feature_keys FROM system_modules
        WHERE coalesce(array_length(depends_on,1),0)=0 AND is_active=true
        ORDER BY display_order LIMIT 1`,
    );
    moduleKey = row.rows[0].key as string;
    moduleFeatureKeys = row.rows[0].feature_keys as string[];
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId, C.companyId]);
    await direct.end();
  });

  it("(1) operator A bật module cho B ⇒ audit row company_id = B, actor = operator", async () => {
    await svc.setModuleEnabled(
      { id: operatorId, companyId: A.companyId },
      B.companyId,
      moduleKey,
      true,
    );

    const audit = await direct.query(
      `SELECT company_id, actor_user_id, object_type, object_id, after
         FROM audit_logs
        WHERE action = 'operator.module_toggled' AND company_id = $1`,
      [B.companyId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].company_id).toBe(B.companyId);
    expect(audit.rows[0].company_id).not.toBe(A.companyId);
    expect(audit.rows[0].actor_user_id).toBe(operatorId);
    expect(audit.rows[0].object_type).toBe("company");
    // object_id = target company (uuid); moduleKey ở payload after (jsonb).
    expect(audit.rows[0].object_id).toBe(B.companyId);
    expect(audit.rows[0].after).toMatchObject({ moduleKey, enabled: true });
  });

  it("(2) withTenant(C) thấy 0 audit row module_toggled của B (RLS không rò chéo)", async () => {
    const db = new DatabaseService();
    const seen = await db.withTenant(C.companyId, async (tx) => {
      // RLS đang ép company_id = C ⇒ row module_toggled của B vô hình.
      const r = await tx.execute(
        sql`SELECT count(*)::int AS c FROM audit_logs WHERE action = 'operator.module_toggled'`,
      );
      return (r.rows[0] as { c: number }).c;
    });
    expect(seen).toBe(0);
  });

  it("(3) flag chỉ đổi trong company_feature_flags của B (A & C không bị chạm)", async () => {
    for (const fk of moduleFeatureKeys) {
      const inB = await direct.query(
        "SELECT enabled FROM company_feature_flags WHERE company_id=$1 AND feature_key=$2",
        [B.companyId, fk],
      );
      expect(inB.rows[0]?.enabled).toBe(true);

      const inA = await direct.query(
        "SELECT enabled FROM company_feature_flags WHERE company_id=$1 AND feature_key=$2",
        [A.companyId, fk],
      );
      expect(inA.rows).toHaveLength(0);

      const inC = await direct.query(
        "SELECT enabled FROM company_feature_flags WHERE company_id=$1 AND feature_key=$2",
        [C.companyId, fk],
      );
      expect(inC.rows).toHaveLength(0);
    }
  });
});
