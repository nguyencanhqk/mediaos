/**
 * S3-LEAVE-BE-6 — Integration (Postgres THẬT, DB CÔ LẬP). GET /leave/reports (Company aggregate) +
 * GET /leave/balances/:id/transactions (canonical, view-transaction:leave-balance) +
 * GET /leave/me/balance-transactions (self-service, view-own:leave-balance) +
 * GET /leave/audit-logs (LEAVE's own audit reader, TÁI DÙNG AuditRepository) over the REAL HTTP path
 * (JwtAuthGuard → CompanyGuard → PermissionGuard → controller → …→ RLS withTenant).
 *
 * deny-path RED (done_when):
 *   (a) mỗi route thiếu đúng cặp quyền của nó → 403
 *   (b) over-grant probes: 1 cặp LEAVE khác (view:leave Team) KHÔNG mở /leave/reports; foundation
 *       (view,audit-log) KHÔNG mở /leave/audit-logs; view-own:leave-balance (Own) KHÔNG mở route
 *       Company-only /leave/balances/:id/transactions (kể cả với balance CỦA CHÍNH MÌNH)
 *   (c) 2-tenant: tenant B không thấy dữ liệu tenant A (report/audit/balances-by-id)
 *   (d) self-service: /leave/me/balance-transactions CHỈ trả về ledger của chính actor, KHÔNG lộ
 *       ledger của nhân viên khác cùng company
 *   (e) append-only: KHÔNG route UPDATE/DELETE trên /leave/audit-logs
 *   (f) no-secret-log: field nhạy cảm trong audit.after bị mask khi đọc qua /leave/audit-logs
 *   (g) report chỉ tính leave_requests status='Approved' (Pending bị loại)
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/leave → vitest
 * include src/**\/*.spec.ts.
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
import { directPool, hasDb } from "../../test/helpers/integration-db";
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
type Pair = [action: string, resource: string, scope: Scope, sensitive: boolean];

const D1 = "2027-03-01";
const D2 = "2027-03-02";

describe.skipIf(!runDb)(
  "S3-LEAVE-BE-6 reports + balance transactions + LEAVE audit reader (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

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
      const roleId = await seedRole(direct, companyId, `lv6-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    async function seedEmp(companyId: string, userId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, employee_code) VALUES ($1,$2,$3) RETURNING id`,
        [companyId, userId, `E-${userId.slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    }

    async function plantType(companyId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO leave_types (company_id, code, name, paid, status)
         VALUES ($1,$2,'Annual',true,'active') RETURNING id`,
        [companyId, `LT-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    }

    async function plantRequestWithDays(
      companyId: string,
      userId: string,
      employeeId: string,
      leaveTypeId: string,
      status: "Approved" | "Pending",
      dates: string[],
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO leave_requests
           (company_id, user_id, leave_type_id, employee_id, start_date, end_date, total_days, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          companyId,
          userId,
          leaveTypeId,
          employeeId,
          dates[0],
          dates[dates.length - 1],
          dates.length,
          status,
        ],
      );
      const requestId = r.rows[0].id as string;
      for (const d of dates) {
        await direct.query(
          `INSERT INTO leave_request_days
             (company_id, leave_request_id, employee_id, leave_type_id, work_date, day_type, leave_days)
           VALUES ($1,$2,$3,$4,$5,'Full Day',1)`,
          [companyId, requestId, employeeId, leaveTypeId, d],
        );
      }
      return requestId;
    }

    async function plantBalance(
      companyId: string,
      userId: string,
      employeeId: string,
      leaveTypeId: string,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO leave_balances (company_id, user_id, employee_id, leave_type_id, year, total_days, used_days)
         VALUES ($1,$2,$3,$4,2027,10,0) RETURNING id`,
        [companyId, userId, employeeId, leaveTypeId],
      );
      return r.rows[0].id as string;
    }

    async function plantTransaction(
      companyId: string,
      balanceId: string,
      employeeId: string,
      leaveTypeId: string,
      type: string,
      amount: number,
    ): Promise<void> {
      await direct.query(
        `INSERT INTO leave_balance_transactions
           (company_id, leave_balance_id, employee_id, leave_type_id, transaction_type, transaction_date, amount_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [companyId, balanceId, employeeId, leaveTypeId, type, D1, amount],
      );
    }

    async function plantAudit(
      companyId: string,
      objectType: string,
      action: string,
      after: Record<string, unknown>,
    ): Promise<void> {
      await direct.query(
        `INSERT INTO audit_logs (company_id, action, object_type, after) VALUES ($1,$2,$3,$4::jsonb)`,
        [companyId, action, objectType, JSON.stringify(after)],
      );
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    function get(token: string, url: string) {
      return request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);
    }

    // Tenant A fixtures.
    let hrToken = "";
    let mgrToken = "";
    let noGrantToken = "";
    let fndAuditToken = "";
    let selfEmpToken = "";
    let selfEmpUser = "";
    let selfEmpId = "";
    let otherEmpUser = "";
    let otherEmpId = "";
    let leaveTypeA = "";
    let selfBalanceId = "";
    let otherBalanceId = "";

    // Tenant B fixtures.
    let bHrToken = "";
    let bBalanceId = "";

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "lvbe6a");
      B = await seedCompany(direct, "lvbe6b");
      companyIds.push(A.companyId, B.companyId);

      leaveTypeA = await plantType(A.companyId);

      const hrId = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, await hash());
      await seedEmp(A.companyId, hrId);
      await grantPairs(A.companyId, hrId, "hr", [
        ["export", "leave", "Company", true],
        ["view-transaction", "leave-balance", "Company", true],
        ["view", "leave-audit-log", "Company", true],
      ]);
      hrToken = await login(A.slug, `hr@${A.slug}.test`);

      const mgrId = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, await hash());
      await seedEmp(A.companyId, mgrId);
      // Different (action,resource) than export:leave — over-grant probe (b1).
      await grantPairs(A.companyId, mgrId, "mgr", [["view", "leave", "Team", true]]);
      mgrToken = await login(A.slug, `mgr@${A.slug}.test`);

      const noGrantId = await seedUser(direct, A.companyId, `nogrant@${A.slug}.test`, await hash());
      await seedEmp(A.companyId, noGrantId);
      noGrantToken = await login(A.slug, `nogrant@${A.slug}.test`);

      const fndAuditId = await seedUser(
        direct,
        A.companyId,
        `fndaudit@${A.slug}.test`,
        await hash(),
      );
      await seedEmp(A.companyId, fndAuditId);
      // foundation's (view,'audit-log') — a DIFFERENT resource_type — must NOT open /leave/audit-logs.
      await grantPairs(A.companyId, fndAuditId, "fndaudit", [
        ["view", "audit-log", "Company", true],
      ]);
      fndAuditToken = await login(A.slug, `fndaudit@${A.slug}.test`);

      selfEmpUser = await seedUser(direct, A.companyId, `self@${A.slug}.test`, await hash());
      selfEmpId = await seedEmp(A.companyId, selfEmpUser);
      await grantPairs(A.companyId, selfEmpUser, "self", [
        ["view-own", "leave-balance", "Own", false],
      ]);
      selfEmpToken = await login(A.slug, `self@${A.slug}.test`);

      otherEmpUser = await seedUser(direct, A.companyId, `other@${A.slug}.test`, await hash());
      otherEmpId = await seedEmp(A.companyId, otherEmpUser);

      // ── leave_requests + leave_request_days: 1 Approved (2 days, counted), 1 Pending (excluded) ──
      await plantRequestWithDays(A.companyId, selfEmpUser, selfEmpId, leaveTypeA, "Approved", [
        D1,
        D2,
      ]);
      await plantRequestWithDays(A.companyId, selfEmpUser, selfEmpId, leaveTypeA, "Pending", [
        "2027-04-01",
      ]);

      // ── leave_balances + leave_balance_transactions (self + other, tenant A) ──
      selfBalanceId = await plantBalance(A.companyId, selfEmpUser, selfEmpId, leaveTypeA);
      await plantTransaction(A.companyId, selfBalanceId, selfEmpId, leaveTypeA, "ACCRUAL", 10);
      await plantTransaction(A.companyId, selfBalanceId, selfEmpId, leaveTypeA, "USE", -2);
      otherBalanceId = await plantBalance(A.companyId, otherEmpUser, otherEmpId, leaveTypeA);
      await plantTransaction(A.companyId, otherBalanceId, otherEmpId, leaveTypeA, "ACCRUAL", 5);

      // ── audit rows (tenant A) — LEAVE object types + 1 non-LEAVE (excluded) + sensitive field ──
      await plantAudit(A.companyId, "leave_type", "LeaveTypeCreated", {
        code: "ANNUAL",
        secretRef: "sk_live_should_be_masked",
      });
      await plantAudit(A.companyId, "leave_balance", "LeaveBalanceAdjusted", { amountDays: 1 });
      await plantAudit(A.companyId, "user", "UserUpdated", { fullName: "Should Not Appear" });

      // ── Tenant B (cross-tenant deny) ──
      const bHrId = await seedUser(direct, B.companyId, `hr@${B.slug}.test`, await hash());
      const bEmpUserId = await seedUser(direct, B.companyId, `emp@${B.slug}.test`, await hash());
      await seedEmp(B.companyId, bHrId);
      const bEmpId = await seedEmp(B.companyId, bEmpUserId);
      await grantPairs(B.companyId, bHrId, "bhr", [
        ["export", "leave", "Company", true],
        ["view-transaction", "leave-balance", "Company", true],
        ["view", "leave-audit-log", "Company", true],
      ]);
      bHrToken = await login(B.slug, `hr@${B.slug}.test`);
      const bLeaveType = await plantType(B.companyId);
      await plantRequestWithDays(B.companyId, bEmpUserId, bEmpId, bLeaveType, "Approved", [D1]);
      bBalanceId = await plantBalance(B.companyId, bEmpUserId, bEmpId, bLeaveType);
      await plantTransaction(B.companyId, bBalanceId, bEmpId, bLeaveType, "ACCRUAL", 3);
      await plantAudit(B.companyId, "leave_type", "LeaveTypeCreated", { note: "tenant B only" });
    });

    afterAll(async () => {
      await direct
        ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ── (a) deny — missing the pair each route needs → 403 ────────────────────────
    it("(a1) GET /leave/reports without export:leave → 403", async () => {
      const res = await get(noGrantToken, "/leave/reports?fromDate=2027-03-01&toDate=2027-03-31");
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("(a2) GET /leave/balances/:id/transactions without view-transaction:leave-balance → 403", async () => {
      const res = await get(noGrantToken, `/leave/balances/${selfBalanceId}/transactions`);
      expect(res.status).toBe(403);
    });

    it("(a3) GET /leave/audit-logs without (view,leave-audit-log) → 403", async () => {
      const res = await get(noGrantToken, "/leave/audit-logs");
      expect(res.status).toBe(403);
    });

    it("(a4) GET /leave/me/balance-transactions without view-own:leave-balance → 403", async () => {
      const res = await get(noGrantToken, "/leave/me/balance-transactions");
      expect(res.status).toBe(403);
    });

    // ── (b) over-grant probes: a DIFFERENT pair does NOT satisfy the gate ──────────
    it("(b1) manager holding (view,leave,Team) does NOT open /leave/reports (needs export:leave)", async () => {
      const res = await get(mgrToken, "/leave/reports?fromDate=2027-03-01&toDate=2027-03-31");
      expect(res.status).toBe(403);
    });

    it("(b2) foundation (view,audit-log) grant does NOT open /leave/audit-logs → 403", async () => {
      const res = await get(fndAuditToken, "/leave/audit-logs");
      expect(res.status).toBe(403);
    });

    it("(b3) view-own:leave-balance (Own) does NOT open /leave/balances/:id/transactions — even for own balance", async () => {
      const res = await get(selfEmpToken, `/leave/balances/${selfBalanceId}/transactions`);
      expect(res.status).toBe(403);
    });

    // ── (c) 2-tenant: tenant B never sees tenant A rows ────────────────────────────
    it("(c1) tenant B /leave/reports → 0 rows from tenant A", async () => {
      const res = await get(
        bHrToken,
        "/leave/reports?fromDate=2027-01-01&toDate=2027-12-31&pageSize=100",
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as Array<{ employeeId: string }>;
      expect(items.some((r) => r.employeeId === selfEmpId)).toBe(false);
    });

    it("(c2) tenant B cannot read tenant A's balance transactions by id → 404", async () => {
      const res = await get(bHrToken, `/leave/balances/${selfBalanceId}/transactions`);
      expect(res.status).toBe(404);
    });

    it("(c3) tenant B /leave/audit-logs → only tenant B's row", async () => {
      const res = await get(bHrToken, "/leave/audit-logs?limit=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body.data.data as Array<{ after: unknown }>;
      expect(rows.length).toBe(1);
      expect(JSON.stringify(rows[0].after)).toContain("tenant B only");
    });

    // ── (d) self-service: /leave/me/balance-transactions never leaks other employees ──
    it("(d1) self /leave/me/balance-transactions → only own 2 rows (ACCRUAL+USE)", async () => {
      const res = await get(selfEmpToken, "/leave/me/balance-transactions");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as Array<{ transactionType: string; amountDays: number }>;
      expect(items.length).toBe(2);
      expect(items.some((r) => r.transactionType === "ACCRUAL" && r.amountDays === 10)).toBe(true);
      expect(items.some((r) => r.transactionType === "USE" && r.amountDays === -2)).toBe(true);
    });

    it("(d2) self /leave/me/balance-transactions does NOT include other employee's ledger", async () => {
      const res = await get(selfEmpToken, "/leave/me/balance-transactions");
      const items = res.body.data.items as Array<{ amountDays: number }>;
      expect(items.some((r) => r.amountDays === 5)).toBe(false); // otherEmp's ACCRUAL(5)
    });

    // ── admin canonical route (hr, Company scope) ──────────────────────────────────
    it("hr GET /leave/balances/:id/transactions → sees both planted ledger rows", async () => {
      const res = await get(hrToken, `/leave/balances/${selfBalanceId}/transactions`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body.data as Array<{ transactionType: string }>;
      expect(rows.length).toBe(2);
    });

    // ── (g) report only counts Approved (Pending excluded) ─────────────────────────
    it("(g) hr GET /leave/reports counts only the Approved 2-day request (Pending excluded)", async () => {
      const res = await get(
        hrToken,
        "/leave/reports?fromDate=2027-01-01&toDate=2027-12-31&pageSize=100",
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data.items as Array<{
        employeeId: string;
        totalRequests: number;
        totalLeaveDays: number;
      }>;
      const row = items.find((r) => r.employeeId === selfEmpId)!;
      expect(row).toBeDefined();
      expect(row.totalRequests).toBe(1);
      expect(row.totalLeaveDays).toBe(2);
    });

    // ── (e) append-only: no UPDATE/DELETE surface on /leave/audit-logs ─────────────
    it("(e) PATCH/DELETE /leave/audit-logs → 404 (no such route registered)", async () => {
      const patchRes = await request(app.getHttpServer())
        .patch("/leave/audit-logs")
        .set("Authorization", `Bearer ${hrToken}`)
        .send({});
      expect(patchRes.status).toBe(404);
      const delRes = await request(app.getHttpServer())
        .delete("/leave/audit-logs")
        .set("Authorization", `Bearer ${hrToken}`);
      expect(delRes.status).toBe(404);
    });

    // ── (f) no-secret-log: sensitive field masked when read through /leave/audit-logs ──
    it("(f) sensitive field (secretRef) in audit.after is masked via /leave/audit-logs", async () => {
      const res = await get(hrToken, "/leave/audit-logs?limit=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body.data.data as Array<{
        objectType: string;
        after: Record<string, unknown>;
      }>;
      const row = rows.find((r) => r.objectType === "leave_type")!;
      expect(row).toBeDefined();
      expect(row.after.secretRef).toBe("***");
      expect(row.after.code).toBe("ANNUAL");
    });

    it("non-LEAVE object_type ('user') is excluded from /leave/audit-logs", async () => {
      const res = await get(hrToken, "/leave/audit-logs?limit=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body.data.data as Array<{ objectType: string }>;
      expect(rows.every((r) => r.objectType !== "user")).toBe(true);
      expect(rows.some((r) => r.objectType === "leave_balance")).toBe(true);
    });
  },
);
