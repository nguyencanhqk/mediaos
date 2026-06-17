import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { SaasRepository } from "../../src/saas/saas.repository";
import { SubscriptionService } from "../../src/saas/subscription.service";
import { OperatorActionAuditService } from "../../src/platform/operator-action-audit.service";
import { PlatformEntitlementsService } from "../../src/platform/platform-entitlements.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const FEATURE_KEY = "custom_workflows";
const METRIC_KEY = "max_channels";

/**
 * AC-2 platform-entitlements cross-tenant leak + operator-audit (DB cô lập mediaos_ac2) —
 * operator A đặt feature-flag / usage-limit CHO tenant B:
 *
 *  (1) feature-flag override CHỈ vào company_feature_flags của B (A/C không bị chạm) ⇒ getEffectiveEntitlements(B)
 *      phản ánh override, getEffectiveEntitlements(C) KHÔNG đổi (RLS không rò chéo).
 *  (2) usage-limit override CHỈ vào company_usage_limits của B; getEffectiveEntitlements(B) phản ánh, C không.
 *  (3) audit_logs có 1 row company_id=B actor=operator action='operator.feature_flag_set'/'operator.usage_limit_set'
 *      (recordOperatorAction CÙNG tx — company_id = B do GUC tx = B).
 *  (4) withTenant(C) thấy 0 audit row của B (RLS không rò chéo).
 *
 * Dùng service THẬT (withTenant(B) + recordOperatorAction cùng tx). B/C đều gán gói 'pro' để có entitlement
 * nền; override 'custom_workflows' chỉ áp cho B.
 */
describe.skipIf(!hasDb)("AC-2 platform-entitlements cross-tenant", () => {
  const direct = directPool();
  let B: SeededTenant; // target tenant
  let C: SeededTenant; // bystander tenant
  let operatorId: string;
  let svc: PlatformEntitlementsService;
  let subscriptions: SubscriptionService;

  async function assignPlan(companyId: string, planCode: string): Promise<void> {
    const db = new DatabaseService();
    const repo = new SaasRepository();
    await db.withTenant(companyId, async (tx) => {
      const sub = new SubscriptionService(db, repo, new AuditService());
      await sub.assignPlanInTx(tx, null, companyId, planCode);
    });
  }

  beforeAll(async () => {
    B = await seedCompany(direct, "entB");
    C = await seedCompany(direct, "entC");
    operatorId = await seedUser(direct, B.companyId, `op-${randomUUID().slice(0, 8)}@a.test`);

    await assignPlan(B.companyId, "pro");
    await assignPlan(C.companyId, "pro");

    const db = new DatabaseService();
    subscriptions = new SubscriptionService(db, new SaasRepository(), new AuditService());
    svc = new PlatformEntitlementsService(
      db,
      new SaasRepository(),
      new AuditService(),
      new OperatorActionAuditService(new AuditService()),
      subscriptions,
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [B.companyId, C.companyId]);
    await direct.end();
  });

  it("(1) operator đặt feature-flag override CHO B ⇒ override chỉ ở B (A/C không chạm)", async () => {
    await svc.setFeatureFlag({ id: operatorId, companyId: B.companyId }, B.companyId, {
      featureKey: FEATURE_KEY,
      enabled: false,
    });

    const inB = await direct.query(
      "SELECT enabled FROM company_feature_flags WHERE company_id=$1 AND feature_key=$2",
      [B.companyId, FEATURE_KEY],
    );
    expect(inB.rows[0]?.enabled).toBe(false);

    const inC = await direct.query(
      "SELECT enabled FROM company_feature_flags WHERE company_id=$1 AND feature_key=$2",
      [C.companyId, FEATURE_KEY],
    );
    expect(inC.rows).toHaveLength(0);

    // getEffectiveEntitlements(B) phản ánh override=false; (C) vẫn = plan 'pro' (không có override).
    const entB = await svc.getEntitlements(B.companyId);
    expect(entB.features.find((f) => f.featureKey === FEATURE_KEY)).toMatchObject({
      enabled: false,
      source: "override",
    });
    const entC = await svc.getEntitlements(C.companyId);
    const fC = entC.features.find((f) => f.featureKey === FEATURE_KEY);
    expect(fC?.source).not.toBe("override");
  });

  it("(2) operator đặt usage-limit override CHO B ⇒ override chỉ ở B; effective(B) phản ánh", async () => {
    await svc.setUsageLimit({ id: operatorId, companyId: B.companyId }, B.companyId, {
      metricKey: METRIC_KEY,
      limitValue: 42,
    });

    const inB = await direct.query(
      "SELECT limit_value FROM company_usage_limits WHERE company_id=$1 AND metric_key=$2",
      [B.companyId, METRIC_KEY],
    );
    expect(Number(inB.rows[0]?.limit_value)).toBe(42);

    const inC = await direct.query(
      "SELECT limit_value FROM company_usage_limits WHERE company_id=$1 AND metric_key=$2",
      [C.companyId, METRIC_KEY],
    );
    expect(inC.rows).toHaveLength(0);

    const entB = await svc.getEntitlements(B.companyId);
    expect(entB.limits.find((l) => l.metricKey === METRIC_KEY)).toMatchObject({
      limit: 42,
      source: "override",
    });
  });

  it("(3) audit_logs có row company_id=B actor=operator cho feature_flag_set & usage_limit_set", async () => {
    const ff = await direct.query(
      `SELECT company_id, actor_user_id, object_type, after
         FROM audit_logs WHERE action='operator.feature_flag_set' AND company_id=$1`,
      [B.companyId],
    );
    expect(ff.rows).toHaveLength(1);
    expect(ff.rows[0].company_id).toBe(B.companyId);
    expect(ff.rows[0].actor_user_id).toBe(operatorId);
    expect(ff.rows[0].object_type).toBe("company");
    expect(ff.rows[0].after).toMatchObject({ featureKey: FEATURE_KEY, enabled: false });

    const ul = await direct.query(
      `SELECT company_id, actor_user_id, object_type, after
         FROM audit_logs WHERE action='operator.usage_limit_set' AND company_id=$1`,
      [B.companyId],
    );
    expect(ul.rows).toHaveLength(1);
    expect(ul.rows[0].company_id).toBe(B.companyId);
    expect(ul.rows[0].actor_user_id).toBe(operatorId);
    expect(ul.rows[0].after).toMatchObject({ metricKey: METRIC_KEY, limitValue: 42 });
  });

  it("(4) withTenant(C) thấy 0 audit row operator-entitlement của B (RLS không rò chéo)", async () => {
    const db = new DatabaseService();
    const seen = await db.withTenant(C.companyId, async (tx) => {
      const r = await tx.execute(
        sql`SELECT count(*)::int AS c FROM audit_logs
              WHERE action IN ('operator.feature_flag_set','operator.usage_limit_set')`,
      );
      return (r.rows[0] as { c: number }).c;
    });
    expect(seen).toBe(0);
  });
});
