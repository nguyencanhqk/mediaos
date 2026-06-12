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
 *   FS10 race-safety (3c-iii): approve() must take a per-instance SELECT…FOR UPDATE lock before
 *        reading dep state (BLOCKING #2), so concurrent approvals of a join's deps serialize and
 *        cannot lost-update (under-open / under-complete). Natural Promise.all timing is order/pool
 *        dependent and unreliable as a RED signal, so this is a deterministic probe: a second
 *        connection HOLDS the instance row lock and we assert a real approve() blocks on it. Pre-
 *        lock a non-completing approve() never touches the instance row → doesn't block → RED.
 *        Sequential correctness of open/complete is covered by FS3 / FS7.
 *
 * Helpers (publishedTemplate / seedContentItem / taskCountForStep / stepIdByNodeKey) mirror
 * workflow-apply.int-spec.ts; left local for now — DRY-extract once a 3rd spec needs them.
 */
describe.skipIf(!hasDb)("G7-3c approve() over DAG (3c-ii fan-out + 3c-iii race-safety)", () => {
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
  /** Outbox event payloads of a given type for an instance (payload.instanceId match). */
  async function outboxPayloadsForInstance(
    instanceId: string,
    eventType: string,
  ): Promise<Array<Record<string, unknown>>> {
    const r = await direct.query(
      `SELECT payload FROM outbox_events WHERE event_type = $1 AND payload->>'instanceId' = $2`,
      [eventType, instanceId],
    );
    return r.rows.map((row) => row.payload as Record<string, unknown>);
  }
  /** assignee + reviewer NULL after applyTemplate (PM assigns later); start/submit need actor===assignee,
   * approve/request_revision need actor===reviewer (S2 fail-closed). Single-actor test: userA is both. */
  async function assignAll(instanceId: string): Promise<void> {
    await direct.query(
      `UPDATE workflow_steps SET assignee_user_id = $1, reviewer_user_id = $1 WHERE workflow_instance_id = $2`,
      [userA, instanceId],
    );
  }

  /** start → submit one step; returns the pending approval request id (NOT yet approved). */
  async function submitFor(stepId: string): Promise<string> {
    await svc.startStep(A.companyId, stepId, userA);
    const sub = await svc.submitStep(A.companyId, stepId, userA, {});
    return (sub as { approvalRequest: { id: string } }).approvalRequest.id;
  }

  /** start → submit → approve one step; returns the approve() result. */
  async function drive(stepId: string) {
    return approval.approve(A.companyId, await submitFor(stepId), userA);
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
    const locks = new LockPropagationService(repo);
    svc = new WorkflowService(db, repo, fsm, audit, outbox, locks);
    approval = new ApprovalService(db, repo, fsm, audit, outbox, locks);
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

  it("FS10 approve() blocks on a held per-instance FOR UPDATE lock (serializes joins)", async () => {
    // Deterministic probe for BLOCKING #2. A blocker connection holds the instance row lock; a real
    // approve() of a non-completing step must block on it once 3c-iii adds lockInstanceForUpdateInTx.
    // Pre-lock approve() never touches the instance row (no completion) → does NOT block → RED.
    const { t, steps } = await publishedTemplate(3, [
      [0, 1],
      [0, 2],
    ]); // fork A→{B,C}
    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await assignAll(instance.id);

    const idA = await stepIdByNodeKey(instance.id, steps[0].nodeKey);
    const idB = await stepIdByNodeKey(instance.id, steps[1].nodeKey);

    await drive(idA); // opens B, C
    const reqB = await submitFor(idB); // B waiting_review, request pending

    const blocker = await direct.connect();
    let approvePromise: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        "SELECT id FROM workflow_instances WHERE company_id = $1 AND id = $2 FOR UPDATE",
        [A.companyId, instance.id],
      );

      // Fire a real approve() without awaiting; race it against a generous timeout.
      approvePromise = approval.approve(A.companyId, reqB, userA);
      const outcome = await Promise.race([
        approvePromise.then(() => "settled", () => "settled"),
        new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 750)),
      ]);

      // RED until lockInstanceForUpdateInTx exists: approve() settles immediately instead of blocking.
      expect(outcome).toBe("blocked");
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }

    // Lock released → the queued approve() proceeds and commits.
    await approvePromise;
    expect(await instanceStatus(instance.id)).toBe("active"); // B approved, C still pending
  });

  // ─── 4c-i: evaluation hook ───────────────────────────────────────────────────
  // Bước requires_evaluation=true khi APPROVED → emit step.evaluation_required CÙNG tx approve
  // (transactional outbox). eval cols thêm INERT ở 0035 → đây là nơi ĐẦU TIÊN dùng. Consumer = G8
  // (chưa có) → worker xử lý 0-consumer = done, KHÔNG dead-letter. G7 chỉ emit + audit.

  it("EV1 requires_evaluation=true → approve emit step.evaluation_required (payload đủ)", async () => {
    const { t, steps } = await publishedTemplate(1);
    const evalTplId = randomUUID();
    // Set cờ trực tiếp (cols inert; published immutable ở service nhưng đây chỉ là test fixture qua direct).
    const upd = await direct.query(
      `UPDATE workflow_definition_steps SET requires_evaluation = true, evaluation_template_id = $1
       WHERE workflow_definition_id = $2 AND node_key = $3`,
      [evalTplId, t.id, steps[0].nodeKey],
    );
    expect(upd.rowCount).toBe(1); // guard: đổi tên cột / sai target → match 0 row, test sẽ false-pass nếu không chốt
    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await assignAll(instance.id);
    const stepId = await stepIdByNodeKey(instance.id, steps[0].nodeKey);

    await drive(stepId);

    const evs = await outboxPayloadsForInstance(instance.id, "step.evaluation_required");
    expect(evs).toHaveLength(1);
    expect(evs[0].stepId).toBe(stepId);
    expect(evs[0].instanceId).toBe(instance.id);
    expect(evs[0].evaluationTemplateId).toBe(evalTplId);
    expect(evs[0].approvedBy).toBe(userA);

    // Audit là side-effect hợp đồng (CÙNG tx) — assert riêng để xoá audit.record sẽ vỡ test, không lặng.
    const audit = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id = $1 AND object_type = 'workflow_step' AND object_id = $2 AND action = 'StepEvaluationRequired'`,
      [A.companyId, stepId],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("EV2 requires_evaluation=false (default) → approve KHÔNG emit step.evaluation_required", async () => {
    const { t, steps } = await publishedTemplate(1);
    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await assignAll(instance.id);
    const stepId = await stepIdByNodeKey(instance.id, steps[0].nodeKey);

    await drive(stepId);

    expect(await outboxPayloadsForInstance(instance.id, "step.evaluation_required")).toHaveLength(0);
    // Control: step.approved VẪN emit → chứng minh approve() chạy, chỉ eval-event vắng đúng lý do.
    expect(
      (await outboxPayloadsForInstance(instance.id, "step.approved")).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
