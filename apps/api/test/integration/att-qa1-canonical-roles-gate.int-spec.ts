/**
 * S3-QA-1 — canonical role gate (employee/manager/hr/company-admin) for ATT. Fills the gap that the
 * bespoke-role suites (attendance-be2/be6.int.spec.ts) don't close: those prove the (action, data_scope)
 * MATRIX works with a controllable custom role, but never exercise the 4 REAL canonical roles seeded by
 * migration 0454. `attendance-permission.int-spec.ts` (G11-1) already proves canonical `employee` ALLOW
 * check-in / DENY approve+lockPeriod+listMonthly — this file does NOT repeat those 2 assertions; it adds
 * the 3 REMAINING canonical roles (manager/hr/company-admin) + the READ routes (view-team/view-company/
 * view-detail), split per plan into:
 *
 *   (A) permission GATE via PermissionGuard.canActivate(ctxFor(...)) — the REAL guard (real DB grants via
 *       app.get(PermissionGuard, {strict:false}), same instance the HTTP path uses), no employee_profiles/
 *       scope data needed (the guard only checks the (action,resourceType) grant, not scope membership).
 *
 *   (B) scope FILTER + mask via DI (app.get(AttendanceReadService)) — ONLY for listTeamRecords /
 *       listCompanyRecords / getRecordDetail: these self-resolveAndAssert internally so DI is a valid
 *       path (mirrors HrReadService precedent). NEVER via DI for checkIn/checkOut — that gate lives on
 *       the CONTROLLER (@RequirePermission), and DI would silently bypass the very guard being proven
 *       (plan-review PLAN-FIX BLOCKING).
 *
 * Role canonical (company_id IS NULL, shared globally) — resolved by NAME, never hard-coded UUID (plan
 * requirement), so a lane running in parallel with a different migration head cannot silently mismatch.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env → hasDb=true ⇒ đỏ-giả trên DB
 * dev chung; chỉ chạy trên DB cô lập lane.
 */

import "reflect-metadata";
import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AttendanceRecordListQuery } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { PermissionGuard } from "../../src/permission/guards/permission.guard";
import { AttendanceController } from "../../src/attendance/attendance.controller";
import { AttendanceReadService } from "../../src/attendance/attendance-read.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const WD = "2024-08-01";

const LIST_QUERY: AttendanceRecordListQuery = {
  page: 1,
  pageSize: 100,
  sort: "workDate",
  order: "desc",
};

