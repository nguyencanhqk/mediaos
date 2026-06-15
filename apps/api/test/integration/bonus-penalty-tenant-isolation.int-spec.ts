import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { BonusPenaltyService } from "../../src/payroll/bonus-penalty.service";
import { BonusPenaltyRepository } from "../../src/payroll/bonus-penalty.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * G12-3 — RLS 2-tenant qua ĐƯỜNG SERVICE + chống reference chéo tenant.
 *  (a) login A KHÔNG đọc bonus_penalty của B (list chỉ thấy A; getOne(B) → NotFound do RLS).
 *  (b) A tạo bonus tham chiếu task của B → BadRequest (referenceExists check cùng tenant), 0 row.
 * FK KHÔNG ép cùng-tenant → service PHẢI validate tay (đây là lỗ hổng nghiêm trọng nhất nếu thiếu).
 */
const ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";

describe.skipIf(!hasDb)("G12-3 bonus/penalty RLS 2-tenant + cross-tenant reference", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let adminA: string;
  let adminB: string;
  let empA: string;
  let empB: string;
  let svc: BonusPenaltyService;

  async function seedTask(companyId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
       VALUES ($1, 'meeting_action', $2, 'not_started', 'initial', 0) RETURNING id`,
      [companyId, `bp-task-${randomUUID().slice(0, 8)}`],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "bpA");
    B = await seedCompany(direct, "bpB");
    adminA = await seedUser(direct, A.companyId, `bpA-admin-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, adminA, ADMIN_ROLE_ID, A.companyId);
    adminB = await seedUser(direct, B.companyId, `bpB-admin-${randomUUID().slice(0, 8)}@b.test`);
    await seedUserRole(direct, adminB, ADMIN_ROLE_ID, B.companyId);
    empA = await seedUser(direct, A.companyId, `bpA-emp-${randomUUID().slice(0, 8)}@a.test`);
    empB = await seedUser(direct, B.companyId, `bpB-emp-${randomUUID().slice(0, 8)}@b.test`);

    const db = new DatabaseService();
    const audit = new AuditService();
    const permission = new PermissionService(new PermissionRepository(db));
    svc = new BonusPenaltyService(new BonusPenaltyRepository(), db, permission, audit);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("(a) login A sees only A's bonus/penalty; getOne of B's row → NotFound (RLS)", async () => {
    const bonusA = await svc.create(
      { id: adminA, companyId: A.companyId },
      { userId: empA, kind: "bonus", amount: 100, periodMonth: "2026-05", source: "manual" },
    );
    const bonusB = await svc.create(
      { id: adminB, companyId: B.companyId },
      { userId: empB, kind: "penalty", amount: 50, periodMonth: "2026-05", source: "manual" },
    );

    const listA = await svc.list({ id: adminA, companyId: A.companyId }, {});
    const idsA = listA.map((x) => x.id);
    expect(idsA).toContain(bonusA.id);
    expect(idsA).not.toContain(bonusB.id);

    await expect(
      svc.getOne({ id: adminA, companyId: A.companyId }, bonusB.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("(b) A creating a bonus referencing B's task → BadRequest, 0 extra row", async () => {
    const taskB = await seedTask(B.companyId);
    const before = await direct.query(
      `SELECT count(*)::int AS n FROM bonus_penalties WHERE company_id = $1`,
      [A.companyId],
    );
    await expect(
      svc.create(
        { id: adminA, companyId: A.companyId },
        {
          userId: empA,
          kind: "bonus",
          amount: 100,
          periodMonth: "2026-06",
          source: "manual",
          referenceType: "task",
          taskId: taskB,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const after = await direct.query(
      `SELECT count(*)::int AS n FROM bonus_penalties WHERE company_id = $1`,
      [A.companyId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
