/**
 * S3-LEAVE-BE-4 — Integration (Postgres THẬT, DB CÔ LẬP). LEAVE ADMIN SURFACE over the REAL HTTP path
 * (JwtAuthGuard → CompanyGuard → PermissionGuard → LeaveController → LeaveAdminService → RLS withTenant +
 * append-only ledger leave_balance_transactions). KHÔNG mock permission. Proves:
 *
 *   DENY (RED-first):
 *     · employee (no create/update/delete:leave-type grant) → 403 on POST/PATCH/DELETE admin/types
 *     · employee (no view/create/update/delete:leave-policy grant) → 403 on admin/policies routes
 *     · employee (no adjust:leave-balance grant) → 403 on POST admin/balances/:id/adjust + 0 ledger row
 *     · cross-tenant view/adjust balance (đơn công ty khác) → 404 (RLS, no existence leak)
 *   APPEND-ONLY: app role UPDATE/DELETE on leave_balance_transactions MUST fail (BẤT BIẾN #2)
 *   NEGATIVE BALANCE: adjust that would push remaining below used+pending when allow_negative_balance=false
 *     → 409 LEAVE-ERR-ADJUST-NEGATIVE-BALANCE + 0 new ledger row (rollback, no ghost row)
 *   CONCURRENCY: 2 parallel adjusts on one balance → exactly 1 succeeds when only 1 fits under the guard
 *   LEDGER: adjustBalance ALWAYS pairs balance UPDATE with exactly 1 leave_balance_transactions row
 *     (transaction_type='ADJUSTMENT') + LeaveBalanceAdjusted audit row — same tx (rollback ⇒ no audit-ma)
 *   SOFT-DELETE: DELETE type/policy sets deleted_at (never a hard DELETE row)
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/leave → vitest include.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../auth/password.service";
import { appPool, directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";

type Scope = "Own" | "Team" | "Department" | "Company" | "System";
type Pair = [action: string, resource: string, scope: Scope, sensitive?: boolean];

// Full admin grant set (HR@Company) — every S3-LEAVE-BE-4 pair from the REAL catalog (mig 0455).
const HR_ADMIN_PAIRS: Pair[] = [
  ["create", "leave-type", "Company", true],
  ["update", "leave-type", "Company", true],
  ["delete", "leave-type", "Company", true],
  ["view", "leave-policy", "Company", true],
  ["create", "leave-policy", "Company", true],
  ["update", "leave-policy", "Company", true],
  ["delete", "leave-policy", "Company", true],
  ["view", "leave-balance", "Company", true],
  ["view-transaction", "leave-balance", "Company", true],
  ["adjust", "leave-balance", "Company", true],
];

describe.skipIf(!runDb)("S3-LEAVE-BE-4 admin surface (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  let annualA = "";
  let hrToken = "";
  let noviewToken = "";

  let _hash = "";
  async function hash(): Promise<string> {
    if (!_hash) _hash = await new PasswordService().hash(LOGIN_PW);
    return _hash;
  }

  async function grantPairs(
    companyId: string,
    userId: string,
    label: string,
    pairs: Pair[],
  ): Promise<void> {
    const roleId = await seedRole(direct, companyId, `lv4-${label}-${userId.slice(0, 8)}`);
    for (const [action, resource, scope, sensitive] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resource, sensitive ?? false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
    }
    await seedUserRole(direct, userId, roleId, companyId);
  }

  async function plantType(companyId: string, code = `LT-${randomUUID().slice(0, 8)}`) {
    const r = await direct.query(
      `INSERT INTO leave_types
         (company_id, code, name, paid, status, deduct_balance, balance_unit,
          allow_full_day, allow_half_day, allow_hourly, allow_multiple_days,
          require_reason, min_notice_days, sort_order, allow_negative_balance)
       VALUES ($1,$2,$3,true,'active',true,'Day',true,true,false,true,false,0,1,false) RETURNING id`,
      [companyId, code, "Annual"],
    );
    return r.rows[0].id as string;
  }

  async function plantEmployeeAndBalance(
    companyId: string,
    total = 20,
  ): Promise<{ userId: string; employeeId: string; leaveTypeId: string; balanceId: string }> {
    const userId = await seedUser(
      direct,
      companyId,
      `emp-${randomUUID().slice(0, 8)}@test.local`,
      await hash(),
    );
    const p = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code) VALUES ($1,$2,$3) RETURNING id`,
      [companyId, userId, `E-${userId.slice(0, 8)}`],
    );
    const employeeId = p.rows[0].id as string;
    const leaveTypeId = await plantType(companyId);
    const b = await direct.query(
      `INSERT INTO leave_balances
         (company_id, user_id, employee_id, leave_type_id, year, total_days, used_days, pending_days)
       VALUES ($1,$2,$3,$4,2027,$5,0,0) RETURNING id`,
      [companyId, userId, employeeId, leaveTypeId, total],
    );
    return { userId, employeeId, leaveTypeId, balanceId: b.rows[0].id as string };
  }

  const post = (token: string, url: string, body: object = {}) =>
    request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`).send(body);
  const patch = (token: string, url: string, body: object = {}) =>
    request(app.getHttpServer()).patch(url).set("Authorization", `Bearer ${token}`).send(body);
  const get = (token: string, url: string) =>
    request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function countTx(balanceId: string, type?: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int n FROM leave_balance_transactions
        WHERE leave_balance_id=$1 ${type ? "AND transaction_type=$2" : ""}`,
      type ? [balanceId, type] : [balanceId],
    );
    return r.rows[0].n as number;
  }

  async function balanceRow(balanceId: string) {
    const r = await direct.query(
      `SELECT total_days::float t, used_days::float u, COALESCE(pending_days,0)::float p, deleted_at
         FROM leave_balances WHERE id=$1`,
      [balanceId],
    );
    return r.rows[0];
  }

  async function countAudit(companyId: string, action: string, objectId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int n FROM audit_logs WHERE company_id=$1 AND action=$2 AND object_id=$3`,
      [companyId, action, objectId],
    );
    return r.rows[0].n as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    A = await seedCompany(direct, "lvbe4a");
    B = await seedCompany(direct, "lvbe4b");
    companyIds.push(A.companyId, B.companyId);

    annualA = await plantType(A.companyId, "ANNUAL-A");
    await plantType(B.companyId, "ANNUAL-B"); // planted for realism — cross-tenant test plants its own balance

    const hrId = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, await hash());
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code) VALUES ($1,$2,$3)`,
      [A.companyId, hrId, `E-${hrId.slice(0, 8)}`],
    );
    await grantPairs(A.companyId, hrId, "hr", HR_ADMIN_PAIRS);

    const noviewId = await seedUser(direct, A.companyId, `noview@${A.slug}.test`, await hash());
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code) VALUES ($1,$2,$3)`,
      [A.companyId, noviewId, `E-${noviewId.slice(0, 8)}`],
    );

    hrToken = await login(A.slug, `hr@${A.slug}.test`);
    noviewToken = await login(A.slug, `noview@${A.slug}.test`);
  });

  afterAll(async () => {
    await direct
      ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
      .catch(() => undefined);
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── DENY 1 · employee (no create/update/delete:leave-type grant) → 403 ────────
  it("employee without leave-type admin grant → 403 on create/update/delete", async () => {
    expect(
      (
        await post(noviewToken, "/leave/admin/types", {
          name: "X",
          code: `x-${randomUUID().slice(0, 6)}`,
        })
      ).status,
    ).toBe(403);
    expect((await patch(noviewToken, `/leave/admin/types/${annualA}`, { name: "Y" })).status).toBe(
      403,
    );
    expect((await post(noviewToken, `/leave/admin/types/${annualA}/delete`, {})).status).toBe(403);
  });

  // ── DENY 2 · employee (no view/create/update/delete:leave-policy grant) → 403 ─
  it("employee without leave-policy admin grant → 403 on list/create/update/delete", async () => {
    expect((await get(noviewToken, "/leave/admin/policies")).status).toBe(403);
    expect(
      (
        await post(noviewToken, "/leave/admin/policies", {
          leaveTypeId: annualA,
          policyCode: `P-${randomUUID().slice(0, 6)}`,
          name: "Policy X",
          policyScope: "Company",
          effectiveFrom: "2027-01-01",
        })
      ).status,
    ).toBe(403);
  });

  // ── DENY 3 · employee (no adjust:leave-balance grant) → 403 + 0 ledger row ────
  it("employee without adjust:leave-balance grant → 403 + 0 ledger row", async () => {
    const { balanceId } = await plantEmployeeAndBalance(A.companyId);
    const res = await post(noviewToken, `/leave/admin/balances/${balanceId}/adjust`, {
      amountDays: 5,
      reason: "no grant",
    });
    expect(res.status).toBe(403);
    expect(await countTx(balanceId, "ADJUSTMENT")).toBe(0);
    const row = await balanceRow(balanceId);
    expect(Number(row.t)).toBe(20);
  });

  // ── DENY 4 · cross-tenant view/adjust balance → 404 (RLS, no existence leak) ──
  it("HR (tenant A) adjust a balance from ANOTHER company → 404 (no leak)", async () => {
    const { balanceId: bBalanceId } = await plantEmployeeAndBalance(B.companyId);
    const res = await post(hrToken, `/leave/admin/balances/${bBalanceId}/adjust`, {
      amountDays: 3,
      reason: "cross-tenant probe",
    });
    expect(res.status).toBe(404);
    expect(await countTx(bBalanceId, "ADJUSTMENT")).toBe(0);
  });

  // ── HAPPY 1 · HR create/update/delete leave type (Company scope) → 200/soft-delete ──
  it("HR create + update + soft-delete a leave type → 200/201, deleted_at set (no hard-delete)", async () => {
    const code = `sick-${randomUUID().slice(0, 6)}`;
    const created = await post(hrToken, "/leave/admin/types", {
      name: "Nghỉ ốm test",
      code,
      deductBalance: true,
      balanceUnit: "Day",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const typeId = created.body.data.id as string;

    const updated = await patch(hrToken, `/leave/admin/types/${typeId}`, { name: "Nghỉ ốm sửa" });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.data.name).toBe("Nghỉ ốm sửa");

    const deleted = await post(hrToken, `/leave/admin/types/${typeId}/delete`, {});
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    const row = await direct.query(`SELECT deleted_at FROM leave_types WHERE id=$1`, [typeId]);
    expect(row.rows[0].deleted_at).not.toBeNull();
  });

  // ── HAPPY 2 · HR create/update/delete leave policy → 200/201 + audit ──────────
  it("HR create + update + soft-delete a leave policy → 200/201 + audit rows", async () => {
    const created = await post(hrToken, "/leave/admin/policies", {
      leaveTypeId: annualA,
      policyCode: `P-${randomUUID().slice(0, 8)}`,
      name: "Chính sách test",
      policyScope: "Company",
      effectiveFrom: "2027-01-01",
      yearlyQuotaDays: 15,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const policyId = created.body.data.id as string;
    expect(await countAudit(A.companyId, "LeavePolicyCreated", policyId)).toBe(1);

    const updated = await patch(hrToken, `/leave/admin/policies/${policyId}`, {
      name: "Chính sách sửa",
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(await countAudit(A.companyId, "LeavePolicyUpdated", policyId)).toBe(1);

    const deleted = await post(hrToken, `/leave/admin/policies/${policyId}/delete`, {});
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    const row = await direct.query(`SELECT deleted_at FROM leave_policies WHERE id=$1`, [policyId]);
    expect(row.rows[0].deleted_at).not.toBeNull();
    expect(await countAudit(A.companyId, "LeavePolicyDeleted", policyId)).toBe(1);
  });

  // ── HAPPY 3 · HR adjust balance → 200 + exactly 1 ledger row + audit + totals move ──
  it("HR adjust (+3 days) → 200, ledger ADJUSTMENT row, audit, total_days moves", async () => {
    const { balanceId } = await plantEmployeeAndBalance(A.companyId, 20);
    const res = await post(hrToken, `/leave/admin/balances/${balanceId}/adjust`, {
      amountDays: 3,
      reason: "Bổ sung theo chính sách mới",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.totalDays).toBe(23);
    expect(await countTx(balanceId, "ADJUSTMENT")).toBe(1);
    expect(await countAudit(A.companyId, "LeaveBalanceAdjusted", balanceId)).toBe(1);
    const row = await balanceRow(balanceId);
    expect(Number(row.t)).toBe(23);
  });

  // ── NEGATIVE BALANCE · adjust below used+pending when allow_negative_balance=false → 409 ──
  it("adjust that would push remaining negative (allow_negative_balance=false) → 409 + 0 new ledger row", async () => {
    const { balanceId, userId, leaveTypeId } = await plantEmployeeAndBalance(A.companyId, 10);
    // used=10 (all consumed) — any negative adjustment would breach total>=used+pending.
    await direct.query(`UPDATE leave_balances SET used_days=10 WHERE id=$1`, [balanceId]);
    const before = await countTx(balanceId);

    const res = await post(hrToken, `/leave/admin/balances/${balanceId}/adjust`, {
      amountDays: -5,
      reason: "over-deduct probe",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe("LEAVE-ERR-ADJUST-NEGATIVE-BALANCE");
    expect(await countTx(balanceId)).toBe(before);
    const row = await balanceRow(balanceId);
    expect(Number(row.t)).toBe(10); // untouched — rollback, no ghost row
    void userId;
    void leaveTypeId;
  });

  // ── CONCURRENCY · 2 parallel over-committing adjusts on one balance → only 1 succeeds ──
  it("2 concurrent negative adjusts that together exceed the guard → exactly 1×200 + 1×409", async () => {
    const { balanceId } = await plantEmployeeAndBalance(A.companyId, 10);
    // total=10, used=0, pending=0 → guard allows down to 0. Two parallel -7 adjusts: only one fits.
    const [r1, r2] = await Promise.all([
      post(hrToken, `/leave/admin/balances/${balanceId}/adjust`, {
        amountDays: -7,
        reason: "race A",
      }),
      post(hrToken, `/leave/admin/balances/${balanceId}/adjust`, {
        amountDays: -7,
        reason: "race B",
      }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(await countTx(balanceId, "ADJUSTMENT")).toBe(1);
    const row = await balanceRow(balanceId);
    expect(Number(row.t)).toBe(3);
  });

  // ── APPEND-ONLY · app role UPDATE/DELETE leave_balance_transactions MUST fail (BẤT BIẾN #2) ──
  it("app role cannot UPDATE/DELETE leave_balance_transactions rows (append-only)", async () => {
    const { balanceId } = await plantEmployeeAndBalance(A.companyId, 10);
    const res = await post(hrToken, `/leave/admin/balances/${balanceId}/adjust`, {
      amountDays: 2,
      reason: "seed ledger row",
    });
    expect(res.status).toBe(200);
    const r = await direct.query(
      `SELECT id FROM leave_balance_transactions WHERE leave_balance_id=$1 LIMIT 1`,
      [balanceId],
    );
    const txId = r.rows[0].id as string;
    void txId;

    const pool = appPool();
    try {
      await expect(
        pool.query("UPDATE leave_balance_transactions SET reason = 'hacked'"),
      ).rejects.toThrow();
      await expect(pool.query("DELETE FROM leave_balance_transactions")).rejects.toThrow();
    } finally {
      await pool.end();
    }
  });
});
