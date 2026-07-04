/**
 * S2-FND-BE-8 (be-system-settings) — GET/PATCH /foundation/system-settings(/:key) HAPPY-PATH (integration,
 * DB cô lập). Principal có grant EXACT cặp sensitive `system-manage:foundation-setting` (mig 0435, System-scope) —
 * super-admin/wildcard KHÔNG thoả (đã phủ ở system-settings-permission-deny.int-spec.ts).
 *
 * Nghiệm thu (Đội 3):
 *   P1  GET /system-settings → 200; sensitive value ĐÃ mask ('***', masked=true); secret_ref KHÔNG BAO GIỜ ra.
 *   P2  GET /system-settings/:key → 200 (1 hàng, masked đúng); non-sensitive value trả nguyên.
 *   P3  GET /system-settings/:key key lạ → 404 (KHÔNG 500, KHÔNG lộ).
 *   P4  PATCH sai value_type (đọc từ HÀNG system_settings) → 400; KHÔNG ghi system_settings; 0 audit mới.
 *   P5  PATCH sai validation_schema (đọc từ HÀNG system_settings) → 422; KHÔNG ghi; 0 audit mới.
 *   P6  PATCH hợp lệ → 200; system_settings.setting_value ĐỔI; company_settings KHÔNG có hàng key này (KHÔNG
 *       chạm company override); đúng 1 audit row action='SYSTEM_SETTING_UPDATED' object_type='system_setting'
 *       company_id = actor.companyId (ghi CÙNG withTenant tx).
 *   P7  PATCH tạo MỚI (key chưa có ở system_settings) → 200 insert + 1 audit; company_settings vẫn trống.
 *
 * KHÔNG test 2-tenant isolation cho system_setting (GLOBAL no-RLS — mọi tenant chia sẻ 1 hàng).
 *
 * Postgres THẬT (DB cô lập mediaos_<lane>, CLAUDE §9.5). Gate `hasDb && LANE_DB`. Direct pool (superuser,
 * bypass RLS) seed users/roles + system_settings; HTTP đi qua app thật (guard + service + audit sống).
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

const runDb = hasDb && Boolean(process.env.LANE_DB);

/** Marker tách dữ liệu (setting_key prefix + category) khỏi suite khác trên cùng DB. */
const TAG = `SSYS-${randomUUID().slice(0, 8)}`;
const KEY = {
  number: `${TAG}.max_upload_mb`, // Number + validation_schema {min:1,max:100}
  sensitive: `${TAG}.smtp_password`, // is_sensitive=true + secret_ref → mask khi đọc
  new: `${TAG}.new_flag`, // chưa tồn tại — PATCH tạo mới (insert path)
} as const;

const SENSITIVE_VALUE = "SUPER-SECRET-must-not-leak";
const SECRET_REF_POINTER = "vault://smtp/pw-pointer";

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

interface SeedSysRow {
  key: string;
  value: unknown;
  valueType?: string;
  isSensitive?: boolean;
  secretRef?: string | null;
  validationSchema?: unknown;
}

async function insertSystemSetting(direct: Pool, row: SeedSysRow): Promise<string> {
  const r = await direct.query(
    `INSERT INTO system_settings
       (setting_key, setting_value, value_type, category, module_code,
        is_public, is_sensitive, is_encrypted, secret_ref, validation_schema, status)
     VALUES ($1, $2::jsonb, $3, $4, 'SYSTEM', false, $5, false, $6, $7::jsonb, 'Active')
     RETURNING id`,
    [
      row.key,
      JSON.stringify(row.value),
      row.valueType ?? "String",
      TAG,
      row.isSensitive ?? false,
      row.secretRef ?? null,
      row.validationSchema === undefined ? null : JSON.stringify(row.validationSchema),
    ],
  );
  return r.rows[0].id as string;
}

/** Đọc system_settings.setting_value (global) theo key. */
async function readSystemValue(direct: Pool, key: string): Promise<unknown> {
  const r = await direct.query(
    "SELECT setting_value FROM system_settings WHERE setting_key = $1 AND status = 'Active'",
    [key],
  );
  return r.rows[0]?.setting_value ?? null;
}

