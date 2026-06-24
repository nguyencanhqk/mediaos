/**
 * S1-QA-FND-1 (L1-qa-perm-scope) — Audit viewer PERMISSION + SCOPE deny-path (integration, DB cô lập).
 *
 * Phủ assertion CÒN THIẾU của QA05-SYS-003/004/007 + BACKEND-04 §18.3 mà audit-list-filter.int-spec.ts
 * KHÔNG phủ (file đó test filter/scope-FILTER khi đã CÓ grant; file này test CỔNG QUYỀN + biên audience):
 *
 *   D1 [QA05-SYS-004 / §18.3]  Employee (role 0008, KHÔNG có grant view:audit-log) GET /foundation/audit-logs
 *                              → 403 (PermissionGuard chặn TRƯỚC service). Envelope {success:false,error}.
 *   D2 [QA05-SYS-004 / §18.3]  Wildcard '*:*' (non-sensitive ALLOW) → vẫn 403: view:audit-log is_sensitive=true
 *                              ⇒ wildcard KHÔNG kế thừa (BẤT BIẾN PermissionGuard). Detail /:id cũng 403.
 *   D3 [QA05-SYS-003 / §18.3]  ALLOW sanity: company-admin (role 0001 + grant 0340) list company hiện tại → 200.
 *                              (Đối chiếu cổng quyền MỞ đúng — KHÔNG nhân bản scope-filter của audit-list-filter.)
 *   D4 [QA05-SYS-004 / §18.3]  Cross-tenant DETAIL: admin A xem audit id của tenant B qua route COMPANY /:id
 *                              → 404 (RLS che — không lộ tồn tại hàng tenant khác, không leak qua mã lỗi).
 *   D5 [QA05-SYS-004 / §18.3]  Biên audience + grant SYSTEM route: admin A (token tenant, KHÔNG view:platform-audit)
 *                              GET /foundation/audit-logs/all → 401/403 (@OperatorOnly chặn token tenant TRƯỚC,
 *                              fallback grant nếu audience qua). KHÔNG bao giờ 200 (không thấy chéo tenant).
 *   D6 [QA05-SYS-007 / §18.3]  my-apps lọc theo permission — GATE TỰ-KÍCH-HOẠT (probe route trước, KHÔNG it.skip
 *                              chết). Trạng thái cây HIỆN TẠI: source S1-FND-MODULE-1 đã land trên `master`
 *                              (b72ad10: module-catalog service/controller/repo/dto/metadata) NHƯNG (a) nhánh làm
 *                              việc CHƯA merge master — branch-merge ở lane QA tạo >12 xung đột file NGOÀI scope
 *                              (.env.example/env.schema/vite/dashboard/web-core) ⇒ KHÔNG an toàn ở lane này; VÀ
 *                              (b) ngay cả khi merge, ModuleCatalogModule CHƯA wire vào app.module.ts — wiring là
 *                              việc của S1-FND-WIRE-1 (status 'todo' trên master) ⇒ route /modules/my-apps KHÔNG
 *                              đăng ký trong Nest graph ⇒ 404. Vé chặn: S1-FND-WIRE-1 (gom + wire FoundationModule).
 *                              ⇒ Gate dưới TỰ probe route: 404/501 (route chưa live) → skip-có-vé (KHÔNG bịa pass);
 *                              200 (WIRE-1 đã land) → CHẠY assertion lọc-quyền THẬT, KHÔNG cần sửa tay (activate-now).
 *
 * Dùng Postgres THẬT (DB cô lập mediaos_<lane>, CLAUDE §9.5). Gate `hasDb && LANE_DB` (memory:
 * integration-test-lane-db-gate) — .env làm hasDb=true; thiếu LANE_DB → đỏ-giả trên DB dev chung.
 * Direct pool (superuser, bypass RLS) seed audit rows + roles; HTTP đi qua app thật (guard + RLS sống).
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
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  seedRole,
  seedPermissionCatalog,
  seedRolePermission,
  type SeededTenant,
} from "../helpers/seed";

const PASSWORD = "Passw0rd!test99";
/** Roles hệ thống seed sẵn (mig 0005). */
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // có view:audit-log (mig 0340)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có view:audit-log

