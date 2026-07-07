/**
 * S3-QA-2 (qa2LeaveApi) — Integration (Postgres THẬT, DB CÔ LẬP). LEAVE API/service test matrix QA-02/QA-05
 * over the REAL HTTP path (JwtAuthGuard → CompanyGuard → PermissionGuard → LeaveController → services → RLS
 * withTenant + append-only ledger). KHÔNG mock permission. WO test-only: KHÔNG đổi hành vi service.
 *
 * PHẠM VI = CÁC Ô CÒN THIẾU trong lưới QA-02/QA-05 mà bộ int-spec BE-1..6 CHƯA phủ (không nhân bản):
 *
 *   BALANCE (QA-02/QA-05):
 *     · GET /leave/admin/balances — HR (view:leave-balance @ Company) thấy danh sách company-wide;
 *       insufficient-permission (chỉ view-own:leave-balance) → 403; cross-tenant → không rò balance công ty khác.
 *
 *   LEDGER INTEGRITY (QA-05 — "balance_before/after liên tục khớp tail", ĐÃ THIẾU ở mọi spec cũ chỉ đếm count):
 *     · submit→approve: chuỗi RESERVE(pending 0→1) → RELEASE(pending 1→0) → USE(used chain) — balance_before/
 *       after LIÊN TỤC theo từng chiều (pending/used) + TAIL khớp leave_balances.pending_days/used_days.
 *     · HR adjust ×2 tuần tự: chuỗi ADJUSTMENT (chiều remaining) liên tục + tail khớp remaining_days.
 *     · APPEND-ONLY (BẤT BIẾN #2): app role UPDATE/DELETE trên chính các dòng ledger vừa dựng → PHẢI fail.
 *
 *   APPROVAL DENY → 0 SIDE-EFFECT (QA-05 RED, mạnh hơn BE-3 chỉ check status):
 *     · manager duyệt đơn NGOÀI Team → 403 + 0 audit(LeaveApproved) + 0 leave_request_approvals(APPROVE) +
 *       0 USE tx (scope-check chạy TRƯỚC mọi mutation) — chứng minh "0 audit + 0 mutation khi ngoài scope".
 *     · reject → KHÔNG tạo attendance leave record (0 attendance_records status='Leave' cho ngày đơn) +
 *       RELEASE + audit(LeaveRejected) ghi in-tx.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env → hasDb=true ⇒ đỏ-giả trên DB
 * dev chung; chỉ chạy trên DB cô lập lane. test/**\/*.int-spec.ts → vitest include.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";

type Scope = "Own" | "Team" | "Department" | "Company" | "System";
type Pair = [action: string, resource: string, scope: Scope, sensitive?: boolean];

// Self-service (create + submit + read-own) → produce a Pending+Reserved request.
const SELF_PAIRS: Pair[] = [
  ["create", "leave", "Own"],
  ["submit", "leave", "Own"],
  ["cancel-own", "leave", "Own"],
  ["view-own", "leave", "Own"],
  ["view-own", "leave-balance", "Own"],
  ["view", "leave-type", "Company"],
];
// HR@Company — approve/reject/view:leave + full balance admin (view/adjust/view-transaction).
const HR_PAIRS: Pair[] = [
  ["view", "leave", "Company", true],
  ["approve", "leave", "Company", false],
  ["reject", "leave", "Company", true],
  ["view", "leave-balance", "Company", true],
  ["view-transaction", "leave-balance", "Company", true],
  ["adjust", "leave-balance", "Company", true],
];
// Manager@Team — view/approve/reject only within Team.
const MGR_PAIRS: Pair[] = [
  ["view", "leave", "Team", true],
  ["approve", "leave", "Team", false],
  ["reject", "leave", "Team", true],
];

// 2027-03 (Mar 1 = Monday) — working weekdays → FullDay single-day = 1 day.
const DATES = {
  ledgerApprove: "2027-03-01",
  rejectNoAtt: "2027-03-02",
  mgrDeny: "2027-03-03",
} as const;

describe.skipIf(!runDb)(
  "S3-QA-2 LEAVE API matrix (ledger integrity · balance scope · deny 0-side-effect)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let annualA = "";
    const u: Record<string, { id: string; profile: string }> = {};
    let aEmp1Balance = ""; // emp1's ANNUAL balance (ledger-integrity target)
    let bBalanceId = ""; // a balance in tenant B (cross-tenant list-exclusion probe)

    let _hash = "";
    async function hash(): Promise<string> {
      if (!_hash) _hash = await new PasswordService().hash(LOGIN_PW);
      return _hash;
    }

    async function seedProfile(
      companyId: string,
      userId: string,
      opts: { managerUserId?: string } = {},
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, direct_manager_id, employee_code)
       VALUES ($1,$2,$3,$4) RETURNING id`,
        [companyId, userId, opts.managerUserId ?? null, `E-${userId.slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    }

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      pairs: Pair[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `qa2-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, sensitive ?? false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    async function plantType(companyId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO leave_types
         (company_id, code, name, paid, status, deduct_balance, balance_unit,
          allow_full_day, allow_half_day, allow_hourly, allow_multiple_days,
          require_reason, min_notice_days, sort_order, allow_negative_balance)
       VALUES ($1,$2,$3,true,'active',true,'Day',true,true,false,true,false,0,1,false) RETURNING id`,
        [companyId, `LT-${randomUUID().slice(0, 8)}`, "Annual"],
      );
      return r.rows[0].id as string;
    }

    async function plantBalance(
      companyId: string,
      userId: string,
      employeeId: string,
      leaveTypeId: string,
      total: number,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO leave_balances
         (company_id, user_id, employee_id, leave_type_id, year, total_days, used_days, pending_days)
       VALUES ($1,$2,$3,$4,2027,$5,0,0) RETURNING id`,
        [companyId, userId, employeeId, leaveTypeId, total],
      );
      return r.rows[0].id as string;
    }

    const post = (token: string, url: string, body: object = {}) =>
      request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`).send(body);
    const get = (token: string, url: string) =>
      request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** emp submits a FullDay single-day request → Pending + Reserved. Returns request id. */
    async function createPending(slug: string, email: string, date: string): Promise<string> {
      const token = await login(slug, email);
      const res = await post(token, "/leave/requests", {
        leaveTypeId: annualA,
        startDate: date,
        endDate: date,
        durationType: "FullDay",
        submitNow: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.status).toBe("Pending");
      return res.body.data.id as string;
    }

    // ── DB probes ────────────────────────────────────────────────────────────────
    async function ledgerRows(
      balanceId: string,
      type: string,
    ): Promise<Array<{ amt: number; bef: number | null; aft: number | null }>> {
      const r = await direct.query(
        `SELECT amount_days::float amt, balance_before_days::float bef, balance_after_days::float aft
         FROM leave_balance_transactions
        WHERE leave_balance_id=$1 AND transaction_type=$2
        ORDER BY created_at, id`,
        [balanceId, type],
      );
      return r.rows.map((x: { amt: number; bef: number | null; aft: number | null }) => ({
        amt: Number(x.amt),
        bef: x.bef == null ? null : Number(x.bef),
        aft: x.aft == null ? null : Number(x.aft),
      }));
    }
    async function balanceState(
      balanceId: string,
    ): Promise<{ used: number; pending: number; remaining: number }> {
      const r = await direct.query(
        `SELECT used_days::float u, COALESCE(pending_days,0)::float p, remaining_days::float rem
         FROM leave_balances WHERE id=$1`,
        [balanceId],
      );
      return {
        used: Number(r.rows[0].u),
        pending: Number(r.rows[0].p),
        remaining: Number(r.rows[0].rem),
      };
    }
    async function countAudit(
      companyId: string,
      action: string,
      objectId: string,
    ): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int n FROM audit_logs WHERE company_id=$1 AND action=$2 AND object_id=$3`,
        [companyId, action, objectId],
      );
      return r.rows[0].n as number;
    }
    async function countApprovals(requestId: string, action: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int n FROM leave_request_approvals WHERE leave_request_id=$1 AND action=$2`,
        [requestId, action],
      );
      return r.rows[0].n as number;
    }
    async function countTx(requestId: string, type: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int n FROM leave_balance_transactions WHERE leave_request_id=$1 AND transaction_type=$2`,
        [requestId, type],
      );
      return r.rows[0].n as number;
    }
    async function reqStatus(id: string): Promise<string> {
      const r = await direct.query(`SELECT status FROM leave_requests WHERE id=$1`, [id]);
      return r.rows[0].status as string;
    }
    async function attendanceLeaveRows(
      companyId: string,
      userId: string,
      date: string,
    ): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int n FROM attendance_records
        WHERE company_id=$1 AND user_id=$2 AND work_date=$3 AND attendance_status='Leave' AND deleted_at IS NULL`,
        [companyId, userId, date],
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
      A = await seedCompany(direct, "qa2lva");
      B = await seedCompany(direct, "qa2lvb");
      companyIds.push(A.companyId, B.companyId);

      annualA = await plantType(A.companyId);

      // Manager (Team) — no manager above.
      const mgrId = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, await hash());
      u.mgr = { id: mgrId, profile: await seedProfile(A.companyId, mgrId) };
      await grant(A.companyId, mgrId, "mgr", MGR_PAIRS);

      // HR (Company) — approver + balance admin.
      const hrId = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, await hash());
      u.hr = { id: hrId, profile: await seedProfile(A.companyId, hrId) };
      await grant(A.companyId, hrId, "hr", HR_PAIRS);

      // emp1 — reports to mgr (inside Team) + balance.
      const emp1 = await seedUser(direct, A.companyId, `emp1@${A.slug}.test`, await hash());
      u.emp1 = {
        id: emp1,
        profile: await seedProfile(A.companyId, emp1, { managerUserId: mgrId }),
      };
      await grant(A.companyId, emp1, "emp1", SELF_PAIRS);
      aEmp1Balance = await plantBalance(A.companyId, emp1, u.emp1.profile, annualA, 20);

      // emp2 — NO manager → OUTSIDE mgr's Team + balance.
      const emp2 = await seedUser(direct, A.companyId, `emp2@${A.slug}.test`, await hash());
      u.emp2 = { id: emp2, profile: await seedProfile(A.companyId, emp2) };
      await grant(A.companyId, emp2, "emp2", SELF_PAIRS);
      await plantBalance(A.companyId, emp2, u.emp2.profile, annualA, 20);

      // viewOwn — view-own:leave-balance @ Own ONLY (insufficient for the Company admin list).
      const viewOwn = await seedUser(direct, A.companyId, `viewown@${A.slug}.test`, await hash());
      u.viewOwn = { id: viewOwn, profile: await seedProfile(A.companyId, viewOwn) };
      await grant(A.companyId, viewOwn, "viewown", [["view-own", "leave-balance", "Own"]]);

      // Tenant B — HR@Company + a balance (cross-tenant list-exclusion probe).
      const annualB = await plantType(B.companyId);
      const bHr = await seedUser(direct, B.companyId, `hr@${B.slug}.test`, await hash());
      await seedProfile(B.companyId, bHr);
      await grant(B.companyId, bHr, "bhr", HR_PAIRS);
      const bEmp = await seedUser(direct, B.companyId, `emp@${B.slug}.test`, await hash());
      const bEmpProfile = await seedProfile(B.companyId, bEmp);
      bBalanceId = await plantBalance(B.companyId, bEmp, bEmpProfile, annualB, 15);
    });

    afterAll(async () => {
      await direct
        ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ══ RED-first · DENY ════════════════════════════════════════════════════════

    // ── DENY 1 · GET /leave/admin/balances needs view:leave-balance@Company — view-own only → 403 ──
    it("[QA-05 RED] view-own:leave-balance holder → 403 on GET /leave/admin/balances (no company list leak)", async () => {
      const token = await login(A.slug, `viewown@${A.slug}.test`);
      const res = await get(token, "/leave/admin/balances");
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.data).toBeFalsy();
    });

    // ── DENY 2 · manager approve OUTSIDE Team → 403 + 0 audit + 0 approval + 0 USE (0 mutation) ──
    it("[QA-05 RED] manager approve non-report → 403 + 0 audit(LeaveApproved) + 0 APPROVE row + 0 USE tx", async () => {
      const reqId = await createPending(A.slug, `emp2@${A.slug}.test`, DATES.mgrDeny);
      const mgrToken = await login(A.slug, `mgr@${A.slug}.test`);
      const denied = await post(mgrToken, `/leave/requests/${reqId}/approve`, {});
      expect(denied.status, JSON.stringify(denied.body)).toBe(403);
      expect(denied.body.error.code).toBe("LEAVE-ERR-OUT-OF-SCOPE");
      // scope-check ran BEFORE any write → request untouched, NO ledger/approval/audit side-effect.
      expect(await reqStatus(reqId)).toBe("Pending");
      expect(await countTx(reqId, "USE")).toBe(0);
      expect(await countApprovals(reqId, "APPROVE")).toBe(0);
      expect(await countAudit(A.companyId, "LeaveApproved", reqId)).toBe(0);
    });

    // ── DENY 3 · reject → NO attendance leave record; RELEASE + LeaveRejected audit in-tx ──
    it("[QA-05 RED] reject a Pending request → 0 attendance_records status='Leave' + RELEASE + LeaveRejected audit", async () => {
      const reqId = await createPending(A.slug, `emp1@${A.slug}.test`, DATES.rejectNoAtt);
      const hrToken = await login(A.slug, `hr@${A.slug}.test`);
      const ok = await post(hrToken, `/leave/requests/${reqId}/reject`, {
        reason: "trùng lịch team",
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.status).toBe("Rejected");
      // reject NEVER creates an attendance Leave record for the requested date.
      expect(await attendanceLeaveRows(A.companyId, u.emp1.id, DATES.rejectNoAtt)).toBe(0);
      // reserve released (RELEASE tx), USE never happened, audit written in-tx.
      expect(await countTx(reqId, "RELEASE")).toBe(1);
      expect(await countTx(reqId, "USE")).toBe(0);
      expect(await countAudit(A.companyId, "LeaveRejected", reqId)).toBe(1);
    });

    // ══ BALANCE scope (QA-02) ════════════════════════════════════════════════════

    // ── HR (view:leave-balance@Company) sees company-wide balances; cross-tenant excluded ──
    it("[QA-02] HR GET /leave/admin/balances → company-wide (emp1+emp2); tenant B list excludes A's balances", async () => {
      const hrToken = await login(A.slug, `hr@${A.slug}.test`);
      const res = await get(hrToken, "/leave/admin/balances?year=2027");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((x) => x.id);
      expect(ids).toContain(aEmp1Balance);
      expect(ids).not.toContain(bBalanceId); // tenant B's balance never visible in A's list

      // tenant B HR sees ONLY B's balances — not A's.
      const bHrToken = await login(B.slug, `hr@${B.slug}.test`);
      const bRes = await get(bHrToken, "/leave/admin/balances?year=2027");
      expect(bRes.status, JSON.stringify(bRes.body)).toBe(200);
      const bIds = (bRes.body.data as Array<{ id: string }>).map((x) => x.id);
      expect(bIds).toContain(bBalanceId);
      expect(bIds).not.toContain(aEmp1Balance);
    });

    // ══ LEDGER INTEGRITY (QA-05 — balance_before/after chain + tail) ══════════════

    // ── submit→approve: RESERVE→RELEASE (pending chain) + USE (used chain) continuous + tail matches ──
    it("[QA-05] submit→approve ledger: RESERVE/RELEASE/USE balance_before/after continuous + tail = leave_balances", async () => {
      // DEDICATED fresh employee+balance (total=20) → the ledger chain on this balance is owned entirely by
      // this one request (isolated from emp1's shared balance which other tests reserve/release).
      const ledgerEmail = `ledger@${A.slug}.test`;
      const ledgerEmpId = await seedUser(direct, A.companyId, ledgerEmail, await hash());
      const ledgerProfile = await seedProfile(A.companyId, ledgerEmpId);
      await grant(A.companyId, ledgerEmpId, "ledger", SELF_PAIRS);
      const balanceId = await plantBalance(A.companyId, ledgerEmpId, ledgerProfile, annualA, 20);

      const reqId = await createPending(A.slug, ledgerEmail, DATES.ledgerApprove);
      const stateAfterReserve = await balanceState(balanceId);

      // RESERVE row: pending 0 → 1 (amount = 1 requested day).
      const reserve = await ledgerRows(balanceId, "RESERVE");
      expect(reserve).toHaveLength(1);
      expect(reserve[0]).toMatchObject({ amt: 1, bef: 0, aft: 1 });
      // tail after reserve: leave_balances.pending == RESERVE.balance_after.
      expect(stateAfterReserve.pending).toBe(reserve[0].aft);

      const hrToken = await login(A.slug, `hr@${A.slug}.test`);
      const approve = await post(hrToken, `/leave/requests/${reqId}/approve`, {
        note: "duyệt QA-2",
      });
      expect(approve.status, JSON.stringify(approve.body)).toBe(200);
      expect(approve.body.data.status).toBe("Approved");

      const release = await ledgerRows(balanceId, "RELEASE");
      const use = await ledgerRows(balanceId, "USE");
      expect(release).toHaveLength(1);
      expect(use).toHaveLength(1);

      // pending dimension chain: RESERVE.after (1) == RELEASE.before (1); RELEASE.after == before - amount.
      expect(release[0].bef).toBe(reserve[0].aft);
      expect(release[0].aft).toBe((release[0].bef ?? 0) - release[0].amt);
      // used dimension chain: USE.after == USE.before + amount.
      expect(use[0].aft).toBe((use[0].bef ?? 0) + use[0].amt);

      // TAIL: current leave_balances matches the last row on each dimension (pending=0, used=USE.after).
      const finalState = await balanceState(balanceId);
      expect(finalState.pending).toBe(release[0].aft);
      expect(finalState.used).toBe(use[0].aft);
    });

    // ── HR adjust ×2 sequential: ADJUSTMENT chain (remaining dimension) continuous + tail; append-only ──
    it("[QA-05] HR adjust ×2 → ADJUSTMENT balance_before/after continuous + tail = remaining_days; ledger append-only", async () => {
      // fresh clean balance so the ledger chain is unambiguous (total=10, used=0, pending=0 → remaining=10).
      const empId = await seedUser(direct, A.companyId, `adj@${A.slug}.test`, await hash());
      const profile = await seedProfile(A.companyId, empId);
      const balanceId = await plantBalance(A.companyId, empId, profile, annualA, 10);
      const hrToken = await login(A.slug, `hr@${A.slug}.test`);

      // sequential (NOT parallel) → deterministic created_at ordering for the chain.
      const adj1 = await post(hrToken, `/leave/admin/balances/${balanceId}/adjust`, {
        amountDays: 3,
        reason: "bổ sung",
      });
      expect(adj1.status, JSON.stringify(adj1.body)).toBe(200);
      const adj2 = await post(hrToken, `/leave/admin/balances/${balanceId}/adjust`, {
        amountDays: -5,
        reason: "điều chỉnh giảm",
      });
      expect(adj2.status, JSON.stringify(adj2.body)).toBe(200);

      const rows = await ledgerRows(balanceId, "ADJUSTMENT");
      expect(rows).toHaveLength(2);
      // remaining chain: 10 → 13 → 8. Each row before == prior after; after == before + amount.
      expect(rows[0]).toMatchObject({ amt: 3, bef: 10, aft: 13 });
      expect(rows[1].bef).toBe(rows[0].aft); // continuity: adj2.before == adj1.after
      expect(rows[1].aft).toBe((rows[1].bef ?? 0) + rows[1].amt); // 13 + (-5) = 8
      // TAIL: last ADJUSTMENT.after == leave_balances.remaining_days.
      const state = await balanceState(balanceId);
      expect(state.remaining).toBe(rows[1].aft);

      // APPEND-ONLY (BẤT BIẾN #2): app role cannot tamper the audited chain (no UPDATE/DELETE grant).
      const pool = appPool();
      try {
        await expect(
          pool.query(
            `UPDATE leave_balance_transactions SET amount_days = 0 WHERE leave_balance_id=$1`,
            [balanceId],
          ),
        ).rejects.toThrow();
        await expect(
          pool.query(`DELETE FROM leave_balance_transactions WHERE leave_balance_id=$1`, [
            balanceId,
          ]),
        ).rejects.toThrow();
      } finally {
        await pool.end();
      }
    });
  },
);
