/**
 * S3-QA-2 (qa2LeaveAttInt) — Integration (Postgres THẬT, DB CÔ LẬP). LEAVE→ATT sync (S3-SYNC-004) over the
 * REAL HTTP path (JwtAuthGuard → CompanyGuard → PermissionGuard → LeaveController → LeaveRequest/Revoke +
 * AttendanceLeaveSyncService → RLS withTenant). WO test-only: KHÔNG đổi hành vi service.
 *
 * THAM CHIẾU (KHÔNG rewrite) src/attendance/attendance-leave-sync.int.spec.ts (S3-INT-1) — nó đã phủ:
 *   full-day approve → ATT Leave/required=0 + check-in 409; CANCEL-non-owner 403; REVOKE-by-manager 403;
 *   cross-tenant revoke 404; HR revoke Approved+Synced → Revoked/ATT reverted/refunded + retry 409;
 *   internal recalculate deny + happy.
 *
 * ĐÂY = CÁC Ô LEAVE-OWNED CÒN THIẾU (không nhân bản):
 *
 *   [QA-03 · S3-SYNC-002] HALF-DAY approve → attendance_records.required_working_minutes GIẢM (480/2 = 240),
 *     status KHÔNG phải 'Leave' (partial, không chặn hẳn), work_mode null; day Synced; audit create in-tx.
 *
 *   [QA-03 · S3-SYNC-004] CANCEL bởi CHÍNH CHỦ (owner, self-service) đơn Approved+Synced full-day →
 *     status Cancelled + ATT recalc (Leave GỠ, required khôi phục 480) + REFUND ledger ĐÚNG SỐ
 *     (balance_before/after khớp, used khôi phục CHÍNH XÁC) + audit(attendance_record) revert in-tx +
 *     IDEMPOTENT: retry → 409, KHÔNG double-refund (đúng 1 dòng REFUND, used không đổi).
 *
 *   [QA-05 · tenant-isolation] CROSS-TENANT NO-SYNC: chạy sync đơn của công ty A DƯỚI tenant công ty B →
 *     0 xử lý, 0 attendance_records ở B, day-rows của A KHÔNG bị đụng (vẫn 'Pending'); sync lại dưới A →
 *     đúng (1 record ở A). Chứng minh company_id ép ở tầng DB (BẤT BIẾN #1) trong đường sync.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate: .env → hasDb=true ⇒ đỏ-giả trên DB
 * dev chung; chỉ chạy trên DB cô lập lane). test/**\/*.int-spec.ts → vitest include.
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
import { DatabaseService } from "../../src/db/db.service";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../../src/foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
import { AttMasterDataSeeder } from "../../src/attendance/att-master-data.seeder";
import { AttendanceLeaveSyncService } from "../../src/attendance/attendance-leave-sync.service";
import { directPool, hasDb } from "../helpers/integration-db";
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
const SHIFT_MINUTES = 480; // OFFICE_8H (AttMasterDataSeeder) — full working day.

type Scope = "Own" | "Team" | "Company";
type Pair = [action: string, resource: string, scope: Scope, sensitive?: boolean];

// Self-service employee (owner) — create/submit/cancel-own + read-own. cancel-own drives the owner-cancel cell.
const SELF_PAIRS: Pair[] = [
  ["create", "leave", "Own"],
  ["submit", "leave", "Own"],
  ["cancel-own", "leave", "Own"],
  ["view-own", "leave", "Own"],
  ["view-own", "leave-balance", "Own"],
  ["view", "leave-type", "Company"],
];
// HR@Company — approve + manage:attendance (for the ATT-record projection actor context).
const HR_PAIRS: Pair[] = [
  ["view", "leave", "Company", true],
  ["approve", "leave", "Company"],
  ["reject", "leave", "Company", true],
  ["revoke", "leave", "Company", true],
];
const ATT_MANAGE_PAIRS: Pair[] = [["manage", "attendance", "Company"]];

const DATES = {
  halfDay: "2027-05-03", // Monday   — half-day reduce cell
  ownerCancel: "2027-05-04", // Tuesday  — owner-cancel recalc + refund + idempotent cell
  crossTenant: "2027-05-05", // Wednesday — cross-tenant no-sync cell
} as const;

describe.skipIf(!runDb)(
  "S3-QA-2 LEAVE→ATT sync (half-day · owner-cancel refund · cross-tenant no-sync)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let annualA = "";
    let annualB = "";
    const u: Record<string, { id: string; profile: string }> = {};

    let _hash = "";
    async function hash(): Promise<string> {
      if (!_hash) _hash = await new PasswordService().hash(LOGIN_PW);
      return _hash;
    }

    async function seedProfile(companyId: string, userId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, employee_code, status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
        [companyId, userId, `E-${userId.slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    }

    async function grant(
      companyId: string,
      userId: string,
      label: string,
      pairs: Pair[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `qa2sync-${label}-${userId.slice(0, 8)}`);
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

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** Submit a single-day request (Pending + Reserved). durationType FullDay | HalfDay(Morning). */
    async function createPending(
      slug: string,
      email: string,
      leaveTypeId: string,
      date: string,
      kind: "FullDay" | "HalfDay",
    ): Promise<string> {
      const token = await login(slug, email);
      const body =
        kind === "HalfDay"
          ? {
              leaveTypeId,
              startDate: date,
              endDate: date,
              durationType: "HalfDay",
              halfDaySession: "Morning",
              submitNow: true,
            }
          : {
              leaveTypeId,
              startDate: date,
              endDate: date,
              durationType: "FullDay",
              submitNow: true,
            };
      const res = await post(token, "/leave/requests", body);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.status).toBe("Pending");
      return res.body.data.id as string;
    }

    /** Run the LEAVE→ATT projection the SAME way the EventBus consumer does (approve → onLeaveApproved). */
    async function runSync(companyId: string, requestId: string, actorId: string): Promise<number> {
      const dbsvc = app.get(DatabaseService);
      const sync = app.get(AttendanceLeaveSyncService);
      return dbsvc.withTenant(companyId, (tx) =>
        sync.syncApprovedRequestTx(tx, companyId, requestId, actorId),
      );
    }

    // ── DB probes ────────────────────────────────────────────────────────────────
    async function attRecord(companyId: string, userId: string, workDate: string) {
      const r = await direct.query(
        `SELECT attendance_status, required_working_minutes, work_mode FROM attendance_records
        WHERE company_id=$1 AND user_id=$2 AND work_date=$3 AND deleted_at IS NULL`,
        [companyId, userId, workDate],
      );
      return r.rows[0] as
        | { attendance_status: string; required_working_minutes: number; work_mode: string | null }
        | undefined;
    }
    async function countAttInCompany(companyId: string, workDate: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int n FROM attendance_records
        WHERE company_id=$1 AND work_date=$2 AND deleted_at IS NULL`,
        [companyId, workDate],
      );
      return r.rows[0].n as number;
    }
    async function daySyncStatus(requestId: string): Promise<string[]> {
      const r = await direct.query(
        `SELECT attendance_sync_status s FROM leave_request_days
        WHERE leave_request_id=$1 AND deleted_at IS NULL ORDER BY work_date`,
        [requestId],
      );
      return r.rows.map((x: { s: string }) => x.s);
    }
    async function usedDays(balanceId: string): Promise<number> {
      const r = await direct.query(`SELECT used_days::float u FROM leave_balances WHERE id=$1`, [
        balanceId,
      ]);
      return Number(r.rows[0].u);
    }
    async function refundRows(
      requestId: string,
    ): Promise<Array<{ amt: number; bef: number | null; aft: number | null }>> {
      const r = await direct.query(
        `SELECT amount_days::float amt, balance_before_days::float bef, balance_after_days::float aft
         FROM leave_balance_transactions
        WHERE leave_request_id=$1 AND transaction_type='REFUND'
        ORDER BY created_at, id`,
        [requestId],
      );
      return r.rows.map((x: { amt: number; bef: number | null; aft: number | null }) => ({
        amt: Number(x.amt),
        bef: x.bef == null ? null : Number(x.bef),
        aft: x.aft == null ? null : Number(x.aft),
      }));
    }
    async function countAudit(
      companyId: string,
      action: string,
      objectId: string,
    ): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int n FROM audit_logs
        WHERE company_id=$1 AND action=$2 AND object_type='attendance_record' AND object_id=$3`,
        [companyId, action, objectId],
      );
      return r.rows[0].n as number;
    }
    async function attRecordId(
      companyId: string,
      userId: string,
      workDate: string,
    ): Promise<string> {
      const r = await direct.query(
        `SELECT id FROM attendance_records
        WHERE company_id=$1 AND user_id=$2 AND work_date=$3 AND deleted_at IS NULL`,
        [companyId, userId, workDate],
      );
      return r.rows[0].id as string;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "qa2synca");
      B = await seedCompany(direct, "qa2syncb");
      companyIds.push(A.companyId, B.companyId);

      // Default shift (OFFICE_8H, requiredWorkingMinutes=480) + rule for A + B (same seeder as check-in/out).
      const seedDb = new DatabaseService();
      const registry = new MasterDataSeederRegistry();
      registry.register(new AttMasterDataSeeder());
      const runner = new MasterDataSeedRunner(seedDb, new SeedTrackingService(seedDb), registry);
      await runner.reconcileCompany(A.companyId);
      await runner.reconcileCompany(B.companyId);

      annualA = await plantType(A.companyId);
      annualB = await plantType(B.companyId);

      // Company A: HR approver (+ manage:attendance) and one self-service employee (owner).
      const hrId = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, await hash());
      u.hr = { id: hrId, profile: await seedProfile(A.companyId, hrId) };
      await grant(A.companyId, hrId, "hr", [...HR_PAIRS, ...ATT_MANAGE_PAIRS]);

      const emp = await seedUser(direct, A.companyId, `emp@${A.slug}.test`, await hash());
      u.emp = { id: emp, profile: await seedProfile(A.companyId, emp) };
      await grant(A.companyId, emp, "emp", SELF_PAIRS);

      // Company B: a self-service employee (the cross-tenant no-sync probe target).
      const bEmp = await seedUser(direct, B.companyId, `emp@${B.slug}.test`, await hash());
      u.bEmp = { id: bEmp, profile: await seedProfile(B.companyId, bEmp) };
      await grant(B.companyId, bEmp, "bemp", SELF_PAIRS);
      await plantBalance(B.companyId, bEmp, u.bEmp.profile, annualB, 20);
    });

    afterAll(async () => {
      await direct
        ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ══ [QA-03 · S3-SYNC-002] HALF-DAY approve → required minutes REDUCED (not fully blocked) ═════════
    it("half-day approve → attendance_records.required_working_minutes reduced to 480/2 (partial, not 'Leave'), day Synced, audit create", async () => {
      // Arrange: dedicated employee+balance so this day-row/ledger is unambiguous.
      const email = `half@${A.slug}.test`;
      const empId = await seedUser(direct, A.companyId, email, await hash());
      const profile = await seedProfile(A.companyId, empId);
      await grant(A.companyId, empId, "half", SELF_PAIRS);
      const balanceId = await plantBalance(A.companyId, empId, profile, annualA, 20);

      const reqId = await createPending(A.slug, email, annualA, DATES.halfDay, "HalfDay");
      const hrToken = await login(A.slug, `hr@${A.slug}.test`);

      // Act: approve (Pending → Approved; day-rows flagged Pending sync) then project onto attendance.
      const approve = await post(hrToken, `/leave/requests/${reqId}/approve`, { note: "half-day" });
      expect(approve.status, JSON.stringify(approve.body)).toBe(200);
      expect(approve.body.data.status).toBe("Approved");
      const processed = await runSync(A.companyId, reqId, u.hr.id);
      expect(processed).toBe(1);

      // Assert: required reduced to HALF the shift (240), NOT full-day 'Leave' block, day Synced, audit written.
      expect(await daySyncStatus(reqId)).toEqual(["Synced"]);
      const rec = await attRecord(A.companyId, empId, DATES.halfDay);
      expect(rec).toBeTruthy();
      expect(rec?.required_working_minutes).toBe(SHIFT_MINUTES / 2); // 240 — reduce, not 0
      expect(rec?.attendance_status).not.toBe("Leave"); // partial day never fully blocks
      expect(rec?.work_mode).toBeNull(); // work_mode 'Leave' is FULL-DAY only
      // half-day USE = 0.5 day (deducted at approve).
      expect(await usedDays(balanceId)).toBe(0.5);
      const recId = await attRecordId(A.companyId, empId, DATES.halfDay);
      expect(await countAudit(A.companyId, "attendance.leave_sync.create", recId)).toBe(1);
    });

    // ══ [QA-03 · S3-SYNC-004] OWNER-CANCEL Approved+Synced → recalc ATT + REFUND ledger + idempotent ══
    it("owner cancels Approved+Synced full-day → Cancelled, ATT recalc (Leave dropped, required 480), REFUND ledger exact, balance restored, retry 409 (no double-refund)", async () => {
      // Arrange: dedicated employee+balance (total=20) so the used/refund chain is owned by this one request.
      const email = `cancel@${A.slug}.test`;
      const empId = await seedUser(direct, A.companyId, email, await hash());
      const profile = await seedProfile(A.companyId, empId);
      await grant(A.companyId, empId, "cancel", SELF_PAIRS);
      const balanceId = await plantBalance(A.companyId, empId, profile, annualA, 20);
      expect(await usedDays(balanceId)).toBe(0); // fresh

      const reqId = await createPending(A.slug, email, annualA, DATES.ownerCancel, "FullDay");
      const hrToken = await login(A.slug, `hr@${A.slug}.test`);
      const approve = await post(hrToken, `/leave/requests/${reqId}/approve`, {});
      expect(approve.status, JSON.stringify(approve.body)).toBe(200);
      // project onto ATT: full-day → status 'Leave', required 0.
      await runSync(A.companyId, reqId, u.hr.id);
      const usedAfterApprove = await usedDays(balanceId);
      expect(usedAfterApprove).toBe(1); // full-day USE = 1
      const recBefore = await attRecord(A.companyId, empId, DATES.ownerCancel);
      expect(recBefore?.attendance_status).toBe("Leave");
      expect(recBefore?.required_working_minutes).toBe(0);
      const recId = await attRecordId(A.companyId, empId, DATES.ownerCancel);

      // Act: the OWNER (self-service, cancel-own:leave) cancels the Approved request over the REAL HTTP path.
      const empToken = await login(A.slug, email);
      const cancel = await post(empToken, `/leave/requests/${reqId}/cancel`, {
        cancelReason: "kế hoạch đổi",
      });
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
      expect(cancel.body.data.status).toBe("Cancelled");

      // Assert 1: ATT recalc INLINE (same tx) — 'Leave' dropped, required restored to the shift (480).
      const recAfter = await attRecord(A.companyId, empId, DATES.ownerCancel);
      expect(recAfter?.attendance_status).not.toBe("Leave");
      expect(recAfter?.required_working_minutes).toBe(SHIFT_MINUTES);
      // audit(object_type=attendance_record) revert written IN-TX with the cancel.
      expect(await countAudit(A.companyId, "attendance.leave_sync.revert", recId)).toBe(1);

      // Assert 2: REFUND ledger ĐÚNG SỐ — exactly one REFUND row, before=used-at-approve, after=before-1.
      const refunds = await refundRows(reqId);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({
        amt: 1,
        bef: usedAfterApprove,
        aft: usedAfterApprove - 1,
      });
      // balance used restored EXACTLY to the pre-approve value (0).
      expect(await usedDays(balanceId)).toBe(0);

      // Assert 3: IDEMPOTENT — retry cancel on an already-Cancelled request → 409, no double-refund/revert.
      const retry = await post(empToken, `/leave/requests/${reqId}/cancel`, {
        cancelReason: "retry",
      });
      expect(retry.status, JSON.stringify(retry.body)).toBe(409);
      expect(await refundRows(reqId)).toHaveLength(1); // still exactly one REFUND row
      expect(await usedDays(balanceId)).toBe(0); // unchanged
    });

    // ══ [QA-05 · tenant-isolation] CROSS-TENANT NO-SYNC — company_id ép ở DB (BẤT BIẾN #1) ════════════
    it("cross-tenant: syncing company A's Approved request UNDER company B → 0 processed, 0 ATT in B, A's days untouched; then sync under A works", async () => {
      // Arrange: employee+balance in A, an Approved (Pending-sync) full-day request.
      const email = `xt@${A.slug}.test`;
      const empId = await seedUser(direct, A.companyId, email, await hash());
      const profile = await seedProfile(A.companyId, empId);
      await grant(A.companyId, empId, "xt", SELF_PAIRS);
      await plantBalance(A.companyId, empId, profile, annualA, 20);
      const reqId = await createPending(A.slug, email, annualA, DATES.crossTenant, "FullDay");
      const hrToken = await login(A.slug, `hr@${A.slug}.test`);
      expect((await post(hrToken, `/leave/requests/${reqId}/approve`, {})).status).toBe(200);
      expect(await daySyncStatus(reqId)).toEqual(["Pending"]); // flagged, not yet synced

      // Act 1: attempt the sync of A's request UNDER tenant B — RLS + company_id must find NOTHING.
      const processedUnderB = await runSync(B.companyId, reqId, u.bEmp.id);

      // Assert: 0 processed, ZERO attendance_records materialised in company B, A's day-row untouched.
      expect(processedUnderB).toBe(0);
      expect(await countAttInCompany(B.companyId, DATES.crossTenant)).toBe(0);
      expect(await daySyncStatus(reqId)).toEqual(["Pending"]); // B could not touch A's rows
      expect(await attRecord(A.companyId, empId, DATES.crossTenant)).toBeUndefined(); // none in A yet either

      // Act 2: same sync UNDER the CORRECT tenant A → materialises exactly one record in A only.
      const processedUnderA = await runSync(A.companyId, reqId, u.hr.id);
      expect(processedUnderA).toBe(1);
      expect(await daySyncStatus(reqId)).toEqual(["Synced"]);
      expect((await attRecord(A.companyId, empId, DATES.crossTenant))?.attendance_status).toBe(
        "Leave",
      );
      expect(await countAttInCompany(B.companyId, DATES.crossTenant)).toBe(0); // still nothing crossed over
    });
  },
);
