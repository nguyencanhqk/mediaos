/**
 * S2-FND-BE-5 (be-settings-public) — GET /foundation/settings/public gate = 'Authenticated' (integration, DB cô lập).
 *
 * CHỐT (plan-BLOCK round 1 đã bác @Public): getPublic KHÔNG cần view:foundation-setting NHƯNG VẪN qua JWT —
 * gỡ @UseGuards(PermissionGuard) cấp lớp SettingsController; getPublic chỉ đi qua guard GLOBAL
 * (JwtAuthGuard → CompanyGuard); resolve + updateCompanySetting GIỮ cổng per-method (view/update:foundation-setting).
 * TUYỆT ĐỐI KHÔNG @Public (mất JWT → vỡ tenant-scoping BẤT BIẾN #1). Mẫu y hệt ModuleCatalogController my-apps.
 *
 * Deny-first RED (viết TRƯỚC implement — case R2 ĐỎ khi getPublic còn gated bằng view:foundation-setting):
 *   R1 [QA-06] KHÔNG Bearer → /settings/public 401 (KHÔNG 200/403). Chứng minh JwtAuthGuard GLOBAL VẪN áp sau
 *              khi gỡ PermissionGuard cấp lớp (BẤT BIẾN #1: mọi request phải có JWT → company_id).
 *   R2 [QA-06] employee (role 0008, KHÔNG view:foundation-setting) + Bearer → /settings/public 200 (gate lifted).
 *              ĐÂY là driver RED: trước implement getPublic gated ⇒ 403; sau implement ⇒ 200.
 *   R3 [QA-05/06] tenant-isolation — employee A CHỈ thấy public setting của companyA, KHÔNG của companyB
 *              (withTenant/companyId + RLS FORCE vẫn ép, dù cổng quyền mở).
 *   R4 [QA-06] secret non-leak — is_sensitive / is_encrypted / value_type=SecretRef / secret_ref!=null KHÔNG
 *              BAO GIỜ vào response public map (setting-mask.toPublicMap KHÔNG nới).
 *   R5 [QA-04 contract] resolve VẪN 403 khi thiếu view:foundation-setting; ALLOW sanity admin (grant 0435) → 200.
 *   R6 [QA-04 contract] PATCH /company-settings/:key VẪN 403 khi thiếu update:foundation-setting (cổng chưa hở).
 *
 * Postgres THẬT (DB cô lập mediaos_<lane>, CLAUDE §9). Gate `hasDb && LANE_DB` (memory:
 * integration-test-lane-db-gate — .env làm hasDb=true; thiếu LANE_DB → đỏ-giả trên DB dev chung).
 * Direct pool (superuser, bypass RLS) seed company_settings + users/roles; HTTP đi qua app thật (guard + RLS sống).
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
  type SeededTenant,
} from "../helpers/seed";

const PASSWORD = "Passw0rd!test99";
/** Roles hệ thống seed sẵn (mig 0005). */
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // CÓ view/update:foundation-setting (grant 0435)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG có foundation-* grant

/** Gate cứng: chỉ chạy khi có Postgres THẬT VÀ chạy trên DB cô lập lane (không phải DB dev chung). */
const runDb = hasDb && Boolean(process.env.LANE_DB);

/** Marker tách dữ liệu setting của suite này khỏi suite khác trên cùng DB (dùng làm category → lọc sạch). */
const TAG = `SPUB-${randomUUID().slice(0, 8)}`;
const CATEGORY = TAG; // category riêng ⇒ /public?category=TAG chỉ trả rows của suite này (khử nhiễu seed khác).

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

