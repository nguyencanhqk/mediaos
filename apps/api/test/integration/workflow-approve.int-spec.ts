import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { WorkflowFsmService } from "../../src/workflow/workflow-fsm.service";
import { WorkflowRepository } from "../../src/workflow/workflow.repository";
import { WorkflowService } from "../../src/workflow/workflow.service";
import { ApprovalService } from "../../src/workflow/approval.service";
import { WorkflowTemplatesRepository } from "../../src/workflow/workflow-templates.repository";
import { WorkflowTemplatesService } from "../../src/workflow/workflow-templates.service";
import { DagValidatorService } from "../../src/workflow/dag-validator.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G7-3c-ii — ApprovalService.approve() generalised to the DAG (Postgres thật, RLS app role).
 *
 * RED-first: these assert the DAG behaviour that the linear pointer model (findMaxStepOrder +
 * advanceInstanceStepOrder + isLastStep=stepOrder>=max) CANNOT satisfy:
 *   FS2  fork  A→{B,C}: approve A opens BOTH B and C (2 tasks).
 *   FS3  join  {B,C}→D: approve B (C pending) leaves D closed; approve C opens D.
 *   FS7  complete is driven by "all required approved", NOT by max step_order
 *        (pure fork; the completing approval is a non-max-order step).
 *   FS6  replay a closed approval request → 409, no duplicate task, no double complete
 *        (regression guard; the 409 path already exists pre-3c-ii).
 *
 * Helpers (publishedTemplate / seedContentItem / taskCountForStep / stepIdByNodeKey) mirror
 * workflow-apply.int-spec.ts; left local for now — DRY-extract once a 3rd spec needs them.
 */
