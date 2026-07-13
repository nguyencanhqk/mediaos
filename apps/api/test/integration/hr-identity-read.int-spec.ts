/**
 * HR-IDENTITY-READ-1 — sensitive CCCD/CMND (identity_*) read over HTTP (CROWN-JEWEL, BẤT BIẾN #3).
 *
 * Dựng app NestJS THẬT (Test.createTestingModule(AppModule)) + supertest và lái qua đường
 * auth/permission THẬT (JwtAuthGuard → CompanyGuard → TwoFactorEnforcementGuard → PermissionGuard →
 * HrReadController → HrReadService → PermissionService.can()). KHÔNG mock permission engine.
 *
 * Bề mặt kiểm chứng (SPEC-03 §14.18 "Giấy tờ — cần duyệt nghiêm ngặt"):
 *   - GET /hr/employees/:id (getHrEmployee)  — detail: identity_* reveal per view-identity + audit-per-view.
 *   - GET /hr/employees        (list)        — mỗi hàng allowed reveal + ĐÚNG 1 audit view-identity/hàng.
 *   - GET /hr/me/profile       (getMyProfile) — self reveal (employee Own chính chủ) + audit.
 *   - GET /auth/me             (capabilities) — cờ hiển thị 'view-identity:employee' (allowlist-gated).
 *
 * Field nhạy cảm: identity_number / identity_issue_date / identity_issue_place (employee_profiles,
 * schema src/db/schema/employees.ts). Cổng RIÊNG view-identity:employee (is_sensitive, mig 0494) —
 * CAO HƠN view-sensitive PII và view-salary: các grant đó KHÔNG mở identity; chỉ EXACT view-identity mở.
 *
 * Ma trận crown-jewel (ADR-0010, permission.decide §sensitive gate):
 *   - read:employee = điều kiện vào GET (PermissionGuard). Không có → 403 (kiểm ở rbac-scope spec).
 *   - view-identity:employee (is_sensitive=true) quyết định REVEAL identity trong body:
 *       · thiếu hẳn          → identity_*=null, KHÔNG audit view-identity.  (manager — deny)
 *       · CHỈ wildcard *:*   → masked (sensitive gate: wildcard KHÔNG thoả), KHÔNG audit.
 *       · exact non-wildcard ALLOW → giá trị THẬT + ĐÚNG 1 audit view-identity / lần xem (list = 1/hàng).
 *   - Role coverage: employee(Own — chính chủ) · hr(Company) · company-admin(Company) · manager(deny).
 *   - Body JSON khi mask KHÔNG chứa GIÁ TRỊ identity thật (chống rò qua JSON — BẤT BIẾN #3).
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env trỏ DB dev chung làm hasDb=true,
 * assertion chạm DB chung = đỏ-giả ⇒ CHỈ chạy khi LANE_DB set (DB cô lập).
 *
 * BẤT BIẾN kiểm chứng:
 *   #1 company_id mọi query: cross-tenant không lộ identity (RLS che → 404, body không chứa identity).
 *   #2 audit append-only: view-identity ghi qua AuditService trong CÙNG tenant tx — đếm row.
 *   #3 không lộ field nhạy cảm: masked body không chứa GIÁ TRỊ identity thật.
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

type DataScope = "Own" | "Team" | "Department" | "Company" | "System";

/** Giá trị identity THẬT (marker) seed vào DB — dò rò rỉ trong body khi bị mask. */
const TARGET_IDENTITY = {
  number: "070200099887", // CCCD 12 số — chuỗi độc nhất để dò leak
  issueDate: "2033-11-27", // date tương lai độc nhất (không đụng created/seed date)
  issuePlace: "CANHSAT-TARGET-XZ", // marker string độc nhất
};
const SELF_IDENTITY = {
  number: "070200011223",
  issueDate: "2032-02-02",
  issuePlace: "CANHSAT-SELF-QW",
};

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
  "HR-IDENTITY-READ-1 identity (CCCD) sensitive read (HTTP, real permission engine)",
  () => {
    const direct = directPool();
    let app: INestApplication;

    let A: SeededTenant;
    let B: SeededTenant;

    // Users (tenant A).
    let targetUserId = ""; // hồ sơ MỤC TIÊU có identity thật (người khác đọc)
    let hrUserId = ""; // read + view-identity Company → reveal + audit
    let adminUserId = ""; // read + view-identity Company (company-admin) → reveal + audit
    let managerUserId = ""; // read Company NHƯNG KHÔNG view-identity → identity null, no audit
    let wildcardUserId = ""; // read + wildcard *:* → sensitive gate chặn (null, no audit)
    let empSelfUserId = ""; // employee: read Own + view-identity Own; đọc hồ sơ CHÍNH CHỦ

    let targetProfileId = "";
    let empSelfProfileId = "";

    // Tenant B (cross-tenant deny).
    let bUserId = "";

    async function seedEmployeeWithIdentity(
      companyId: string,
      userId: string,
      identity: { number: string; issueDate: string; issuePlace: string },
    ): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles
           (company_id, user_id, status, identity_number, identity_issue_date, identity_issue_place)
         VALUES ($1, $2, 'active', $3, $4, $5) RETURNING id`,
        [companyId, userId, identity.number, identity.issueDate, identity.issuePlace],
      );
      return r.rows[0].id as string;
    }

    /** Đếm audit row view-identity theo object cho 1 tenant (append-only — chỉ tăng). */
    async function countAudit(companyId: string, objectId: string): Promise<number> {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM audit_logs
         WHERE company_id = $1 AND action = 'view-identity'
           AND object_type = 'employee' AND object_id = $2`,
        [companyId, objectId],
      );
      return r.rows[0].n as number;
    }

    /**
     * Cấp role company-scoped với DANH SÁCH grant (action, resourceType, scope). Mô phỏng §13 mà KHÔNG
     * hard-code role-id hệ thống. view-identity:employee có catalog sau mig 0494 (is_sensitive=true);
     * seedPermissionCatalog upsert idempotent để không phụ thuộc thứ tự chạy.
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
      const roleId = await seedRole(
        direct,
        companyId,
        `qa-identity-${label}-${userId.slice(0, 8)}`,
      );
      for (const g of grants) {
        const permId = await seedPermissionCatalog(direct, g.action, g.resourceType, g.sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", g.scope ?? "Company");
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    beforeAll(async () => {
      const hash = await hashedPw();

      A = await seedCompany(direct, "idA");
      B = await seedCompany(direct, "idB");

      targetUserId = await seedUser(direct, A.companyId, `target@${A.slug}.test`, hash);
      hrUserId = await seedUser(direct, A.companyId, `hr@${A.slug}.test`, hash);
      adminUserId = await seedUser(direct, A.companyId, `admin@${A.slug}.test`, hash);
      managerUserId = await seedUser(direct, A.companyId, `manager@${A.slug}.test`, hash);
      wildcardUserId = await seedUser(direct, A.companyId, `wildcard@${A.slug}.test`, hash);
      empSelfUserId = await seedUser(direct, A.companyId, `empself@${A.slug}.test`, hash);

      // Hồ sơ mục tiêu (người khác đọc) + hồ sơ chính chủ của employee.
      targetProfileId = await seedEmployeeWithIdentity(A.companyId, targetUserId, TARGET_IDENTITY);
      empSelfProfileId = await seedEmployeeWithIdentity(A.companyId, empSelfUserId, SELF_IDENTITY);

      // hr: read + view-identity EXACT Company → reveal + audit.
      await grant(A.companyId, hrUserId, "hr", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "view-identity", resourceType: "employee", sensitive: true, scope: "Company" },
      ]);
      // company-admin: read + view-identity EXACT Company → reveal + audit.
      await grant(A.companyId, adminUserId, "admin", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "view-identity", resourceType: "employee", sensitive: true, scope: "Company" },
      ]);
      // manager: read Company NHƯNG KHÔNG view-identity → identity masked (deny), no audit.
      await grant(A.companyId, managerUserId, "manager", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
      ]);
      // wildcard: read + wildcard *:* ALLOW → sensitive gate chặn view-identity (mask, no audit).
      await grant(A.companyId, wildcardUserId, "wildcard", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "*", resourceType: "*", sensitive: false, scope: "Company" },
      ]);
      // employee: read Own + view-identity Own → reveal CHÍNH CHỦ (chỉ thấy hồ sơ mình).
      await grant(A.companyId, empSelfUserId, "employee", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Own" },
        { action: "view-identity", resourceType: "employee", sensitive: true, scope: "Own" },
      ]);

      // Tenant B — user có read + view-identity (Company) trong tenant B, dùng cho cross-tenant deny.
      bUserId = await seedUser(direct, B.companyId, `b@${B.slug}.test`, hash);
      await grant(B.companyId, bUserId, "b-viewer", [
        { action: "read", resourceType: "employee", sensitive: false, scope: "Company" },
        { action: "view-identity", resourceType: "employee", sensitive: true, scope: "Company" },
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
      return api(app).get(`/hr/employees/${profileId}`).set(bearer(token));
    }

    /** Body JSON KHÔNG lộ GIÁ TRỊ identity thật (BẤT BIẾN #3). */
    function expectNoIdentityLeak(
      body: unknown,
      identity: { number: string; issuePlace: string },
    ): void {
      const blob = JSON.stringify(body);
      expect(blob).not.toContain(identity.number);
      expect(blob).not.toContain(identity.issuePlace);
    }

    // ── DENY (mask): thiếu view-identity → identity_*=null, NO audit ────────────────

    it("MASK: manager read:employee NHƯNG thiếu view-identity → identity_*=null + 0 audit + body không lộ", async () => {
      const before = await countAudit(A.companyId, targetProfileId);
      const token = await login(app, A.slug, `manager@${A.slug}.test`);
      const res = await getDetail(token, targetProfileId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.identityNumber).toBeNull();
      expect(res.body.data.identityIssueDate).toBeNull();
      expect(res.body.data.identityIssuePlace).toBeNull();
      expectNoIdentityLeak(res.body, TARGET_IDENTITY);
      expect(await countAudit(A.companyId, targetProfileId)).toBe(before);
    });

    it("MASK: chỉ wildcard *:* ALLOW → view-identity bị sensitive gate chặn → identity_*=null + 0 audit", async () => {
      const before = await countAudit(A.companyId, targetProfileId);
      const token = await login(app, A.slug, `wildcard@${A.slug}.test`);
      const res = await getDetail(token, targetProfileId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Wildcard KHÔNG thoả sensitive gate (permission.decide) → identity masked.
      expect(res.body.data.identityNumber).toBeNull();
      expect(res.body.data.identityIssueDate).toBeNull();
      expect(res.body.data.identityIssuePlace).toBeNull();
      expectNoIdentityLeak(res.body, TARGET_IDENTITY);
      expect(await countAudit(A.companyId, targetProfileId)).toBe(before);
    });

    // ── REVEAL: view-identity:employee exact → giá trị thật + ĐÚNG 1 audit / lần xem ─

    it("REVEAL: hr view-identity Company → identity thật + ĐÚNG 1 audit view-identity mỗi lần xem (detail)", async () => {
      const token = await login(app, A.slug, `hr@${A.slug}.test`);

      const before = await countAudit(A.companyId, targetProfileId);
      const res1 = await getDetail(token, targetProfileId);
      expect(res1.status, JSON.stringify(res1.body)).toBe(200);
      expect(res1.body.data.identityNumber).toBe(TARGET_IDENTITY.number);
      expect(res1.body.data.identityIssueDate).toBe(TARGET_IDENTITY.issueDate);
      expect(res1.body.data.identityIssuePlace).toBe(TARGET_IDENTITY.issuePlace);
      const after1 = await countAudit(A.companyId, targetProfileId);
      expect(after1 - before).toBe(1); // ĐÚNG 1 row mỗi lần xem

      // Xem lần 2 → thêm ĐÚNG 1 row (mỗi reveal là 1 audit, không gộp).
      const res2 = await getDetail(token, targetProfileId);
      expect(res2.status).toBe(200);
      expect(await countAudit(A.companyId, targetProfileId)).toBe(after1 + 1);
    });

    it("REVEAL: company-admin view-identity Company → identity thật + ĐÚNG 1 audit (detail)", async () => {
      const token = await login(app, A.slug, `admin@${A.slug}.test`);
      const before = await countAudit(A.companyId, targetProfileId);
      const res = await getDetail(token, targetProfileId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.identityNumber).toBe(TARGET_IDENTITY.number);
      expect(await countAudit(A.companyId, targetProfileId)).toBe(before + 1);
    });

    // ── employee Own (chính chủ) — reveal hồ sơ mình; KHÔNG thấy hồ sơ người khác ──

    it("REVEAL (self): employee view-identity Own xem hồ sơ CHÍNH CHỦ (GET /hr/employees/:id) → identity thật + 1 audit", async () => {
      const token = await login(app, A.slug, `empself@${A.slug}.test`);
      const before = await countAudit(A.companyId, empSelfProfileId);
      const res = await getDetail(token, empSelfProfileId);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.identityNumber).toBe(SELF_IDENTITY.number);
      expect(res.body.data.identityIssuePlace).toBe(SELF_IDENTITY.issuePlace);
      expect(await countAudit(A.companyId, empSelfProfileId)).toBe(before + 1);
    });

    it("REVEAL (self): employee GET /hr/me/profile → identity CHÍNH CHỦ thật + 1 audit", async () => {
      const token = await login(app, A.slug, `empself@${A.slug}.test`);
      const before = await countAudit(A.companyId, empSelfProfileId);
      const res = await api(app).get("/hr/me/profile").set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.identityNumber).toBe(SELF_IDENTITY.number);
      expect(res.body.data.identityIssueDate).toBe(SELF_IDENTITY.issueDate);
      expect(res.body.data.identityIssuePlace).toBe(SELF_IDENTITY.issuePlace);
      expect(await countAudit(A.companyId, empSelfProfileId)).toBe(before + 1);
    });

    it("SCOPE: employee Own KHÔNG xem được hồ sơ người khác (GET /hr/employees/:id target) → 404, không lộ + 0 audit", async () => {
      const before = await countAudit(A.companyId, targetProfileId);
      const token = await login(app, A.slug, `empself@${A.slug}.test`);
      const res = await getDetail(token, targetProfileId);
      expect(res.status).toBe(404);
      expectNoIdentityLeak(res.body, TARGET_IDENTITY);
      // Out-of-scope 404 xảy ra TRƯỚC revealIdentity ⇒ KHÔNG audit.
      expect(await countAudit(A.companyId, targetProfileId)).toBe(before);
    });

    // ── REVEAL (list): 1 audit view-identity / hàng allowed; deny → null, 0 audit ───

    it("REVEAL (list): hr GET /hr/employees → hàng mục tiêu identity thật + ĐÚNG 1 audit/hàng", async () => {
      const token = await login(app, A.slug, `hr@${A.slug}.test`);
      const before = await countAudit(A.companyId, targetProfileId);
      const res = await api(app).get("/hr/employees?pageSize=100").set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body.data.items as Array<{
        id: string;
        identityNumber: string | null;
        identityIssuePlace: string | null;
      }>;
      const targetRow = rows.find((r) => r.id === targetProfileId);
      expect(targetRow, "target profile must be in list").toBeDefined();
      expect(targetRow!.identityNumber).toBe(TARGET_IDENTITY.number);
      expect(targetRow!.identityIssuePlace).toBe(TARGET_IDENTITY.issuePlace);
      // List ghi ĐÚNG 1 audit view-identity cho hàng mục tiêu (per-row audit, HrReadService).
      expect(await countAudit(A.companyId, targetProfileId)).toBe(before + 1);
    });

    it("DENY (list): manager GET /hr/employees → hàng mục tiêu identity null + 0 audit + body không lộ", async () => {
      const token = await login(app, A.slug, `manager@${A.slug}.test`);
      const before = await countAudit(A.companyId, targetProfileId);
      const res = await api(app).get("/hr/employees?pageSize=100").set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = res.body.data.items as Array<{ id: string; identityNumber: string | null }>;
      const targetRow = rows.find((r) => r.id === targetProfileId);
      expect(targetRow, "target profile must be in list").toBeDefined();
      expect(targetRow!.identityNumber).toBeNull();
      expectNoIdentityLeak(res.body, TARGET_IDENTITY);
      expect(await countAudit(A.companyId, targetProfileId)).toBe(before);
    });

    // ── CROSS-TENANT (BẤT BIẾN #1) ──────────────────────────────────────────────────

    it("cross-tenant: viewer tenant B xem hồ sơ tenant A → 404 (RLS che), body KHÔNG lộ identity + 0 audit", async () => {
      const before = await countAudit(A.companyId, targetProfileId);
      const token = await login(app, B.slug, `b@${B.slug}.test`);
      const res = await getDetail(token, targetProfileId);
      expect(res.status).toBe(404);
      expectNoIdentityLeak(res.body, TARGET_IDENTITY);
      expect(await countAudit(A.companyId, targetProfileId)).toBe(before);
      void bUserId;
    });

    // ── /auth/me capabilities['view-identity:employee'] (allowlist-gated, grant-bound) ─

    async function meCapabilities(token: string): Promise<Record<string, boolean>> {
      const res = await api(app).get("/auth/me").set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res.body.data.capabilities as Record<string, boolean>;
    }

    it("/auth/me: hr → capabilities['view-identity:employee'] === true", async () => {
      const caps = await meCapabilities(await login(app, A.slug, `hr@${A.slug}.test`));
      expect(caps["view-identity:employee"]).toBe(true);
    });

    it("/auth/me: company-admin → capabilities['view-identity:employee'] === true", async () => {
      const caps = await meCapabilities(await login(app, A.slug, `admin@${A.slug}.test`));
      expect(caps["view-identity:employee"]).toBe(true);
    });

    it("/auth/me: employee (Own) → capabilities['view-identity:employee'] === true", async () => {
      const caps = await meCapabilities(await login(app, A.slug, `empself@${A.slug}.test`));
      expect(caps["view-identity:employee"]).toBe(true);
    });

    it("/auth/me: manager (KHÔNG grant) → capabilities['view-identity:employee'] VẮNG (least-privilege)", async () => {
      const caps = await meCapabilities(await login(app, A.slug, `manager@${A.slug}.test`));
      expect(caps["view-identity:employee"]).toBeUndefined();
    });
  },
);
