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
import { LockPropagationService } from "../../src/workflow/lock-propagation.service";
import { WorkflowTemplatesRepository } from "../../src/workflow/workflow-templates.repository";
import { WorkflowTemplatesService } from "../../src/workflow/workflow-templates.service";
import { DagValidatorService } from "../../src/workflow/dag-validator.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G7-4a — LockPropagationService over the DAG (Postgres thật, RLS app role).
 *
 * BR-006/WF-003 "downstream_blocked_by_revision": revision của bước N khoá TRANSITIVE DESCENDANTS
 * của N (KHÔNG khoá nhánh độc lập); re-approve N release lock caused_by=N; bước mở lại chỉ khi
 * KHÔNG còn lock active nào khác (multi-source). RED-first: fail cho tới khi LockPropagationService
 * + requestRevision/approve wiring tồn tại.
 *
 *   LK1 revision N → hậu duệ transitive bị khoá (lock row + start reject).
 *   LK2 nhánh độc lập (không phụ thuộc N) KHÔNG bị khoá + vẫn start được (chống over-lock).
 *   LK3 N re-approved → release lock hậu duệ → hậu duệ mở (auto-task).
 *   LK5 đa-nguồn: D khoá bởi cả B và C; re-approve B nhưng C còn revision → D VẪN khoá (1 lock còn lại).
 *
 * Harness (publishedTemplate / seedContentItem / drive / submitFor …) mirrors workflow-approve.int-spec.ts.
 */
describe.skipIf(!hasDb)("G7-4a LockPropagationService (revision → transitive descendant lock)", () => {
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
      [A.companyId, `lk-prj-${randomUUID().slice(0, 8)}`],
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
      code: `lk-${randomUUID().slice(0, 8)}`,
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
  async function stepStatus(stepId: string): Promise<string> {
    const r = await direct.query(`SELECT status FROM workflow_steps WHERE id = $1`, [stepId]);
    return r.rows[0].status as string;
  }
  /** caused_by_step_id of every ACTIVE lock on `lockedStepId` (released_at IS NULL). */
  async function activeLockCauses(lockedStepId: string): Promise<string[]> {
    const r = await direct.query(
      `SELECT caused_by_step_id FROM workflow_step_instance_locks
       WHERE locked_step_id = $1 AND released_at IS NULL ORDER BY created_at`,
      [lockedStepId],
    );
    return r.rows.map((x) => x.caused_by_step_id as string);
  }
  async function assignAll(instanceId: string): Promise<void> {
    await direct.query(
      `UPDATE workflow_steps SET assignee_user_id = $1, reviewer_user_id = $1 WHERE workflow_instance_id = $2`,
      [userA, instanceId],
    );
  }
  /** start → submit one step; returns the pending approval request id (NOT yet decided). */
  async function submitFor(stepId: string): Promise<string> {
    await svc.startStep(A.companyId, stepId, userA);
    const sub = await svc.submitStep(A.companyId, stepId, userA, {});
    return (sub as { approvalRequest: { id: string } }).approvalRequest.id;
  }
  /** start → submit → approve one step (handles revision→start re-approve via T5). */
  async function drive(stepId: string) {
    return approval.approve(A.companyId, await submitFor(stepId), userA);
  }
  /** start → submit → request_revision one step; returns the revised step. */
  async function reviseStep(stepId: string, description = "fix this") {
    const reqId = await submitFor(stepId);
    return approval.requestRevision(A.companyId, reqId, userA, description);
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "g74a");
    userA = await seedUser(direct, A.companyId, `g74a-${randomUUID().slice(0, 8)}@a.test`);
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
    const locks = new LockPropagationService(repo);
    svc = new WorkflowService(db, repo, fsm, audit, outbox, locks);
    approval = new ApprovalService(db, repo, fsm, audit, outbox, locks);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("LK1 revision A locks transitive descendants {B,C} and blocks their start", async () => {
    // chain A→B→C
    const { t, steps } = await publishedTemplate(3, [
      [0, 1],
      [1, 2],
    ]);
    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await assignAll(instance.id);

    const idA = await stepIdByNodeKey(instance.id, steps[0].nodeKey);
    const idB = await stepIdByNodeKey(instance.id, steps[1].nodeKey);
    const idC = await stepIdByNodeKey(instance.id, steps[2].nodeKey);

    await reviseStep(idA); // A → revision: lock transitive descendants {B, C} caused_by=A

    expect(await activeLockCauses(idB)).toEqual([idA]);
    expect(await activeLockCauses(idC)).toEqual([idA]);
    // Locked descendant cannot start (combined guard: locked AND deps unmet).
    await expect(svc.startStep(A.companyId, idB, userA)).rejects.toBeInstanceOf(ConflictException);
  });

  it("LK2 an independent branch is NOT locked and stays operable (anti over-lock)", async () => {
    // A→B (B dep A); C is an independent root (no dep). Revise A → only B locked, C free.
    const { t, steps } = await publishedTemplate(3, [[0, 1]]);
    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await assignAll(instance.id);

    const idA = await stepIdByNodeKey(instance.id, steps[0].nodeKey);
    const idB = await stepIdByNodeKey(instance.id, steps[1].nodeKey);
    const idC = await stepIdByNodeKey(instance.id, steps[2].nodeKey);

    await reviseStep(idA); // descendants of A = {B} only

    expect(await activeLockCauses(idB)).toEqual([idA]); // B locked
    expect(await activeLockCauses(idC)).toEqual([]); // C independent → NOT locked
    // C is a root with no deps and no lock → still startable.
    const startedC = await svc.startStep(A.companyId, idC, userA);
    expect(startedC.status).toBe("in_progress");
  });

  it("LK3 re-approving A releases its descendant locks and opens the descendant", async () => {
    // linear A→B
    const { t, steps } = await publishedTemplate(2, [[0, 1]]);
    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await assignAll(instance.id);

    const idA = await stepIdByNodeKey(instance.id, steps[0].nodeKey);
    const idB = await stepIdByNodeKey(instance.id, steps[1].nodeKey);

    await reviseStep(idA); // A → revision, lock B caused_by=A
    expect(await activeLockCauses(idB)).toEqual([idA]);

    await drive(idA); // A re-driven: revision→start→submit→approve → release B's lock, open B
    expect(await activeLockCauses(idB)).toEqual([]); // released
    expect(await taskCountForStep(idB)).toBe(1); // B opened by fan-out (deps met, no active lock)
    expect(await stepStatus(idA)).toBe("approved");
  });

  it("LK5 multi-source: D locked by B and C; re-approve B alone keeps D locked by C", async () => {
    // diamond A→{B,C}→D
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

    await drive(idA); // approve A → opens B, C
    await reviseStep(idB); // B → revision: lock D caused_by=B
    await reviseStep(idC); // C → revision: lock D caused_by=C

    expect((await activeLockCauses(idD)).sort()).toEqual([idB, idC].sort()); // D locked by BOTH

    await drive(idB); // re-approve B only → release D's lock caused_by=B; C still in revision
    expect(await activeLockCauses(idD)).toEqual([idC]); // D STILL locked by C
    expect(await taskCountForStep(idD)).toBe(0); // D not opened (still locked + dep C unapproved)
  });
});
