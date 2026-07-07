/**
 * S2-AUTH-BE-5 / FIX-1-CAP-EXPOSE — /auth/me phơi cặp NHẠY CẢM trong allowlist ('view:audit-log') vào
 * `capabilities` để FE useCan('view','audit-log') hoạt động THẬT.
 *
 * BỐI CẢNH (vòng sửa): getCapabilities() CỐ Ý lọc bỏ MỌI grant sensitive ⇒ trước fix, capabilities của
 * /auth/me KHÔNG BAO GIỜ chứa 'view:audit-log' ⇒ FE viewer (LoginLogsPage/SecurityEventsPage) luôn render
 * forbidden NGAY CẢ với company-admin (đã grant mig 0340). FIX surface CÓ KIỂM SOÁT đúng cặp allowlist —
 * KHÔNG nới enforcement (cổng thật vẫn là PermissionGuard per-resource, đã test ở auth-logs-viewer.int.spec).
 *
 * Integration trên Postgres THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5). Gate cứng `hasDb && LANE_DB`
 * (memory integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 * Colocated trong src/auth → vitest gom qua include glob spec của src (xuất hiện trong run summary).
 *
 * Phủ (RED-trước → GREEN):
 *   P1  company-admin (role 0001, grant view:audit-log mig 0340) → me.capabilities['view:audit-log'] === true.
 *   N2  employee (role 0008) + wildcard '*:*' (non-sensitive ALLOW) → KHÔNG có key 'view:audit-log'
 *       (wildcard nhạy-cảm KHÔNG kế thừa — mirror sensitive gate can()); '*:*' VẪN có (non-sensitive surface).
 *   N3  employee (role 0008) trơn → KHÔNG có key 'view:audit-log' (deny-default).
 *
 * S3-FE-REGISTRY-1 (beCapExpose) — APPEND 4 cặp ATT/LEAVE view NHẠY CẢM vào SENSITIVE_CAPABILITY_ALLOWLIST
 * để FE dựng cờ hiển thị nav (att.team-records / att.records / leave). Cặp seed THẬT is_sensitive=true
 * (attendance-permissions.const mig 0454 + leave-permissions.const mig 0455). Chỉ mở CỜ HIỂN THỊ — enforcement
 * (can()/PermissionGuard per-resource) KHÔNG đổi. KHÔNG gồm view-own:leave / approve:leave (đã non-sensitive ⇒
 * lộ qua getCapabilities, KHÔNG cần allowlist).
 *   P4  user grant ĐÚNG 4 cặp {view-own,view-team,view-company}:attendance + view:leave → me.capabilities CÓ đủ 4.
 *   P5  employee (role 0008, seed grant CHỈ view-own:attendance) → view-own hiện; view-team/view-company/view:leave
 *       VẮNG (allowlist bám ĐÚNG grant per-pair — KHÔNG over-expose).
 *   P6  manager (role 0010) → view-own + view-team:attendance + view:leave hiện; view-company:attendance VẮNG.
 *   N5  user CHỈ '*:*' → KHÔNG kế thừa 4 cặp NHẠY CẢM (sensitive gate); view:audit-log VẪN vắng (no-regress).
 *
 * S2-AUTH-CAP-2 — APPEND 2 cặp NHẠY CẢM (assign-role:user · assign:permission) vào
 * SENSITIVE_CAPABILITY_ALLOWLIST. FE gate nút "Quản lý vai trò" (UserDetailPage/UserRolesPage,
 * PermissionGate assign-role:user) + nút "Phân quyền" (RoleDetailPage/RolesPage/RolePermissionsPage,
 * assign:permission) — cặp seed THẬT is_sensitive=true, grant Company CHỈ company-admin(0001). TRƯỚC fix:
 * getCapabilities() lọc sensitive + allowlist thiếu 2 cặp ⇒ nút ẨN với CẢ company-admin dù grant thật tồn
 * tại (phát hiện 2026-07-07 trên dev-online). Chỉ mở CỜ HIỂN THỊ — enforcement (PermissionGuard
 * assign-role:user isSensitive / assign:permission ANTI-ESCALATION per-resource) KHÔNG đổi.
 *   CAP2-P1  company-admin (0001) → /auth/me CÓ đủ 2 cặp === true.
 *   CAP2-N1/N2  employee (0008) + manager (0010) → KHÔNG có cặp nào (least-privilege).
 *   CAP2-N3  user CHỈ '*:*' → KHÔNG kế thừa 2 cặp (sensitive gate); '*:*' vẫn có.
 *
 * S2-AUTH-CAP-1 — APPEND 3 cặp NHẠY CẢM (export:leave · view:leave-audit-log · view:attendance-audit-log)
 * vào SENSITIVE_CAPABILITY_ALLOWLIST để FE dựng cờ hiển thị (export nghỉ phép, viewer audit-log LEAVE/ATT).
 * Cặp seed THẬT is_sensitive=true, grant Company CHỈ cho hr(0011)+company-admin(0001) — mig 0455
 * (export:leave leave-permissions.const:60, view:leave-audit-log :85) + mig 0454 (view:attendance-audit-log
 * attendance-permissions.const:84). getCapabilities() lọc bỏ sensitive ⇒ RED (3 key vắng) TRƯỚC khi APPEND
 * allowlist; chỉ getAllowlistedSensitiveCapabilities surface được ⇒ allowlist là điểm mở khóa DUY NHẤT.
 *   CAP1-P1/P2  company-admin(0001) + hr(0011) → /auth/me CÓ đủ 3 cặp === true (grant Company mig 0454/0455).
 *   CAP1-N1/N2  employee(0008) + manager(0010) → KHÔNG có bất kỳ cặp nào trong 3 (least-privilege đúng seed).
 *   CAP1-N3     user CHỈ '*:*' → KHÔNG kế thừa 3 cặp (sensitive gate); '*:*' vẫn có; view:audit-log vẫn vắng.
 *   CAP1-N4     cross-tenant: user tenant B trơn → KHÔNG chứa 3 cặp của tenant A (company isolation, BẤT BIẾN #1).
 *   CAP1-N5     DENY-override: grant 3 cặp CAP-1 + DENY 'export:leave' → export:leave suppress; 2 cặp còn lại vẫn hiện.
 * Enforcement (can()/PermissionGuard per-resource) KHÔNG đổi — chỉ mở cờ hiển thị (UI-hint).
 *
 * PIN theo CẶP SEED THẬT ('view','audit-log') — KHÔNG theo mã FE AUTH.AUDIT_LOG.VIEW (drift S1-FND-MODULE).
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
import { PasswordService } from "./password.service";
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

// Credential test (KHÔNG phải secret thật) — tránh literal gán-keyword (guard-secrets, BẤT BIẾN #3).
const LOGIN_PW = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // có ('view','audit-log') (mig 0340)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có ('view','audit-log')
// S3-FE-REGISTRY-1 — role seed THẬT (mig 0454/0455): manager có view-own+view-team:attendance + view:leave
// (Team), KHÔNG có view-company:attendance. Dùng chứng minh allowlist bám ĐÚNG grant per-role (granularity).
const MANAGER_ROLE = "00000000-0000-0000-0000-000000000010";

/** Cặp seed THẬT (mig 0340: is_sensitive=true). Key map = "action:resourceType". */
const AUDIT_LOG_CAP_KEY = "view:audit-log";
const WILDCARD_CAP_KEY = "*:*";