describe.skipIf(!runDb)(
  "S3-QA-1 canonical role gate — employee/manager/hr/company-admin (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let guard: PermissionGuard;
    let readSvc: AttendanceReadService;

    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let roleManagerId = "";
    let roleHrId = "";
    let roleCompanyAdminId = "";

    // Tenant A — canonical-role users.
    let mgrUser = "";
    let empUser = "";
    let otherMgrUser = "";
    let otherEmpUser = "";
    let hrUser = "";
    let adminUser = "";

    // Tenant B — cross-company probes.
    let bHrUser = "";
    let bAdminUser = "";
    let bOtherUser = "";

    let recMgr = "";

    /** Resolve canonical role id BY NAME (company_id IS NULL) — plan requirement, no hard-coded UUID. */
    async function canonicalRoleId(name: string): Promise<string> {
      const r = await direct.query(
        "SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL",
        [name],
      );
      if (r.rows.length === 0) {
        throw new Error(
          `[S3-QA-1] canonical role không tồn tại: ${name} (mig 0444 phải chạy trước)`,
        );
      }
      return r.rows[0].id as string;
    }

    async function seedOrgUnit(companyId: string, name: string): Promise<string> {
      const r = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
        [companyId, name],
      );
      return r.rows[0].id as string;
    }

    async function seedEmp(
      companyId: string,
      userId: string,
      orgUnitId: string | null,
      directManagerUserId: string | null,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, direct_manager_id, status)
         VALUES ($1,$2,$3,$4,'active') RETURNING id`,
        [companyId, userId, orgUnitId, directManagerUserId],
      );
      return r.rows[0].id as string;
    }

    async function plantRecord(
      companyId: string,
      userId: string,
      workDate: string,
      withLocation = false,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO attendance_records
           (company_id, user_id, work_date, status, attendance_status, location_json, check_in_at,
            late_minutes, early_leave_minutes, working_minutes)
         VALUES ($1,$2,$3,'present','Present',$4::jsonb,$5,0,0,480) RETURNING id`,
        [
          companyId,
          userId,
          workDate,
          withLocation ? JSON.stringify({ lat: 10.77, lng: 106.7, label: "HQ" }) : null,
          `${workDate}T01:00:00Z`,
        ],
      );
      return r.rows[0].id as string;
    }

    /** Dựng ExecutionContext giả gắn handler thật của controller + user đã seed — mirrors G11-1 ctxFor. */
    function ctxFor(
      methodName: keyof AttendanceController,
      userId: string,
      companyId: string,
    ): ExecutionContext {
      const handler = AttendanceController.prototype[methodName] as (...a: unknown[]) => unknown;
      const req = { user: { id: userId, companyId }, params: {} };
      return {
        getHandler: () => handler,
        getClass: () => AttendanceController,
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      await app.init();

      guard = app.get(PermissionGuard, { strict: false });
      readSvc = app.get(AttendanceReadService, { strict: false });

      direct = directPool();
      A = await seedCompany(direct, "qa1cra");
      B = await seedCompany(direct, "qa1crb");
      companyIds.push(A.companyId, B.companyId);

      roleManagerId = await canonicalRoleId("manager");
      roleHrId = await canonicalRoleId("hr");
      roleCompanyAdminId = await canonicalRoleId("company-admin");

      const ouEng = await seedOrgUnit(A.companyId, "Engineering");
      const ouSales = await seedOrgUnit(A.companyId, "Sales");

      mgrUser = await seedUser(direct, A.companyId, `mgr-${A.slug}@x.test`);
      empUser = await seedUser(direct, A.companyId, `emp-${A.slug}@x.test`);
      otherMgrUser = await seedUser(direct, A.companyId, `othermgr-${A.slug}@x.test`);
      otherEmpUser = await seedUser(direct, A.companyId, `otheremp-${A.slug}@x.test`);
      hrUser = await seedUser(direct, A.companyId, `hr-${A.slug}@x.test`);
      adminUser = await seedUser(direct, A.companyId, `admin-${A.slug}@x.test`);

      await seedUserRole(direct, mgrUser, roleManagerId, A.companyId);
      await seedUserRole(direct, otherMgrUser, roleManagerId, A.companyId);
      await seedUserRole(direct, hrUser, roleHrId, A.companyId);
      await seedUserRole(direct, adminUser, roleCompanyAdminId, A.companyId);

      await seedEmp(A.companyId, mgrUser, ouEng, null);
      await seedEmp(A.companyId, empUser, ouEng, mgrUser); // direct report of mgr
      await seedEmp(A.companyId, otherMgrUser, ouSales, null);
      await seedEmp(A.companyId, otherEmpUser, ouSales, otherMgrUser); // report of otherMgr (khác team)
      await seedEmp(A.companyId, hrUser, ouEng, null);
      await seedEmp(A.companyId, adminUser, ouEng, null);

      recMgr = await plantRecord(A.companyId, mgrUser, WD, true);
      await plantRecord(A.companyId, empUser, WD);
      await plantRecord(A.companyId, otherMgrUser, WD);
      await plantRecord(A.companyId, otherEmpUser, WD);

      // Tenant B — cross-company probes (hr + company-admin canonical, KHÔNG được thấy dữ liệu A).
      bHrUser = await seedUser(direct, B.companyId, `hr-${B.slug}@x.test`);
      bAdminUser = await seedUser(direct, B.companyId, `admin-${B.slug}@x.test`);
      bOtherUser = await seedUser(direct, B.companyId, `other-${B.slug}@x.test`);
      await seedUserRole(direct, bHrUser, roleHrId, B.companyId);
      await seedUserRole(direct, bAdminUser, roleCompanyAdminId, B.companyId);
      await seedEmp(B.companyId, bOtherUser, null, null);
      await plantRecord(B.companyId, bOtherUser, WD);
    });

    afterAll(async () => {
      await direct
        ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ═══ (A) Permission GATE qua PermissionGuard thật (ctxFor) — 3 role còn thiếu ═══════════════
    // 'employee' ALLOW check-in / DENY approve+lockPeriod+listMonthly ĐÃ CÓ ở attendance-permission
    // .int-spec.ts (G11-1) — KHÔNG lặp lại ở đây.

    it("manager ALLOW view-team (listTeamRecords) — canonical grant Team (mig 0454)", async () => {
      await expect(
        guard.canActivate(ctxFor("listTeamRecords", mgrUser, A.companyId)),
      ).resolves.toBe(true);
    });

    it("manager DENY view-company (listCompanyRecords) — canonical KHÔNG có grant Company", async () => {
      await expect(
        guard.canActivate(ctxFor("listCompanyRecords", mgrUser, A.companyId)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("hr ALLOW view-team (listTeamRecords)", async () => {
      await expect(guard.canActivate(ctxFor("listTeamRecords", hrUser, A.companyId))).resolves.toBe(
        true,
      );
    });

    it("hr ALLOW view-company (listCompanyRecords)", async () => {
      await expect(
        guard.canActivate(ctxFor("listCompanyRecords", hrUser, A.companyId)),
      ).resolves.toBe(true);
    });

    it("hr ALLOW view-detail (getRecordDetail)", async () => {
      await expect(guard.canActivate(ctxFor("getRecordDetail", hrUser, A.companyId))).resolves.toBe(
        true,
      );
    });

    it("company-admin ALLOW view-team (listTeamRecords)", async () => {
      await expect(
        guard.canActivate(ctxFor("listTeamRecords", adminUser, A.companyId)),
      ).resolves.toBe(true);
    });

    it("company-admin ALLOW view-company (listCompanyRecords)", async () => {
      await expect(
        guard.canActivate(ctxFor("listCompanyRecords", adminUser, A.companyId)),
      ).resolves.toBe(true);
    });

    it("company-admin ALLOW view-detail (getRecordDetail)", async () => {
      await expect(
        guard.canActivate(ctxFor("getRecordDetail", adminUser, A.companyId)),
      ).resolves.toBe(true);
    });

    // ═══ (B) Scope FILTER + mask qua DI (route ĐỌC — tự resolveAndAssert nội bộ, DI hợp lệ) ═══════

    it("manager (Team) listTeamRecords → self + report; KHÔNG thấy team khác (IDOR)", async () => {
      const res = await readSvc.listTeamRecords(
        { id: mgrUser, companyId: A.companyId },
        LIST_QUERY,
      );
      const seen = new Set(res.items.map((r) => r.userId));
      expect(seen.has(mgrUser)).toBe(true); // self
      expect(seen.has(empUser)).toBe(true); // direct report
      expect(seen.has(otherMgrUser)).toBe(false); // team khác
      expect(seen.has(otherEmpUser)).toBe(false); // team khác
    });

    it("hr (Company) listCompanyRecords → thấy CẢ 2 team", async () => {
      const res = await readSvc.listCompanyRecords(
        { id: hrUser, companyId: A.companyId },
        LIST_QUERY,
      );
      const seen = new Set(res.items.map((r) => r.userId));
      for (const u of [mgrUser, empUser, otherMgrUser, otherEmpUser]) {
        expect(seen.has(u)).toBe(true);
      }
    });

    it("company-admin (Company) listCompanyRecords → thấy CẢ 2 team", async () => {
      const res = await readSvc.listCompanyRecords(
        { id: adminUser, companyId: A.companyId },
        LIST_QUERY,
      );
      const seen = new Set(res.items.map((r) => r.userId));
      for (const u of [mgrUser, empUser, otherMgrUser, otherEmpUser]) {
        expect(seen.has(u)).toBe(true);
      }
    });

    it("cross-company: tenant B hr listCompanyRecords → chỉ thấy record của B, KHÔNG thấy user nào của tenant A", async () => {
      const res = await readSvc.listCompanyRecords(
        { id: bHrUser, companyId: B.companyId },
        LIST_QUERY,
      );
      const seen = res.items.map((r) => r.userId);
      // Positive control TRƯỚC — chống pass-giả khi response rỗng (vacuous pass che mất bug over-restriction).
      expect(res.items.length).toBe(1);
      expect(seen).toContain(bOtherUser);
      for (const u of [mgrUser, empUser, otherMgrUser, otherEmpUser]) {
        expect(seen).not.toContain(u);
      }
    });

    it("cross-company: tenant B company-admin listCompanyRecords → chỉ thấy record của B, KHÔNG thấy user nào của tenant A", async () => {
      const res = await readSvc.listCompanyRecords(
        { id: bAdminUser, companyId: B.companyId },
        LIST_QUERY,
      );
      const seen = res.items.map((r) => r.userId);
      expect(res.items.length).toBe(1);
      expect(seen).toContain(bOtherUser);
      for (const u of [mgrUser, empUser, otherMgrUser, otherEmpUser]) {
        expect(seen).not.toContain(u);
      }
    });

    it("service-level DENY: user KHÔNG có grant view-company gọi listCompanyRecords qua DI → ForbiddenException (resolveAndAssert, không chỉ controller guard)", async () => {
      await expect(
        readSvc.listCompanyRecords({ id: mgrUser, companyId: A.companyId }, LIST_QUERY),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("hr (view-sensitive Company) getRecordDetail → locationJson THẬT", async () => {
      const detail = await readSvc.getRecordDetail({ id: hrUser, companyId: A.companyId }, recMgr);
      expect(detail.locationJson).toMatchObject({ label: "HQ" });
    });

    it("company-admin (view-sensitive Company) getRecordDetail → locationJson THẬT", async () => {
      const detail = await readSvc.getRecordDetail(
        { id: adminUser, companyId: A.companyId },
        recMgr,
      );
      expect(detail.locationJson).toMatchObject({ label: "HQ" });
    });

    it("manager (KHÔNG view-sensitive) getRecordDetail (own record, Team scope) → locationJson NULL", async () => {
      const detail = await readSvc.getRecordDetail({ id: mgrUser, companyId: A.companyId }, recMgr);
      expect(detail.locationJson).toBeNull();
    });
  },
);