/** Gate cứng: chỉ chạy khi có Postgres THẬT VÀ chạy trên DB cô lập lane (không phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

/** Marker tách dữ liệu audit của suite này khỏi suite khác trên cùng DB. */
const TAG = `PDENY-${randomUUID().slice(0, 8)}`;

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

/** Chèn 1 hàng audit RAW vào tenant chỉ định (direct pool, bypass RLS). Trả về id. */
async function insertAudit(direct: Pool, companyId: string, action: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, $2, 'user') RETURNING id`,
    [companyId, action],
  );
  return r.rows[0].id as string;
}

function rowsOf(body: { data: { data: unknown[] } }): unknown[] {
  return body.data.data;
}

describe.skipIf(!runDb)("S1-QA-FND-1 audit permission + scope deny-path", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let adminToken: string; // company-admin A (CÓ view:audit-log)
  let employeeToken: string; // employee A (KHÔNG có view:audit-log)
  let wildcardToken: string; // user A có '*:*' non-sensitive (KHÔNG kế thừa sensitive)
  let auditIdB: string; // audit row của tenant B (cross-tenant target)
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "pda");
    B = await seedCompany(direct, "pdb");
    companyIds.push(A.companyId, B.companyId);
    const pw = await new PasswordService().hash(PASSWORD);

    // company-admin A — có grant view:audit-log (mig 0340) ⇒ ALLOW sanity.
    const adminEmail = `adm-${randomUUID().slice(0, 8)}@a.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    // employee A — role 0008 KHÔNG có view:audit-log ⇒ deny-path 403.
    const empEmail = `emp-${randomUUID().slice(0, 8)}@a.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    // wildcard A — role riêng + grant '*:*' (non-sensitive). KHÔNG kế thừa view:audit-log (sensitive).
    const wildEmail = `wild-${randomUUID().slice(0, 8)}@a.test`;
    const wild = await seedUser(direct, A.companyId, wildEmail, pw);
    const wildRole = await seedRole(direct, A.companyId, `wild-${randomUUID().slice(0, 8)}`);
    const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
    await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
    await seedUserRole(direct, wild, wildRole, A.companyId);

    // audit rows: 1 của A (admin xem được), 1 của B (cross-tenant target cho D4).
    await insertAudit(direct, A.companyId, `${TAG}-a`);
    auditIdB = await insertAudit(direct, B.companyId, `${TAG}-b`);

    adminToken = await login(app, A.slug, adminEmail);
    employeeToken = await login(app, A.slug, empEmail);
    wildcardToken = await login(app, A.slug, wildEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── D1: Employee KHÔNG grant → 403 (cổng quyền chặn TRƯỚC service) ─────────────
  it("D1 — Employee (không view:audit-log) GET /foundation/audit-logs → 403 envelope", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs`)
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeTruthy();
    // KHÔNG lộ data audit khi bị từ chối.
    expect(res.body.data ?? null).toBeNull();
  });

  it("D1 — Employee GET /foundation/audit-logs/:id (detail) cũng → 403 (không bypass qua route detail)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs/${randomUUID()}`)
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status).toBe(403);
  });

  // ── D2: Wildcard '*:*' non-sensitive KHÔNG kế thừa view:audit-log (sensitive) ───
  it("D2 — Wildcard '*:*' (non-sensitive) GET /foundation/audit-logs → 403 (sensitive không kế thừa)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs`)
      .set("Authorization", `Bearer ${wildcardToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ── D3: ALLOW sanity — company-admin có grant → 200 (cổng MỞ đúng) ─────────────
  it("D3 — company-admin (view:audit-log) GET /foundation/audit-logs → 200 (chỉ tenant hiện tại)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs?action=${TAG}-a`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = rowsOf(res.body) as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]["companyId"]).toBe(A.companyId);
  });

  // ── D4: Cross-tenant detail qua route COMPANY → 404 (RLS che) ──────────────────
  it("D4 — admin A GET /foundation/audit-logs/{idCủaB} → 404 (RLS che, không lộ tồn tại tenant khác)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs/${auditIdB}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    // Mã lỗi 404 không khác giữa "không tồn tại" và "thuộc tenant khác" ⇒ không leak tồn tại hàng B.
    expect(res.body.data ?? null).toBeNull();
  });

  // ── D5: SYSTEM route /all với token tenant + không view:platform-audit → KHÔNG 200 ──
  it("D5 — admin A (token tenant, không platform-audit) GET /foundation/audit-logs/all → 401/403 (KHÔNG 200)", async () => {
    const res = await api(app)
      .get(`/foundation/audit-logs/all?action=${TAG}-b`)
      .set("Authorization", `Bearer ${adminToken}`);
    // @OperatorOnly chặn token audience='tenant' (401); nếu audience qua thì thiếu grant (403). KHÔNG 200.
    expect([401, 403]).toContain(res.status);
    expect(res.status).not.toBe(200);
    // Tuyệt đối không lộ hàng audit của B qua route system.
    expect(res.body.data ?? null).toBeNull();
  });

  // ── D6: my-apps lọc permission — GATE TỰ-KÍCH-HOẠT (probe route, KHÔNG it.skip chết) ──
  // Probe GET /foundation/modules/my-apps:
  //   • 404/501 (route chưa wire — S1-FND-WIRE-1 'todo') ⇒ skip-có-vé runtime: KHÔNG bịa pass, KHÔNG fail-giả.
  //   • 200 (WIRE-1 land + master merge) ⇒ CHẠY assertion lọc-quyền THẬT — không cần sửa tay (activate-now).
  // Assertion bất biến (không hardcode module nào, không vỡ khi seed-grant drift):
  //   (1) admin (role 0001, grant rộng) thấy ≥1 app; mỗi item shape my-apps đúng + KHÔNG lộ storage_path/secret.
  //   (2) employee (role 0008, quyền tối thiểu) → tập app là SUBSET của admin (ít/bằng quyền ⇒ ít/bằng app).
  //       Đây là chứng minh hướng-lọc: thiếu requiredAny của module ⇒ module BỊ LỌC khỏi my-apps.
  it("D6 — my-apps lọc app theo permission [TỰ-KÍCH-HOẠT khi route live; nếu 404 → skip-có-vé S1-FND-WIRE-1]", async (ctx) => {
    const adminRes = await api(app)
      .get(`/foundation/modules/my-apps`)
      .set("Authorization", `Bearer ${adminToken}`);

    // Route chưa wire (ModuleCatalogModule chưa vào app.module.ts — S1-FND-WIRE-1 'todo') ⇒ 404.
    // KHÔNG nghiệm thu được ở cây này; skip-có-vé runtime (KHÔNG bịa pass).
    if (adminRes.status === 404 || adminRes.status === 501) {
      ctx.skip();
      return;
    }

    // ── Route ĐÃ live ⇒ assertion lọc-quyền THẬT ──────────────────────────────────
    expect(adminRes.status, JSON.stringify(adminRes.body)).toBe(200);
    const adminApps = (adminRes.body.data as Array<Record<string, unknown>>) ?? [];
    expect(Array.isArray(adminApps)).toBe(true);
    expect(adminApps.length).toBeGreaterThan(0); // admin (grant rộng) thấy ≥1 app

    // Shape + KHÔNG lộ secret/storage_path trên mọi item (BẤT BIẾN #3 / QA06-FILE-001).
    for (const item of adminApps) {
      expect(item).toHaveProperty("module_code");
      expect(item).toHaveProperty("route");
      expect(item).toHaveProperty("is_active");
      const serialized = JSON.stringify(item);
      expect(serialized).not.toMatch(/storage_path/i);
      expect(serialized).not.toMatch(/secret_ref/i);
      expect(serialized).not.toMatch(/password_hash|refresh_token/i);
    }
    const adminCodes = new Set(adminApps.map((a) => a.module_code as string));

    // Employee (role 0008, quyền tối thiểu): tập app là SUBSET của admin.
    const empRes = await api(app)
      .get(`/foundation/modules/my-apps`)
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(empRes.status, JSON.stringify(empRes.body)).toBe(200);
    const empApps = (empRes.body.data as Array<Record<string, unknown>>) ?? [];
    const empCodes = empApps.map((a) => a.module_code as string);

    // Ít/bằng quyền ⇒ ít/bằng app: mọi app employee thấy thì admin cũng thấy (subset),
    // và employee KHÔNG thấy nhiều hơn admin. Chứng minh module thiếu requiredAny BỊ LỌC.
    for (const code of empCodes) {
      expect(adminCodes.has(code), `employee thấy '${code}' nhưng admin không → lọc sai`).toBe(
        true,
      );
    }
    expect(empApps.length).toBeLessThanOrEqual(adminApps.length);
  });
});
