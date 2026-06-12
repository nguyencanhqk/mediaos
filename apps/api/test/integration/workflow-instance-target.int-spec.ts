import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedWorkflowDefinition, type SeededTenant } from "../helpers/seed";

/**
 * G7-3a (0034) — workflow_instances target CHECK: đúng-một (content_item XOR project).
 * Dùng superuser direct (bypass RLS) để kiểm CHECK ở tầng DB; G4-3 instance cũ (content set) vẫn thoả.
 */
describe.skipIf(!hasDb)("G7-3a workflow_instances exactly-one target (content_item XOR project)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let defId: string;
  let contentItemId: string;
  let projectId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "g73a");
    defId = await seedWorkflowDefinition(direct, A.companyId);
    const prj = await direct.query(
      `INSERT INTO projects (company_id, name, status) VALUES ($1, 'g73a-prj', 'active') RETURNING id`,
      [A.companyId],
    );
    projectId = prj.rows[0].id as string;
    const ci = await direct.query(
      `INSERT INTO content_items (company_id, project_id, title, status)
       VALUES ($1, $2, 'g73a-ci', 'draft') RETURNING id`,
      [A.companyId, projectId],
    );
    contentItemId = ci.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  function insertInstance(contentId: string | null, projId: string | null) {
    return direct.query(
      `INSERT INTO workflow_instances
         (company_id, workflow_definition_id, content_item_id, project_id, current_step_order, status)
       VALUES ($1, $2, $3, $4, 1, 'active') RETURNING id`,
      [A.companyId, defId, contentId, projId],
    );
  }

  it("cả hai NULL → CHECK reject", async () => {
    await expect(insertInstance(null, null)).rejects.toThrow(/wf_instances_target_check/);
  });

  it("cả hai set → CHECK reject", async () => {
    await expect(insertInstance(contentItemId, projectId)).rejects.toThrow(/wf_instances_target_check/);
  });

  it("chỉ content_item (kiểu G4-3 cũ) → ok", async () => {
    const r = await insertInstance(contentItemId, null);
    expect(r.rows[0].id).toBeDefined();
  });

  it("chỉ project (kiểu G7 mới) → ok", async () => {
    const r = await insertInstance(null, projectId);
    expect(r.rows[0].id).toBeDefined();
  });
});
