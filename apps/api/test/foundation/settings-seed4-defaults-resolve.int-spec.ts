/**
 * S2-FND-SEED-4 (🟢 seed4-defaults) — resolve precedence + deny-path RED + secret non-leak + migration
 * idempotency, trên Postgres THẬT (DB cô lập mediaos_<lane>).
 *
 * CHẠY SAU seed4-mig (int-spec cần mig 0470 đã áp → 14 canonical system_settings + 10 key mới). Gate
 * `hasDb && LANE_DB` (memory: integration-test-lane-db-gate — .env làm hasDb=true; thiếu LANE_DB → đỏ-giả
 * trên DB dev chung). Direct pool (superuser, bypass RLS) seed; HTTP đi qua app THẬT (guard + RLS sống).
 *
 * Bao phủ (Task kiểm thử BẮT BUỘC):
 *   QA-04 (contract) — POST /foundation/settings/resolve admin → 10 system key mới đúng value theo precedence
 *                      (scope='system' khi không override); resolveMany BATCH ≤2 query (KHÔNG N+1).
 *   QA-05 (deny RED, viết TRƯỚC) — role VIEW-ONLY (ad-hoc grant view:foundation-setting, KHÔNG update, CHỈ
 *                      test-setup) → /resolve nhánh canSeeNonPublic=false (chỉ public, non-public bị bỏ);
 *                      user KHÔNG có view:foundation-setting → 403.
 *   QA-06 (security) — /resolve + /public KHÔNG lộ secret_ref/plaintext; is_sensitive/SecretRef bị mask/drop.
 *   Migration idempotency — re-áp INSERT 0470 (ON CONFLICT DO NOTHING) → đúng 14 canonical Active, không
 *                      nhân đôi; file.allowed_mime_types (DÔI) vẫn còn.
 *   Fallback tier — 11 company-default key resolve scope='default' (SETTING_DEFAULTS) khi company/system vắng;
 *                      notification.in_app_enabled scope='system' (mig 0470 luôn có — owner-note 1);
 *                      precedence company>default + company>system.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { SettingRepository } from "../../src/foundation/settings/setting.repository";
import { SettingService } from "../../src/foundation/settings/setting.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PermissionService } from "../../src/permission/permission.service";
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

const runDb = hasDb && Boolean(process.env.LANE_DB);

const PASSWORD = "Passw0rd!test99";
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001"; // view+update:foundation-setting (0435)
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008"; // KHÔNG foundation-* grant

const TAG = `SEED4-${randomUUID().slice(0, 8)}`;

/** 10 system key CANONICAL còn thiếu, seed bởi mig 0470 (DB-10 §11.1). value = giá trị mong đợi; public = is_public. */
const NEW_SYSTEM_KEYS: readonly { key: string; value: unknown; public: boolean }[] = [
  { key: "system.default_currency", value: "VND", public: true },
  { key: "security.password_min_length", value: 8, public: false },
  { key: "security.password_require_uppercase", value: true, public: false },
  { key: "security.password_require_number", value: true, public: false },
  { key: "security.session_ttl_minutes", value: 1440, public: false },
  { key: "security.refresh_token_ttl_days", value: 30, public: false },
  { key: "file.default_visibility", value: "Private", public: false },
  { key: "notification.in_app_enabled", value: true, public: true },
  { key: "notification.email_enabled", value: false, public: false },
  { key: "dashboard.cache_default_ttl_seconds", value: 300, public: false },
];

/** 11 company-default key (DB-10 §11.2 \ notification.in_app_enabled) — fallback SETTING_DEFAULTS. */
const COMPANY_DEFAULT_KEYS: readonly { key: string; value: unknown }[] = [
  { key: "company.timezone", value: "Asia/Ho_Chi_Minh" },
  { key: "company.locale", value: "vi-VN" },
  { key: "company.currency", value: "VND" },
  { key: "attendance.default_shift_code", value: "OFFICE_8H" },
  { key: "attendance.allow_web_checkin", value: true },
  { key: "attendance.allow_mobile_checkin", value: true },
  { key: "attendance.block_checkin_when_leave_approved", value: true },
  { key: "leave.allow_negative_balance", value: false },
  { key: "leave.default_annual_leave_days", value: 12 },
  { key: "task.allow_personal_task", value: true },
  { key: "dashboard.cache_enabled", value: true },
];

