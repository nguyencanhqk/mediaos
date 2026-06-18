/**
 * WAVE 3 C1 — all-tenant data-browser (ADR-0021 Tầng 3) deny-path + cross-tenant visibility + drift guard.
 * DB cô lập (mediaos_ac9rr). RED-first deny paths trên Postgres thật (RLS/role chỉ kiểm chứng được ở DB).
 *
 *  (b) operator KHÔNG có all-tenant grant 'active' ⇒ 403; grant TENANT-SCOPED (target=A) cũng KHÔNG đủ ⇒ 403.
 *  (c) bảng ngoài allowlist ⇒ 400; (c2) cột ngoài allowlist (secret) ⇒ 400.
 *  (d) all-tenant grant (target NULL) ⇒ thấy rows XUYÊN tenant (cả A và B trong 1 lần đọc).
 *  (e) company_id LUÔN có trong row (định danh tenant) kể cả khi không yêu cầu.
 *  (f) MỖI read ghi 1 audit operator.all_tenant_read vào HOME tenant của operator (metadata-only, no PII).
 *  (g) DRIFT GUARD: mọi bảng allowlist có policy *_all_tenant_read + column-GRANT SELECT cho mediaos_readonly.
 *  (h) ROLE-SAFETY: mediaos_readonly là NOBYPASSRLS + NOSUPERUSER (không bypass RLS).
 *
 * Auth boundary (non-operator 403 / step-up thiếu 403) phủ ở db-ops.metadata.spec (decorator) + guard pipeline.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_BROWSER_ALLOWLIST } from "@mediaos/contracts";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { OperatorActionAuditService } from "../../src/platform/operator-action-audit.service";
import { AllTenantBrowserService } from "../../src/db-ops/all-tenant-browser.service";
import { DbOpsGrantRepository } from "../../src/db-ops/db-ops-grant.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const createdGrants: string[] = [];

/** Seed 1 grant 'active' DIRECT cho operator. targetTenantId=null ⇒ ALL-TENANT. Trả grantId. */
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

describe.skipIf(!hasDb)("WAVE 3 C1 all-tenant data-browser (ADR-0021)", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let operatorId: string;
  let service: AllTenantBrowserService;

  beforeAll(async () => {
    A = await seedCompany(direct, "ac9rrA");
    B = await seedCompany(direct, "ac9rrB");
    operatorId = await seedUser(direct, A.companyId, `op-${randomUUID().slice(0, 8)}@a.test`);
    await seedUser(direct, A.companyId, `ua-${randomUUID().slice(0, 8)}@a.test`);
    await seedUser(direct, B.companyId, `ub-${randomUUID().slice(0, 8)}@b.test`);

    service = new AllTenantBrowserService(
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

  it("(b) KHÔNG all-tenant grant ⇒ 403 fail-closed", async () => {
    await expect(
      service.browseAllTenants(operator(), { table: "users", limit: 50, offset: 0 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("(b2) grant TENANT-SCOPED (target=A) KHÔNG đủ cho all-tenant ⇒ 403", async () => {
    await seedActiveGrant(direct, operatorId, A.companyId); // target=A (không phải all-tenant)
    await expect(
      service.browseAllTenants(operator(), { table: "users", limit: 50, offset: 0 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("(c) bảng ngoài allowlist ⇒ 400 (default-deny)", async () => {
    await expect(
      service.browseAllTenants(operator(), {
        table: "payslips" as unknown as "users",
        limit: 50,
        offset: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("(c2) cột secret ngoài allowlist ⇒ 400 (default-deny)", async () => {
    await expect(
      service.browseAllTenants(operator(), {
        table: "users",
        cols: ["password_hash"],
        limit: 50,
        offset: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("(d) all-tenant grant ⇒ đọc XUYÊN tenant (cả A và B trong 1 lần)", async () => {
    await seedActiveGrant(direct, operatorId, null); // ALL-TENANT
    const res = await service.browseAllTenants(operator(), {
      table: "users",
      cols: ["id", "company_id", "email"],
      limit: 100,
      offset: 0,
    });
    const companies = new Set(res.rows.map((r) => r.company_id));
    expect(companies.has(A.companyId)).toBe(true);
    expect(companies.has(B.companyId)).toBe(true);
    expect(companies.size).toBeGreaterThanOrEqual(2);
  });

  it("(e) company_id LUÔN có trong row dù không yêu cầu (định danh tenant)", async () => {
    const res = await service.browseAllTenants(operator(), {
      table: "users",
      cols: ["email"], // KHÔNG yêu cầu company_id
      limit: 100,
      offset: 0,
    });
    expect(res.columns).toContain("company_id");
    for (const row of res.rows) expect(row).toHaveProperty("company_id");
  });

  it("(f) MỖI read ghi 1 audit operator.all_tenant_read vào HOME tenant (metadata-only, no PII)", async () => {
    const before = await direct.query(
      "SELECT count(*)::int AS c FROM audit_logs WHERE action='operator.all_tenant_read' AND company_id=$1",
      [A.companyId],
    );
    await service.browseAllTenants(operator(), {
      table: "users",
      cols: ["id", "email"],
      filters: [{ column: "status", value: "active" }],
      limit: 50,
      offset: 0,
    });
    const after = await direct.query(
      `SELECT after FROM audit_logs
       WHERE action='operator.all_tenant_read' AND company_id=$1
       ORDER BY created_at DESC LIMIT 1`,
      [A.companyId],
    );
    const countNow = await direct.query(
      "SELECT count(*)::int AS c FROM audit_logs WHERE action='operator.all_tenant_read' AND company_id=$1",
      [A.companyId],
    );
    expect(countNow.rows[0].c).toBe((before.rows[0].c as number) + 1);
    const payload = after.rows[0].after as Record<string, unknown>;
    expect(payload.table).toBe("users");
    expect(payload.scope).toBe("all-tenant");
    expect(payload).toHaveProperty("returned");
    expect(payload).toHaveProperty("filters"); // CHỈ tên cột, KHÔNG value
    expect(JSON.stringify(payload)).not.toContain("password");
    expect(JSON.stringify(payload)).not.toContain("active"); // filter VALUE không lọt audit
  });

  // (g) DRIFT GUARD: allowlist ↔ policy + column-GRANT phải đồng bộ (ADR-0021 §Hệ quả).
  const allowlistTables = Object.keys(DB_BROWSER_ALLOWLIST) as Array<keyof typeof DB_BROWSER_ALLOWLIST>;
  it.each(allowlistTables)("(g) bảng %s: có policy all_tenant_read + column-GRANT cho mediaos_readonly", async (table) => {
    const pol = await direct.query(
      "SELECT 1 FROM pg_policies WHERE tablename=$1 AND policyname=$2",
      [table, `${table}_all_tenant_read`],
    );
    expect(pol.rowCount).toBe(1);
    for (const col of DB_BROWSER_ALLOWLIST[table]) {
      const priv = await direct.query(
        "SELECT has_column_privilege('mediaos_readonly', $1, $2, 'SELECT') AS ok",
        [table, col],
      );
      expect(priv.rows[0].ok, `mediaos_readonly thiếu SELECT trên ${table}.${col}`).toBe(true);
    }
  });

  it("(h) role mediaos_readonly là NOBYPASSRLS + NOSUPERUSER (không bypass RLS)", async () => {
    const { rows } = await direct.query(
      "SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname='mediaos_readonly'",
    );
    expect(rows[0].rolsuper).toBe(false);
    expect(rows[0].rolbypassrls).toBe(false);
    expect(rows[0].rolcanlogin).toBe(false); // NOLOGIN — chỉ qua SET ROLE
  });
});