/**
 * S3-FE-REGISTRY-1 — 4 cặp ATT/LEAVE view NHẠY CẢM (is_sensitive=true, seed mig 0454/0455) mới APPEND vào
 * allowlist. Tuple (action, resourceType) tránh split(":") nhập nhằng. KHÔNG có view-own:leave / approve:leave
 * (đã non-sensitive ⇒ lộ sẵn qua getCapabilities, KHÔNG thuộc allowlist).
 */
const ATT_LEAVE_SENSITIVE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["view-own", "attendance"],
  ["view-team", "attendance"],
  ["view-company", "attendance"],
  ["view", "leave"],
];
const ATT_LEAVE_SENSITIVE_KEYS = ATT_LEAVE_SENSITIVE_PAIRS.map(([a, r]) => `${a}:${r}`);

/** Gate cứng: Postgres THẬT VÀ DB cô lập lane (KHÔNG phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

const TAG = randomUUID().slice(0, 8);

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: LOGIN_PW });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

async function meCapabilities(
  app: INestApplication,
  token: string,
): Promise<Record<string, boolean>> {
  const res = await api(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.capabilities as Record<string, boolean>;
}

describe.skipIf(!runDb)("S2-AUTH-BE-5 FIX-1-CAP-EXPOSE /auth/me allowlisted sensitive caps", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let adminToken: string;
  let wildcardToken: string;
  let employeeToken: string;
  let attLeaveToken: string;
  let managerToken: string;
  let bareWildToken: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "mecap");
    companyIds.push(A.companyId);
    const pw = await new PasswordService().hash(LOGIN_PW);

    // P1: company-admin — role 0001 có grant view:audit-log (mig 0340).
    const adminEmail = `adm-${TAG}@a.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    // N2: employee + wildcard '*:*' non-sensitive ALLOW — chứng minh wildcard KHÔNG kế thừa cặp nhạy cảm.
    const wildEmail = `wild-${TAG}@a.test`;
    const wild = await seedUser(direct, A.companyId, wildEmail, pw);
    await seedUserRole(direct, wild, EMPLOYEE_ROLE, A.companyId);
    const wildRole = await seedRole(direct, A.companyId, `wild-${TAG}`);
    const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
    await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
    await seedUserRole(direct, wild, wildRole, A.companyId);

    // P5: employee trơn (role 0008) — seed THẬT grant CHỈ view-own:attendance (Own, self-service). Chứng minh
    // allowlist bám ĐÚNG grant per-pair: view-own present, view-team/view-company/view:leave VẮNG (không over-expose).
    // (N3 tái dùng token này: KHÔNG có grant view:audit-log ⇒ vắng.)
    const empEmail = `emp-${TAG}@a.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    // P4 (S3-FE-REGISTRY-1): user được grant ĐÚNG 4 cặp ATT/LEAVE view NHẠY CẢM (is_sensitive=true) qua role
    // riêng DUY NHẤT (KHÔNG kèm employee role → cô lập đúng 4 cặp). getCapabilities() lọc sensitive ⇒ chỉ
    // allowlist surface được → RED trước khi APPEND allowlist.
    const attLeaveEmail = `attlv-${TAG}@a.test`;
    const attLeaveUser = await seedUser(direct, A.companyId, attLeaveEmail, pw);
    const attLeaveRole = await seedRole(direct, A.companyId, `attlv-${TAG}`);
    for (const [action, resourceType] of ATT_LEAVE_SENSITIVE_PAIRS) {
      const permId = await seedPermissionCatalog(direct, action, resourceType, true);
      await seedRolePermission(direct, attLeaveRole, permId, "ALLOW");
    }
    await seedUserRole(direct, attLeaveUser, attLeaveRole, A.companyId);

    // P6: manager (role 0010) — seed THẬT view-own + view-team:attendance + view:leave (Team), KHÔNG view-company.
    const mgrEmail = `mgr-${TAG}@a.test`;
    const mgr = await seedUser(direct, A.companyId, mgrEmail, pw);
    await seedUserRole(direct, mgr, MANAGER_ROLE, A.companyId);

    // N5: user CHỈ có wildcard '*:*' (KHÔNG employee role) — cô lập cổng sensitive: wildcard KHÔNG kế thừa cặp
    // nhạy cảm nào (KHÔNG lẫn view-own:attendance của employee role). Tái dùng wildRole (đã grant *:*).
    const bareWildEmail = `bw-${TAG}@a.test`;
    const bareWild = await seedUser(direct, A.companyId, bareWildEmail, pw);
    await seedUserRole(direct, bareWild, wildRole, A.companyId);

    adminToken = await login(app, A.slug, adminEmail);
    wildcardToken = await login(app, A.slug, wildEmail);
    employeeToken = await login(app, A.slug, empEmail);
    attLeaveToken = await login(app, A.slug, attLeaveEmail);
    managerToken = await login(app, A.slug, mgrEmail);
    bareWildToken = await login(app, A.slug, bareWildEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  it("P1 — company-admin /auth/me → capabilities['view:audit-log'] === true", async () => {
    const caps = await meCapabilities(app, adminToken);
    expect(caps[AUDIT_LOG_CAP_KEY]).toBe(true);
  });

  it("N2 — employee + wildcard '*:*' → KHÔNG có 'view:audit-log' (sensitive không kế thừa), '*:*' vẫn có", async () => {
    const caps = await meCapabilities(app, wildcardToken);
    expect(caps[WILDCARD_CAP_KEY]).toBe(true); // non-sensitive wildcard vẫn surface
    expect(AUDIT_LOG_CAP_KEY in caps).toBe(false); // sensitive KHÔNG kế thừa qua *:*
  });

  it("N3 — employee trơn → KHÔNG có 'view:audit-log' (deny-default)", async () => {
    const caps = await meCapabilities(app, employeeToken);
    expect(AUDIT_LOG_CAP_KEY in caps).toBe(false);
  });

  it("P4 — user grant ĐÚNG 4 cặp ATT/LEAVE view nhạy cảm → /auth/me.capabilities CÓ đủ 4 cặp", async () => {
    const caps = await meCapabilities(app, attLeaveToken);
    for (const key of ATT_LEAVE_SENSITIVE_KEYS) {
      expect(caps[key], `thiếu cặp allowlist ${key}`).toBe(true);
    }
  });

  it("P5 — employee (view-own:attendance) → CHỈ view-own hiện; view-team/view-company/view:leave VẮNG", async () => {
    const caps = await meCapabilities(app, employeeToken);
    expect(
      caps["view-own:attendance"],
      "employee phải thấy cờ view-own:attendance (self-service)",
    ).toBe(true);
    for (const key of ["view-team:attendance", "view-company:attendance", "view:leave"]) {
      expect(key in caps, `employee KHÔNG được lộ cặp ${key} (per-pair granularity)`).toBe(false);
    }
  });

  it("P6 — manager → view-own + view-team:attendance + view:leave hiện; view-company:attendance VẮNG", async () => {
    const caps = await meCapabilities(app, managerToken);
    for (const key of ["view-own:attendance", "view-team:attendance", "view:leave"]) {
      expect(caps[key], `manager thiếu cờ ${key}`).toBe(true);
    }
    expect("view-company:attendance" in caps, "manager KHÔNG được lộ view-company:attendance").toBe(
      false,
    );
  });

  it("N5 — user CHỈ '*:*' → KHÔNG kế thừa 4 cặp ATT/LEAVE nhạy cảm; view:audit-log vẫn vắng", async () => {
    const caps = await meCapabilities(app, bareWildToken);
    expect(caps[WILDCARD_CAP_KEY]).toBe(true); // non-sensitive wildcard vẫn surface
    for (const key of ATT_LEAVE_SENSITIVE_KEYS) {
      expect(key in caps, `cặp nhạy cảm ${key} KHÔNG kế thừa qua *:*`).toBe(false);
    }
    expect(AUDIT_LOG_CAP_KEY in caps).toBe(false); // no-regress S2-AUTH-BE-5
  });
});

// ────────────────────────────────────────────────────────────────────────────
// S2-AUTH-CAP-1 — APPEND 3 cặp NHẠY CẢM vào SENSITIVE_CAPABILITY_ALLOWLIST.
// Cặp seed THẬT is_sensitive=true, grant Company CHỈ hr(0011)+company-admin(0001) (mig 0454/0455).
// ────────────────────────────────────────────────────────────────────────────

/** hr — grant Company đủ 3 cặp CAP-1 (mig 0454 view:attendance-audit-log · mig 0455 export:leave + view:leave-audit-log). */
const HR_ROLE = "00000000-0000-0000-0000-000000000011";

