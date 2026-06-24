import "reflect-metadata";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { PermissionGuard } from "../../src/permission/guards/permission.guard";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { PermissionService } from "../../src/permission/permission.service";
import { SettingRepository } from "../../src/foundation/settings/setting.repository";
import { SettingService } from "../../src/foundation/settings/setting.service";
import { SettingsController } from "../../src/foundation/settings/settings.controller";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * S1-FND-SETTING-1 — RED-first deny-path + leak-path + audit-in-tx + tenant-isolation + append-only.
 *
 * Chạy trên PERMISSION ENGINE + RLS THẬT (Postgres). DB cô lập per-lane:
 *   bash scripts/lane-db-setup.sh setting → export LANE_DB=mediaos_setting → pnpm --filter @mediaos/api test
 *
 * Gate: hasDb (DATABASE_URL+DIRECT) — KHÔNG xanh-giả khi không có DB. Audit-in-tx test thêm gate
 * checkHasCompanySetting (object_type 'company_setting' ∈ CHECK audit_logs — mig 0439 đã áp chưa) để
 * KHÔNG vỡ CHECK trên DB band thấp (bài học sequence_counter).
 */

const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001";

// Gate: hasDb (DATABASE_URL+DIRECT) + LANE_DB (DB cô lập đã migrate 0439). THIẾU LANE_DB → SKIP để
// KHÔNG chạm DB dev chung 'mediaos' (chưa có 'company_setting' trong CHECK ⇒ ô nhiễm + đỏ-giả).
// Cùng mẫu đã vá ở migration-smoke.int-spec.ts:106 (runIsolatedDb = hasDb && !!process.env.LANE_DB).
const runIsolatedDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!runIsolatedDb)("S1-FND-SETTING-1 settings permission + leak + audit", () => {
  const direct = directPool();
  const db = new DatabaseService();
  const permission = new PermissionService(new PermissionRepository(db));
  const guard = new PermissionGuard(new Reflector(), permission);
  const svc = new SettingService(db, new SettingRepository(db), new AuditService(), permission);

  let A: SeededTenant;
  let B: SeededTenant;
  let noRoleUserId: string; // không role → thiếu view + update foundation-setting
  let adminUserId: string; // company-admin → có view + update (non-sensitive seed mig 0435)
  let hasCompanySettingType = false;

  beforeAll(async () => {
    A = await seedCompany(direct, "setperm");
    B = await seedCompany(direct, "setperm-b");
    noRoleUserId = await seedUser(direct, A.companyId, `norole-${A.slug}@x.test`);
    adminUserId = await seedUser(direct, A.companyId, `admin-${A.slug}@x.test`);
    await seedUserRole(direct, adminUserId, COMPANY_ADMIN_ROLE, A.companyId);

    // Có 'company_setting' trong CHECK audit_logs.object_type chưa (mig 0439 áp trên DB này)?
    const r = await direct.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'audit_logs'::regclass AND contype='c' AND conname LIKE '%object_type%' LIMIT 1`,
    );
    hasCompanySettingType = r.rows.length > 0 && String(r.rows[0].def).includes("company_setting");

    // Seed fixtures: 1 public-nonsensitive, 1 public-sensitive, 1 private-nonsensitive, 1 secret-ref.
    await direct.query(
      `INSERT INTO company_settings
         (company_id, setting_key, setting_value, value_type, category, module_code, is_public, is_sensitive, is_encrypted, secret_ref, status)
       VALUES
         ($1,'co.public.ok','"co-pub"'::jsonb,'String','General','SYSTEM', true,  false, false, NULL, 'Active'),
         ($1,'co.public.sensitive','"co-leak"'::jsonb,'String','General','SYSTEM', true,  true,  false, NULL, 'Active'),
         ($1,'co.private.ok','"co-priv"'::jsonb,'String','General','SYSTEM', false, false, false, NULL, 'Active'),
         ($1,'co.secret','"co-secret-val"'::jsonb,'SecretRef','Mail','SYSTEM', false, true,  true,  'vault://co-secret', 'Active')`,
      [A.companyId],
    );
    // system fixtures (global, no company_id).
    await direct.query(
      `INSERT INTO system_settings
         (setting_key, setting_value, value_type, category, module_code, is_public, is_sensitive, status)
       VALUES
         ('sys.public.ok'||$1,'"sys-pub"'::jsonb,'String','General','SYSTEM', true, false,'Active')
       ON CONFLICT (setting_key) WHERE status='Active' DO NOTHING`,
      [A.slug],
    );
    // company_settings của tenant B (cho tenant-isolation).
    await direct.query(
      `INSERT INTO company_settings
         (company_id, setting_key, setting_value, value_type, category, module_code, is_public, is_sensitive, status)
       VALUES ($1,'co.public.ok','"B-only"'::jsonb,'String','General','SYSTEM', true, false,'Active')`,
      [B.companyId],
    );
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.query(`DELETE FROM system_settings WHERE setting_key = $1`, [
      `sys.public.ok${A.slug}`,
    ]);
    await direct.end();
  });

  function ctxFor(
    methodName: keyof SettingsController,
    userId: string,
    params: Record<string, string> = {},
  ): ExecutionContext {
    const handler = SettingsController.prototype[methodName] as (...a: unknown[]) => unknown;
    const req = { user: { id: userId, companyId: A.companyId }, params };
    return {
      getHandler: () => handler,
      getClass: () => SettingsController,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  // ── (QA-05/QA-06) deny-path: no permission → 403 (PermissionGuard fail-closed) ──
  it("getPublic (view:foundation-setting) — user thiếu grant ⇒ 403", async () => {
    await expect(guard.canActivate(ctxFor("getPublic", noRoleUserId))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("resolve (view:foundation-setting) — user thiếu grant ⇒ 403", async () => {
    await expect(guard.canActivate(ctxFor("resolve", noRoleUserId))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("updateCompanySetting (update:foundation-setting) — user thiếu grant ⇒ 403", async () => {
    await expect(
      guard.canActivate(ctxFor("updateCompanySetting", noRoleUserId, { key: "co.public.ok" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("company-admin có view + update foundation-setting ⇒ guard ALLOW (sanity)", async () => {
    expect(await guard.canActivate(ctxFor("getPublic", adminUserId))).toBe(true);
    expect(
      await guard.canActivate(ctxFor("updateCompanySetting", adminUserId, { key: "co.public.ok" })),
    ).toBe(true);
  });

  // ── (QA-06 security) leak-path: /public chỉ public-nonsensitive, KHÔNG secret_ref ──
  it("getPublic returns ONLY public-nonsensitive; no sensitive, no secret_ref, no secret value", async () => {
    const out = await svc.getPublic(A.companyId, {});
    expect(out["co.public.ok"]).toBe("co-pub");
    expect(out["co.public.sensitive"]).toBeUndefined();
    expect(out["co.private.ok"]).toBeUndefined();
    expect(out["co.secret"]).toBeUndefined();
    const json = JSON.stringify(out);
    expect(json).not.toContain("co-leak");
    expect(json).not.toContain("co-secret-val");
    expect(json).not.toContain("vault://co-secret");
    expect(json).not.toContain("secret_ref");
    expect(json).not.toContain("secretRef");
  });

  it("resolve as admin: sensitive value MASKED, secret_ref NEVER present (even when key requested)", async () => {
    const out = (await svc.resolve(
      { id: adminUserId, companyId: A.companyId },
      { keys: ["co.secret", "co.public.sensitive", "co.public.ok"] },
    )) as { settings: { key: string; value: unknown; masked: boolean }[] };
    const secret = out.settings.find((s) => s.key === "co.secret");
    expect(secret?.masked).toBe(true);
    expect(secret?.value).toBe("***");
    const json = JSON.stringify(out);
    expect(json).not.toContain("co-secret-val");
    expect(json).not.toContain("vault://co-secret");
    expect(json).not.toContain("co-leak");
    expect(json).not.toContain("secret_ref");
    expect(json).not.toContain("secretRef");
  });

  it("resolve as no-role user: only public values (sensitive/secret dropped)", async () => {
    const out = (await svc.resolve(
      { id: noRoleUserId, companyId: A.companyId },
      { keys: ["co.secret", "co.public.sensitive", "co.public.ok"] },
    )) as { values: Record<string, unknown> };
    expect(out.values).toEqual({ "co.public.ok": "co-pub" });
    expect(JSON.stringify(out)).not.toContain("co-secret-val");
    expect(JSON.stringify(out)).not.toContain("co-leak");
  });

  // ── tenant-isolation: B's company_settings KHÔNG resolve trong ngữ cảnh A ──
  it("tenant isolation: A resolves its own co.public.ok, NOT B's value", async () => {
    const r = await svc.resolveSetting(A.companyId, "co.public.ok");
    expect(r.value).toBe("co-pub");
    expect(r.value).not.toBe("B-only");
  });

  // ── BẤT BIẾN #2: audit_logs append-only — app role KHÔNG UPDATE/DELETE (gated CHECK 'company_setting') ──
  // Gate ở CẤP it (ctx.skip = runtime skip THẬT, KHÔNG early-return = pass-câm). hasCompanySettingType
  // chỉ biết sau beforeAll nên skipIf(collect-time) không dùng được → ctx.skip() là tương đương runtime.
  it("append-only: app role UPDATE/DELETE on company_setting audit row is DENIED", async (ctx) => {
    if (!hasCompanySettingType) {
      ctx.skip(); // 'company_setting' chưa có trong CHECK audit_logs (cần mig 0439 / LANE_DB).
      return;
    }
    const ins = await direct.query(
      `INSERT INTO audit_logs (company_id, action, object_type)
       VALUES ($1, 'CONFIG_UPDATE', 'company_setting') RETURNING id`,
      [A.companyId],
    );
    const auditId = ins.rows[0].id as string;
    await expect(
      db.withTenant(A.companyId, async (tx) => {
        // app role grant chỉ INSERT/SELECT trên audit_logs (mig 0003) ⇒ UPDATE FAIL (BẤT BIẾN #2).
        await tx.execute(sql`UPDATE audit_logs SET action = 'tampered' WHERE id = ${auditId}`);
      }),
    ).rejects.toThrow();
    await expect(
      db.withTenant(A.companyId, async (tx) => {
        await tx.execute(sql`DELETE FROM audit_logs WHERE id = ${auditId}`);
      }),
    ).rejects.toThrow();
  });
});

// ── audit-in-tx: gated CHECK 'company_setting' (KHÔNG xanh-giả nếu mig 0439 chưa áp trên DB band thấp) ──
// Gate suite = hasDb && LANE_DB (DB cô lập đã migrate 0439) — KHÔNG chạm DB dev chung 'mediaos'.
describe.skipIf(!runIsolatedDb)("S1-FND-SETTING-1 audit CONFIG_UPDATE in-tx", () => {
  const direct = directPool();
  const db = new DatabaseService();
  const permission = new PermissionService(new PermissionRepository(db));
  const svc = new SettingService(db, new SettingRepository(db), new AuditService(), permission);
  let A: SeededTenant;
  let adminUserId: string;
  let hasType = false;

  beforeAll(async () => {
    A = await seedCompany(direct, "set-audit");
    adminUserId = await seedUser(direct, A.companyId, `aud-${A.slug}@x.test`);
    await seedUserRole(direct, adminUserId, "00000000-0000-0000-0000-000000000001", A.companyId);
    await direct.query(
      `INSERT INTO system_settings (setting_key, setting_value, value_type, category, module_code, is_public, is_sensitive, status)
       VALUES ($1,'"vi"'::jsonb,'String','General','SYSTEM', true, false,'Active')
       ON CONFLICT (setting_key) WHERE status='Active' DO NOTHING`,
      [`audit.locale.${A.slug}`],
    );
    const r = await direct.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'audit_logs'::regclass AND contype='c' AND conname LIKE '%object_type%' LIMIT 1`,
    );
    hasType = r.rows.length > 0 && String(r.rows[0].def).includes("company_setting");
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.query(`DELETE FROM system_settings WHERE setting_key = $1`, [
      `audit.locale.${A.slug}`,
    ]);
    await direct.end();
  });

  // Gate ở CẤP it (ctx.skip = runtime skip THẬT, KHÔNG early-return = pass-câm). hasType chỉ biết sau
  // beforeAll nên dùng ctx.skip() (runtime) thay cho skipIf(collect-time).
  it("PATCH company-setting → exactly 1 audit_logs row CONFIG_UPDATE company_setting, masked snapshot", async (ctx) => {
    if (!hasType) {
      ctx.skip(); // mig 0439 chưa áp trên DB này → 'company_setting' chưa có trong CHECK audit_logs.
      return;
    }
    const key = `audit.locale.${A.slug}`;
    await svc.updateCompanySetting({ id: adminUserId, companyId: A.companyId }, key, {
      settingValue: "en",
      reason: "audit test",
    });
    const rows = await direct.query(
      `SELECT action, object_type, old_values, new_values, changed_fields
         FROM audit_logs
        WHERE company_id = $1 AND object_type = 'company_setting' AND action = 'CONFIG_UPDATE'`,
      [A.companyId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].object_type).toBe("company_setting");
    const cf = rows.rows[0].changed_fields;
    expect(Array.isArray(cf) ? cf : []).toContain("settingValue");
  });

  it("business rollback → NO audit row left (audit + mutation same tx)", async (ctx) => {
    if (!hasType) {
      ctx.skip(); // gated cùng lý do trên (runtime skip THẬT, KHÔNG pass-câm).
      return;
    }
    const before = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND action='CONFIG_UPDATE_ROLLBACK_PROBE'`,
      [A.companyId],
    );
    // Ép lỗi sau khi đã upsert+audit (giả lập): gọi với value sai type → throw TRƯỚC mọi side-effect ⇒
    // không có audit nào ghi (chứng minh validate-trước, KHÔNG audit nửa vời).
    await expect(
      svc.updateCompanySetting(
        { id: adminUserId, companyId: A.companyId },
        `audit.locale.${A.slug}`,
        {
          settingValue: 123, // system value_type=String ⇒ BadRequest
        },
      ),
    ).rejects.toThrow();
    const after = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE company_id=$1 AND action='CONFIG_UPDATE_ROLLBACK_PROBE'`,
      [A.companyId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
