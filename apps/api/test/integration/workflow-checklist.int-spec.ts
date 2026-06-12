import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
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
 * G7-4b — Checklist enforcement (submit gated by required checklist completion) — Postgres thật, RLS app role.
 *
 * §4/§5 LK4: submit (T2) gated — MỌI checklist_item.is_required của bước phải `checked` (có row
 * workflow_step_checklist_states). Linkage (QUYẾT ĐỊNH #1 = ĐƯỜNG A): instance-step.node_key →
 * def-step (workflow_definition_id + node_key) → checklists.workflow_definition_step_id →
 * checklist_items WHERE is_required. `default_checklist_id` LUÔN NULL (3b không set) → KHÔNG dùng.
 *
 * RED-first: gate cases fail cho tới khi resolveChecklistComplete + FSM guard tồn tại. Tick được mô
 * phỏng bằng direct-SQL INSERT (độc lập với tick API — API test ở describe riêng bên dưới).
 *
 *   LK4-no-checklist   bước không có checklist → submit OK (chống over-gate).
 *   LK4-optional       chỉ item is_required=false, chưa tick → submit OK.
 *   LK4-required-block  required chưa tick → submit reject (ChecklistIncompleteError → 409). ← LK4 §5
 *   LK4-required-tick   required đã tick → submit OK.
 *   LK4-mixed          2 required + 1 optional: tick 1/2 required → block; tick 2/2 → OK (optional kệ).
 *
 * Harness (publishedTemplate-style builder / seedContentItem / assignAll) mirror workflow-lock.int-spec.ts.
 */
describe.skipIf(!hasDb)("G7-4b checklist enforcement (submit gated by required-checklist completion)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let userA: string;
  let userB: string;
  let svc: WorkflowService;
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
      [A.companyId, `ck-prj-${randomUUID().slice(0, 8)}`],
    );
    const ci = await direct.query(
      `INSERT INTO content_items (company_id, project_id, title, status) VALUES ($1, $2, 'ci', 'draft') RETURNING id`,
      [A.companyId, prj.rows[0].id],
    );
    return ci.rows[0].id as string;
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
  async function assignAll(instanceId: string): Promise<void> {
    await direct.query(
      `UPDATE workflow_steps SET assignee_user_id = $1, reviewer_user_id = $1 WHERE workflow_instance_id = $2`,
      [userA, instanceId],
    );
  }
  /** Direct-SQL tick (mô phỏng API tick) — uq (step,item) chặn trùng. */
  async function tickDirect(stepId: string, itemId: string): Promise<void> {
    await direct.query(
      `INSERT INTO workflow_step_checklist_states (company_id, workflow_step_id, checklist_item_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [A.companyId, stepId, itemId],
    );
  }
  async function stateCount(stepId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM workflow_step_checklist_states WHERE workflow_step_id = $1`,
      [stepId],
    );
    return r.rows[0].n as number;
  }

  /** Attach a checklist + items to a DRAFT def-step; returns created item rows (with ids). */
  async function attachChecklist(
    templateId: string,
    stepId: string,
    items: Array<{ label: string; isRequired: boolean }>,
  ): Promise<Array<{ id: string }>> {
    const cl = await templates.createChecklist(A.companyId, userA, templateId, stepId, { name: "CL" });
    const created: Array<{ id: string }> = [];
    for (let i = 0; i < items.length; i++) {
      const item = await templates.addChecklistItem(A.companyId, userA, templateId, cl.id, {
        label: items[i].label,
        isRequired: items[i].isRequired,
        sortOrder: i,
      });
      created.push(item as { id: string });
    }
    return created;
  }

  /**
   * Build a single-step published template (root step), optionally with a checklist, apply it to a
   * fresh content item, assign userA to all steps, and return the instance step id + checklist items.
   */
  async function singleStepWithChecklist(
    items: Array<{ label: string; isRequired: boolean }>,
  ): Promise<{ stepId: string; items: Array<{ id: string }> }> {
    const t = await templates.createTemplate(A.companyId, userA, {
      code: `ck-${randomUUID().slice(0, 8)}`,
      name: "T",
      appliesTo: "content_item",
    });
    const s = await templates.addStep(A.companyId, userA, t.id, stepDto());
    const createdItems = items.length ? await attachChecklist(t.id, s.id, items) : [];
    await templates.publishTemplate(A.companyId, userA, t.id);

    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await assignAll(instance.id);
    const stepId = await stepIdByNodeKey(instance.id, s.nodeKey);
    return { stepId, items: createdItems };
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "g74b");
    userA = await seedUser(direct, A.companyId, `g74b-${randomUUID().slice(0, 8)}@a.test`);
    userB = await seedUser(direct, A.companyId, `g74b-b-${randomUUID().slice(0, 8)}@a.test`);
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
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("LK4-no-checklist: a step with no checklist submits OK (no over-gate)", async () => {
    const { stepId } = await singleStepWithChecklist([]);
    await svc.startStep(A.companyId, stepId, userA);
    await svc.submitStep(A.companyId, stepId, userA, {});
    expect(await stepStatus(stepId)).toBe("waiting_review");
  });

  it("LK4-optional: a step with only optional items submits OK without ticking", async () => {
    const { stepId } = await singleStepWithChecklist([{ label: "nice-to-have", isRequired: false }]);
    await svc.startStep(A.companyId, stepId, userA);
    await svc.submitStep(A.companyId, stepId, userA, {});
    expect(await stepStatus(stepId)).toBe("waiting_review");
  });

  it("LK4-required-block: a required item left unchecked blocks submit (409)", async () => {
    const { stepId } = await singleStepWithChecklist([{ label: "must-do", isRequired: true }]);
    await svc.startStep(A.companyId, stepId, userA);
    await expect(svc.submitStep(A.companyId, stepId, userA, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await stepStatus(stepId)).toBe("in_progress"); // submit rejected → still in_progress
  });

  it("LK4-required-tick: ticking the required item unblocks submit", async () => {
    const { stepId, items } = await singleStepWithChecklist([{ label: "must-do", isRequired: true }]);
    await svc.startStep(A.companyId, stepId, userA);
    await tickDirect(stepId, items[0].id);
    await svc.submitStep(A.companyId, stepId, userA, {});
    expect(await stepStatus(stepId)).toBe("waiting_review");
  });

  it("LK4-mixed: all REQUIRED must be ticked; optional is ignored", async () => {
    const { stepId, items } = await singleStepWithChecklist([
      { label: "req-1", isRequired: true },
      { label: "req-2", isRequired: true },
      { label: "opt-1", isRequired: false },
    ]);
    await svc.startStep(A.companyId, stepId, userA);

    // Tick only the first required → still blocked.
    await tickDirect(stepId, items[0].id);
    await expect(svc.submitStep(A.companyId, stepId, userA, {})).rejects.toBeInstanceOf(
      ConflictException,
    );

    // Tick the second required (optional left unchecked) → submit OK.
    await tickDirect(stepId, items[1].id);
    await svc.submitStep(A.companyId, stepId, userA, {});
    expect(await stepStatus(stepId)).toBe("waiting_review");
  });

  // ─── Tick / un-tick API (G7-4b) — idempotent, scoped, assignee-gated, audited ──
  describe("checklist tick/untick API", () => {
    it("checkItem unblocks submit; uncheckItem re-blocks it; both are idempotent", async () => {
      const { stepId, items } = await singleStepWithChecklist([
        { label: "must-do", isRequired: true },
      ]);
      await svc.startStep(A.companyId, stepId, userA);

      // Idempotent tick: two checks → one row.
      await svc.checkItem(A.companyId, stepId, items[0].id, userA);
      await svc.checkItem(A.companyId, stepId, items[0].id, userA);
      expect(await stateCount(stepId)).toBe(1);

      // Idempotent untick: two unchecks → zero rows, second is a no-op.
      await svc.uncheckItem(A.companyId, stepId, items[0].id, userA);
      await svc.uncheckItem(A.companyId, stepId, items[0].id, userA);
      expect(await stateCount(stepId)).toBe(0);

      // Un-ticked → submit blocked again.
      await expect(svc.submitStep(A.companyId, stepId, userA, {})).rejects.toBeInstanceOf(
        ConflictException,
      );

      // Re-tick via API → submit OK.
      await svc.checkItem(A.companyId, stepId, items[0].id, userA);
      await svc.submitStep(A.companyId, stepId, userA, {});
      expect(await stepStatus(stepId)).toBe("waiting_review");
    });

    it("rejects ticking an item that belongs to a DIFFERENT step (anti tick-stray-item)", async () => {
      // Two independent single-step templates → each has its own checklist item.
      const a = await singleStepWithChecklist([{ label: "a-item", isRequired: true }]);
      const b = await singleStepWithChecklist([{ label: "b-item", isRequired: true }]);
      await expect(
        svc.checkItem(A.companyId, a.stepId, b.items[0].id, userA),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await stateCount(a.stepId)).toBe(0); // nothing ticked
    });

    it("rejects tick by a non-assignee (DECISION #2A — assignee-gated)", async () => {
      const { stepId, items } = await singleStepWithChecklist([
        { label: "must-do", isRequired: true },
      ]);
      // userB is seeded in this tenant but is NOT the step assignee (userA is, via assignAll).
      await expect(
        svc.checkItem(A.companyId, stepId, items[0].id, userB),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await stateCount(stepId)).toBe(0);
    });
  });
});