/**
 * 3 cặp CAP-1 (action, resource_type) mới APPEND — seed THẬT is_sensitive=true. Tuple tránh split(":") nhập nhằng.
 *   export:leave              — leave-permissions.const:60 / mig 0455 (hr+company-admin, Company)
 *   view:leave-audit-log      — leave-permissions.const:85 / mig 0455 (hr+company-admin, Company)
 *   view:attendance-audit-log — attendance-permissions.const:84 / mig 0454 (hr+company-admin, Company)
 */
const CAP1_SENSITIVE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["export", "leave"],
  ["view", "leave-audit-log"],
  ["view", "attendance-audit-log"],
];
const CAP1_SENSITIVE_KEYS = CAP1_SENSITIVE_PAIRS.map(([a, r]) => `${a}:${r}`);

describe.skipIf(!runDb)(
  "S2-AUTH-CAP-1 /auth/me export:leave · view:leave-audit-log · view:attendance-audit-log",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    let adminToken: string;
    let hrToken: string;
    let employeeToken: string;
    let managerToken: string;
    let wildcardToken: string;
    let denyOverrideToken: string;
    let tenantBToken: string;
    const companyIds: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();
      const pw = await new PasswordService().hash(LOGIN_PW);

      // ── Tenant A ────────────────────────────────────────────────────────────
      A = await seedCompany(direct, "cap1a");
      companyIds.push(A.companyId);

      // CAP1-P1/P2: company-admin (0001) + hr (0011) — CẢ HAI có grant Company 3 cặp CAP-1 (mig 0454/0455).
      const adminEmail = `ca-${TAG}@cap1.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

      const hrEmail = `hr-${TAG}@cap1.test`;
      const hr = await seedUser(direct, A.companyId, hrEmail, pw);
      await seedUserRole(direct, hr, HR_ROLE, A.companyId);

      // CAP1-N1/N2: employee (0008) + manager (0010) — KHÔNG có bất kỳ cặp CAP-1 (least-privilege seed).
      const empEmail = `emp-${TAG}@cap1.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      const mgrEmail = `mgr-${TAG}@cap1.test`;
      const mgr = await seedUser(direct, A.companyId, mgrEmail, pw);
      await seedUserRole(direct, mgr, MANAGER_ROLE, A.companyId);

      // CAP1-N3: wildcard-only — role có '*:*' ALLOW non-sensitive → KHÔNG kế thừa cặp nhạy cảm CAP-1.
      const wildEmail = `wild-${TAG}@cap1.test`;
      const wild = await seedUser(direct, A.companyId, wildEmail, pw);
      const wildRole = await seedRole(direct, A.companyId, `cap1-wild-${TAG}`);
      const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
      await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
      await seedUserRole(direct, wild, wildRole, A.companyId);

      // CAP1-N5: deny-override — role ALLOW cả 3 cặp CAP-1 (Company) + DENY 'export:leave' → export:leave bị
      // suppress (deny-override per-pair, mirror isDenied wildcard-aware); 2 cặp còn lại vẫn hiện.
      const denyEmail = `deny-${TAG}@cap1.test`;
      const denyUser = await seedUser(direct, A.companyId, denyEmail, pw);
      const denyRole = await seedRole(direct, A.companyId, `cap1-deny-${TAG}`);
      for (const [action, resourceType] of CAP1_SENSITIVE_PAIRS) {
        const permId = await seedPermissionCatalog(direct, action, resourceType, true);
        await seedRolePermission(direct, denyRole, permId, "ALLOW");
      }
      const exportLeavePerm = await seedPermissionCatalog(direct, "export", "leave", true);
      await seedRolePermission(direct, denyRole, exportLeavePerm, "DENY");
      await seedUserRole(direct, denyUser, denyRole, A.companyId);

      // ── Tenant B (cross-tenant, BẤT BIẾN #1) ─────────────────────────────────
      // CAP1-N4: user trơn (KHÔNG role) — grant CAP-1 của tenant A KHÔNG rò sang tenant B.
      B = await seedCompany(direct, "cap1b");
      companyIds.push(B.companyId);
      const bEmail = `bare-${TAG}@cap1b.test`;
      await seedUser(direct, B.companyId, bEmail, pw);

      adminToken = await login(app, A.slug, adminEmail);
      hrToken = await login(app, A.slug, hrEmail);
      employeeToken = await login(app, A.slug, empEmail);
      managerToken = await login(app, A.slug, mgrEmail);
      wildcardToken = await login(app, A.slug, wildEmail);
      denyOverrideToken = await login(app, A.slug, denyEmail);
      tenantBToken = await login(app, B.slug, bEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("CAP1-P1 — company-admin (0001) → /auth/me CÓ đủ 3 cặp CAP-1 === true", async () => {
      const caps = await meCapabilities(app, adminToken);
      for (const key of CAP1_SENSITIVE_KEYS) {
        expect(caps[key], `company-admin thiếu cặp allowlist ${key}`).toBe(true);
      }
    });

    it("CAP1-P2 — hr (0011) → /auth/me CÓ đủ 3 cặp CAP-1 === true", async () => {
      const caps = await meCapabilities(app, hrToken);
      for (const key of CAP1_SENSITIVE_KEYS) {
        expect(caps[key], `hr thiếu cặp allowlist ${key}`).toBe(true);
      }
    });

    it("CAP1-N1 — employee (0008) → KHÔNG có bất kỳ cặp CAP-1 nào (least-privilege)", async () => {
      const caps = await meCapabilities(app, employeeToken);
      for (const key of CAP1_SENSITIVE_KEYS) {
        expect(key in caps, `employee KHÔNG được lộ cặp ${key}`).toBe(false);
      }
    });

    it("CAP1-N2 — manager (0010) → KHÔNG có bất kỳ cặp CAP-1 nào (least-privilege)", async () => {
      const caps = await meCapabilities(app, managerToken);
      for (const key of CAP1_SENSITIVE_KEYS) {
        expect(key in caps, `manager KHÔNG được lộ cặp ${key}`).toBe(false);
      }
    });

    it("CAP1-N3 — wildcard '*:*' → KHÔNG kế thừa 3 cặp CAP-1 (sensitive gate); '*:*' vẫn có", async () => {
      const caps = await meCapabilities(app, wildcardToken);
      expect(caps[WILDCARD_CAP_KEY]).toBe(true); // non-sensitive wildcard vẫn surface
      for (const key of CAP1_SENSITIVE_KEYS) {
        expect(key in caps, `cặp nhạy cảm ${key} KHÔNG kế thừa qua *:*`).toBe(false);
      }
      expect(AUDIT_LOG_CAP_KEY in caps).toBe(false); // no-regress S2-AUTH-BE-5
    });

    it("CAP1-N4 — cross-tenant: user tenant B trơn → KHÔNG chứa 3 cặp CAP-1 của tenant A", async () => {
      const caps = await meCapabilities(app, tenantBToken);
      for (const key of CAP1_SENSITIVE_KEYS) {
        expect(key in caps, `tenant B KHÔNG được thấy ${key} của tenant A`).toBe(false);
      }
    });

    it("CAP1-N5 — DENY-override: grant 3 cặp + DENY 'export:leave' → export:leave suppress; 2 cặp còn lại vẫn hiện", async () => {
      const caps = await meCapabilities(app, denyOverrideToken);
      expect("export:leave" in caps, "export:leave phải bị DENY-override suppress").toBe(false);
      expect(caps["view:leave-audit-log"], "view:leave-audit-log vẫn hiện").toBe(true);
      expect(caps["view:attendance-audit-log"], "view:attendance-audit-log vẫn hiện").toBe(true);
    });
  },
);

