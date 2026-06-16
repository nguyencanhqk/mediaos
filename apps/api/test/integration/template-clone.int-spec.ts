import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { TemplateRepository } from "../../src/templates/template.repository";
import { TemplateCloneService } from "../../src/templates/template-clone.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * G16-3 DONE-CRITERION: "clone template được cho công ty khác." TemplateCloneService THẬT (Postgres, RLS).
 *
 *  (a) clone starter → 4 roles (+permissions), 1 workflow (3 steps + 7 transitions), 4 dashboards.
 *  (b) idempotent — re-apply tạo 0 row mới, KHÔNG nhân đôi.
 *  (c) RLS-isolated — công ty B KHÔNG thấy role đã clone của công ty A.
 *  (d) template không tồn tại → NotFound (fail-loud).
 */
describe.skipIf(!hasDb)("G16-3 template clone (provision workspace from starter)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let db: DatabaseService;
  let repo: TemplateRepository;
  let clone: TemplateCloneService;

  beforeAll(async () => {
    A = await seedCompany(direct, "tplA");
    B = await seedCompany(direct, "tplB");
    db = new DatabaseService();
    repo = new TemplateRepository();
    clone = new TemplateCloneService(db, repo, new AuditService());
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("(a) clones starter → roles(+permissions) + workflow(+steps+transitions) + dashboards", async () => {
    const res = await clone.applyTemplate(A.companyId, "starter", null);
    expect(res.rolesCreated).toBe(4);
    expect(res.workflowsCreated).toBe(1);
    expect(res.dashboardsCreated).toBe(4);
    expect(res.alreadyProvisioned).toBe(false);

    const roles = await direct.query(
      "SELECT id, name FROM roles WHERE company_id=$1 AND is_system=false ORDER BY name",
      [A.companyId],
    );
    expect(roles.rows.map((r) => r.name)).toEqual([
      "content-creator",
      "content-reviewer",
      "content-uploader",
      "workspace-manager",
    ]);

    // workspace-manager có 8 permission grant (blueprint).
    const wm = roles.rows.find((r) => r.name === "workspace-manager")!;
    const wmPerms = await direct.query(
      "SELECT count(*)::int AS c FROM role_permissions WHERE role_id=$1 AND effect='ALLOW'",
      [wm.id],
    );
    expect(wmPerms.rows[0].c).toBe(8);

    const wf = await direct.query(
      "SELECT id, status FROM workflow_definitions WHERE company_id=$1 AND code='content_pipeline'",
      [A.companyId],
    );
    expect(wf.rowCount).toBe(1);
    expect(wf.rows[0].status).toBe("published");
    const wfId = wf.rows[0].id as string;

    const steps = await direct.query(
      "SELECT count(*)::int AS c FROM workflow_definition_steps WHERE workflow_definition_id=$1",
      [wfId],
    );
    expect(steps.rows[0].c).toBe(3);

    const trans = await direct.query(
      "SELECT count(*)::int AS c FROM step_transitions WHERE workflow_definition_id=$1",
      [wfId],
    );
    expect(trans.rows[0].c).toBe(7);

    const dash = await direct.query(
      "SELECT count(*)::int AS c FROM dashboard_configs WHERE company_id=$1 AND deleted_at IS NULL",
      [A.companyId],
    );
    expect(dash.rows[0].c).toBe(4);
  });

  it("(b) is idempotent — re-apply creates nothing new (no duplicates)", async () => {
    const res = await clone.applyTemplate(A.companyId, "starter", null);
    expect(res.rolesCreated).toBe(0);
    expect(res.workflowsCreated).toBe(0);
    expect(res.dashboardsCreated).toBe(0);
    expect(res.alreadyProvisioned).toBe(true);

    const roles = await direct.query(
      "SELECT count(*)::int AS c FROM roles WHERE company_id=$1 AND is_system=false",
      [A.companyId],
    );
    expect(roles.rows[0].c).toBe(4);
    const dash = await direct.query(
      "SELECT count(*)::int AS c FROM dashboard_configs WHERE company_id=$1 AND deleted_at IS NULL",
      [A.companyId],
    );
    expect(dash.rows[0].c).toBe(4);
  });

  it("(c) cloned rows are RLS-isolated — company B cannot see company A's cloned role", async () => {
    const hiddenFromB = await db.withTenant(B.companyId, (tx) =>
      repo.findCompanyRoleByName(tx, A.companyId, "workspace-manager"),
    );
    expect(hiddenFromB).toBeUndefined();

    const visibleInA = await db.withTenant(A.companyId, (tx) =>
      repo.findCompanyRoleByName(tx, A.companyId, "workspace-manager"),
    );
    expect(visibleInA).toBeDefined();
  });

  it("(d) unknown template → NotFound (fail-loud)", async () => {
    await expect(clone.applyTemplate(A.companyId, "does-not-exist", null)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
