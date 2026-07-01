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
