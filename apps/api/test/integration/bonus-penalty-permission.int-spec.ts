import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
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
  seedRole,
  seedRolePermission,
  seedPermissionCatalog,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * G12-3 — permission FAIL-CLOSED (RED-first). Thưởng/phạt = SỐ TIỀN per-person (BẤT BIẾN #3):
 *  (a) KHÔNG manage-bonus-penalty → create throws Forbidden, 0 row.
 *  (b) KHÔNG approve-bonus-penalty → approve/reject throws Forbidden.
 *  (c) KHÔNG view-bonus-penalty → list/getOne throws Forbidden.
 *  (d) wildcard *:* ALLOW KHÔNG kế thừa 3 quyền sensitive.
 *  (e) SELF-APPROVE bị chặn: người tạo (dù đủ quyền) KHÔNG được tự duyệt khoản của mình.
 * Permission engine THẬT (Postgres, 4 tầng G3) — KHÔNG mock. company-admin (…0001) đủ quyền (seed 0099).
 */
const ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";

describe.skipIf(!hasDb)("G12-3 bonus/penalty permission deny-path (fail-closed)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let noPermUser: string;
  let wildcardUser: string;
  let adminUser: string;
  let employee: string;
  let svc: BonusPenaltyService;

  async function countBonus(companyId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM bonus_penalties WHERE company_id = $1`,
      [companyId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "bpperm");
    employee = await seedUser(direct, A.companyId, `bp-emp-${randomUUID().slice(0, 8)}@a.test`);

    noPermUser = await seedUser(
      direct,
      A.companyId,
      `bp-noperm-${randomUUID().slice(0, 8)}@a.test`,
    );
    const emptyRole = await seedRole(direct, A.companyId, `bp-empty-${randomUUID().slice(0, 8)}`);
    await seedUserRole(direct, noPermUser, emptyRole, A.companyId);

    wildcardUser = await seedUser(
      direct,
      A.companyId,
      `bp-wild-${randomUUID().slice(0, 8)}@a.test`,
    );
    const wildcardRole = await seedRole(direct, A.companyId, `bp-wild-${randomUUID().slice(0, 8)}`);
    const wildcardPerm = await seedPermissionCatalog(direct, "*", "*", false);
    await seedRolePermission(direct, wildcardRole, wildcardPerm, "ALLOW");
    await seedUserRole(direct, wildcardUser, wildcardRole, A.companyId);

    // admin = company-admin role (…0001) → đủ manage/approve/view (seed migration 0099).
    adminUser = await seedUser(direct, A.companyId, `bp-admin-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, adminUser, ADMIN_ROLE_ID, A.companyId);

    const db = new DatabaseService();
    const audit = new AuditService();
    const permission = new PermissionService(new PermissionRepository(db));
    svc = new BonusPenaltyService(new BonusPenaltyRepository(), db, permission, audit);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  const draft = () => ({
    userId: employee,
    kind: "bonus" as const,
    amount: 500,
    periodMonth: "2026-05",
    source: "manual" as const,
  });

  it("(a) no manage-bonus-penalty → create throws Forbidden, 0 row", async () => {
    const before = await countBonus(A.companyId);
    await expect(
      svc.create({ id: noPermUser, companyId: A.companyId }, draft()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await countBonus(A.companyId)).toBe(before);
  });

  it("(b) no approve-bonus-penalty → approve/reject throws Forbidden", async () => {
    await expect(
      svc.approve({ id: noPermUser, companyId: A.companyId }, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.reject({ id: noPermUser, companyId: A.companyId }, randomUUID(), {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(c) no view-bonus-penalty → list/getOne throws Forbidden", async () => {
    await expect(svc.list({ id: noPermUser, companyId: A.companyId }, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      svc.getOne({ id: noPermUser, companyId: A.companyId }, randomUUID()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(d) wildcard *:* does NOT inherit sensitive manage/approve/view", async () => {
    const u = { id: wildcardUser, companyId: A.companyId };
    await expect(svc.create(u, draft())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.approve(u, randomUUID())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.list(u, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("(e) self-approve blocked → creator cannot approve own draft; status stays draft", async () => {
    const admin = { id: adminUser, companyId: A.companyId };
    const created = await svc.create(admin, draft());
    expect(created.status).toBe("draft");
    await expect(svc.approve(admin, created.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.reject(admin, created.id, {})).rejects.toBeInstanceOf(ForbiddenException);
    const r = await direct.query(`SELECT status FROM bonus_penalties WHERE id = $1`, [created.id]);
    expect(r.rows[0].status).toBe("draft");
  });
});
