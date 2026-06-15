import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PayslipAcknowledgementService } from "../../src/payroll/payslip-acknowledgement.service";
import { PayslipAcknowledgementRepository } from "../../src/payroll/payslip-acknowledgement.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * G12-4 — nhân viên xác nhận/khiếu nại payslip (permission + ownership + published + unique). RED-first:
 *  - OWNERSHIP: chỉ thao tác trên phiếu CỦA MÌNH (FK không ép → kiểm tay).
 *  - chỉ kỳ 'published' mới ack/dispute được; 1 ack/phiếu/người (unique → 409).
 *  - resolve nhạy cảm (resolve-payslip-dispute) — employee KHÔNG kế thừa.
 *  - cross-tenant A/B: 0 row qua RLS → NotFound.
 * Permission engine THẬT: employee role …0008 có acknowledge-own-payslip; admin …0001 có resolve (seed 0132).
 */
const ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";
const EMPLOYEE_ROLE_ID = "00000000-0000-0000-0000-000000000008";

describe.skipIf(!hasDb)("G12-4 payslip acknowledgement permission/ownership", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let empA: string; // nhân viên tenant A (có acknowledge-own-payslip)
  let otherEmpA: string;
  let hrA: string; // HR tenant A (có resolve-payslip-dispute)
  let approverId: string;
  let svc: PayslipAcknowledgementService;

  async function seedPeriod(
    t: SeededTenant,
    month: string,
    status: "draft" | "published",
  ): Promise<string> {
    const published = status === "published";
    const r = await direct.query(
      `INSERT INTO payroll_periods
         (company_id, period_month, status, created_by,
          approved_by, approved_at, published_by, published_at)
       VALUES ($1, $2, $3, $4,
          ${published ? "$4, now(), $4, now()" : "NULL, NULL, NULL, NULL"})
       RETURNING id`,
      [t.companyId, month, status, approverId],
    );
    return r.rows[0].id as string;
  }

  async function seedPayslip(t: SeededTenant, periodId: string, userId: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO payslips
         (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
       VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $3, 'original') RETURNING id`,
      [t.companyId, periodId, userId],
    );
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "packA");
    B = await seedCompany(direct, "packB");
    // approverId chỉ để điền cột published_by/approved_by khi seed kỳ published (cùng tenant A; cho B tự seed).
    approverId = await seedUser(
      direct,
      A.companyId,
      `pack-appr-${randomUUID().slice(0, 8)}@a.test`,
    );
    empA = await seedUser(direct, A.companyId, `pack-emp-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, empA, EMPLOYEE_ROLE_ID, A.companyId);
    otherEmpA = await seedUser(direct, A.companyId, `pack-oth-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, otherEmpA, EMPLOYEE_ROLE_ID, A.companyId);
    hrA = await seedUser(direct, A.companyId, `pack-hr-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, hrA, ADMIN_ROLE_ID, A.companyId);

    const db = new DatabaseService();
    const audit = new AuditService();
    const permission = new PermissionService(new PermissionRepository(db));
    svc = new PayslipAcknowledgementService(
      new PayslipAcknowledgementRepository(),
      db,
      permission,
      audit,
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  it("employee acks SOMEONE ELSE's payslip → Forbidden (ownership)", async () => {
    const period = await seedPeriod(A, "2026-07", "published");
    const otherPayslip = await seedPayslip(A, period, otherEmpA);
    await expect(
      svc.acknowledge({ id: empA, companyId: A.companyId }, otherPayslip),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("employee acks own payslip when period NOT published → Conflict", async () => {
    const draft = await seedPeriod(A, "2026-08", "draft");
    const ps = await seedPayslip(A, draft, empA);
    await expect(svc.acknowledge({ id: empA, companyId: A.companyId }, ps)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("employee acks own published payslip → success; second ack → 409 (unique)", async () => {
    const period = await seedPeriod(A, "2026-09", "published");
    const ps = await seedPayslip(A, period, empA);
    const row = await svc.acknowledge({ id: empA, companyId: A.companyId }, ps);
    expect(row.status).toBe("acknowledged");
    await expect(svc.acknowledge({ id: empA, companyId: A.companyId }, ps)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("employee disputes own published payslip with reason → disputed", async () => {
    const period = await seedPeriod(A, "2026-10", "published");
    const ps = await seedPayslip(A, period, empA);
    const row = await svc.dispute({ id: empA, companyId: A.companyId }, ps, {
      reason: "Thiếu phụ cấp",
    });
    expect(row.status).toBe("disputed");
    expect(row.reason).toBe("Thiếu phụ cấp");
  });

  it("employee (no resolve-payslip-dispute) calls resolve → Forbidden (sensitive non-inherit)", async () => {
    const period = await seedPeriod(A, "2026-11", "published");
    const ps = await seedPayslip(A, period, empA);
    const disputed = await svc.dispute({ id: empA, companyId: A.companyId }, ps, { reason: "Sai" });
    await expect(
      svc.resolve({ id: empA, companyId: A.companyId }, disputed.id, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("HR resolves a disputed acknowledgement → resolved", async () => {
    const period = await seedPeriod(A, "2026-12", "published");
    const ps = await seedPayslip(A, period, empA);
    const disputed = await svc.dispute({ id: empA, companyId: A.companyId }, ps, {
      reason: "Sai số",
    });
    const resolved = await svc.resolve({ id: hrA, companyId: A.companyId }, disputed.id, {
      resolutionNote: "Đã rà soát, đúng số",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedBy).toBe(hrA);
  });

  it("cross-tenant: A's employee cannot ack a payslip in tenant B (RLS 0 row → NotFound)", async () => {
    const periodB = await seedPeriod(B, "2026-07", "published");
    const psB = await seedPayslip(B, periodB, empA); // user_id reused but row belongs to B
    await expect(svc.acknowledge({ id: empA, companyId: A.companyId }, psB)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
