/**
 * S2-FND-BE-8 (be-system-settings) — GET/PATCH /foundation/system-settings(/:key) DENY-PATH (RED-first,
 * DB cô lập). Cổng = `system-manage:foundation-setting` (mig 0435 §5c, is_sensitive=TRUE, System-scope) —
 * cặp KHÔNG seed cho role nào (cấp tường minh per-user). BẤT BIẾN sensitive gate (permission.service
 * L157-181): wildcard `*:*` / super-admin KHÔNG kế thừa quyền nhạy cảm ⇒ vẫn 403.
 *
 * Deny-first RED (viết TRƯỚC implement — route chưa tồn tại ⇒ 404 ≠ 403 ⇒ ĐỎ; sau implement ⇒ 403):
 *   D1  employee (role 0008, KHÔNG grant) PATCH /system-settings/:key → 403 + KHÔNG audit mới (0 audit).
 *   D2  employee GET /system-settings → 403 (list bị chặn TRƯỚC service).
 *   D3  employee GET /system-settings/:key → 403 (detail cũng gated, không bypass).
 *   D4  wildcard '*:*' (non-sensitive ALLOW) PATCH → vẫn 403 (sensitive KHÔNG kế thừa) + 0 audit.
 *   D5  wildcard '*:*' GET /system-settings → 403 (sensitive KHÔNG kế thừa).
 *   D6  update:foundation-setting (non-sensitive, đủ cho company-setting) KHÔNG mở cổng system-manage → PATCH 403.
 *
 * BẤT BIẾN #2 (audit append-only): mọi deny KHÔNG được ghi audit — assert count(audit_logs) không đổi.
 * KHÔNG test 2-tenant isolation cho system_setting (GLOBAL no-RLS — mọi tenant chia sẻ 1 hàng).
 *
 * Postgres THẬT (DB cô lập mediaos_<lane>, CLAUDE §9.5). Gate `hasDb && LANE_DB` (memory:
 * integration-test-lane-db-gate — .env làm hasDb=true; thiếu LANE_DB → đỏ-giả trên DB dev chung).
 * Direct pool (superuser, bypass RLS) seed users/roles + system_settings; HTTP đi qua app thật (guard sống).
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
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const PASSWORD = "Passw0rd!test99";
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có foundation-* grant

/** Gate cứng: chỉ chạy khi có Postgres THẬT VÀ chạy trên DB cô lập lane (không phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

/** Marker tách dữ liệu của suite này khỏi suite khác trên cùng DB (dùng làm setting_key prefix + category). */
const TAG = `SSYSDENY-${randomUUID().slice(0, 8)}`;
const KEY = `${TAG}.number.key`;

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

/** Đếm TỔNG audit_logs của tenant (chứng minh deny KHÔNG ghi audit mới — BẤT BIẾN #2 append-only). */
async function auditCount(direct: Pool, companyId: string): Promise<number> {
  const r = await direct.query("SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1", [
    companyId,
  ]);
  return r.rows[0].n as number;
}

/** Chèn 1 system_setting RAW (global no-RLS, không company_id). Dùng làm target cho PATCH deny. */
async function insertSystemSetting(direct: Pool): Promise<void> {
  await direct.query(
    `INSERT INTO system_settings
       (setting_key, setting_value, value_type, category, module_code, is_public, is_sensitive, status)
     VALUES ($1, '10'::jsonb, 'Number', $2, 'SYSTEM', true, false, 'Active')
     ON CONFLICT (setting_key) WHERE status = 'Active' DO NOTHING`,
    [KEY, TAG],
  );
}

