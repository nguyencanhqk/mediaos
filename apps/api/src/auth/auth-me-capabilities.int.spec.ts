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
 *   CAP2-N4  DENY-override: ALLOW 2 cặp + DENY 'assign-role:user' → suppress; assign:permission vẫn hiện.
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
 * S3-ATT-EXPORT-1-FIX — APPEND cặp NHẠY CẢM 'export:attendance' vào bộ CAP1 (is_sensitive=true, seed mig
 * 0454:124-125 — grant Company CHỈ hr(0011)+company-admin(0001)). Bằng chứng PIPELINE THẬT thay cho false-green
 * FE: nút Export attendance dùng PermissionGate → capabilities['export:attendance'] mà /auth/me chỉ trả được
 * SAU khi 'export:attendance' vào SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts). RED trước allowlist
 * (CAP1-P1/P2 vắng key) → GREEN sau; employee/manager/wildcard/cross-tenant KHÔNG có (CAP1-N1..N4, least-privilege
 * + sensitive gate). Enforcement THẬT vẫn là @RequirePermission('export','attendance') per-resource.
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
import {
  TASK_GRANT_MATRIX,
  TASK_PERMISSIONS,
  TASK_SENSITIVE_PAIRS,
} from "../foundation/seed/task-permissions.const";

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
// S2-AUTH-CAP-1 (+ S3-ATT-EXPORT-1-FIX) — APPEND 4 cặp NHẠY CẢM vào SENSITIVE_CAPABILITY_ALLOWLIST.
// Cặp seed THẬT is_sensitive=true, grant Company CHỈ hr(0011)+company-admin(0001) (mig 0454/0455).
// export:attendance (mig 0454:124-125) là bằng chứng pipeline THẬT của WO S3-ATT-EXPORT-1 (thay false-green FE).
// ────────────────────────────────────────────────────────────────────────────

/** hr — grant Company đủ 3 cặp CAP-1 (mig 0454 view:attendance-audit-log · mig 0455 export:leave + view:leave-audit-log). */
const HR_ROLE = "00000000-0000-0000-0000-000000000011";

/**
 * 4 cặp CAP-1 (action, resource_type) — seed THẬT is_sensitive=true. Tuple tránh split(":") nhập nhằng.
 *   export:leave              — leave-permissions.const:60 / mig 0455 (hr+company-admin, Company)
 *   view:leave-audit-log      — leave-permissions.const:85 / mig 0455 (hr+company-admin, Company)
 *   view:attendance-audit-log — attendance-permissions.const:84 / mig 0454 (hr+company-admin, Company)
 *   export:attendance         — attendance-permissions.const:55 / mig 0454:124-125 (hr+company-admin, Company)
 *
 * S3-ATT-EXPORT-1-FIX — APPEND cặp export:attendance (is_sensitive=true). Đây là BẰNG CHỨNG PIPELINE THẬT
 * thay cho false-green FE (ExportAttendanceButton.spec hand-inject cap): /auth/me → getAllowlisted-
 * SensitiveCapabilities chỉ surface được sau khi 'export:attendance' vào SENSITIVE_CAPABILITY_ALLOWLIST
 * (permission.service.ts). RED trước allowlist (P1/P2 vắng key) → GREEN sau. Grant Company CHỈ hr(0011)+
 * company-admin(0001) mig 0454:124-125; employee(0008)/manager(0010) KHÔNG grant ⇒ least-privilege; wildcard
 * *:* KHÔNG kế thừa (sensitive gate). Enforcement THẬT vẫn là @RequirePermission('export','attendance').
 */
const CAP1_SENSITIVE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["export", "leave"],
  ["view", "leave-audit-log"],
  ["view", "attendance-audit-log"],
  // S3-ATT-EXPORT-1-FIX — APPEND-only (giữ 3 cặp CAP-1 trên nguyên vẹn):
  ["export", "attendance"],
];
const CAP1_SENSITIVE_KEYS = CAP1_SENSITIVE_PAIRS.map(([a, r]) => `${a}:${r}`);