// ────────────────────────────────────────────────────────────────────────────
// S2-AUTH-BE-12 — APPEND 'reset-2fa:user' vào SENSITIVE_CAPABILITY_ALLOWLIST.
// Cặp seed THẬT is_sensitive=true, grant Company CHỈ company-admin(0001) (mig 0466). getCapabilities() lọc
// bỏ sensitive ⇒ chỉ allowlist surface được. Enforcement (PermissionGuard per-resource) KHÔNG đổi.
// ────────────────────────────────────────────────────────────────────────────

const RESET_2FA_CAP_KEY = "reset-2fa:user";

// ────────────────────────────────────────────────────────────────────────────
// S2-AUTH-CAP-2 — APPEND 'assign-role:user' + 'assign:permission' vào SENSITIVE_CAPABILITY_ALLOWLIST.
// Cặp seed THẬT is_sensitive=true, grant Company CHỈ company-admin(0001). FE gate nút "Quản lý vai trò"
// (assign-role:user) + "Phân quyền" (assign:permission) — thiếu allowlist ⇒ nút ẩn với cả admin.
// Enforcement (PermissionGuard per-resource, sensitive gate) KHÔNG đổi — chỉ mở cờ hiển thị.
// ────────────────────────────────────────────────────────────────────────────

/** 2 cặp CAP-2 (action, resourceType) — tuple tránh split(":") nhập nhằng. */
const CAP2_SENSITIVE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["assign-role", "user"],
  ["assign", "permission"],
];
const CAP2_SENSITIVE_KEYS = CAP2_SENSITIVE_PAIRS.map(([a, r]) => `${a}:${r}`);

