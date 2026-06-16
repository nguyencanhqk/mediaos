import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { SaasRepository } from "../../src/saas/saas.repository";
import { SubscriptionService } from "../../src/saas/subscription.service";
import { TemplateRepository } from "../../src/templates/template.repository";
import { TemplateCloneService } from "../../src/templates/template-clone.service";
import { PlatformCompanyRepository } from "../../src/platform/platform-company.repository";
import { PlatformCompanyService } from "../../src/platform/platform-company.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, seedUserRole, type SeededTenant } from "../helpers/seed";

const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001";
const PLATFORM_ADMIN_ROLE = "00000000-0000-0000-0000-0000000000f0";

/**
 * G16-3 platform tier (ADR-0017) — quản vòng đời tenant chéo công ty THẬT (Postgres, RLS escape-hatch).
 *
 *  (a) create → công ty + subscription(free) + provision template ATOMIC; list (escape-hatch) thấy nó.
 *  (b) escape-hatch DEFAULT-DENY — withTenant(A) KHÔNG thấy công ty khác (chỉ list mới qua platform context).
 *  (c) suspend → status='suspended' (KHÔNG hard-delete).
 *  (d) AUTHZ deny-path — quyền platform-company is_sensitive: company-admin DENY, platform-admin ALLOW.
 */
describe.skipIf(!hasDb)("G16-3 platform company management", () => {
  const direct = directPool();
  let A: SeededTenant;
  let paActor: { id: string; companyId: string }; // platform-admin
  let caUser: string; // company-admin
  let svc: PlatformCompanyService;
  let permission: PermissionService;
  const createdCompanyIds: string[] = [];

  beforeAll(async () => {
    A = await seedCompany(direct, "platA");

    const paUser = await seedUser(direct, A.companyId, `pa-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, paUser, PLATFORM_ADMIN_ROLE, A.companyId);
    paActor = { id: paUser, companyId: A.companyId };

    caUser = await seedUser(direct, A.companyId, `ca-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, caUser, COMPANY_ADMIN_ROLE, A.companyId);

    const db = new DatabaseService();
    const audit = new AuditService();
    const saasRepo = new SaasRepository();
    const subs = new SubscriptionService(db, saasRepo, audit);
    const clone = new TemplateCloneService(db, new TemplateRepository(), audit);
    svc = new PlatformCompanyService(db, new PlatformCompanyRepository(), audit, subs, clone);
    permission = new PermissionService(new PermissionRepository(db));
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, ...createdCompanyIds]);
    await direct.end();
  });

  it("(a) create → company active + free subscription + provisioned; appears in platform list", async () => {
    const slug = `plat-${randomUUID().slice(0, 8)}`;
    const result = await svc.create(paActor, { name: "Acme Co", slug });
    createdCompanyIds.push(result.company.id);

    expect(result.company.status).toBe("active");
    expect(result.company.slug).toBe(slug);
    expect(result.provision?.rolesCreated).toBe(4);

    // subscription = free
    const sub = await direct.query(
      `SELECT p.code FROM company_subscriptions cs
         JOIN subscription_plans p ON p.id = cs.plan_id
        WHERE cs.company_id=$1 AND cs.deleted_at IS NULL`,
      [result.company.id],
    );
    expect(sub.rows[0].code).toBe("free");

    // provisioned dashboards exist
    const dash = await direct.query(
      "SELECT count(*)::int AS c FROM dashboard_configs WHERE company_id=$1",
      [result.company.id],
    );
    expect(dash.rows[0].c).toBe(4);

    // platform list (escape-hatch) sees it
    const list = await svc.list({ page: 1, limit: 100 });
    expect(list.items.some((c) => c.id === result.company.id)).toBe(true);
  });

  it("(b) escape-hatch default-deny — withTenant(A) cannot see another company", async () => {
    const slug = `plat-${randomUUID().slice(0, 8)}`;
    const created = await svc.create(paActor, { name: "Hidden Co", slug });
    createdCompanyIds.push(created.company.id);

    const db = new DatabaseService();
    const repo = new PlatformCompanyRepository();
    // In tenant A context (no platform GUC) the other company is invisible (RLS).
    const seenFromA = await db.withTenant(A.companyId, (tx) => repo.findById(tx, created.company.id));
    expect(seenFromA).toBeUndefined();
    // get-one (withTenant(targetId)) DOES see it (id = current).
    const viaGetOne = await svc.getOne(created.company.id);
    expect(viaGetOne.id).toBe(created.company.id);
  });

  it("(c) suspend → status suspended (no hard-delete)", async () => {
    const slug = `plat-${randomUUID().slice(0, 8)}`;
    const created = await svc.create(paActor, { name: "Suspend Co", slug });
    createdCompanyIds.push(created.company.id);

    const suspended = await svc.suspend(paActor, created.company.id);
    expect(suspended.status).toBe("suspended");

    const row = await direct.query("SELECT status, deleted_at FROM companies WHERE id=$1", [
      created.company.id,
    ]);
    expect(row.rows[0].status).toBe("suspended");
    expect(row.rows[0].deleted_at).toBeNull(); // suspend ≠ delete
  });

  it("(d) authz: platform-company is sensitive — company-admin DENY, platform-admin ALLOW", async () => {
    const caDecision = await permission.can({
      userId: caUser,
      companyId: A.companyId,
      action: "manage",
      resourceType: "platform-company",
      isSensitive: true,
    });
    expect(caDecision.allow).toBe(false);

    const paManage = await permission.can({
      userId: paActor.id,
      companyId: A.companyId,
      action: "manage",
      resourceType: "platform-company",
      isSensitive: true,
    });
    expect(paManage.allow).toBe(true);

    const paView = await permission.can({
      userId: paActor.id,
      companyId: A.companyId,
      action: "view",
      resourceType: "platform-company",
      isSensitive: true,
    });
    expect(paView.allow).toBe(true);
  });
});