describe.skipIf(!runDb)(
  "S2-AUTH-CAP-1 /auth/me export:leave · view:leave-audit-log · view:attendance-audit-log · export:attendance",
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
    let denyOverrideToken: string;
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

      // CAP2-N4 (gate LOW finding): role ALLOW CẢ 2 cặp CAP-2 + DENY 'assign-role:user' → cờ leo-thang
      // cao-rủi-ro nhất bị suppress (deny-override per-pair); assign:permission còn lại vẫn hiện.
      const denyEmail = `deny-${TAG}@cap2.test`;
      const denyUser = await seedUser(direct, A.companyId, denyEmail, pw);
      const denyRole = await seedRole(direct, A.companyId, `cap2-deny-${TAG}`);
      for (const [action, resourceType] of CAP2_SENSITIVE_PAIRS) {
        const permId = await seedPermissionCatalog(direct, action, resourceType, true);
        await seedRolePermission(direct, denyRole, permId, "ALLOW");
      }
      const assignRolePerm = await seedPermissionCatalog(direct, "assign-role", "user", true);
      await seedRolePermission(direct, denyRole, assignRolePerm, "DENY");
      await seedUserRole(direct, denyUser, denyRole, A.companyId);

      adminToken = await login(app, A.slug, adminEmail);
      employeeToken = await login(app, A.slug, empEmail);
      managerToken = await login(app, A.slug, mgrEmail);
      wildcardToken = await login(app, A.slug, wildEmail);
      denyOverrideToken = await login(app, A.slug, denyEmail);
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

    it("CAP2-N4 — DENY-override: ALLOW 2 cặp + DENY 'assign-role:user' → assign-role:user suppress; assign:permission vẫn hiện", async () => {
      const caps = await meCapabilities(app, denyOverrideToken);
      expect("assign-role:user" in caps, "assign-role:user phải bị DENY-override suppress").toBe(
        false,
      );
      expect(caps["assign:permission"], "assign:permission vẫn hiện").toBe(true);
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

// ────────────────────────────────────────────────────────────────────────────
// S2-AUTH-USEROPS-1 — APPEND 'delete:user' + 'restore:user' + 'reset-password:user' vào
// SENSITIVE_CAPABILITY_ALLOWLIST. restore/reset-password = pair MỚI is_sensitive=true (mig 0476);
// delete:user = pair 0005 NÂNG false→true (mig 0476). Grant Company CHỈ company-admin(0001)
// (delete từ 0005/0441; restore/reset-password từ 0476). Thiếu allowlist ⇒ useCanExact false với
// CẢ admin (bài học CAP-2). Enforcement (PermissionGuard isSensitive per-resource) KHÔNG đổi.
// ────────────────────────────────────────────────────────────────────────────

/** 3 cặp USEROPS (action, resourceType) — tuple tránh split(":") nhập nhằng. */
const USEROPS_SENSITIVE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["delete", "user"],
  ["restore", "user"],
  ["reset-password", "user"],
];
const USEROPS_SENSITIVE_KEYS = USEROPS_SENSITIVE_PAIRS.map(([a, r]) => `${a}:${r}`);

describe.skipIf(!runDb)(
  "S2-AUTH-USEROPS-1 /auth/me delete:user · restore:user · reset-password:user (company-admin only)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let adminToken: string;
    let employeeToken: string;
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

      A = await seedCompany(direct, "uopscap");
      companyIds.push(A.companyId);

      // company-admin (0001) — grant Company: delete:user (0005 bulk + 0441 backfill, sensitive-hóa 0476)
      // + restore/reset-password:user (0476).
      const adminEmail = `ca-${TAG}@uops.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

      // employee (0008) — KHÔNG có grant 3 cặp (least-privilege).
      const empEmail = `emp-${TAG}@uops.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      // wildcard-only '*:*' non-sensitive — KHÔNG kế thừa cặp sensitive (kể cả delete:user SAU sensitive-hóa).
      const wildEmail = `wild-${TAG}@uops.test`;
      const wild = await seedUser(direct, A.companyId, wildEmail, pw);
      const wildRole = await seedRole(direct, A.companyId, `uops-wild-${TAG}`);
      const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
      await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
      await seedUserRole(direct, wild, wildRole, A.companyId);

      adminToken = await login(app, A.slug, adminEmail);
      employeeToken = await login(app, A.slug, empEmail);
      wildcardToken = await login(app, A.slug, wildEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("UOPS-P1 — company-admin (0001) → /auth/me CÓ đủ 3 cặp USEROPS === true", async () => {
      const caps = await meCapabilities(app, adminToken);
      for (const key of USEROPS_SENSITIVE_KEYS) {
        expect(caps[key], `company-admin thiếu cặp allowlist ${key}`).toBe(true);
      }
    });

    it("UOPS-N1 — employee (0008) → KHÔNG có cặp USEROPS nào (least-privilege)", async () => {
      const caps = await meCapabilities(app, employeeToken);
      for (const key of USEROPS_SENSITIVE_KEYS) {
        expect(key in caps, `employee KHÔNG được lộ cặp ${key}`).toBe(false);
      }
    });

    it("UOPS-N2 — wildcard '*:*' → KHÔNG kế thừa 3 cặp USEROPS (delete:user ĐÃ sensitive-hóa); '*:*' vẫn có", async () => {
      const caps = await meCapabilities(app, wildcardToken);
      expect(caps[WILDCARD_CAP_KEY]).toBe(true);
      for (const key of USEROPS_SENSITIVE_KEYS) {
        expect(key in caps, `cặp nhạy cảm ${key} KHÔNG kế thừa qua *:*`).toBe(false);
      }
    });
  },
);

// ────────────────────────────────────────────────────────────────────────────
// S4-TASK-SEED-1 — APPEND 8 cặp NHẠY CẢM TASK vào SENSITIVE_CAPABILITY_ALLOWLIST (mig 0485:
// delete/close/archive/manage-member/view-report:project + delete/export:task + view:task-audit-log).
// done_when #5: company-admin thấy ĐỦ 23 cặp TASK qua /auth/me = 15 non-sensitive (getCapabilities)
// + 8 sensitive (allowlist). RED trước allowlist (P1 thiếu 8 key) → GREEN sau. Grant-bound: manager
// surface đúng các cặp @Team được grant (owner-check per-project là việc BE — S4-TASK-BE-1);
// delete:task của manager HOÃN (TASK_DEFERRED_GRANTS) ⇒ PHẢI vắng tới khi S4-TASK-BE-2 grant.
// Enforcement (can()/PermissionGuard per-resource) KHÔNG đổi — chỉ mở cờ hiển thị (UI-hint).
// Ma trận kỳ vọng dẫn xuất từ TASK_GRANT_MATRIX (task-permissions.const) — một nguồn sự thật.
// ────────────────────────────────────────────────────────────────────────────

const TASK_ALL_KEYS = TASK_PERMISSIONS.map((p) => `${p.action}:${p.resourceType}`);
const TASK_SENSITIVE_KEYS = [...TASK_SENSITIVE_PAIRS];

/** Key TASK kỳ vọng hiện trên /auth/me cho 1 role — đúng bằng grant thật của ma trận seed. */
function taskKeysFor(roleKey: "emp" | "mgr" | "hr" | "ca"): string[] {
  return TASK_GRANT_MATRIX.filter((r) => r[roleKey]).map((r) => `${r.action}:${r.resource}`);
}

describe.skipIf(!runDb)(
  "S4-TASK-SEED-1 /auth/me capabilities TASK (23 cặp — allowlist 8 sensitive, mig 0485)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let adminToken: string;
    let hrToken: string;
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

      A = await seedCompany(direct, "taskcap");
      companyIds.push(A.companyId);

      const adminEmail = `ca-${TAG}@taskcap.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

      const hrEmail = `hr-${TAG}@taskcap.test`;
      const hr = await seedUser(direct, A.companyId, hrEmail, pw);
      await seedUserRole(direct, hr, HR_ROLE, A.companyId);

      const empEmail = `emp-${TAG}@taskcap.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      const mgrEmail = `mgr-${TAG}@taskcap.test`;
      const mgr = await seedUser(direct, A.companyId, mgrEmail, pw);
      await seedUserRole(direct, mgr, MANAGER_ROLE, A.companyId);

      // wildcard-only: '*:*' non-sensitive → KHÔNG kế thừa cặp sensitive TASK (sensitive gate).
      const wildEmail = `wild-${TAG}@taskcap.test`;
      const wild = await seedUser(direct, A.companyId, wildEmail, pw);
      const wildRole = await seedRole(direct, A.companyId, `taskcap-wild-${TAG}`);
      const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
      await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
      await seedUserRole(direct, wild, wildRole, A.companyId);

      adminToken = await login(app, A.slug, adminEmail);
      hrToken = await login(app, A.slug, hrEmail);
      employeeToken = await login(app, A.slug, empEmail);
      managerToken = await login(app, A.slug, mgrEmail);
      wildcardToken = await login(app, A.slug, wildEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("TASKCAP-P1 — company-admin → /auth/me CÓ ĐỦ 23 cặp TASK === true (done_when #5)", async () => {
      const caps = await meCapabilities(app, adminToken);
      expect(taskKeysFor("ca").length).toBe(23); // pin: ma trận admin đủ bộ
      for (const key of TASK_ALL_KEYS) {
        expect(caps[key], `company-admin thiếu cặp ${key} trên /auth/me`).toBe(true);
      }
    });

    it("TASKCAP-P2 — hr → CÓ đúng 18 cặp grant (gồm view-report:project/export:task/view:task-audit-log); VẮNG 5 cặp không grant", async () => {
      const caps = await meCapabilities(app, hrToken);
      const granted = taskKeysFor("hr");
      expect(granted.length).toBe(18);
      for (const key of granted) {
        expect(caps[key], `hr thiếu cặp đã grant ${key}`).toBe(true);
      }
      for (const key of TASK_ALL_KEYS.filter((k) => !granted.includes(k))) {
        expect(key in caps, `hr KHÔNG được lộ cặp chưa grant ${key}`).toBe(false);
      }
    });

    it("TASKCAP-P3 — manager → CÓ 19 cặp @Team (grant-bound, gồm sensitive project); VẮNG delete:task (HOÃN BE-2) + view:task-audit-log", async () => {
      const caps = await meCapabilities(app, managerToken);
      const granted = taskKeysFor("mgr");
      expect(granted.length).toBe(19);
      for (const key of granted) {
        expect(caps[key], `manager thiếu cặp đã grant ${key}`).toBe(true);
      }
      expect("delete:task" in caps, "delete:task manager HOÃN sang BE-2 — không được lộ").toBe(
        false,
      );
      expect("view:task-audit-log" in caps, "manager không có audit-log").toBe(false);
      expect("create:task" in caps, "create:task manager HOÃN sang BE-2").toBe(false);
      expect("update:task" in caps, "update:task manager HOÃN sang BE-2").toBe(false);
    });

    it("TASKCAP-N1 — employee → KHÔNG cặp sensitive nào; KHÔNG create:project; KHÔNG create/update:task (HOÃN); CÓ 7 cặp Own", async () => {
      const caps = await meCapabilities(app, employeeToken);
      for (const key of TASK_SENSITIVE_KEYS) {
        expect(key in caps, `employee KHÔNG được lộ cặp sensitive ${key}`).toBe(false);
      }
      expect("create:project" in caps, "employee không có create:project (done_when #5)").toBe(
        false,
      );
      expect("update:project" in caps).toBe(false);
      expect("create:task" in caps, "create:task employee HOÃN sang BE-2").toBe(false);
      expect("update:task" in caps, "update:task employee HOÃN sang BE-2").toBe(false);
      const granted = taskKeysFor("emp");
      expect(granted.length).toBe(7);
      for (const key of granted) {
        expect(caps[key], `employee thiếu cặp non-sensitive đã grant ${key}`).toBe(true);
      }
    });

    it("TASKCAP-N2 — wildcard '*:*' → KHÔNG kế thừa cặp sensitive TASK nào (sensitive gate)", async () => {
      const caps = await meCapabilities(app, wildcardToken);
      expect(caps[WILDCARD_CAP_KEY]).toBe(true);
      for (const key of TASK_SENSITIVE_KEYS) {
        expect(key in caps, `cặp sensitive ${key} KHÔNG kế thừa qua *:*`).toBe(false);
      }
    });
  },
);

// ────────────────────────────────────────────────────────────────────────────
// S4-NOTI-BE-3 — APPEND 6 cặp NHẠY CẢM NOTI config vào SENSITIVE_CAPABILITY_ALLOWLIST (seed mig 0481,
// catalog pin ở notification-event-catalog.const.ts NOTI_CONFIG_PAIRS): view/update:notification-config ·
// view/update:notification-template · view:notification-delivery-log · view:notification-audit-log.
// Grant Company CHỈ company-admin (0001) — employee(0008)/manager(0010)/hr(0011) KHÔNG có grant (0 dòng
// role_permissions cho 3 role này trên 6 cặp — least-privilege). Bug CAP-2 đã tái diễn 3 lần
// (CAP-2/USEROPS-1/EXPORT-1): thiếu allowlist ⇒ nút cấu hình NOTI ẨN với CẢ admin dù grant thật tồn tại.
// Enforcement (PermissionGuard per-resource, notification-admin.controller.ts) KHÔNG đổi.
// ────────────────────────────────────────────────────────────────────────────

const NOTI_CONFIG_SENSITIVE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["view", "notification-config"],
  ["update", "notification-config"],
  ["view", "notification-template"],
  ["update", "notification-template"],
  ["view", "notification-delivery-log"],
  ["view", "notification-audit-log"],
];
const NOTI_CONFIG_SENSITIVE_KEYS = NOTI_CONFIG_SENSITIVE_PAIRS.map(([a, r]) => `${a}:${r}`);

describe.skipIf(!runDb)(
  "S4-NOTI-BE-3 /auth/me 6 cặp NOTI config (view/update:notification-config·template · view:notification-delivery-log·audit-log)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let adminToken: string;
    let hrToken: string;
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

      A = await seedCompany(direct, "noticap");
      companyIds.push(A.companyId);

      // company-admin (0001) — grant Company đủ 6 cặp NOTI config (seed THẬT mig 0481).
      const adminEmail = `ca-${TAG}@noticap.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

      // hr (0011) + employee (0008) + manager (0010) — KHÔNG có grant nào trong 6 cặp (least-privilege).
      const hrEmail = `hr-${TAG}@noticap.test`;
      const hr = await seedUser(direct, A.companyId, hrEmail, pw);
      await seedUserRole(direct, hr, HR_ROLE, A.companyId);

      const empEmail = `emp-${TAG}@noticap.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      const mgrEmail = `mgr-${TAG}@noticap.test`;
      const mgr = await seedUser(direct, A.companyId, mgrEmail, pw);
      await seedUserRole(direct, mgr, MANAGER_ROLE, A.companyId);

      // wildcard-only '*:*' non-sensitive → KHÔNG kế thừa 6 cặp sensitive NOTI (sensitive gate).
      const wildEmail = `wild-${TAG}@noticap.test`;
      const wild = await seedUser(direct, A.companyId, wildEmail, pw);
      const wildRole = await seedRole(direct, A.companyId, `noticap-wild-${TAG}`);
      const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
      await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
      await seedUserRole(direct, wild, wildRole, A.companyId);

      adminToken = await login(app, A.slug, adminEmail);
      hrToken = await login(app, A.slug, hrEmail);
      employeeToken = await login(app, A.slug, empEmail);
      managerToken = await login(app, A.slug, mgrEmail);
      wildcardToken = await login(app, A.slug, wildEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("NOTICAP-P1 — company-admin (0001) → /auth/me CÓ ĐỦ 6 cặp NOTI config === true", async () => {
      const caps = await meCapabilities(app, adminToken);
      for (const key of NOTI_CONFIG_SENSITIVE_KEYS) {
        expect(caps[key], `company-admin thiếu cặp allowlist ${key}`).toBe(true);
      }
    });

    it("NOTICAP-N1 — hr (0011) → KHÔNG có cặp NOTI config nào (least-privilege, chỉ company-admin)", async () => {
      const caps = await meCapabilities(app, hrToken);
      for (const key of NOTI_CONFIG_SENSITIVE_KEYS) {
        expect(key in caps, `hr KHÔNG được lộ cặp ${key}`).toBe(false);
      }
    });

    it("NOTICAP-N2 — employee (0008) → KHÔNG có cặp NOTI config nào (least-privilege)", async () => {
      const caps = await meCapabilities(app, employeeToken);
      for (const key of NOTI_CONFIG_SENSITIVE_KEYS) {
        expect(key in caps, `employee KHÔNG được lộ cặp ${key}`).toBe(false);
      }
    });

    it("NOTICAP-N3 — manager (0010) → KHÔNG có cặp NOTI config nào (least-privilege)", async () => {
      const caps = await meCapabilities(app, managerToken);
      for (const key of NOTI_CONFIG_SENSITIVE_KEYS) {
        expect(key in caps, `manager KHÔNG được lộ cặp ${key}`).toBe(false);
      }
    });

    it("NOTICAP-N4 — wildcard '*:*' → KHÔNG kế thừa 6 cặp NOTI config nào (sensitive gate); '*:*' vẫn có", async () => {
      const caps = await meCapabilities(app, wildcardToken);
      expect(caps[WILDCARD_CAP_KEY]).toBe(true);
      for (const key of NOTI_CONFIG_SENSITIVE_KEYS) {
        expect(key in caps, `cặp sensitive ${key} KHÔNG kế thừa qua *:*`).toBe(false);
      }
    });
  },
);

// ────────────────────────────────────────────────────────────────────────────
// S4-FE-DASH-3 — APPEND 2 cặp NHẠY CẢM DASH config vào SENSITIVE_CAPABILITY_ALLOWLIST:
//   view:dashboard-config · update:dashboard-config
// Cặp seed THẬT is_sensitive=true — catalog dashboard-widget-catalog.const.ts:314-324
// (DASH.CONFIG.VIEW / DASH.CONFIG.UPDATE), seed + grant mig 0484 khối (3). Grant Company CHỈ
// company-admin(0001) — DASH_GRANT_MATRIX:379-385 (employee/manager/hr KHÔNG có grant, least-privilege).
// FE DashboardConfigPage dùng PermissionGate → useCanExact('view'/'update','dashboard-config').
// TRƯỚC fix: getCapabilities() lọc bỏ MỌI sensitive + allowlist thiếu 2 cặp ⇒ /auth/me KHÔNG BAO GIỜ
// trả 2 cặp cho BẤT KỲ user nào (kể cả company-admin có grant thật) ⇒ trang LUÔN EmptyState "không có
// quyền" trong app thật (bẫy CAP-2/EXPORT-1/NOTI-BE-3 tái diễn ≥5 lần). Đây là BẰNG CHỨNG PIPELINE THẬT
// thay cho false-green của FE spec (tự set capabilities vào store). Enforcement KHÔNG đổi —
// @RequirePermission('view'/'update','dashboard-config',{isSensitive:true}) + PermissionGuard class-level
// (dashboard-config.controller.ts) + RLS company_id vẫn là cổng THẬT. Chỉ mở CỜ HIỂN THỊ.
// ────────────────────────────────────────────────────────────────────────────

/** 2 cặp DASH config (action, resourceType) — tuple tránh split(":") nhập nhằng. Seed THẬT mig 0484. */
const DASH_CONFIG_SENSITIVE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["view", "dashboard-config"],
  ["update", "dashboard-config"],
];
const DASH_CONFIG_SENSITIVE_KEYS = DASH_CONFIG_SENSITIVE_PAIRS.map(([a, r]) => `${a}:${r}`);