describe.skipIf(!runDb)(
  "S2-AUTH-CAP-2 /auth/me assign-role:user · assign:permission (company-admin only)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let adminToken: string;
    let employeeToken: string;
    let managerToken: string;
    let wildcardToken: string;
    const companyIds: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();
      const pw = await new PasswordService().hash(LOGIN_PW);

      A = await seedCompany(direct, "cap2");
      companyIds.push(A.companyId);

      // CAP2-P1: company-admin (0001) — grant Company assign-role:user + assign:permission (seed canonical).
      const adminEmail = `ca-${TAG}@cap2.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

      // CAP2-N1/N2: employee (0008) + manager (0010) — KHÔNG có grant 2 cặp CAP-2 (least-privilege).
      const empEmail = `emp-${TAG}@cap2.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      const mgrEmail = `mgr-${TAG}@cap2.test`;
      const mgr = await seedUser(direct, A.companyId, mgrEmail, pw);
      await seedUserRole(direct, mgr, MANAGER_ROLE, A.companyId);

      // CAP2-N3: user CHỈ '*:*' ALLOW non-sensitive — wildcard KHÔNG kế thừa cặp nhạy cảm.
      const wildEmail = `wild-${TAG}@cap2.test`;
      const wild = await seedUser(direct, A.companyId, wildEmail, pw);
      const wildRole = await seedRole(direct, A.companyId, `cap2-wild-${TAG}`);
      const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
      await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
      await seedUserRole(direct, wild, wildRole, A.companyId);

      adminToken = await login(app, A.slug, adminEmail);
      employeeToken = await login(app, A.slug, empEmail);
      managerToken = await login(app, A.slug, mgrEmail);
      wildcardToken = await login(app, A.slug, wildEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("CAP2-P1 — company-admin (0001) → /auth/me CÓ đủ 2 cặp CAP-2 === true", async () => {
      const caps = await meCapabilities(app, adminToken);
      for (const key of CAP2_SENSITIVE_KEYS) {
        expect(caps[key], `company-admin thiếu cặp allowlist ${key}`).toBe(true);
      }
    });

    it("CAP2-N1 — employee (0008) → KHÔNG có cặp CAP-2 nào (least-privilege)", async () => {
      const caps = await meCapabilities(app, employeeToken);
      for (const key of CAP2_SENSITIVE_KEYS) {
        expect(key in caps, `employee KHÔNG được lộ cặp ${key}`).toBe(false);
      }
    });

    it("CAP2-N2 — manager (0010) → KHÔNG có cặp CAP-2 nào (least-privilege)", async () => {
      const caps = await meCapabilities(app, managerToken);
      for (const key of CAP2_SENSITIVE_KEYS) {
        expect(key in caps, `manager KHÔNG được lộ cặp ${key}`).toBe(false);
      }
    });

    it("CAP2-N3 — wildcard '*:*' → KHÔNG kế thừa 2 cặp CAP-2 (sensitive gate); '*:*' vẫn có", async () => {
      const caps = await meCapabilities(app, wildcardToken);
      expect(caps[WILDCARD_CAP_KEY]).toBe(true);
      for (const key of CAP2_SENSITIVE_KEYS) {
        expect(key in caps, `cặp nhạy cảm ${key} KHÔNG kế thừa qua *:*`).toBe(false);
      }
    });
  },
);

