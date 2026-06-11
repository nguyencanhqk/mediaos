import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { WorkflowTemplatesRepository } from "../../src/workflow/workflow-templates.repository";
import { WorkflowTemplatesService } from "../../src/workflow/workflow-templates.service";
import { WorkflowTemplatesController } from "../../src/workflow/workflow-templates.controller";
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
    svc = new WorkflowTemplatesService(db, new WorkflowTemplatesRepository(db), new AuditService());
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
});

/**
 * PD3 (fail-closed wiring): mutation handlers PHẢI mang @RequirePermission('…','workflow-template').
 * Không cần DB — kiểm metadata tĩnh để đảm bảo PermissionGuard không bị bỏ sót (deny-by-default ADR-0010).
 */
describe("G7-1c controller permission metadata (PD3)", () => {
  const proto = WorkflowTemplatesController.prototype as unknown as Record<string, object>;
  it.each([["create"], ["update"], ["remove"]])(
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