describe.skipIf(!runDb)(
  "S4-FE-DASH-3 /auth/me view:dashboard-config · update:dashboard-config (company-admin only)",
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
      A = await seedCompany(direct, "dashcfg");
      companyIds.push(A.companyId);

      // DASHCFG-P1: company-admin (0001) — grant Company đủ 2 cặp DASH config (seed THẬT mig 0484:105-106).
      const adminEmail = `ca-${TAG}@dashcfg.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

      // DASHCFG-N1/N2/N3: hr(0011) + employee(0008) + manager(0010) — KHÔNG có grant 2 cặp (least-privilege).
      const hrEmail = `hr-${TAG}@dashcfg.test`;
      const hr = await seedUser(direct, A.companyId, hrEmail, pw);
      await seedUserRole(direct, hr, HR_ROLE, A.companyId);

      const empEmail = `emp-${TAG}@dashcfg.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      const mgrEmail = `mgr-${TAG}@dashcfg.test`;
      const mgr = await seedUser(direct, A.companyId, mgrEmail, pw);
      await seedUserRole(direct, mgr, MANAGER_ROLE, A.companyId);

      // DASHCFG-N4: wildcard-only '*:*' non-sensitive → KHÔNG kế thừa 2 cặp sensitive (sensitive gate).
      const wildEmail = `wild-${TAG}@dashcfg.test`;
      const wild = await seedUser(direct, A.companyId, wildEmail, pw);
      const wildRole = await seedRole(direct, A.companyId, `dashcfg-wild-${TAG}`);
      const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
      await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
      await seedUserRole(direct, wild, wildRole, A.companyId);

      // ── Tenant B (cross-tenant, BẤT BIẾN #1) ─────────────────────────────────
      // DASHCFG-N5: user trơn (KHÔNG role) — grant DASH config của tenant A KHÔNG rò sang tenant B.
      B = await seedCompany(direct, "dashcfgb");
      companyIds.push(B.companyId);
      const bEmail = `bare-${TAG}@dashcfgb.test`;
      await seedUser(direct, B.companyId, bEmail, pw);

      adminToken = await login(app, A.slug, adminEmail);
      hrToken = await login(app, A.slug, hrEmail);
      employeeToken = await login(app, A.slug, empEmail);
      managerToken = await login(app, A.slug, mgrEmail);
      wildcardToken = await login(app, A.slug, wildEmail);
      tenantBToken = await login(app, B.slug, bEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    it("DASHCFG-P1 — company-admin (0001) → /auth/me CÓ đủ 2 cặp DASH config === true", async () => {
      const caps = await meCapabilities(app, adminToken);
      for (const key of DASH_CONFIG_SENSITIVE_KEYS) {
        expect(caps[key], `company-admin thiếu cặp allowlist ${key}`).toBe(true);
      }
    });

    it("DASHCFG-N1 — hr (0011) → KHÔNG có cặp DASH config nào (least-privilege, chỉ company-admin)", async () => {
      const caps = await meCapabilities(app, hrToken);
      for (const key of DASH_CONFIG_SENSITIVE_KEYS) {
        expect(key in caps, `hr KHÔNG được lộ cặp ${key}`).toBe(false);
      }
    });

    it("DASHCFG-N2 — employee (0008) → KHÔNG có cặp DASH config nào (least-privilege)", async () => {
      const caps = await meCapabilities(app, employeeToken);
      for (const key of DASH_CONFIG_SENSITIVE_KEYS) {
        expect(key in caps, `employee KHÔNG được lộ cặp ${key}`).toBe(false);
      }
    });

    it("DASHCFG-N3 — manager (0010) → KHÔNG có cặp DASH config nào (least-privilege)", async () => {
      const caps = await meCapabilities(app, managerToken);
      for (const key of DASH_CONFIG_SENSITIVE_KEYS) {
        expect(key in caps, `manager KHÔNG được lộ cặp ${key}`).toBe(false);
      }
    });

    it("DASHCFG-N4 — wildcard '*:*' → KHÔNG kế thừa 2 cặp DASH config (sensitive gate); '*:*' vẫn có", async () => {
      const caps = await meCapabilities(app, wildcardToken);
      expect(caps[WILDCARD_CAP_KEY]).toBe(true); // non-sensitive wildcard vẫn surface
      for (const key of DASH_CONFIG_SENSITIVE_KEYS) {
        expect(key in caps, `cặp nhạy cảm ${key} KHÔNG kế thừa qua *:*`).toBe(false);
      }
    });

    it("DASHCFG-N5 — cross-tenant: user tenant B trơn → KHÔNG chứa 2 cặp DASH config của tenant A", async () => {
      const caps = await meCapabilities(app, tenantBToken);
      for (const key of DASH_CONFIG_SENSITIVE_KEYS) {
        expect(key in caps, `tenant B KHÔNG được thấy ${key} của tenant A`).toBe(false);
      }
    });
  },
);

