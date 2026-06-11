import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OutboxService } from "../../src/events/outbox.service";
import { WorkflowFsmService } from "../../src/workflow/workflow-fsm.service";
import { WorkflowRepository } from "../../src/workflow/workflow.repository";
import { WorkflowService } from "../../src/workflow/workflow.service";
import { WorkflowTemplatesRepository } from "../../src/workflow/workflow-templates.repository";
import { WorkflowTemplatesService } from "../../src/workflow/workflow-templates.service";
import { DagValidatorService } from "../../src/workflow/dag-validator.service";
import { WorkflowTemplatesController } from "../../src/workflow/workflow-templates.controller";
import { REQUIRE_PERMISSION } from "../../src/permission/require-permission.decorator";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G7-3b — applyTemplate qua WorkflowService (Postgres thật, RLS app role). RED-first deny-path:
 * FS8a (chỉ published), FS8c (sai appliesTo), FS8b (target đã active → 409); GREEN: snapshot + root-only task.
 */
describe.skipIf(!hasDb)("G7-3b applyTemplate", () => {
  const direct = directPool();
  let A: SeededTenant;
  let userA: string;
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
      [A.companyId, `apl-prj-${randomUUID().slice(0, 8)}`],
    );
    const ci = await direct.query(
      `INSERT INTO content_items (company_id, project_id, title, status) VALUES ($1, $2, 'ci', 'draft') RETURNING id`,
      [A.companyId, prj.rows[0].id],
    );
    return ci.rows[0].id as string;
  }

  /** Build + publish a content_item template with N steps and optional dep edges (by step index). */
  async function publishedTemplate(steps: number, deps: Array<[number, number]> = []) {
    const t = await templates.createTemplate(A.companyId, userA, {
      code: `apl-${randomUUID().slice(0, 8)}`,
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
  async function stepIdByNodeKey(instanceId: string, nodeKey: string): Promise<string | undefined> {
    const r = await direct.query(
      `SELECT id FROM workflow_steps WHERE workflow_instance_id = $1 AND node_key = $2`,
      [instanceId, nodeKey],
    );
    return r.rows[0]?.id as string | undefined;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "g73b");
    userA = await seedUser(direct, A.companyId, `g73b-${randomUUID().slice(0, 8)}@a.test`);
    const db = new DatabaseService();
    templates = new WorkflowTemplatesService(
      db,
      new WorkflowTemplatesRepository(db),
      new AuditService(),
      new DagValidatorService(),
    );
    svc = new WorkflowService(
      db,
      new WorkflowRepository(db),
      new WorkflowFsmService(),
      new AuditService(),
      new OutboxService(),
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("FS8a apply template draft → NotFound (chỉ published mới apply)", async () => {
    const t = await templates.createTemplate(A.companyId, userA, {
      code: `dr-${randomUUID().slice(0, 8)}`,
      name: "Draft",
      appliesTo: "content_item",
    });
    await templates.addStep(A.companyId, userA, t.id, stepDto());
    const ci = await seedContentItem();
    await expect(svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("FS8c apply project target vào template content_item → BadRequest (sai appliesTo)", async () => {
    const { t } = await publishedTemplate(1);
    const prj = await direct.query(
      `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
      [A.companyId, `apl-prj2-${randomUUID().slice(0, 8)}`],
    );
    await expect(
      svc.applyTemplate(A.companyId, userA, t.id, { projectId: prj.rows[0].id }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("FS8b apply lên content đã có active → Conflict (uq)", async () => {
    const { t } = await publishedTemplate(1);
    const ci = await seedContentItem();
    await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    await expect(svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("FS2 linear A→B→C: instance active + version pin + chỉ root A có task", async () => {
    const { t, steps } = await publishedTemplate(3, [
      [0, 1],
      [1, 2],
    ]);
    const ci = await seedContentItem();
    const { instance, steps: created } = await svc.applyTemplate(A.companyId, userA, t.id, {
      contentItemId: ci,
    });
    expect(instance.status).toBe("active");
    expect(instance.definitionVersion).toBe(1);
    expect(created).toHaveLength(3);

    const rootStepId = await stepIdByNodeKey(instance.id, steps[0].nodeKey);
    const midStepId = await stepIdByNodeKey(instance.id, steps[1].nodeKey);
    expect(await taskCountForStep(rootStepId!)).toBe(1); // root mở
    expect(await taskCountForStep(midStepId!)).toBe(0); // chờ dep approved (3c)
  });

  it("FS2 parallel A→{B,C}: chỉ root A có task, B/C chờ", async () => {
    const { t, steps } = await publishedTemplate(3, [
      [0, 1],
      [0, 2],
    ]);
    const ci = await seedContentItem();
    const { instance } = await svc.applyTemplate(A.companyId, userA, t.id, { contentItemId: ci });
    const rootStepId = await stepIdByNodeKey(instance.id, steps[0].nodeKey);
    const bStepId = await stepIdByNodeKey(instance.id, steps[1].nodeKey);
    expect(await taskCountForStep(rootStepId!)).toBe(1);
    expect(await taskCountForStep(bStepId!)).toBe(0);
  });
});

/**
 * PD2 (fail-closed wiring): apply handler PHẢI mang @RequirePermission('apply','workflow-instance').
 */
describe("G7-3b apply controller permission metadata (PD2)", () => {
  const proto = WorkflowTemplatesController.prototype as unknown as Record<string, object>;
  it("apply mang @RequirePermission(apply, workflow-instance)", () => {
    const meta = Reflect.getMetadata(REQUIRE_PERMISSION, proto["apply"]) as
      | { action: string; resourceType: string }
      | undefined;
    expect(meta).toBeDefined();
    expect(meta?.action).toBe("apply");
    expect(meta?.resourceType).toBe("workflow-instance");
  });
});
