/**
 * AC-9 db-ops data-browser deny-path + cross-tenant scope (DB cô lập mediaos_ac9) — RED-first.
 *
 *  (b) operator KHÔNG break-glass active → 403 fail-closed (browse);
 *  (c) đọc bảng ngoài allowlist / cột ngoài allowlist → 400 (default-deny);
 *  (d) cross-tenant scope: withTenant(target) CHỈ thấy rows của target — seed A+B, đọc target=A ⇒ 0 row B;
 *  (f) audit-row ghi ĐỦ MỖI read (actor + target + table + filter + returned count).
 *
 * (a) non-operator + (e) step-up thiếu/hết hạn được phủ ở metadata.spec (decorator) + audit-read.http precedent
 *     (guard pipeline). File này thuần service/DB (RLS chỉ kiểm chứng trên Postgres thật).
 *
 * Tầng 1 (ADR-0020): data-browser đi withTenant(targetCompanyId) — RLS company_id=current ÉP. KHÔNG GUC mới.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OperatorActionAuditService } from "../../src/platform/operator-action-audit.service";
import { DataBrowserService } from "../../src/db-ops/data-browser.service";
import { DbOpsGrantRepository } from "../../src/db-ops/db-ops-grant.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const createdGrants: string[] = [];

/** Seed 1 grant 'active' DIRECT (bypass app grants — test setup) cho operator trên target. Trả grantId. */
async function seedActiveGrant(
  direct: import("pg").Pool,
  operatorId: string,
  targetTenantId: string | null,
): Promise<string> {
  const { rows } = await direct.query(
    `INSERT INTO db_ops_grants
       (requester_user_id, target_tenant_id, reason, required_approvals, status, activated_at, expires_at)
     VALUES ($1, $2, 'test-active', 2, 'active', now(), now() + interval '1 hour')
     RETURNING id`,
    [operatorId, targetTenantId],
  );
  const id = rows[0].id as string;
  createdGrants.push(id);
  return id;
}

describe.skipIf(!hasDb)("AC-9 db-ops data-browser deny + cross-tenant scope", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let operatorId: string;
  let service: DataBrowserService;

  beforeAll(async () => {
    A = await seedCompany(direct, "ac9A");
    B = await seedCompany(direct, "ac9B");
    operatorId = await seedUser(direct, A.companyId, `op-${randomUUID().slice(0, 8)}@a.test`);
    // Seed thêm vài user của A và B (data-browser sẽ đọc bảng users).
    await seedUser(direct, A.companyId, `ua-${randomUUID().slice(0, 8)}@a.test`);
    await seedUser(direct, B.companyId, `ub-${randomUUID().slice(0, 8)}@b.test`);

    service = new DataBrowserService(
      new DatabaseService(),
      new DbOpsGrantRepository(),
      new OperatorActionAuditService(new AuditService()),
    );
  });

  afterAll(async () => {
    if (createdGrants.length) {
      await direct.query("DELETE FROM db_ops_grants WHERE id = ANY($1::uuid[])", [createdGrants]);
    }
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  const operator = () => ({ id: operatorId, companyId: A.companyId });

  it("(b) KHÔNG break-glass active ⇒ 403 fail-closed", async () => {
    await expect(
      service.browse(operator(), { targetCompanyId: A.companyId, table: "users", limit: 50, offset: 0 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("(c) bảng ngoài allowlist ⇒ 400 (default-deny)", async () => {
    await seedActiveGrant(direct, operatorId, A.companyId);
    await expect(
      service.browse(operator(), {
        // ép kiểu để vượt enum tĩnh — service vẫn assertTableAllowed → 400.
        targetCompanyId: A.companyId,
        table: "payslips" as unknown as "users",
        limit: 50,
        offset: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("(c2) cột ngoài allowlist ⇒ 400 (default-deny)", async () => {
    await expect(
      service.browse(operator(), {
        targetCompanyId: A.companyId,
        table: "users",
        cols: ["password_hash"],
        limit: 50,
        offset: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("(d) cross-tenant scope: browse target=A ⇒ CHỈ rows của A (0 row của B)", async () => {
    const res = await service.browse(operator(), {
      targetCompanyId: A.companyId,
      table: "users",
      cols: ["id", "company_id", "email"],
      limit: 100,
      offset: 0,
    });
    expect(res.rows.length).toBeGreaterThan(0);
    for (const row of res.rows) {
      expect(row.company_id).toBe(A.companyId);
    }
  });

  it("(f) MỖI read ghi 1 audit operator.db_read với metadata (table/filterCount/returned)", async () => {
    const before = await direct.query(
      "SELECT count(*)::int AS c FROM audit_logs WHERE action = 'operator.db_read' AND company_id = $1",
      [A.companyId],
    );
    await service.browse(operator(), {
      targetCompanyId: A.companyId,
      table: "users",
      cols: ["id", "email"],
      filters: [{ column: "status", value: "active" }],
      limit: 50,
      offset: 0,
    });
    const after = await direct.query(
      `SELECT after FROM audit_logs
       WHERE action = 'operator.db_read' AND company_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    const beforeCount = before.rows[0].c as number;
    const countNow = await direct.query(
      "SELECT count(*)::int AS c FROM audit_logs WHERE action = 'operator.db_read' AND company_id = $1",
      [A.companyId],
    );
    expect(countNow.rows[0].c).toBe(beforeCount + 1);
    const payload = after.rows[0].after as Record<string, unknown>;
    expect(payload.table).toBe("users");
    expect(payload).toHaveProperty("returned");
    // BẤT BIẾN #3: audit KHÔNG chứa value của filter (chỉ tên cột).
    expect(payload).toHaveProperty("filters");
    expect(JSON.stringify(payload)).not.toContain("password");
  });

  it("(g) all-tenant grant (target NULL) ⇒ browse được mọi tenant (A và B)", async () => {
    await seedActiveGrant(direct, operatorId, null);
    const resB = await service.browse(operator(), {
      targetCompanyId: B.companyId,
      table: "users",
      cols: ["id", "company_id"],
      limit: 100,
      offset: 0,
    });
    expect(resB.rows.length).toBeGreaterThan(0);
    for (const row of resB.rows) expect(row.company_id).toBe(B.companyId);
  });
});