// ────────────────────────────────────────────────────────────────────────────
// S5-HR-IMPORT-FE-1 — APPEND 'import:employee' vào SENSITIVE_CAPABILITY_ALLOWLIST. Cặp seed THẬT
// is_sensitive=true (mig 0496, flip false→true của 0019 dòng 23 + backfill dọn stray blanket-grant
// role hr-manager media-era), grant Company CHỈ hr(0011)+company-admin(0001) (mig 0496 khối (b)). BE lane
// S5-HR-IMPORT-BE-1 CHỐT DEFER việc allowlist này sang FE lane (ledger 2026-07-13) — TRƯỚC APPEND này,
// getCapabilities() lọc bỏ MỌI sensitive ⇒ /auth/me KHÔNG BAO GIỜ trả 'import:employee' cho BẤT KỲ ai
// (kể cả hr/company-admin có grant thật) ⇒ route /hr/employees/import + nút "Import nhân viên"
// (EmployeeListPage, useCanExact('import','employee')) LUÔN ẨN trong app thật (bẫy CAP-2/USEROPS-1/
// EXPORT-1/NOTI-BE-3/DASH-3 tái diễn). Đây là BẰNG CHỨNG PIPELINE THẬT thay cho false-green FE (spec tự
// set capabilities vào store). Enforcement KHÔNG đổi — @RequirePermission('import','employee',
// {isSensitive:true}) (hr-import.controller.ts) + assertImportScope (Company/System only,
// hr-employee-import.service.ts) vẫn là cổng THẬT. Chỉ mở CỜ HIỂN THỊ.
// ────────────────────────────────────────────────────────────────────────────