describe.skipIf(!runDb)("S2-AUTH-BE-12 /auth/me reset-2fa:user (company-admin only)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let adminToken: string;
  let employeeToken: string;
  let managerToken: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();
    const pw = await new PasswordService().hash(LOGIN_PW);

    A = await seedCompany(direct, "r2facap");
    companyIds.push(A.companyId);

    // company-admin (0001) — grant Company reset-2fa:user (mig 0466).
    const adminEmail = `ca-${TAG}@r2fa.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    // employee (0008) + manager (0010) — KHÔNG có grant reset-2fa:user (least-privilege).
    const empEmail = `emp-${TAG}@r2fa.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    const mgrEmail = `mgr-${TAG}@r2fa.test`;
    const mgr = await seedUser(direct, A.companyId, mgrEmail, pw);
    await seedUserRole(direct, mgr, MANAGER_ROLE, A.companyId);

    adminToken = await login(app, A.slug, adminEmail);
    employeeToken = await login(app, A.slug, empEmail);
    managerToken = await login(app, A.slug, mgrEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  it("company-admin (0001) → /auth/me.capabilities['reset-2fa:user'] === true", async () => {
    const caps = await meCapabilities(app, adminToken);
    expect(caps[RESET_2FA_CAP_KEY]).toBe(true);
  });

  it("employee (0008) → KHÔNG có 'reset-2fa:user' (least-privilege)", async () => {
    const caps = await meCapabilities(app, employeeToken);
    expect(RESET_2FA_CAP_KEY in caps).toBe(false);
  });

  it("manager (0010) → KHÔNG có 'reset-2fa:user' (least-privilege)", async () => {
    const caps = await meCapabilities(app, managerToken);
    expect(RESET_2FA_CAP_KEY in caps).toBe(false);
  });
});