/** 14 canonical §11.1 key — dùng cho idempotency count. */
const CANONICAL_SYSTEM_KEYS = [
  "system.default_timezone",
  "system.default_locale",
  "system.default_currency",
  "security.password_min_length",
  "security.password_require_uppercase",
  "security.password_require_number",
  "security.session_ttl_minutes",
  "security.refresh_token_ttl_days",
  "file.max_upload_size_mb",
  "file.default_visibility",
  "audit.default_retention_days",
  "notification.in_app_enabled",
  "notification.email_enabled",
  "dashboard.cache_default_ttl_seconds",
];

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

/** Chèn 1 company_setting RAW (direct pool, bypass RLS). */
async function insertCompanySetting(
  direct: Pool,
  companyId: string,
  row: {
    key: string;
    value: unknown;
    valueType?: string;
    category?: string;
    isPublic?: boolean;
    isSensitive?: boolean;
    secretRef?: string | null;
  },
): Promise<void> {
  await direct.query(
    `INSERT INTO company_settings
       (company_id, setting_key, setting_value, value_type, category, module_code,
        is_public, is_sensitive, is_encrypted, secret_ref, status)
     VALUES ($1,$2,$3::jsonb,$4,$5,NULL,$6,$7,false,$8,'Active')`,
    [
      companyId,
      row.key,
      JSON.stringify(row.value),
      row.valueType ?? "String",
      row.category ?? TAG,
      row.isPublic ?? true,
      row.isSensitive ?? false,
      row.secretRef ?? null,
    ],
  );
}