/** Chèn 1 company_setting RAW vào tenant chỉ định (direct pool, bypass RLS). value_type/is_public/... tường minh. */
async function insertCompanySetting(
  direct: Pool,
  companyId: string,
  row: {
    key: string;
    value: unknown;
    valueType?: string;
    isPublic?: boolean;
    isSensitive?: boolean;
    isEncrypted?: boolean;
    secretRef?: string | null;
  },
): Promise<void> {
  await direct.query(
    `INSERT INTO company_settings
       (company_id, setting_key, setting_value, value_type, category, module_code,
        is_public, is_sensitive, is_encrypted, secret_ref, status)
     VALUES ($1, $2, $3::jsonb, $4, $5, NULL, $6, $7, $8, $9, 'Active')`,
    [
      companyId,
      row.key,
      JSON.stringify(row.value),
      row.valueType ?? "String",
      CATEGORY,
      row.isPublic ?? true,
      row.isSensitive ?? false,
      row.isEncrypted ?? false,
      row.secretRef ?? null,
    ],
  );
}

/** Key có TAG để không đụng suite khác. */
const KEY = {
  pubA: `${TAG}.pub.a`,
  sensitiveA: `${TAG}.sensitive.a`,
  encryptedA: `${TAG}.encrypted.a`,
  secretRefA: `${TAG}.secretref.a`,
  pubB: `${TAG}.pub.b`,
} as const;

const SECRET_VALUES = {
  sensitive: "SENSITIVE-must-not-leak",
  encrypted: "ENCRYPTED-must-not-leak",
  secretRef: "SECRETREF-must-not-leak",
  secretRefPointer: "vault://a/secretref-pointer",
} as const;

