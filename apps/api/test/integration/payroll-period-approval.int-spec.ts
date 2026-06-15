import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PayrollPeriodService } from "../../src/payroll/payroll-period.service";
import { PayrollPeriodRepository } from "../../src/payroll/payroll-period.repository";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * G12-4 — vòng duyệt bảng lương (draft→approved→published). RED-first:
 *  - FSM trigger 0130 chặn MỌI lùi trạng thái + xoá mềm kỳ non-draft (DB defense-in-depth).
 *  - status CHECK loại 'locked' (G12-2 retired).
 *  - Service: SoD (người duyệt ≠ người chạy lương), kỳ rỗng không duyệt, conflict trạng thái sai.
 * Permission engine THẬT (admin role …0001 có approve/publish-payroll-period qua seed 0132).
 */
const ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001";

describe.skipIf(!hasDb)("G12-4 payroll period approval FSM (draft→approved→published)", () => {
  const direct = directPool();
  const app = appPool();
  let A: SeededTenant;
  let runner: string; // chạy lương (created_by của payslips)
  let approver: string; // duyệt (≠ runner)
  let periodSvc: PayrollPeriodService;

  async function seedPeriod(
    month: string,
    status: "draft" | "approved" | "published",
  ): Promise<string> {
    // Set đủ cặp duyệt/phát hành để qua approved_pair/published_pair CHECK khi seed trực tiếp.
    const approved = status === "approved" || status === "published";
    const published = status === "published";
    const r = await direct.query(
      `INSERT INTO payroll_periods
         (company_id, period_month, status, created_by,
          approved_by, approved_at, published_by, published_at)
       VALUES ($1, $2, $3, $4,
          ${approved ? "$5, now()" : "NULL, NULL"},
          ${published ? "$5, now()" : "NULL, NULL"})
       RETURNING id`,
      approved
        ? [A.companyId, month, status, runner, approver]
        : [A.companyId, month, status, runner],
    );
    return r.rows[0].id as string;
  }

  async function seedPayslipIn(periodId: string, createdBy: string): Promise<string> {
    const u = await seedUser(direct, A.companyId, `pa-emp-${randomUUID().slice(0, 8)}@a.test`);
    const r = await direct.query(
      `INSERT INTO payslips
         (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, entry_kind)
       VALUES ($1, $2, $3, 5000.00, 5000.00, 5000.00, $4, 'original') RETURNING id`,
      [A.companyId, periodId, u, createdBy],
    );
    return r.rows[0].id as string;
  }

  async function statusOf(periodId: string): Promise<string> {
    const r = await direct.query(`SELECT status FROM payroll_periods WHERE id = $1`, [periodId]);
    return r.rows[0].status as string;
  }

  async function asApp<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
      const out = await fn(c);
      await c.query("ROLLBACK");
      return out;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "papprove");
    runner = await seedUser(direct, A.companyId, `pa-runner-${randomUUID().slice(0, 8)}@a.test`);
    await seedUserRole(direct, runner, ADMIN_ROLE_ID, A.companyId);
    approver = await seedUser(
      direct,
      A.companyId,
      `pa-approver-${randomUUID().slice(0, 8)}@a.test`,
    );
    await seedUserRole(direct, approver, ADMIN_ROLE_ID, A.companyId);

    const db = new DatabaseService();
    const audit = new AuditService();
    const permission = new PermissionService(new PermissionRepository(db));
    periodSvc = new PayrollPeriodService(new PayrollPeriodRepository(), db, permission, audit);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
  });

  // ── Service: SoD + FSM transitions ─────────────────────────────────────────
  it("approve: người CHẠY lương không được tự duyệt (SoD) → Forbidden", async () => {
    const p = await seedPeriod("2026-07", "draft");
    await seedPayslipIn(p, runner); // payslip created_by = runner
    await expect(
      periodSvc.approve({ id: runner, companyId: A.companyId }, p),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await statusOf(p)).toBe("draft");
  });

  it("approve: kỳ KHÔNG có payslip → Conflict (không duyệt bảng rỗng)", async () => {
    const p = await seedPeriod("2026-08", "draft");
    await expect(
      periodSvc.approve({ id: approver, companyId: A.companyId }, p),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("approve: approver ≠ runner + có payslip → approved (đặt approved_by)", async () => {
    const p = await seedPeriod("2026-09", "draft");
    await seedPayslipIn(p, runner);
    const row = await periodSvc.approve({ id: approver, companyId: A.companyId }, p);
    expect(row.status).toBe("approved");
    expect(row.approvedBy).toBe(approver);
    // duyệt lại kỳ đã approved → Conflict (chỉ draft mới duyệt được).
    await expect(
      periodSvc.approve({ id: approver, companyId: A.companyId }, p),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("publish: kỳ chưa approved → Conflict; approved → published", async () => {
    const draft = await seedPeriod("2026-10", "draft");
    await expect(
      periodSvc.publish({ id: approver, companyId: A.companyId }, draft),
    ).rejects.toBeInstanceOf(ConflictException);

    const approved = await seedPeriod("2026-11", "approved");
    const row = await periodSvc.publish({ id: approver, companyId: A.companyId }, approved);
    expect(row.status).toBe("published");
    expect(row.publishedBy).toBe(approver);
  });

  it("remove: chỉ kỳ draft mới xoá mềm được (approved/published → Conflict)", async () => {
    const approved = await seedPeriod("2026-12", "approved");
    await expect(
      periodSvc.remove({ id: approver, companyId: A.companyId }, approved),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ── DB trigger 0130: chặn lùi trạng thái + xoá mềm non-draft (defense-in-depth) ──
  it("trigger: approved→draft bị chặn ở DB", async () => {
    const p = await seedPeriod("2025-01", "approved");
    await expect(
      asApp((c) => c.query(`UPDATE payroll_periods SET status='draft' WHERE id=$1`, [p])),
    ).rejects.toThrow();
  });

  it("trigger: published→draft và published→approved bị chặn ở DB", async () => {
    const p = await seedPeriod("2025-02", "published");
    await expect(
      asApp((c) => c.query(`UPDATE payroll_periods SET status='draft' WHERE id=$1`, [p])),
    ).rejects.toThrow();
    await expect(
      asApp((c) => c.query(`UPDATE payroll_periods SET status='approved' WHERE id=$1`, [p])),
    ).rejects.toThrow();
  });

  it("trigger: nhảy thẳng draft→published bị chặn (phải qua approved)", async () => {
    const p = await seedPeriod("2025-03", "draft");
    await expect(
      asApp((c) =>
        c.query(
          `UPDATE payroll_periods SET status='published', approved_by=$2, approved_at=now(),
             published_by=$2, published_at=now() WHERE id=$1`,
          [p, approver],
        ),
      ),
    ).rejects.toThrow();
  });

  it("trigger: xoá mềm kỳ published bị chặn ở DB", async () => {
    const p = await seedPeriod("2025-04", "published");
    await expect(
      asApp((c) => c.query(`UPDATE payroll_periods SET deleted_at=now() WHERE id=$1`, [p])),
    ).rejects.toThrow();
  });

  it("CHECK: status 'locked' (G12-2 retired) bị loại", async () => {
    const p = await seedPeriod("2025-05", "draft");
    await expect(
      asApp((c) => c.query(`UPDATE payroll_periods SET status='locked' WHERE id=$1`, [p])),
    ).rejects.toThrow();
  });
});