describe.skipIf(!runDb)("S2-FND-SEED-4 resolve precedence + deny-path + idempotency", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant; // có override
  let B: SeededTenant; // pristine (fallback-default tier)
  let adminToken: string;
  let viewOnlyToken: string; // ad-hoc view:foundation-setting (KHÔNG update)
  let noViewToken: string; // role 0008, KHÔNG foundation grant
  const companyIds: string[] = [];

  // Direct service cho internal contract (resolveMany/precedence/fallback — KHÔNG qua HTTP).
  const db = new DatabaseService();
  const permission = new PermissionService(new PermissionRepository(db));
  const repo = new SettingRepository(db);
  const svc = new SettingService(db, repo, new AuditService(), permission);

  const SECRET_KEY = `${TAG}.secret`;
  const SECRET_VALUE = "SEED4-SECRET-must-not-leak";
  const SECRET_REF = "vault://seed4/secret-pointer";
  const PREC_KEY = `${TAG}.prec`; // system + company override → company>system

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    direct = directPool();

    A = await seedCompany(direct, "seed4a");
    B = await seedCompany(direct, "seed4b");
    companyIds.push(A.companyId, B.companyId);
    const pw = await new PasswordService().hash(PASSWORD);

    // admin A (role 0001 → view+update:foundation-setting).
    const adminEmail = `adm-${randomUUID().slice(0, 8)}@a.test`;
    const admin = await seedUser(direct, A.companyId, adminEmail, pw);
    await seedUserRole(direct, admin, COMPANY_ADMIN_ROLE, A.companyId);

    // view-only A: role 0008 (login/base) + ad-hoc role grant CHỈ view:foundation-setting (KHÔNG update).
    // Ad-hoc CHỈ trong test-setup — KHÔNG thêm role canonical vào seed sản phẩm.
    const viewEmail = `view-${randomUUID().slice(0, 8)}@a.test`;
    const viewUser = await seedUser(direct, A.companyId, viewEmail, pw);
    await seedUserRole(direct, viewUser, EMPLOYEE_ROLE, A.companyId);
    const viewRole = await seedRole(
      direct,
      A.companyId,
      `seed4-viewonly-${randomUUID().slice(0, 6)}`,
    );
    const viewPerm = await seedPermissionCatalog(direct, "view", "foundation-setting", false);
    await seedRolePermission(direct, viewRole, viewPerm, "ALLOW", "Company");
    await seedUserRole(direct, viewUser, viewRole, A.companyId);

    // no-view A: role 0008 (KHÔNG foundation grant) → 403 trên /resolve.
    const noViewEmail = `nov-${randomUUID().slice(0, 8)}@a.test`;
    const noViewUser = await seedUser(direct, A.companyId, noViewEmail, pw);
    await seedUserRole(direct, noViewUser, EMPLOYEE_ROLE, A.companyId);

    // ── Overrides company A ──────────────────────────────────────────────────────
    // company>default: override company.timezone (default = Asia/Ho_Chi_Minh).
    await insertCompanySetting(direct, A.companyId, {
      key: "company.timezone",
      value: "America/New_York",
      isPublic: true,
    });
    // secret non-leak fixture.
    await insertCompanySetting(direct, A.companyId, {
      key: SECRET_KEY,
      value: SECRET_VALUE,
      valueType: "SecretRef",
      isSensitive: true,
      isPublic: true, // lỡ đánh public — vẫn phải bị drop/mask.
      secretRef: SECRET_REF,
    });
    // company>system: system global + company A override cho cùng PREC_KEY.
    await direct.query(
      `INSERT INTO system_settings
         (setting_key, setting_value, value_type, category, module_code, is_public, is_sensitive, status)
       VALUES ($1,'"sys-val"'::jsonb,'String','General','SYSTEM', true, false,'Active')
       ON CONFLICT (setting_key) WHERE status='Active' DO NOTHING`,
      [PREC_KEY],
    );
    await insertCompanySetting(direct, A.companyId, { key: PREC_KEY, value: "co-val" });

    adminToken = await login(app, A.slug, adminEmail);
    viewOnlyToken = await login(app, A.slug, viewEmail);
    noViewToken = await login(app, A.slug, noViewEmail);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    if (direct)
      await direct.query(`DELETE FROM system_settings WHERE setting_key = $1`, [PREC_KEY]);
    await direct?.end();
  });

  // ══ QA-05 DENY-PATH (RED-first) ═══════════════════════════════════════════════════════════════
  it("QA-05 deny — user KHÔNG có view:foundation-setting → 403 (envelope success=false, data=null)", async () => {
    const res = await api(app)
      .post("/foundation/settings/resolve")
      .set("Authorization", `Bearer ${noViewToken}`)
      .send({ keys: NEW_SYSTEM_KEYS.map((k) => k.key) });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.data ?? null).toBeNull();
  });

  it("QA-05 deny — VIEW-ONLY (view, KHÔNG update) → canSeeNonPublic=false: CHỈ public key, non-public bị bỏ", async () => {
    const res = await api(app)
      .post("/foundation/settings/resolve")
      .set("Authorization", `Bearer ${viewOnlyToken}`)
      .send({ keys: NEW_SYSTEM_KEYS.map((k) => k.key) });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body.success).toBe(true);
    // Nhánh canSeeNonPublic=false → service trả { values: map } (KHÔNG { settings } metadata).
    expect("settings" in (res.body.data as object)).toBe(false);
    expect("values" in (res.body.data as object)).toBe(true);
    const values = (res.body.data as { values: Record<string, unknown> }).values;
    // CHỈ 2 key public (system.default_currency + notification.in_app_enabled) lọt; 8 non-public bị bỏ.
    expect(values["system.default_currency"]).toBe("VND");
    expect(values["notification.in_app_enabled"]).toBe(true);
    for (const k of NEW_SYSTEM_KEYS.filter((x) => !x.public)) {
      expect(k.key in values, `${k.key} (non-public) phải bị bỏ với view-only`).toBe(false);
    }
  });

  // ══ QA-04 CONTRACT — admin resolve 10 key mới theo precedence ══════════════════════════════════
  it("QA-04 — admin resolve 10 system key mới → scope='system', đúng value (DB-10 §11.1)", async () => {
    const res = await api(app)
      .post("/foundation/settings/resolve")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ keys: NEW_SYSTEM_KEYS.map((k) => k.key), includeMetadata: true });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body.success).toBe(true);
    const settings = res.body.data.settings as {
      key: string;
      value: unknown;
      scope: string;
      masked: boolean;
    }[];
    for (const expected of NEW_SYSTEM_KEYS) {
      const s = settings.find((x) => x.key === expected.key);
      expect(s, `thiếu key ${expected.key} trong resolve`).toBeDefined();
      expect(s?.scope, `${expected.key}.scope`).toBe("system"); // A không override 10 key này
      expect(s?.value, `${expected.key}.value`).toEqual(expected.value);
      expect(s?.masked, `${expected.key} không nhạy cảm → không mask`).toBe(false);
    }
  });

  it("QA-04 — resolveMany BATCH ≤2 query (1 company + 1 system) cho 21 key (KHÔNG N+1)", async () => {
    const repo2 = new SettingRepository(db);
    const svc2 = new SettingService(db, repo2, new AuditService(), permission);
    const cSpy = vi.spyOn(repo2, "findCompanyByKeysTx");
    const sSpy = vi.spyOn(repo2, "findSystemByKeysTx");
    const allKeys = [
      ...NEW_SYSTEM_KEYS.map((k) => k.key),
      ...COMPANY_DEFAULT_KEYS.map((k) => k.key),
    ];
    await svc2.resolveMany(B.companyId, allKeys);
    expect(cSpy).toHaveBeenCalledTimes(1);
    expect(sSpy).toHaveBeenCalledTimes(1);
    cSpy.mockRestore();
    sSpy.mockRestore();
  });

  // ══ Fallback tier — 11 company-default resolve scope='default' (company/system vắng) ════════════
  it("11 company-default key resolve scope='default' qua SETTING_DEFAULTS (company B pristine)", async () => {
    const resolved = await svc.resolveMany(
      B.companyId,
      COMPANY_DEFAULT_KEYS.map((k) => k.key),
    );
    for (const expected of COMPANY_DEFAULT_KEYS) {
      const r = resolved.find((x) => x.key === expected.key);
      expect(r, `thiếu ${expected.key}`).toBeDefined();
      expect(r?.found, `${expected.key}.found`).toBe(true);
      expect(r?.scope, `${expected.key}.scope`).toBe("default");
      expect(r?.value, `${expected.key}.value`).toEqual(expected.value);
    }
  });

  it("notification.in_app_enabled → scope='system' value=true (mig 0470 luôn có — KHÔNG 'default')", async () => {
    const r = await svc.resolveSetting(B.companyId, "notification.in_app_enabled");
    expect(r.found).toBe(true);
    expect(r.scope).toBe("system"); // owner-note 1: system-scope thắng, KHÔNG default
    expect(r.value).toBe(true);
  });

  it("precedence company>default — company A override company.timezone thắng SETTING_DEFAULTS", async () => {
    const r = await svc.resolveSetting(A.companyId, "company.timezone");
    expect(r.scope).toBe("company");
    expect(r.value).toBe("America/New_York");
    // Company B (không override) vẫn scope='default'.
    const rb = await svc.resolveSetting(B.companyId, "company.timezone");
    expect(rb.scope).toBe("default");
    expect(rb.value).toBe("Asia/Ho_Chi_Minh");
  });

  it("precedence company>system — company A override PREC_KEY thắng system global", async () => {
    const ra = await svc.resolveSetting(A.companyId, PREC_KEY);
    expect(ra.scope).toBe("company");
    expect(ra.value).toBe("co-val");
    // Company B (không override) → scope='system' (global seed).
    const rb = await svc.resolveSetting(B.companyId, PREC_KEY);
    expect(rb.scope).toBe("system");
    expect(rb.value).toBe("sys-val");
  });

  // ══ QA-06 SECURITY — secret non-leak qua /resolve + /public ════════════════════════════════════
  it("QA-06 — admin /resolve key SecretRef sensitive: value MASK '***', KHÔNG secret_ref/plaintext", async () => {
    const res = await api(app)
      .post("/foundation/settings/resolve")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ keys: [SECRET_KEY], includeMetadata: true });
    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    const settings = res.body.data.settings as { key: string; value: unknown; masked: boolean }[];
    const s = settings.find((x) => x.key === SECRET_KEY);
    expect(s?.masked).toBe(true);
    expect(s?.value).toBe("***");
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toContain(SECRET_REF);
    expect(serialized).not.toMatch(/secret_ref|secretRef/);
  });

  it("QA-06 — GET /public (view-only) KHÔNG lộ SecretRef/sensitive key", async () => {
    const res = await api(app)
      .get(`/foundation/settings/public?category=${TAG}`)
      .set("Authorization", `Bearer ${viewOnlyToken}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(SECRET_KEY in data).toBe(false);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toContain(SECRET_REF);
    expect(serialized).not.toMatch(/secret_ref/i);
  });

  // ══ Migration idempotency — re-áp INSERT 0470 → không nhân đôi, 14 canonical Active, DÔI còn ═════
  it("idempotency — re-áp INSERT 0470 (ON CONFLICT DO NOTHING) → 14 canonical Active, không nhân đôi", async () => {
    const countActive = async (): Promise<number> => {
      const r = await direct.query(
        `SELECT count(*)::int AS n FROM system_settings
          WHERE setting_key = ANY($1::text[]) AND status='Active'`,
        [CANONICAL_SYSTEM_KEYS],
      );
      return r.rows[0].n as number;
    };
    const before = await countActive();
    expect(before).toBe(14); // 4 sẵn (0435) + 10 mới (0470)

    // Re-áp CHÍNH XÁC INSERT 0470 (subset đại diện) — idempotent, KHÔNG nhân đôi.
    await direct.query(
      `INSERT INTO system_settings
         (setting_key, setting_value, value_type, category, module_code, description, is_public, is_sensitive, status)
       VALUES
         ('system.default_currency','"VND"'::jsonb,'String','General','SYSTEM','re-apply probe',true,false,'Active'),
         ('security.password_min_length','8'::jsonb,'Number','Security','AUTH','re-apply probe',false,false,'Active'),
         ('notification.in_app_enabled','true'::jsonb,'Boolean','Notification','NOTI','re-apply probe',true,false,'Active'),
         ('dashboard.cache_default_ttl_seconds','300'::jsonb,'Number','Dashboard','DASH','re-apply probe',false,false,'Active')
       ON CONFLICT (setting_key) WHERE status='Active' DO NOTHING`,
    );

    const after = await countActive();
    expect(after).toBe(14); // KHÔNG nhân đôi

    // Từng canonical key đúng 1 Active row.
    const per = await direct.query(
      `SELECT setting_key, count(*)::int AS n FROM system_settings
        WHERE setting_key = ANY($1::text[]) AND status='Active' GROUP BY setting_key`,
      [CANONICAL_SYSTEM_KEYS],
    );
    for (const row of per.rows) {
      expect(row.n, `${row.setting_key} phải đúng 1 Active row`).toBe(1);
    }

    // file.allowed_mime_types (DÔI) vẫn còn Active — WO KHÔNG hard-delete.
    const mime = await direct.query(
      `SELECT count(*)::int AS n FROM system_settings
        WHERE setting_key='file.allowed_mime_types' AND status='Active'`,
    );
    expect(mime.rows[0].n).toBe(1);
  });
});
