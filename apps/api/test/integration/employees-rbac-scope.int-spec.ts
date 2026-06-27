/**
 * S2-QA-1 — RBAC / data-scope over HTTP for HR list + detail (CROWN-JEWEL).
 *
 * Dựng app NestJS THẬT (Test.createTestingModule(AppModule)) + supertest → GET /hr/employees và
 * GET /hr/employees/:id chạy qua đường auth/permission THẬT (JwtAuthGuard → CompanyGuard →
 * TwoFactorEnforcementGuard → PermissionGuard → HrReadController → HrReadService). KHÔNG mock permission.
 *
 * RETARGET (S2-QA-1-FIX-A): trỏ vào endpoint THẬT có áp scope = /hr/employees (HrReadService, lane
 * S2-HR-BE-1). Endpoint cũ /employees (EmployeesService.listEmployees) CHỈ gate read:employee + RLS,
 * KHÔNG áp DataScopeService → mọi role có read:employee thấy toàn tenant ⇒ KHÔNG nghiệm thu được
 * Own/Team/Department. /hr/employees gọi resolveAndAssert + buildEmployeeScopeCondition Own/Team/
 * Department/Company/System nên các assert scope là XANH-THẬT (không còn it.fails đỏ-có-chủ-đích).
 *
 * Nguồn sự thật scope: docs/plans + auth-seed-canonical-roles §13 —
 *   read:employee : employee=Own · manager=Team · hr=Company · company-admin=Company · super-admin=System.
 *
 * Response shape /hr/employees: { items, meta } (paginated) → list parse qua res.body.data.items.
 * /hr/employees/:id trả detail object trực tiếp; out-of-scope/cross-tenant → 404 (NotFoundException,
 * KHÔNG lộ sự tồn tại hàng ngoài scope).
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env trỏ DB dev chung làm hasDb=true,
 * assertion sẽ chạm DB chung = đỏ-giả ⇒ CHỈ chạy khi LANE_DB set (DB cô lập).
 *
 * BẤT BIẾN kiểm chứng:
 *   #1 company_id mọi query: cross-tenant user KHÔNG đọc được hồ sơ tenant khác (RLS + predicate scope).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
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

// JWT_SECRET phải có TRƯỚC khi TokenService đọc env (constructor) — mirror các spec HTTP khác.
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!test99";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

type DataScope = "Own" | "Team" | "Department" | "Company" | "System";

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe.skipIf(!hasLaneDb)(
  "S2-QA-1 employees RBAC / data-scope (HTTP, real permission engine)",
  () => {
    const direct = directPool();
    let app: INestApplication;

    let A: SeededTenant;
    let B: SeededTenant;

    // Org tree (tenant A): Engineering (mgr + rep), Sales (peer, no manager).
    let ouEng = "";
    let ouSales = "";

    // Users + their employee profile ids (tenant A).
    let mgrUserId = "";
    let repUserId = "";
    let peerUserId = "";
    let hrUserId = "";
    let adminUserId = "";
    let sysUserId = "";
    let noPermUserId = ""; // có user nhưng KHÔNG có read:employee → deny-path

    let mgrProfileId = "";
    let repProfileId = "";
    let peerProfileId = "";

    // Tenant B (cross-tenant deny).
    let bUserId = "";
    let bProfileId = "";

    async function seedOrgUnit(companyId: string, name: string): Promise<string> {
      const r = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id",
        [companyId, name],
      );
      return r.rows[0].id as string;
    }

    async function seedEmployee(
      companyId: string,
      userId: string,
      orgUnitId: string | null,
      directManagerUserId: string | null,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, direct_manager_id, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [companyId, userId, orgUnitId, directManagerUserId],
      );
      return r.rows[0].id as string;
    }

    /**
     * Cấp cho `userId` một role company-scoped có DUY NHẤT grant read:employee với `scope` cho trước.
     * Mô phỏng §13 per-pair data_scope mà KHÔNG hard-code role-id hệ thống (scope điều khiển được).
     */
    async function grantReadEmployee(
      companyId: string,
      userId: string,
      scope: DataScope,
    ): Promise<void> {
      const roleId = await seedRole(
        direct,
        companyId,
        `qa-read-employee-${scope}-${userId.slice(0, 8)}`,
      );
      // read:employee có sẵn trong catalog (mig 0019, KHÔNG sensitive). seedPermissionCatalog idempotent.
      const permId = await seedPermissionCatalog(direct, "read", "employee", false);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      await seedUserRole(direct, userId, roleId, companyId);
    }

    beforeAll(async () => {
      const hash = await hashedPw();

      A = await seedCompany(direct, "rbacA");
      B = await seedCompany(direct, "rbacB");

      ouEng = await seedOrgUnit(A.companyId, "Engineering");
      ouSales = await seedOrgUnit(A.companyId, "Sales");

      // ── Users (tenant A) — mật khẩu ĐÚNG cho tất cả ──
      mgrUserId = await seedUser(direct, A.companyId, `mgr@${A.slug}.test`, hash);
      repUserId = await seedUser(direct, A.companyId, `rep@${A.slug}.test`, hash);
      peerUserId = await seedUser(direct, A.companyId, `peer@${A.slug}.test`, hash);
      hrUserId = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
      adminUserId = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
      sysUserId = await seedUser(direct, A.companyId, `sys@${A.slug}.test`, hash);
      noPermUserId = await seedUser(direct, A.companyId, `noperm@${A.slug}.test`, hash);

      // ── Employee profiles (the records being listed) ──
      mgrProfileId = await seedEmployee(A.companyId, mgrUserId, ouEng, null); // manager, Engineering
      repProfileId = await seedEmployee(A.companyId, repUserId, ouEng, mgrUserId); // report of mgr, Engineering
      peerProfileId = await seedEmployee(A.companyId, peerUserId, ouSales, null); // unrelated, Sales
      // hr/admin/sys are listed too (Company/System should see them).
      await seedEmployee(A.companyId, hrUserId, ouEng, null);
      await seedEmployee(A.companyId, adminUserId, ouSales, null);
      await seedEmployee(A.companyId, sysUserId, ouEng, null);

      // ── §13 read:employee scopes ──
      await grantReadEmployee(A.companyId, repUserId, "Own"); // employee scope
      await grantReadEmployee(A.companyId, mgrUserId, "Team"); // manager scope (reports ∪ self)
      await grantReadEmployee(A.companyId, hrUserId, "Department"); // dept scope (same org_unit) — hr seeded Dept here to test Department over HTTP
      await grantReadEmployee(A.companyId, adminUserId, "Company"); // company-admin scope
      await grantReadEmployee(A.companyId, sysUserId, "System"); // super-admin scope
      // noPermUserId: KHÔNG grant read:employee → deny-path.

      // ── Tenant B ──
      bUserId = await seedUser(direct, B.companyId, `b@${B.slug}.test`, hash);
      bProfileId = await seedEmployee(B.companyId, bUserId, null, null);
      await grantReadEmployee(B.companyId, bUserId, "Company"); // can read OWN tenant only

      // ── NestJS app (đường auth/permission thật) ──
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
    });

    afterAll(async () => {
      await direct
        .query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [
          [A.companyId, B.companyId],
        ])
        .catch(() => undefined);
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      if (app) await app.close();
    });

    /**
     * GET /hr/employees → mảng user_id thấy được (200 expected). /hr/employees trả { items, meta }
     * (HrEmployeeListResponse) bọc trong envelope → đọc res.body.data.items. pageSize=100 để 1 trang
     * chứa toàn bộ cây nhân sự seed (≤ 6 hồ sơ tenant A) — assert scope không bị cắt do phân trang.
     */
    async function listVisibleUserIds(token: string): Promise<string[]> {
      const res = await api(app).get("/hr/employees?pageSize=100").set(bearer(token));
      expect(res.status, `list failed: ${JSON.stringify(res.body)}`).toBe(200);
      const rows = res.body.data.items as Array<{ userId: string }>;
      expect(Array.isArray(rows)).toBe(true);
      return rows.map((r) => r.userId);
    }

    // ── DENY-PATH (GREEN ngay) ────────────────────────────────────────────────────

    it("DENY: GET /hr/employees KHÔNG có read:employee → 403 (fail-closed PermissionGuard)", async () => {
      const token = await login(app, A.slug, `noperm@${A.slug}.test`);
      const res = await api(app).get("/hr/employees").set(bearer(token));
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it("DENY: GET /hr/employees/:id KHÔNG có read:employee → 403", async () => {
      const token = await login(app, A.slug, `noperm@${A.slug}.test`);
      const res = await api(app).get(`/hr/employees/${repProfileId}`).set(bearer(token));
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    // ── ALLOW + SCOPE (Own/Team/Department) — XANH THẬT trên /hr/employees ───────────
    //
    // S2-QA-1-FIX-A: /hr/employees (HrReadService) ÁP DataScopeService.buildEmployeeScopeCondition,
    // nên Own/Team/Department lọc hàng THẬT theo data_scope đã grant. Đây là plain it() PHẢI XANH —
    // KHÔNG còn it.fails (endpoint /employees cũ thiếu scope không còn được WO này kiểm). Nếu một
    // trong các assert dưới ĐỎ ⇒ scope wiring hồi quy, KHÔNG che bằng it.fails.

    it("Own: employee CHỈ thấy hồ sơ CHÍNH MÌNH (data_scope=Own)", async () => {
      const token = await login(app, A.slug, `rep@${A.slug}.test`);
      const seen = await listVisibleUserIds(token);
      expect(seen.sort()).toEqual([repUserId]);
    });

    it("Team: manager thấy reports ∪ self, KHÔNG thấy peer (data_scope=Team)", async () => {
      const token = await login(app, A.slug, `mgr@${A.slug}.test`);
      const seen = await listVisibleUserIds(token);
      expect(seen.sort()).toEqual([mgrUserId, repUserId].sort());
      expect(seen).not.toContain(peerUserId);
    });

    it("Department: cùng org_unit, KHÔNG thấy phòng khác (data_scope=Department)", async () => {
      // hrUser scope=Department, org_unit=Engineering → thấy Engineering (mgr/rep/hr/sys), KHÔNG thấy Sales (peer/admin).
      const token = await login(app, A.slug, `hr@${A.slug}.test`);
      const seen = await listVisibleUserIds(token);
      expect(seen).toContain(mgrUserId);
      expect(seen).toContain(repUserId);
      expect(seen).toContain(hrUserId);
      expect(seen).not.toContain(peerUserId); // Sales
      expect(seen).not.toContain(adminUserId); // Sales
    });

    it("Company: company-admin thấy TOÀN tenant A, KHÔNG thấy tenant B (data_scope=Company)", async () => {
      const token = await login(app, A.slug, `admin@${A.slug}.test`);
      const seen = await listVisibleUserIds(token);
      expect(seen).toEqual(
        expect.arrayContaining([
          mgrUserId,
          repUserId,
          peerUserId,
          hrUserId,
          adminUserId,
          sysUserId,
        ]),
      );
      expect(seen).not.toContain(bUserId);
    });

    it("System: super-admin scope thấy toàn bộ tenant (data_scope=System, N=1 bounded tới tenant)", async () => {
      const token = await login(app, A.slug, `sys@${A.slug}.test`);
      const seen = await listVisibleUserIds(token);
      expect(seen).toEqual(
        expect.arrayContaining([
          mgrUserId,
          repUserId,
          peerUserId,
          hrUserId,
          adminUserId,
          sysUserId,
        ]),
      );
      expect(seen).not.toContain(bUserId);
    });

    it("GET /hr/employees/:id allow-path: company-admin xem hồ sơ trong tenant → 200", async () => {
      const token = await login(app, A.slug, `admin@${A.slug}.test`);
      const res = await api(app).get(`/hr/employees/${peerProfileId}`).set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.userId).toBe(peerUserId);
    });

    it("GET /hr/employees/:id out-of-scope: Own không xem được hồ sơ người khác → 404 (KHÔNG lộ tồn tại)", async () => {
      // rep scope=Own → chỉ hồ sơ chính mình. Xem hồ sơ peer (khác người) → 404, KHÔNG 200/403.
      const token = await login(app, A.slug, `rep@${A.slug}.test`);
      const res = await api(app).get(`/hr/employees/${peerProfileId}`).set(bearer(token));
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    // ── CROSS-TENANT DENY (BẤT BIẾN #1, GREEN) ──────────────────────────────────────

    it("cross-tenant: user công ty B KHÔNG thấy hồ sơ công ty A trong list", async () => {
      const token = await login(app, B.slug, `b@${B.slug}.test`);
      const seen = await listVisibleUserIds(token);
      expect(seen).toContain(bUserId); // thấy chính tenant B
      // KHÔNG lọt bất kỳ hồ sơ tenant A nào.
      for (const aUser of [mgrUserId, repUserId, peerUserId, hrUserId, adminUserId, sysUserId]) {
        expect(seen).not.toContain(aUser);
      }
    });

    it("cross-tenant: GET /hr/employees/:id của tenant A bằng token tenant B → 404 (RLS che, KHÔNG 200)", async () => {
      const token = await login(app, B.slug, `b@${B.slug}.test`);
      const res = await api(app).get(`/hr/employees/${mgrProfileId}`).set(bearer(token));
      expect(res.status).toBe(404);
      // KHÔNG lộ chuỗi salary trong body lỗi (BẤT BIẾN #3 — không rò field nhạy cảm).
      const blob = JSON.stringify(res.body);
      expect(blob).not.toContain("base_salary");
      expect(blob).not.toContain("baseSalary");
      void bProfileId;
      void mgrProfileId;
    });

    // ── S2-HR-EMP-LEGACY-LOCK-1: legacy GET /employees(/:id) now scoped + masked like /hr/employees ──
    //
    // Trước WO này, /employees(/:id) (EmployeesService) CHỈ gate read:employee + RLS → bất kỳ grantee
    // nào đọc được salaryType + PII của MỌI nhân viên trong tenant (IDOR + rò field nhạy cảm). Giờ áp
    // DataScopeService + masking (salaryType↔view-salary · phone/contractType/notes↔view-sensitive).
    describe("legacy /employees(/:id) — scoped + masked (LEGACY-LOCK)", () => {
      it("DENY: GET /employees KHÔNG có read:employee → 403", async () => {
        const token = await login(app, A.slug, `noperm@${A.slug}.test`);
        const res = await api(app).get("/employees").set(bearer(token));
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it("list scoped: rep (Own) GET /employees → CHỈ thấy hồ sơ chính mình (IDOR list đóng)", async () => {
        const token = await login(app, A.slug, `rep@${A.slug}.test`);
        const res = await api(app).get("/employees").set(bearer(token));
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const rows = res.body.data as Array<{ userId: string }>;
        expect(rows.map((r) => r.userId)).toEqual([repUserId]);
      });

      it("IDOR detail đóng: rep (Own) GET /employees/:id của peer → 404 (trước đây 200 + lộ salaryType)", async () => {
        const token = await login(app, A.slug, `rep@${A.slug}.test`);
        const res = await api(app).get(`/employees/${peerProfileId}`).set(bearer(token));
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
      });

      it("in-scope NHƯNG thiếu view-salary/view-sensitive → 200 với salaryType + PII = null (masked)", async () => {
        // admin scope=Company → thấy peer; KHÔNG view-salary/view-sensitive → salaryType (DB default
        // 'monthly') phải mask thành null ⇒ chứng minh salary-class gate chạy trên route legacy.
        const token = await login(app, A.slug, `admin@${A.slug}.test`);
        const res = await api(app).get(`/employees/${peerProfileId}`).set(bearer(token));
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.userId).toBe(peerUserId);
        expect(res.body.data.baseSalary).toBeNull();
        expect(res.body.data.salaryType).toBeNull();
        expect(res.body.data.phone).toBeNull();
        expect(res.body.data.contractType).toBeNull();
        expect(res.body.data.notes).toBeNull();
      });

      it("cross-tenant: GET /employees/:id tenant A bằng token tenant B → 404, KHÔNG rò salary", async () => {
        const token = await login(app, B.slug, `b@${B.slug}.test`);
        const res = await api(app).get(`/employees/${mgrProfileId}`).set(bearer(token));
        expect(res.status).toBe(404);
        const blob = JSON.stringify(res.body);
        expect(blob).not.toContain("salary_type");
        expect(blob).not.toContain("salaryType");
      });
    });
  },
);