const IMPORT_EMPLOYEE_CAP_KEY = "import:employee";

describe.skipIf(!runDb)(
  "S5-HR-IMPORT-FE-1 /auth/me import:employee (hr + company-admin only, mig 0496)",
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
      A = await seedCompany(direct, "impcap");
      companyIds.push(A.companyId);

      // IMPORTCAP-P1/P2: company-admin (0001) + hr (0011) — CẢ HAI có grant Company import:employee (mig 0496).
      const adminEmail = `ca-${TAG}@impcap.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

      const hrEmail = `hr-${TAG}@impcap.test`;
      const hr = await seedUser(direct, A.companyId, hrEmail, pw);
      await seedUserRole(direct, hr, HR_ROLE, A.companyId);

      // IMPORTCAP-N1/N2: employee (0008) + manager (0010) — KHÔNG có grant import:employee (least-privilege).
      const empEmail = `emp-${TAG}@impcap.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      const mgrEmail = `mgr-${TAG}@impcap.test`;
      const mgr = await seedUser(direct, A.companyId, mgrEmail, pw);
      await seedUserRole(direct, mgr, MANAGER_ROLE, A.companyId);

      // IMPORTCAP-N3: wildcard-only — role có '*:*' ALLOW non-sensitive → KHÔNG kế thừa import:employee.
      const wildEmail = `wild-${TAG}@impcap.test`;
      const wild = await seedUser(direct, A.companyId, wildEmail, pw);
      const wildRole = await seedRole(direct, A.companyId, `impcap-wild-${TAG}`);
      const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
      await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
      await seedUserRole(direct, wild, wildRole, A.companyId);

      // IMPORTCAP-N5: deny-override — role ALLOW import:employee (Company) + DENY cùng cặp → suppress
      // (deny-override per-pair, mirror isDenied wildcard-aware).
      const denyEmail = `deny-${TAG}@impcap.test`;
      const denyUser = await seedUser(direct, A.companyId, denyEmail, pw);
      const denyRole = await seedRole(direct, A.companyId, `impcap-deny-${TAG}`);
      const importPerm = await seedPermissionCatalog(direct, "import", "employee", true);
      await seedRolePermission(direct, denyRole, importPerm, "ALLOW");
      await seedRolePermission(direct, denyRole, importPerm, "DENY");
      await seedUserRole(direct, denyUser, denyRole, A.companyId);

      // ── Tenant B (cross-tenant, BẤT BIẾN #1) ─────────────────────────────────
      // IMPORTCAP-N4: user trơn (KHÔNG role) — grant import:employee của tenant A KHÔNG rò sang tenant B.
      B = await seedCompany(direct, "impcapb");
      companyIds.push(B.companyId);
      const bEmail = `bare-${TAG}@impcapb.test`;
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

    it("IMPORTCAP-P1 — company-admin (0001) → /auth/me.capabilities['import:employee'] === true", async () => {
      const caps = await meCapabilities(app, adminToken);
      expect(caps[IMPORT_EMPLOYEE_CAP_KEY]).toBe(true);
    });

    it("IMPORTCAP-P2 — hr (0011) → /auth/me.capabilities['import:employee'] === true", async () => {
      const caps = await meCapabilities(app, hrToken);
      expect(caps[IMPORT_EMPLOYEE_CAP_KEY]).toBe(true);
    });

    it("IMPORTCAP-N1 — employee (0008) → KHÔNG có 'import:employee' (least-privilege)", async () => {
      const caps = await meCapabilities(app, employeeToken);
      expect(IMPORT_EMPLOYEE_CAP_KEY in caps).toBe(false);
    });

    it("IMPORTCAP-N2 — manager (0010) → KHÔNG có 'import:employee' (least-privilege)", async () => {
      const caps = await meCapabilities(app, managerToken);
      expect(IMPORT_EMPLOYEE_CAP_KEY in caps).toBe(false);
    });

    it("IMPORTCAP-N3 — wildcard '*:*' → KHÔNG kế thừa 'import:employee' (sensitive gate); '*:*' vẫn có", async () => {
      const caps = await meCapabilities(app, wildcardToken);
      expect(caps[WILDCARD_CAP_KEY]).toBe(true);
      expect(IMPORT_EMPLOYEE_CAP_KEY in caps).toBe(false);
    });

    it("IMPORTCAP-N4 — cross-tenant: user tenant B trơn → KHÔNG chứa 'import:employee' của tenant A", async () => {
      const caps = await meCapabilities(app, tenantBToken);
      expect(IMPORT_EMPLOYEE_CAP_KEY in caps).toBe(false);
    });

    it("IMPORTCAP-N5 — DENY-override: ALLOW + DENY cùng cặp → 'import:employee' bị suppress", async () => {
      const caps = await meCapabilities(app, denyOverrideToken);
      expect(
        IMPORT_EMPLOYEE_CAP_KEY in caps,
        "import:employee phải bị DENY-override suppress",
      ).toBe(false);
    });
  },
);
