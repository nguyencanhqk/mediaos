/**
 * S2-QA-1 — sensitive-data salary over HTTP (CROWN-JEWEL, BẤT BIẾN #3).
 *
 * Dựng app NestJS THẬT (Test.createTestingModule(AppModule)) + supertest → GET /employees,
 * GET /employees/:id và PATCH /employees/:id chạy qua đường auth/permission THẬT
 * (JwtAuthGuard → CompanyGuard → TwoFactorEnforcementGuard → PermissionGuard → EmployeesController
 * → EmployeesService → PermissionService.can()). KHÔNG mock permission engine.
 *
 * Field nhạy cảm: base_salary (employee_profiles.base_salary) — field nhạy cảm DUY NHẤT hiện có trên
 * employee_profiles. GAP đã biết: schema KHÔNG có cột 'bank'/'bank_account' trên employee_profiles
 * (salary_profiles của PAYROLL Phase-2 mới có); KHÔNG bịa field → spec phủ base_salary và nêu rõ gap.
 *
 * Ma trận crown-jewel (ADR-0010, permission.service §3b):
 *   - read:employee là điều kiện vào GET (PermissionGuard). KHÔNG có → 403 (kiểm ở rbac-scope spec).
 *   - view-salary:employee (is_sensitive=true) quyết định REVEAL salary trong body:
 *       · thiếu hẳn         → baseSalary=null, KHÔNG audit view-salary.
 *       · CHỈ wildcard *:*  → masked (sensitive gate: wildcard KHÔNG thoả), KHÔNG audit.
 *       · exact non-wildcard ALLOW → baseSalary=number + ĐÚNG 1 audit row view-salary / lần xem
 *         (list = 1 row / item allowed).
 *   - update-salary:employee quyết định PATCH base_salary:
 *       · thiếu (hoặc chỉ wildcard) → 403 (ForbiddenException), KHÔNG write, KHÔNG audit update-salary.
 *       · exact non-wildcard ALLOW → write + ĐÚNG 1 audit row update-salary với before/after.
 *   - Body JSON khi mask KHÔNG chứa GIÁ TRỊ salary thật (chống rò qua JSON).
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env trỏ DB dev chung làm hasDb=true,
 * assertion chạm DB chung = đỏ-giả ⇒ CHỈ chạy khi LANE_DB set (DB cô lập).
 *
 * BẤT BIẾN kiểm chứng:
 *   #1 company_id mọi query: cross-tenant không lộ salary (RLS che → 404, body không chứa salary).
 *   #2 audit append-only: view-salary/update-salary ghi qua AuditService (cùng tenant tx) — đếm row.
 *   #3 không lộ secret/field nhạy cảm: masked body không chứa GIÁ TRỊ base_salary thật.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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

/** Lương thật seed vào DB — giá trị "đánh dấu" để dò rò rỉ trong body khi bị mask. */
const REAL_SALARY = "12345678.00"; // numeric(.,2); reveal → Number(...) = 12345678
const REAL_SALARY_NUM = 12345678;
const NEW_SALARY = 23456789; // PATCH target

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
  "S2-QA-1 employees salary sensitive (HTTP, real permission engine)",
  () => {
    const direct = directPool();
    let app: INestApplication;

    let A: SeededTenant;
    let B: SeededTenant;

    // Users (tenant A).
    let targetUserId = ""; // hồ sơ MỤC TIÊU có base_salary thật
    let readerUserId = ""; // read:employee Company NHƯNG KHÔNG có view-salary → mask
    let viewerUserId = ""; // read:employee + view-salary:employee exact → reveal + audit
    let wildcardUserId = ""; // chỉ wildcard *:* ALLOW → sensitive gate chặn (mask, no audit)
    let updaterUserId = ""; // read:employee + view-salary + update-salary → PATCH allowed
    let noUpdateUserId = ""; // read:employee + view-salary NHƯNG KHÔNG update-salary → PATCH 403

    let targetProfileId = "";

    // Tenant B (cross-tenant deny).
    let bUserId = "";

    async function seedSalariedEmployee(
      companyId: string,
      userId: string,
      baseSalary: string | null,
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, base_salary, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [companyId, userId, baseSalary],
      );
      return r.rows[0].id as string;
    }

    /** Đếm audit row theo action/object cho 1 tenant (append-only — chỉ tăng). */
    async function countAudit(
      companyId: string,
      action: "view-salary" | "update-salary",
      objectId: string,
    ): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
         WHERE company_id = $1 AND action = $2 AND object_type = 'employee' AND object_id = $3`,
        [companyId, action, objectId],
      );
      return r.rows[0].n as number;
    }

    /**
     * Cấp role company-scoped với DANH SÁCH grant (action, resourceType, scope). Mô phỏng §13 mà KHÔNG
     * hard-code role-id hệ thống. read/view-salary/update-salary đều có sẵn catalog (mig 0019).
     */
    async function grant(
      companyId: string,
      userId: string,
      label: string,
      grants: Array<{
        action: string;
        resourceType: string;
        sensitive: boolean;
        scope?: DataScope;
      }>,
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `qa-salary-${label}-${userId.slice(0, 8)}`);
      for (const g of grants) {
        const permId = await seedPermissionCatalog(direct, g.action, g.resourceType, g.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", g.scope ?? "Company");
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    beforeAll(async () => {
      const hash = await hashedPw();

      A = await seedCompany(direct, "salA");
      B = await seedCompany(direct, "salB");

      targetUserId = await seedUser(direct, A.companyId, `target@${A.slug}.test`, hash);
      readerUserId = await seedUser(direct, A.companyId, `reader@${A.slug}.test`, hash);
      viewerUserId = await seedUser(direct, A.companyId, `viewer@${A.slug}.test`, hash);
      wildcardUserId = await seedUser(direct, A.companyId, `wildcard@${A.slug}.test`, hash);
      updaterUserId = await seedUser(direct, A.companyId, `updater@${A.slug}.test`, hash);
      noUpdateUserId = await seedUser(direct, A.companyId, `noupdate@${A.slug}.test`, hash);

      // Hồ sơ mục tiêu có base_salary thật (giá trị đánh dấu để dò rò rỉ).
      targetProfileId = await seedSalariedEmployee(A.companyId, targetUserId, REAL_SALARY);

      // reader: thấy hồ sơ (read:employee Company) NHƯNG KHÔNG có view-salary → salary masked.
      await grant(A.companyId, readerUserId, "reader", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
      ]);
      // viewer: read + view-salary EXACT (is_sensitive) → reveal + audit.
      await grant(A.companyId, viewerUserId, "viewer", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "view-salary", resourceType: "employee", sensitive: true, scope: "Company" },
      ]);
      // wildcard: read + wildcard *:* ALLOW → sensitive gate chặn view-salary (mask, no audit).
      await grant(A.companyId, wildcardUserId, "wildcard", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "*", resourceType: "*", sensitive: false, scope: "Company" },
      ]);
      // updater: read + view-salary + update-salary EXACT → PATCH base_salary allowed.
      await grant(A.companyId, updaterUserId, "updater", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "update", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "view-salary", resourceType: "employee", sensitive: true, scope: "Company" },
        { action: "update-salary", resourceType: "employee", sensitive: true, scope: "Company" },
      ]);
      // noUpdate: read + update (non-salary) + view-salary NHƯNG KHÔNG update-salary → PATCH 403.
      await grant(A.companyId, noUpdateUserId, "noupdate", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "update", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "view-salary", resourceType: "employee", sensitive: true, scope: "Company" },
      ]);

      // Tenant B — user có read:employee (Company) trong tenant B, dùng cho cross-tenant deny.
      bUserId = await seedUser(direct, B.companyId, `b@${B.slug}.test`, hash);
      await grant(B.companyId, bUserId, "b-reader", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "view-salary", resourceType: "employee", sensitive: true, scope: "Company" },
      ]);

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

    async function getDetail(token: string, profileId: string) {
      return api(app).get(`/employees/${profileId}`).set(bearer(token));
    }

    // ── DENY (mask): thiếu view-salary:employee → baseSalary=null, NO audit ─────────

    it("MASK: read:employee NHƯNG thiếu view-salary → baseSalary=null + 0 audit view-salary + body không lộ salary thật", async () => {
      const before = await countAudit(A.companyId, "view-salary", targetProfileId);
      const token = await login(app, A.slug, `reader@${A.slug}.test`);
      const res = await getDetail(token, targetProfileId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.baseSalary).toBeNull();
      // Body KHÔNG chứa GIÁ TRỊ salary thật (BẤT BIẾN #3 — không rò field nhạy cảm qua JSON).
      const blob = JSON.stringify(res.body);
      expect(blob).not.toContain(REAL_SALARY); // "12345678.00"
      expect(blob).not.toContain(String(REAL_SALARY_NUM)); // 12345678
      // KHÔNG ghi audit view-salary khi không reveal.
      const after = await countAudit(A.companyId, "view-salary", targetProfileId);
      expect(after).toBe(before);
    });

    it("MASK: chỉ wildcard *:* ALLOW → view-salary bị sensitive gate chặn → baseSalary=null + 0 audit", async () => {
      const before = await countAudit(A.companyId, "view-salary", targetProfileId);
      const token = await login(app, A.slug, `wildcard@${A.slug}.test`);
      const res = await getDetail(token, targetProfileId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Wildcard KHÔNG thoả sensitive gate (permission.service §3b) → salary masked.
      expect(res.body.data.baseSalary).toBeNull();
      const blob = JSON.stringify(res.body);
      expect(blob).not.toContain(REAL_SALARY);
      const after = await countAudit(A.companyId, "view-salary", targetProfileId);
      expect(after).toBe(before);
    });

    // ── REVEAL: view-salary:employee exact → number + ĐÚNG 1 audit / lần xem ────────

    it("REVEAL: view-salary:employee exact → baseSalary=number + ĐÚNG 1 audit view-salary mỗi lần xem (detail)", async () => {
      const token = await login(app, A.slug, `viewer@${A.slug}.test`);

      const before = await countAudit(A.companyId, "view-salary", targetProfileId);
      const res1 = await getDetail(token, targetProfileId);
      expect(res1.status, JSON.stringify(res1.body)).toBe(200);
      expect(res1.body.data.baseSalary).toBe(REAL_SALARY_NUM);
      const after1 = await countAudit(A.companyId, "view-salary", targetProfileId);
      expect(after1 - before).toBe(1); // ĐÚNG 1 row mỗi lần xem

      // Xem lần 2 → thêm ĐÚNG 1 row (mỗi reveal là 1 audit, không gộp).
      const res2 = await getDetail(token, targetProfileId);
      expect(res2.status).toBe(200);
      const after2 = await countAudit(A.companyId, "view-salary", targetProfileId);
      expect(after2 - after1).toBe(1);
    });

    it("REVEAL (list): GET /employees với view-salary → mỗi item allowed có baseSalary=number + 1 audit/item", async () => {
      const token = await login(app, A.slug, `viewer@${A.slug}.test`);
      const before = await countAudit(A.companyId, "view-salary", targetProfileId);
      const res = await api(app).get("/employees").set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body.data as Array<{ id: string; baseSalary: number | null }>;
      const targetRow = rows.find((r) => r.id === targetProfileId);
      expect(targetRow, "target profile must be in list").toBeDefined();
      expect(targetRow!.baseSalary).toBe(REAL_SALARY_NUM);
      // List ghi ĐÚNG 1 audit view-salary cho item mục tiêu (per-item audit).
      const after = await countAudit(A.companyId, "view-salary", targetProfileId);
      expect(after - before).toBe(1);
    });

    // ── PATCH base_salary: gate update-salary:employee ──────────────────────────────

    it("DENY: PATCH base_salary thiếu update-salary:employee → 403, KHÔNG write, KHÔNG audit update-salary", async () => {
      const token = await login(app, A.slug, `noupdate@${A.slug}.test`);
      const before = await countAudit(A.companyId, "update-salary", targetProfileId);

      const res = await api(app)
        .patch(`/employees/${targetProfileId}`)
        .set(bearer(token))
        .send({ baseSalary: NEW_SALARY });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);

      // KHÔNG audit update-salary.
      const after = await countAudit(A.companyId, "update-salary", targetProfileId);
      expect(after).toBe(before);
      // KHÔNG write: base_salary trong DB vẫn là giá trị cũ.
      const row = await direct.query("SELECT base_salary FROM employee_profiles WHERE id = $1", [
        targetProfileId,
      ]);
      expect(Number(row.rows[0].base_salary)).toBe(REAL_SALARY_NUM);
    });

    it("ALLOW: PATCH base_salary có update-salary:employee → write + ĐÚNG 1 audit update-salary với before/after", async () => {
      const token = await login(app, A.slug, `updater@${A.slug}.test`);
      const before = await countAudit(A.companyId, "update-salary", targetProfileId);

      const res = await api(app)
        .patch(`/employees/${targetProfileId}`)
        .set(bearer(token))
        .send({ baseSalary: NEW_SALARY });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Mutation response mask salary mặc định (xem qua GET có audit) — KHÔNG lộ giá trị.
      expect(res.body.data.baseSalary).toBeNull();

      const after = await countAudit(A.companyId, "update-salary", targetProfileId);
      expect(after - before).toBe(1);

      // Audit row chứa before/after ĐÚNG (controlled audit trail, append-only).
      const auditRow = await direct.query(
        `SELECT before, after FROM audit_logs
         WHERE company_id = $1 AND action = 'update-salary' AND object_id = $2
         ORDER BY created_at DESC LIMIT 1`,
        [A.companyId, targetProfileId],
      );
      expect(auditRow.rows[0].before).toEqual({ base_salary: REAL_SALARY_NUM });
      expect(auditRow.rows[0].after).toEqual({ base_salary: NEW_SALARY });

      // DB thực sự cập nhật.
      const row = await direct.query("SELECT base_salary FROM employee_profiles WHERE id = $1", [
        targetProfileId,
      ]);
      expect(Number(row.rows[0].base_salary)).toBe(NEW_SALARY);
    });

    // ── CROSS-TENANT (BẤT BIẾN #1) ──────────────────────────────────────────────────

    it("cross-tenant: viewer tenant B xem hồ sơ tenant A → 404 (RLS che), body KHÔNG lộ salary", async () => {
      const token = await login(app, B.slug, `b@${B.slug}.test`);
      const res = await getDetail(token, targetProfileId);
      expect(res.status).toBe(404);
      const blob = JSON.stringify(res.body);
      expect(blob).not.toContain(REAL_SALARY);
      expect(blob).not.toContain("base_salary");
      void bUserId;
    });
  },
);
