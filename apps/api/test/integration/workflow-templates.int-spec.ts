import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { WorkflowTemplatesRepository } from "../../src/workflow/workflow-templates.repository";
import { WorkflowTemplatesService } from "../../src/workflow/workflow-templates.service";
import { WorkflowTemplatesController } from "../../src/workflow/workflow-templates.controller";
import { DagValidatorService } from "../../src/workflow/dag-validator.service";
import { REQUIRE_PERMISSION } from "../../src/permission/require-permission.decorator";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * G7-1c — WorkflowTemplatesService qua Postgres thật (RLS app role). RED-first deny-path:
 * cross-tenant đọc/ghi template bị chặn (R1–R3) + published immutable (R4, D4); rồi GREEN happy + audit-in-tx.
 */
describe.skipIf(!hasDb)("G7-1c workflow templates service", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let userA: string;
  let svc: WorkflowTemplatesService;

  /** Seed 1 template trực tiếp (superuser, bypass RLS) với status cho trước — để dựng lưới deny-path. */
  async function seedTemplate(companyId: string, status = "draft"): Promise<string> {
    const r = await direct.query(
      `INSERT INTO workflow_definitions
         (company_id, code, name, applies_to, version, status, max_approval_level, allow_parallel_steps, is_active)
       VALUES ($1, $2, 'Tmpl', 'content_item', 1, $3, 1, false, true) RETURNING id`,
      [companyId, `tmpl-${randomUUID().slice(0, 8)}`, status],
    );
    return r.rows[0].id as string;
  }

  async function auditCount(companyId: string, objectId: string, action: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs
       WHERE company_id = $1 AND object_type = 'workflow_template' AND object_id = $2 AND action = $3`,
      [companyId, objectId, action],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "g71ca");
    B = await seedCompany(direct, "g71cb");
    userA = await seedUser(direct, A.companyId, `g71c-${randomUUID().slice(0, 8)}@a.test`);
    const db = new DatabaseService();
    svc = new WorkflowTemplatesService(
      db,
      new WorkflowTemplatesRepository(db),
      new AuditService(),
      new DagValidatorService(),
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  // ─── RED deny-path (viết TRƯỚC — phải đỏ đúng lý do) ─────────────────────────

  it("R1 get-detail template tenant khác → NotFound (RLS chặn chéo tenant)", async () => {
    const tB = await seedTemplate(B.companyId);
    await expect(svc.getTemplateDetail(A.companyId, tB)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("R2 update template tenant khác → NotFound", async () => {
    const tB = await seedTemplate(B.companyId);
    await expect(svc.updateTemplate(A.companyId, userA, tB, { name: "X" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("R3 soft-delete template tenant khác → NotFound", async () => {
    const tB = await seedTemplate(B.companyId);
    await expect(svc.deleteTemplate(A.companyId, userA, tB)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("R4 update/delete template published → Conflict (D4 immutable)", async () => {
    const tA = await seedTemplate(A.companyId, "published");
    await expect(svc.updateTemplate(A.companyId, userA, tA, { name: "X" })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(svc.deleteTemplate(A.companyId, userA, tA)).rejects.toBeInstanceOf(ConflictException);
  });

  // ─── GREEN happy-path + audit-in-tx ──────────────────────────────────────────

  it("create draft → version=1, status=draft, createdBy set + audit", async () => {
    const t = await svc.createTemplate(A.companyId, userA, {
      code: `c-${randomUUID().slice(0, 8)}`,
      name: "Quy trình video",
      appliesTo: "content_item",
    });
    expect(t.version).toBe(1);
    expect(t.status).toBe("draft");
    expect(t.isActive).toBe(true);
    expect(t.createdBy).toBe(userA);
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateCreated")).toBe(1);
  });

  it("create trùng (code, version=1) → Conflict", async () => {
    const code = `dup-${randomUUID().slice(0, 8)}`;
    await svc.createTemplate(A.companyId, userA, { code, name: "A", appliesTo: "content_item" });
    await expect(
      svc.createTemplate(A.companyId, userA, { code, name: "B", appliesTo: "content_item" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("update name draft → đổi name + audit", async () => {
    const t = await svc.createTemplate(A.companyId, userA, {
      code: `u-${randomUUID().slice(0, 8)}`,
      name: "Cũ",
      appliesTo: "content_item",
    });
    const u = await svc.updateTemplate(A.companyId, userA, t.id, { name: "Mới" });
    expect(u.name).toBe("Mới");
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateUpdated")).toBe(1);
  });

  it("get-detail trả template + arrays rỗng (chưa có step/dep/checklist)", async () => {
    const t = await svc.createTemplate(A.companyId, userA, {
      code: `d-${randomUUID().slice(0, 8)}`,
      name: "Detail",
      appliesTo: "content_item",
    });
    const detail = await svc.getTemplateDetail(A.companyId, t.id);
    expect(detail.template.id).toBe(t.id);
    expect(detail.steps).toEqual([]);
    expect(detail.dependencies).toEqual([]);
    expect(detail.checklists).toEqual([]);
  });

  it("list gồm tenant A, loại tenant B + loại soft-deleted; get sau xoá → NotFound", async () => {
    const t = await svc.createTemplate(A.companyId, userA, {
      code: `l-${randomUUID().slice(0, 8)}`,
      name: "List",
      appliesTo: "content_item",
    });
    const tB = await seedTemplate(B.companyId);

    const listA = await svc.listTemplates(A.companyId);
    const ids = listA.map((x) => x.id);
    expect(ids).toContain(t.id);
    expect(ids).not.toContain(tB);

    await svc.deleteTemplate(A.companyId, userA, t.id);
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateDeleted")).toBe(1);

    const after = await svc.listTemplates(A.companyId);
    expect(after.map((x) => x.id)).not.toContain(t.id);
    await expect(svc.getTemplateDetail(A.companyId, t.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  // ─── 1c-ii: template steps ───────────────────────────────────────────────────

  const stepDto = (over: Record<string, unknown> = {}) => ({
    nodeKey: `nk-${randomUUID().slice(0, 8)}`,
    code: `sc-${randomUUID().slice(0, 8)}`,
    name: "Viết kịch bản",
    defaultTaskTitle: "Viết kịch bản",
    stepType: "task",
    isRequired: true,
    ...over,
  });

  it("R5 addStep parent tenant khác → NotFound", async () => {
    const tB = await seedTemplate(B.companyId);
    await expect(svc.addStep(A.companyId, userA, tB, stepDto())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("R6 addStep trên template published → Conflict (draft-only)", async () => {
    const tA = await seedTemplate(A.companyId, "published");
    await expect(svc.addStep(A.companyId, userA, tA, stepDto())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("R7 nodeKey trùng trong template → Conflict", async () => {
    const t = await svc.createTemplate(A.companyId, userA, {
      code: `nk-${randomUUID().slice(0, 8)}`,
      name: "T",
      appliesTo: "content_item",
    });
    const nodeKey = `dup-${randomUUID().slice(0, 8)}`;
    await svc.addStep(A.companyId, userA, t.id, stepDto({ nodeKey }));
    await expect(svc.addStep(A.companyId, userA, t.id, stepDto({ nodeKey }))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("updateStep step tenant khác → NotFound", async () => {
    const tB = await seedTemplate(B.companyId);
    await expect(
      svc.updateStep(A.companyId, userA, tB, randomUUID(), { name: "X" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("addStep stepOrder auto (max+1) + audit; get-detail thấy step theo thứ tự", async () => {
    const t = await svc.createTemplate(A.companyId, userA, {
      code: `as-${randomUUID().slice(0, 8)}`,
      name: "T",
      appliesTo: "content_item",
    });
    const s1 = await svc.addStep(A.companyId, userA, t.id, stepDto());
    const s2 = await svc.addStep(A.companyId, userA, t.id, stepDto());
    expect(s1.stepOrder).toBe(1);
    expect(s2.stepOrder).toBe(2);
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateStepAdded")).toBe(2);

    const detail = await svc.getTemplateDetail(A.companyId, t.id);
    expect(detail.steps.map((x) => x.id)).toEqual([s1.id, s2.id]);
  });

  it("updateStep đổi name; nodeKey giữ nguyên (BẤT BIẾN) + audit", async () => {
    const t = await svc.createTemplate(A.companyId, userA, {
      code: `us-${randomUUID().slice(0, 8)}`,
      name: "T",
      appliesTo: "content_item",
    });
    const s = await svc.addStep(A.companyId, userA, t.id, stepDto({ name: "Cũ" }));
    const u = await svc.updateStep(A.companyId, userA, t.id, s.id, { name: "Mới" });
    expect(u.name).toBe("Mới");
    expect(u.nodeKey).toBe(s.nodeKey);
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateStepUpdated")).toBe(1);
  });

  it("removeStep hard-delete + cascade dependency + audit", async () => {
    const t = await svc.createTemplate(A.companyId, userA, {
      code: `rm-${randomUUID().slice(0, 8)}`,
      name: "T",
      appliesTo: "content_item",
    });
    const s1 = await svc.addStep(A.companyId, userA, t.id, stepDto());
    const s2 = await svc.addStep(A.companyId, userA, t.id, stepDto());
    // dependency s1→s2 (direct) để kiểm cascade khi hard-delete s1
    await direct.query(
      `INSERT INTO workflow_step_dependencies (company_id, workflow_definition_id, from_step_id, to_step_id)
       VALUES ($1, $2, $3, $4)`,
      [A.companyId, t.id, s1.id, s2.id],
    );

    await svc.removeStep(A.companyId, userA, t.id, s1.id);
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateStepRemoved")).toBe(1);

    const detail = await svc.getTemplateDetail(A.companyId, t.id);
    expect(detail.steps.map((x) => x.id)).toEqual([s2.id]);
    expect(detail.dependencies).toEqual([]); // FK cascade xoá dep
  });

  // ─── 1c-iii: dependencies ────────────────────────────────────────────────────

  async function templateWith2Steps() {
    const t = await svc.createTemplate(A.companyId, userA, {
      code: `dep-${randomUUID().slice(0, 8)}`,
      name: "T",
      appliesTo: "content_item",
    });
    const s1 = await svc.addStep(A.companyId, userA, t.id, stepDto());
    const s2 = await svc.addStep(A.companyId, userA, t.id, stepDto());
    return { t, s1, s2 };
  }

  const edge = (from: string, to: string) => ({
    fromStepId: from,
    toStepId: to,
    dependencyType: "finish_to_start" as const,
  });

  it("R8 addDependency parent tenant khác → NotFound", async () => {
    const tB = await seedTemplate(B.companyId);
    await expect(
      svc.addDependency(A.companyId, userA, tB, edge(randomUUID(), randomUUID())),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("R9 addDependency trên template published → Conflict", async () => {
    const tA = await seedTemplate(A.companyId, "published");
    await expect(
      svc.addDependency(A.companyId, userA, tA, edge(randomUUID(), randomUUID())),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("R10 self-loop (from === to) → BadRequest", async () => {
    const { t, s1 } = await templateWith2Steps();
    await expect(svc.addDependency(A.companyId, userA, t.id, edge(s1.id, s1.id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("R11 from/to step không thuộc template → BadRequest", async () => {
    const { t, s1 } = await templateWith2Steps();
    await expect(
      svc.addDependency(A.companyId, userA, t.id, edge(s1.id, randomUUID())),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("R12 edge trùng → Conflict", async () => {
    const { t, s1, s2 } = await templateWith2Steps();
    await svc.addDependency(A.companyId, userA, t.id, edge(s1.id, s2.id));
    await expect(svc.addDependency(A.companyId, userA, t.id, edge(s1.id, s2.id))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("addDependency → detail thấy edge + audit; removeDependency → mất edge + audit", async () => {
    const { t, s1, s2 } = await templateWith2Steps();
    const dep = await svc.addDependency(A.companyId, userA, t.id, edge(s1.id, s2.id));
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateDependencyAdded")).toBe(1);

    let detail = await svc.getTemplateDetail(A.companyId, t.id);
    expect(detail.dependencies.map((d) => d.id)).toEqual([dep.id]);

    await svc.removeDependency(A.companyId, userA, t.id, dep.id);
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateDependencyRemoved")).toBe(1);

    detail = await svc.getTemplateDetail(A.companyId, t.id);
    expect(detail.dependencies).toEqual([]);
  });

  // ─── 1c-iv: checklists + items ───────────────────────────────────────────────

  async function templateWithStep() {
    const t = await svc.createTemplate(A.companyId, userA, {
      code: `cl-${randomUUID().slice(0, 8)}`,
      name: "T",
      appliesTo: "content_item",
    });
    const s = await svc.addStep(A.companyId, userA, t.id, stepDto());
    return { t, s };
  }

  async function itemCount(checklistId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM checklist_items WHERE checklist_id = $1`,
      [checklistId],
    );
    return r.rows[0].n as number;
  }

  it("R13 createChecklist parent tenant khác → NotFound", async () => {
    const tB = await seedTemplate(B.companyId);
    await expect(
      svc.createChecklist(A.companyId, userA, tB, randomUUID(), { name: "CL" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("R14 createChecklist trên template published → Conflict", async () => {
    const tA = await seedTemplate(A.companyId, "published");
    await expect(
      svc.createChecklist(A.companyId, userA, tA, randomUUID(), { name: "CL" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("R15 createChecklist step không thuộc template → NotFound", async () => {
    const { t } = await templateWithStep();
    await expect(
      svc.createChecklist(A.companyId, userA, t.id, randomUUID(), { name: "CL" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("R16 addChecklistItem checklist không thuộc template → NotFound", async () => {
    const { t } = await templateWithStep();
    await expect(
      svc.addChecklistItem(A.companyId, userA, t.id, randomUUID(), {
        label: "x",
        isRequired: true,
        sortOrder: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("checklist lifecycle: create→detail→addItem→removeItem→removeChecklist cascade + audit", async () => {
    const { t, s } = await templateWithStep();
    const cl = await svc.createChecklist(A.companyId, userA, t.id, s.id, { name: "QA checklist" });
    expect(cl.workflowDefinitionStepId).toBe(s.id);
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateChecklistAdded")).toBe(1);

    const detail = await svc.getTemplateDetail(A.companyId, t.id);
    expect(detail.checklists.map((c) => c.id)).toEqual([cl.id]);

    const item = await svc.addChecklistItem(A.companyId, userA, t.id, cl.id, {
      label: "Check intro",
      isRequired: true,
      sortOrder: 0,
    });
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateChecklistItemAdded")).toBe(1);
    expect(await itemCount(cl.id)).toBe(1);

    await svc.removeChecklistItem(A.companyId, userA, t.id, cl.id, item.id);
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateChecklistItemRemoved")).toBe(1);
    expect(await itemCount(cl.id)).toBe(0);

    // re-add 1 item rồi xoá checklist → FK cascade xoá item
    await svc.addChecklistItem(A.companyId, userA, t.id, cl.id, {
      label: "x",
      isRequired: true,
      sortOrder: 1,
    });
    await svc.removeChecklist(A.companyId, userA, t.id, s.id, cl.id);
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateChecklistRemoved")).toBe(1);
    expect(await itemCount(cl.id)).toBe(0); // cascade

    const after = await svc.getTemplateDetail(A.companyId, t.id);
    expect(after.checklists).toEqual([]);
  });

  // ─── 2b: publish / clone lifecycle (LC1–LC3) ─────────────────────────────────

  /** Draft template + N steps (returns template + the created steps in order). */
  async function templateWithSteps(n: number) {
    const t = await svc.createTemplate(A.companyId, userA, {
      code: `pub-${randomUUID().slice(0, 8)}`,
      name: "T",
      appliesTo: "content_item",
    });
    const steps = [];
    for (let i = 0; i < n; i++) {
      steps.push(await svc.addStep(A.companyId, userA, t.id, stepDto()));
    }
    return { t, steps };
  }

  async function templateStatus(id: string): Promise<string | undefined> {
    const r = await direct.query(`SELECT status FROM workflow_definitions WHERE id = $1`, [id]);
    return r.rows[0]?.status as string | undefined;
  }

  it("LC1 publish template có chu trình → 422 dagValidation, status vẫn draft", async () => {
    const { t, steps } = await templateWithSteps(2);
    await svc.addDependency(A.companyId, userA, t.id, edge(steps[0].id, steps[1].id));
    await svc.addDependency(A.companyId, userA, t.id, edge(steps[1].id, steps[0].id)); // cycle

    try {
      await svc.publishTemplate(A.companyId, userA, t.id);
      throw new Error("expected publishTemplate to reject");
    } catch (e) {
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      const body = (e as UnprocessableEntityException).getResponse() as {
        dagValidation: { valid: boolean; errors: { code: string }[] };
      };
      expect(body.dagValidation.valid).toBe(false);
      expect(body.dagValidation.errors.some((x) => x.code === "cycle")).toBe(true);
    }
    expect(await templateStatus(t.id)).toBe("draft"); // KHÔNG đổi status
  });

  it("LC2 publish DAG hợp lệ → published + KHÓA sửa (addStep/update → Conflict)", async () => {
    const { t, steps } = await templateWithSteps(2);
    await svc.addDependency(A.companyId, userA, t.id, edge(steps[0].id, steps[1].id));

    const published = await svc.publishTemplate(A.companyId, userA, t.id);
    expect(published.status).toBe("published");
    expect(published.publishedAt).not.toBeNull();
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplatePublished")).toBe(1);

    // D4: published immutable — mutations now blocked by loadDraftTemplate.
    await expect(svc.addStep(A.companyId, userA, t.id, stepDto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(svc.updateTemplate(A.companyId, userA, t.id, { name: "X" })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("LC3 clone published → draft version+1, copy đủ + node_key giữ + sửa clone OK", async () => {
    const { t, steps } = await templateWithSteps(2);
    await svc.addDependency(A.companyId, userA, t.id, edge(steps[0].id, steps[1].id));
    const cl = await svc.createChecklist(A.companyId, userA, t.id, steps[0].id, { name: "QA" });
    await svc.addChecklistItem(A.companyId, userA, t.id, cl.id, {
      label: "Check intro",
      isRequired: true,
      sortOrder: 0,
    });
    await svc.publishTemplate(A.companyId, userA, t.id);

    const clone = await svc.cloneTemplate(A.companyId, userA, t.id);
    expect(clone.version).toBe(2);
    expect(clone.status).toBe("draft");
    expect(clone.id).not.toBe(t.id);
    expect(await auditCount(A.companyId, t.id, "WorkflowTemplateCloned")).toBe(1);

    const detail = await svc.getTemplateDetail(A.companyId, clone.id);
    // node_key giữ nguyên (cùng tập), nhưng step id MỚI.
    expect(detail.steps.map((s) => s.nodeKey).sort()).toEqual(steps.map((s) => s.nodeKey).sort());
    expect(detail.steps.map((s) => s.id).sort()).not.toEqual(steps.map((s) => s.id).sort());
    // dep remap sang step id của clone.
    expect(detail.dependencies).toHaveLength(1);
    const cloneStepIds = new Set(detail.steps.map((s) => s.id));
    expect(cloneStepIds.has(detail.dependencies[0].fromStepId)).toBe(true);
    expect(cloneStepIds.has(detail.dependencies[0].toStepId)).toBe(true);
    // checklist + item copy sang checklist id mới.
    expect(detail.checklists).toHaveLength(1);
    const newChecklistId = detail.checklists[0].id;
    expect(newChecklistId).not.toBe(cl.id);
    expect(await itemCount(newChecklistId)).toBe(1);

    // sửa clone (draft) OK.
    const renamed = await svc.updateTemplate(A.companyId, userA, clone.id, { name: "Bản nháp sửa" });
    expect(renamed.name).toBe("Bản nháp sửa");
  });

  it("clone template draft → BadRequest (chỉ published mới clone được)", async () => {
    const { t } = await templateWithSteps(1);
    await expect(svc.cloneTemplate(A.companyId, userA, t.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

/**
 * PD3 (fail-closed wiring): mutation handlers PHẢI mang @RequirePermission('…','workflow-template').
 * Không cần DB — kiểm metadata tĩnh để đảm bảo PermissionGuard không bị bỏ sót (deny-by-default ADR-0010).
 */
describe("G7-1c controller permission metadata (PD3)", () => {
  const proto = WorkflowTemplatesController.prototype as unknown as Record<string, object>;
  it.each([
    ["create"],
    ["update"],
    ["remove"],
    ["publish"],
    ["clone"],
    ["addStep"],
    ["updateStep"],
    ["removeStep"],
    ["addDependency"],
    ["removeDependency"],
    ["addChecklist"],
    ["removeChecklist"],
    ["addChecklistItem"],
    ["removeChecklistItem"],
  ])(
    "%s mang @RequirePermission resourceType=workflow-template",
    (method) => {
      const meta = Reflect.getMetadata(REQUIRE_PERMISSION, proto[method]) as
        | { action: string; resourceType: string }
        | undefined;
      expect(meta).toBeDefined();
      expect(meta?.resourceType).toBe("workflow-template");
    },
  );
});