/** Đếm company_settings của tenant theo key (chứng minh KHÔNG chạm company override). */
async function companySettingCount(direct: Pool, companyId: string, key: string): Promise<number> {
  const r = await direct.query(
    "SELECT count(*)::int AS n FROM company_settings WHERE company_id = $1 AND setting_key = $2",
    [companyId, key],
  );
  return r.rows[0].n as number;
}

/** Đếm audit_logs SYSTEM_SETTING_UPDATED theo object_id (đúng 1 khi PATCH thành công). */
async function auditUpdatedCount(
  direct: Pool,
  companyId: string,
  objectId: string,
): Promise<number> {
  const r = await direct.query(
    `SELECT count(*)::int AS n FROM audit_logs
     WHERE company_id = $1 AND object_id = $2
       AND action = 'SYSTEM_SETTING_UPDATED' AND object_type = 'system_setting'`,
    [companyId, objectId],
  );
  return r.rows[0].n as number;
}

describe.skipIf(!runDb)("S2-FND-BE-8 system-settings GET(mask)/PATCH(validate+audit-in-tx)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let token: string; // user A có grant EXACT system-manage:foundation-setting (sensitive, System-scope)
  let numberId: string;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "ssys");
    companyIds.push(A.companyId);
    const pw = await new PasswordService().hash(PASSWORD);

    // system-manager A — role riêng + grant EXACT system-manage:foundation-setting (is_sensitive=TRUE,
    // System-scope). EXACT (non-wildcard) ALLOW ⇒ thoả sensitive gate (permission.service L176-181).
    const email = `sysmgr-${randomUUID().slice(0, 8)}@a.test`;
    const user = await seedUser(direct, A.companyId, email, pw);
    const role = await seedRole(direct, A.companyId, `sysmgr-${randomUUID().slice(0, 8)}`);
    const perm = await seedPermissionCatalog(direct, "system-manage", "foundation-setting", true);
    await seedRolePermission(direct, role, perm, "ALLOW", "System");
    await seedUserRole(direct, user, role, A.companyId);

    numberId = await insertSystemSetting(direct, {
      key: KEY.number,
      value: 10,
      valueType: "Number",
      validationSchema: { min: 1, max: 100 },
    });
    await insertSystemSetting(direct, {
      key: KEY.sensitive,
      value: SENSITIVE_VALUE,
      valueType: "SecretRef",
      isSensitive: true,
      secretRef: SECRET_REF_POINTER,
    });

    token = await login(app, A.slug, email);
  });

  afterAll(async () => {
    await app?.close();
    if (direct) await direct.query("DELETE FROM system_settings WHERE category = $1", [TAG]);
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── P1: GET list → masked; secret_ref không bao giờ ra ─────────────────────
  it("P1 — GET /system-settings → 200; sensitive value masked; secret_ref KHÔNG ra", async () => {
    const res = await api(app)
      .get(`/foundation/system-settings?category=${TAG}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    const rows = res.body.data as Array<{
      key: string;
      value: unknown;
      masked: boolean;
      scope: string;
    }>;
    const sens = rows.find((r) => r.key === KEY.sensitive);
    expect(sens?.masked).toBe(true);
    expect(sens?.value).toBe("***");
    expect(sens?.scope).toBe("system");
    const num = rows.find((r) => r.key === KEY.number);
    expect(num?.value).toBe(10); // non-sensitive → nguyên value

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(SENSITIVE_VALUE);
    expect(serialized).not.toContain(SECRET_REF_POINTER);
    expect(serialized).not.toMatch(/secret_ref/i);
    expect(serialized).not.toMatch(/secretRef/);
  });

  // ── P2: GET detail → 200 masked ────────────────────────────────────────────
  it("P2 — GET /system-settings/:key → 200 (1 hàng, non-sensitive value nguyên)", async () => {
    const res = await api(app)
      .get(`/foundation/system-settings/${KEY.number}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.key).toBe(KEY.number);
    expect(res.body.data.value).toBe(10);
    expect(res.body.data.masked).toBe(false);
  });

  it("P2b — GET /system-settings/:key sensitive → value masked, secret_ref không ra", async () => {
    const res = await api(app)
      .get(`/foundation/system-settings/${KEY.sensitive}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.masked).toBe(true);
    expect(res.body.data.value).toBe("***");
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(SENSITIVE_VALUE);
    expect(serialized).not.toContain(SECRET_REF_POINTER);
  });

  // ── P3: GET detail key lạ → 404 (không 500) ────────────────────────────────
  it("P3 — GET /system-settings/:key key lạ → 404 (KHÔNG 500)", async () => {
    const res = await api(app)
      .get(`/foundation/system-settings/${TAG}.does-not-exist`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.success).toBe(false);
  });

  // ── P4: PATCH sai value_type → 400, KHÔNG ghi, 0 audit mới ──────────────────
  it("P4 — PATCH sai value_type (Number) → 400; system_settings KHÔNG đổi; 0 audit mới", async () => {
    const before = await auditUpdatedCount(direct, A.companyId, numberId);
    const res = await api(app)
      .patch(`/foundation/system-settings/${KEY.number}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ settingValue: "not-a-number" });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await readSystemValue(direct, KEY.number)).toBe(10); // giữ nguyên
    expect(await auditUpdatedCount(direct, A.companyId, numberId)).toBe(before);
  });

  // ── P5: PATCH sai validation_schema → 422, KHÔNG ghi, 0 audit mới ───────────
  it("P5 — PATCH vi phạm validation_schema (max) → 422; KHÔNG đổi; 0 audit mới", async () => {
    const before = await auditUpdatedCount(direct, A.companyId, numberId);
    const res = await api(app)
      .patch(`/foundation/system-settings/${KEY.number}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ settingValue: 999 }); // > max 100
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(await readSystemValue(direct, KEY.number)).toBe(10);
    expect(await auditUpdatedCount(direct, A.companyId, numberId)).toBe(before);
  });

  // ── P6: PATCH hợp lệ → 200; ghi system_settings; KHÔNG chạm company_settings; đúng 1 audit ──
  it("P6 — PATCH hợp lệ → 200; system_settings đổi; company_settings trống; 1 audit company_id=actor", async () => {
    const res = await api(app)
      .patch(`/foundation/system-settings/${KEY.number}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ settingValue: 50, reason: "raise limit" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.value).toBe(50);
    expect(res.body.data.scope).toBe("system");

    expect(await readSystemValue(direct, KEY.number)).toBe(50); // GHI system_settings
    expect(await companySettingCount(direct, A.companyId, KEY.number)).toBe(0); // KHÔNG chạm company override
    expect(await auditUpdatedCount(direct, A.companyId, numberId)).toBe(1); // đúng 1 audit row

    // audit company_id = actor.companyId (ghi trong withTenant tx của actor).
    const a = await direct.query(
      `SELECT company_id, action, object_type, data_scope, permission_code
       FROM audit_logs WHERE object_id = $1 AND action = 'SYSTEM_SETTING_UPDATED'`,
      [numberId],
    );
    expect(a.rows[0].company_id).toBe(A.companyId);
    expect(a.rows[0].data_scope).toBe("System");
    expect(a.rows[0].permission_code).toBe("FOUNDATION.SETTING.SYSTEM_MANAGE");
  });

  // ── P7: PATCH tạo MỚI (insert path) → 200 + 1 audit; company_settings vẫn trống ──
  it("P7 — PATCH key chưa có → 200 insert system_settings + 1 audit; company_settings trống", async () => {
    const res = await api(app)
      .patch(`/foundation/system-settings/${KEY.new}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ settingValue: true, valueType: "Boolean" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.value).toBe(true);

    expect(await readSystemValue(direct, KEY.new)).toBe(true); // insert vào system_settings
    expect(await companySettingCount(direct, A.companyId, KEY.new)).toBe(0);

    const r = await direct.query(
      "SELECT id FROM system_settings WHERE setting_key = $1 AND status = 'Active'",
      [KEY.new],
    );
    const newId = r.rows[0].id as string;
    expect(await auditUpdatedCount(direct, A.companyId, newId)).toBe(1);
  });
});