describe.skipIf(!hasDb)("G7-3c-ii approve() over DAG", () => {
  const direct = directPool();
  let A: SeededTenant;
  let userA: string;
  let svc: WorkflowService;
  let approval: ApprovalService;
  let templates: WorkflowTemplatesService;

  const stepDto = (over: Record<string, unknown> = {}) => ({
    nodeKey: `nk-${randomUUID().slice(0, 8)}`,
    code: `sc-${randomUUID().slice(0, 8)}`,
    name: "Step",
    defaultTaskTitle: "Task title",
    stepType: "task",
    isRequired: true,
    ...over,
  });

  async function seedContentItem(): Promise<string> {
    const prj = await direct.query(
      `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
      [A.companyId, `apr-prj-${randomUUID().slice(0, 8)}`],
    );
    const ci = await direct.query(
      `INSERT INTO content_items (company_id, project_id, title, status) VALUES ($1, $2, 'ci', 'draft') RETURNING id`,
      [A.companyId, prj.rows[0].id],
    );
    return ci.rows[0].id as string;
  }

  /** Build + publish a content_item template with N steps and dep edges (by step index). */
  async function publishedTemplate(steps: number, deps: Array<[number, number]> = []) {
    const t = await templates.createTemplate(A.companyId, userA, {
      code: `apr-${randomUUID().slice(0, 8)}`,
      name: "T",
      appliesTo: "content_item",
    });
    const created = [];
    for (let i = 0; i < steps; i++) created.push(await templates.addStep(A.companyId, userA, t.id, stepDto()));
    for (const [from, to] of deps) {
      await templates.addDependency(A.companyId, userA, t.id, {
        fromStepId: created[from].id,
        toStepId: created[to].id,
        dependencyType: "finish_to_start",
      });
    }
    await templates.publishTemplate(A.companyId, userA, t.id);
    return { t, steps: created };
  }

  async function taskCountForStep(stepId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM tasks WHERE workflow_step_id = $1 AND deleted_at IS NULL`,
      [stepId],
    );
    return r.rows[0].n as number;
  }
  async function stepIdByNodeKey(instanceId: string, nodeKey: string): Promise<string> {
    const r = await direct.query(
      `SELECT id FROM workflow_steps WHERE workflow_instance_id = $1 AND node_key = $2`,
      [instanceId, nodeKey],
    );
    return r.rows[0].id as string;
  }
  async function instanceStatus(instanceId: string): Promise<string> {
    const r = await direct.query(`SELECT status FROM workflow_instances WHERE id = $1`, [instanceId]);
    return r.rows[0].status as string;
  }
  /** assignee NULL after applyTemplate (PM assigns later); start/submit need actor===assignee. */
  async function assignAll(instanceId: string): Promise<void> {
    await direct.query(
      `UPDATE workflow_steps SET assignee_user_id = $1 WHERE workflow_instance_id = $2`,
      [userA, instanceId],
    );
  }

  /** start → submit → approve one step; returns the approve() result. */
  async function drive(stepId: string) {
    await svc.startStep(A.companyId, stepId, userA);
    const sub = await svc.submitStep(A.companyId, stepId, userA, {});
    return approval.approve(A.companyId, (sub as { approvalRequest: { id: string } }).approvalRequest.id, userA);
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "g73cii");
    userA = await seedUser(direct, A.companyId, `g73cii-${randomUUID().slice(0, 8)}@a.test`);
    const db = new DatabaseService();
    templates = new WorkflowTemplatesService(
      db,
      new WorkflowTemplatesRepository(db),
      new AuditService(),
      new DagValidatorService(),
    );
    const repo = new WorkflowRepository(db);
    const fsm = new WorkflowFsmService();
    const audit = new AuditService();
    const outbox = new OutboxService();
    svc = new WorkflowService(db, repo, fsm, audit, outbox);
    approval = new ApprovalService(db, repo, fsm, audit, outbox);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("FS2 fork A→{B,C}: approve A opens BOTH B and C", async () => {
    // A=0, B=1, C=2
    const { t, steps } = await publishedTemplate(3, [
      [0, 1],
      [0, 2],
    ]);
    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await assignAll(instance.id);

    const idA = await stepIdByNodeKey(instance.id, steps[0].nodeKey);
    const idB = await stepIdByNodeKey(instance.id, steps[1].nodeKey);
    const idC = await stepIdByNodeKey(instance.id, steps[2].nodeKey);

    const res = await drive(idA);

    expect(res.isWorkflowComplete).toBe(false);
    expect(await taskCountForStep(idB)).toBe(1); // B opened by fan-out
    expect(await taskCountForStep(idC)).toBe(1); // C opened by fan-out
  });

  it("FS3 join {B,C}→D: D opens only after BOTH B and C approved", async () => {
    // A=0, B=1, C=2, D=3 — diamond
    const { t, steps } = await publishedTemplate(4, [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ]);
    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await assignAll(instance.id);

    const idA = await stepIdByNodeKey(instance.id, steps[0].nodeKey);
    const idB = await stepIdByNodeKey(instance.id, steps[1].nodeKey);
    const idC = await stepIdByNodeKey(instance.id, steps[2].nodeKey);
    const idD = await stepIdByNodeKey(instance.id, steps[3].nodeKey);

    await drive(idA); // opens B, C
    await drive(idB); // C still pending → D must stay closed
    expect(await taskCountForStep(idD)).toBe(0);

    await drive(idC); // both deps approved → D opens
    expect(await taskCountForStep(idD)).toBe(1);
  });

  it("FS7 complete is driven by all-required-approved, NOT max step_order", async () => {
    // pure fork A(order1)→{B(order2), C(order3)}; leaves B,C.
    const { t, steps } = await publishedTemplate(3, [
      [0, 1],
      [0, 2],
    ]);
    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await assignAll(instance.id);

    const idA = await stepIdByNodeKey(instance.id, steps[0].nodeKey);
    const idB = await stepIdByNodeKey(instance.id, steps[1].nodeKey);
    const idC = await stepIdByNodeKey(instance.id, steps[2].nodeKey);

    await drive(idA);
    const afterC = await drive(idC); // C is max order(3) but B still pending → NOT complete
    expect(afterC.isWorkflowComplete).toBe(false);
    expect(await instanceStatus(instance.id)).toBe("active");

    const afterB = await drive(idB); // B is order 2 (< max) but is the last required → completes
    expect(afterB.isWorkflowComplete).toBe(true);
    expect(await instanceStatus(instance.id)).toBe("completed");
  });

  it("FS6 replay a closed approval request → 409, no dup task, no double complete", async () => {
    // linear A→B; approve A twice via the same request id.
    const { t, steps } = await publishedTemplate(2, [[0, 1]]);
    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await assignAll(instance.id);

    const idA = await stepIdByNodeKey(instance.id, steps[0].nodeKey);
    const idB = await stepIdByNodeKey(instance.id, steps[1].nodeKey);

    await svc.startStep(A.companyId, idA, userA);
    const sub = await svc.submitStep(A.companyId, idA, userA, {});
    const reqId = (sub as { approvalRequest: { id: string } }).approvalRequest.id;

    await approval.approve(A.companyId, reqId, userA); // 1st — ok, opens B
    await expect(approval.approve(A.companyId, reqId, userA)).rejects.toBeInstanceOf(ConflictException);

    expect(await taskCountForStep(idB)).toBe(1); // B opened exactly once
    expect(await instanceStatus(instance.id)).toBe("active"); // not completed (B unapproved)
  });
});