describe.skipIf(!runDb)("S2-FND-BE-8 system-settings permission deny-path (sensitive gate)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let employeeToken: string; // role 0008 — KHÔNG grant
  let wildcardToken: string; // '*:*' non-sensitive — KHÔNG kế thừa sensitive
  let updateOnlyToken: string; // update:foundation-setting (non-sensitive) — KHÔNG mở cổng system-manage
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "ssysdeny");
    companyIds.push(A.companyId);
    const pw = await new PasswordService().hash(PASSWORD);

    // employee A — role 0008 KHÔNG có foundation-* grant ⇒ deny-path 403.
    const empEmail = `emp-${randomUUID().slice(0, 8)}@a.test`;
    const emp = await seedUser(direct, A.companyId, empEmail, pw);
    await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

    // wildcard A — role riêng + grant '*:*' (non-sensitive). KHÔNG kế thừa quyền sensitive.
    const wildEmail = `wild-${randomUUID().slice(0, 8)}@a.test`;
    const wild = await seedUser(direct, A.companyId, wildEmail, pw);
    const wildRole = await seedRole(direct, A.companyId, `wild-${randomUUID().slice(0, 8)}`);
    const wildPerm = await seedPermissionCatalog(direct, "*", "*", false);
    await seedRolePermission(direct, wildRole, wildPerm, "ALLOW");
    await seedUserRole(direct, wild, wildRole, A.companyId);

    // update-only A — role riêng + grant update:foundation-setting (non-sensitive, mig 0435). Đủ cho
    // company-setting NHƯNG KHÔNG phải system-manage ⇒ chứng minh cổng system-setting là RIÊNG & sensitive.
    const upEmail = `up-${randomUUID().slice(0, 8)}@a.test`;
    const up = await seedUser(direct, A.companyId, upEmail, pw);
    const upRole = await seedRole(direct, A.companyId, `up-${randomUUID().slice(0, 8)}`);
    const upPerm = await seedPermissionCatalog(direct, "update", "foundation-setting", false);
    await seedRolePermission(direct, upRole, upPerm, "ALLOW");
    await seedUserRole(direct, up, upRole, A.companyId);

    await insertSystemSetting(direct);

    employeeToken = await login(app, A.slug, empEmail);
    wildcardToken = await login(app, A.slug, wildEmail);
    updateOnlyToken = await login(app, A.slug, upEmail);
  });

  afterAll(async () => {
    await app?.close();
    // Dọn system_settings của suite (GLOBAL — cleanupTenants không phủ). Xoá TRƯỚC companies.
    if (direct) await direct.query("DELETE FROM system_settings WHERE category = $1", [TAG]);
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── D1: employee PATCH → 403 + 0 audit mới ─────────────────────────────────
  it("D1 — employee (không grant) PATCH /system-settings/:key → 403 + KHÔNG ghi audit", async () => {
    const before = await auditCount(direct, A.companyId);
    const res = await api(app)
      .patch(`/foundation/system-settings/${KEY}`)
      .set("Authorization", `Bearer ${employeeToken}`)
      .send({ settingValue: 20 });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.data ?? null).toBeNull();
    const after = await auditCount(direct, A.companyId);
    expect(after).toBe(before); // append-only: deny KHÔNG ghi audit
  });

  // ── D2: employee GET list → 403 ────────────────────────────────────────────
  it("D2 — employee GET /system-settings → 403 (list gated TRƯỚC service)", async () => {
    const res = await api(app)
      .get(`/foundation/system-settings`)
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.data ?? null).toBeNull();
  });

  // ── D3: employee GET detail → 403 ──────────────────────────────────────────
  it("D3 — employee GET /system-settings/:key → 403 (detail cũng gated)", async () => {
    const res = await api(app)
      .get(`/foundation/system-settings/${KEY}`)
      .set("Authorization", `Bearer ${employeeToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ── D4: wildcard '*:*' PATCH → 403 (sensitive KHÔNG kế thừa) + 0 audit ──────
  it("D4 — wildcard '*:*' PATCH /system-settings/:key → 403 (sensitive không kế thừa) + KHÔNG audit", async () => {
    const before = await auditCount(direct, A.companyId);
    const res = await api(app)
      .patch(`/foundation/system-settings/${KEY}`)
      .set("Authorization", `Bearer ${wildcardToken}`)
      .send({ settingValue: 30 });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    const after = await auditCount(direct, A.companyId);
    expect(after).toBe(before);
  });

  // ── D5: wildcard '*:*' GET → 403 ───────────────────────────────────────────
  it("D5 — wildcard '*:*' GET /system-settings → 403 (sensitive không kế thừa)", async () => {
    const res = await api(app)
      .get(`/foundation/system-settings`)
      .set("Authorization", `Bearer ${wildcardToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ── D6: update:foundation-setting (non-sensitive) KHÔNG mở cổng system-manage ──
  it("D6 — update:foundation-setting KHÔNG mở cổng PATCH /system-settings/:key → 403", async () => {
    const before = await auditCount(direct, A.companyId);
    const res = await api(app)
      .patch(`/foundation/system-settings/${KEY}`)
      .set("Authorization", `Bearer ${updateOnlyToken}`)
      .send({ settingValue: 40 });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    const after = await auditCount(direct, A.companyId);
    expect(after).toBe(before);
  });
});