describe.skipIf(!runDb)(
  "S2-FND-BE-5 settings/public authenticated gate + tenant-isolation + secret non-leak",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    let adminToken: string; // company-admin A — CÓ view/update:foundation-setting (grant 0435)
    let employeeToken: string; // employee A — KHÔNG có foundation-* grant
    const companyIds: string[] = [];

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      A = await seedCompany(direct, "spuba");
      B = await seedCompany(direct, "spubb");
      companyIds.push(A.companyId, B.companyId);
      const pw = await new PasswordService().hash(PASSWORD);

      // company-admin A — grant 0435 (view/update:foundation-setting) ⇒ ALLOW sanity resolve.
      const adminEmail = `adm-${randomUUID().slice(0, 8)}@a.test`;
      const admin = await seedUser(direct, A.companyId, adminEmail, pw);
      await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

      // employee A — role 0008, KHÔNG foundation-* grant ⇒ deny-path resolve/patch NHƯNG public mở.
      const empEmail = `emp-${randomUUID().slice(0, 8)}@a.test`;
      const emp = await seedUser(direct, A.companyId, empEmail, pw);
      await seedUserRole(direct, emp, EMPLOYEE_ROLE, A.companyId);

      // ── company_settings companyA: 1 public-nonsensitive + 3 secret-like (phải bị drop khỏi /public) ──
      await insertCompanySetting(direct, A.companyId, { key: KEY.pubA, value: "A-public-value" });
      await insertCompanySetting(direct, A.companyId, {
        key: KEY.sensitiveA,
        value: SECRET_VALUES.sensitive,
        isPublic: true, // lỡ đánh dấu public NHƯNG is_sensitive=true ⇒ vẫn phải bị loại.
        isSensitive: true,
      });
      await insertCompanySetting(direct, A.companyId, {
        key: KEY.encryptedA,
        value: SECRET_VALUES.encrypted,
        isPublic: true,
        isEncrypted: true,
      });
      await insertCompanySetting(direct, A.companyId, {
        key: KEY.secretRefA,
        value: SECRET_VALUES.secretRef,
        valueType: "SecretRef",
        isPublic: true,
        secretRef: SECRET_VALUES.secretRefPointer,
      });

      // ── company_settings companyB: 1 public (cross-tenant target cho R3) ──
      await insertCompanySetting(direct, B.companyId, { key: KEY.pubB, value: "B-public-value" });

      adminToken = await login(app, A.slug, adminEmail);
      employeeToken = await login(app, A.slug, empEmail);
    });

    afterAll(async () => {
      await app?.close();
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ── R1: KHÔNG Bearer → 401 (JwtAuthGuard GLOBAL vẫn áp; KHÔNG 200, KHÔNG 403) ──────
    it("R1 — GET /foundation/settings/public KHÔNG Bearer → 401 (JWT global sống, không @Public)", async () => {
      const res = await api(app).get(`/foundation/settings/public?category=${CATEGORY}`);
      expect(res.status, JSON.stringify(res.body)).toBe(401);
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(403);
      expect(res.body.data ?? null).toBeNull();
    });

    // ── R2: employee KHÔNG grant + Bearer → 200 (DRIVER RED: gate view:foundation-setting đã gỡ) ──
    it("R2 — employee (không view:foundation-setting) GET /settings/public → 200 (authenticated-only)", async () => {
      const res = await api(app)
        .get(`/foundation/settings/public?category=${CATEGORY}`)
        .set("Authorization", `Bearer ${employeeToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data as Record<string, unknown>;
      expect(data[KEY.pubA]).toBe("A-public-value");
    });

    // ── R3: tenant-isolation — employee A CHỈ thấy public của companyA (RLS/withTenant ép) ──
    it("R3 — employee A /settings/public chỉ thấy setting companyA, KHÔNG thấy companyB", async () => {
      const res = await api(app)
        .get(`/foundation/settings/public?category=${CATEGORY}`)
        .set("Authorization", `Bearer ${employeeToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data[KEY.pubA]).toBe("A-public-value"); // của A → thấy
      expect(KEY.pubB in data).toBe(false); // của B → KHÔNG thấy (cô lập tenant)
      expect(JSON.stringify(res.body)).not.toContain("B-public-value");
    });

    // ── R4: secret non-leak — sensitive/encrypted/SecretRef/secret_ref KHÔNG BAO GIỜ vào /public ──
    it("R4 — /settings/public KHÔNG bao giờ lộ sensitive/encrypted/SecretRef/secret_ref", async () => {
      const res = await api(app)
        .get(`/foundation/settings/public?category=${CATEGORY}`)
        .set("Authorization", `Bearer ${employeeToken}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const data = res.body.data as Record<string, unknown>;

      // Chỉ key public-nonsensitive tồn tại; 3 secret-like bị loại hoàn toàn (không cả masked).
      expect(KEY.pubA in data).toBe(true);
      expect(KEY.sensitiveA in data).toBe(false);
      expect(KEY.encryptedA in data).toBe(false);
      expect(KEY.secretRefA in data).toBe(false);

      // Không dấu vết secret value / con trỏ secret_ref trong toàn bộ response.
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain(SECRET_VALUES.sensitive);
      expect(serialized).not.toContain(SECRET_VALUES.encrypted);
      expect(serialized).not.toContain(SECRET_VALUES.secretRef);
      expect(serialized).not.toContain(SECRET_VALUES.secretRefPointer);
      expect(serialized).not.toMatch(/secret_ref/i);
    });

    // ── R5: contract — resolve VẪN gated (403 thiếu grant; 200 admin có grant) ──────────
    it("R5 — POST /settings/resolve VẪN 403 khi thiếu view:foundation-setting", async () => {
      const res = await api(app)
        .post(`/foundation/settings/resolve`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ category: CATEGORY });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.data ?? null).toBeNull();
    });

    it("R5b — ALLOW sanity: admin (view:foundation-setting) POST /settings/resolve → 2xx (cổng resolve còn nguyên)", async () => {
      const res = await api(app)
        .post(`/foundation/settings/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ category: CATEGORY });
      // POST mặc định 201 (không @HttpCode) — chấp nhận 200/201; điểm chính: cổng view:foundation-setting MỞ.
      expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
      expect(res.body.success).toBe(true);
    });

    // ── R6: contract — PATCH company-setting VẪN gated (403 thiếu update:foundation-setting) ──
    it("R6 — PATCH /company-settings/:key VẪN 403 khi thiếu update:foundation-setting", async () => {
      const res = await api(app)
        .patch(`/foundation/company-settings/${TAG}.patch.key`)
        .set("Authorization", `Bearer ${employeeToken}`)
        .send({ settingValue: "x", valueType: "String" });
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.data ?? null).toBeNull();
    });
  },
);
