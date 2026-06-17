/**
 * AC-4 UI config — RLS cross-tenant isolation (mirror tenant-isolation.int-spec). Postgres thật, app-pool
 * (NOSUPERUSER+NOBYPASSRLS) qua withTenant. RED-first: 3 bảng (tenant_branding/ui_navigation_config/
 * i18n_overrides) chưa tồn tại tới khi AC-4 GREEN (mig 0300).
 *
 * 2 chốt RLS (BẤT BIẾN #1 + rủi ro cross-tenant leak):
 *  (1) withTenant(A) select 0 row của tenant B trên cả 3 bảng (USING policy).
 *  (2) withTenant(A) KHÔNG INSERT/UPDATE đè được row tenant B (WITH CHECK + USING) — gán company_id=B
 *      bị WITH CHECK chặn; UPDATE row B trong ngữ cảnh A không match (USING) ⇒ 0 row đổi.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/** Chạy 1 callback trong ngữ cảnh tenant `companyId` qua app-pool (RLS ép thật). */
async function withTenant<T>(
  pool: ReturnType<typeof appPool>,
  companyId: string,
  fn: (client: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

describe.skipIf(!hasDb)("AC-4 UI config RLS cross-tenant isolation", () => {
  const app = appPool(2);
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  // id row B (seed direct, bypass RLS) — A KHÔNG được thấy/sửa.
  let brandingB: string;
  let navB: string;
  let i18nB: string;
  const navKeyB = `nav-${randomUUID().slice(0, 8)}`;
  const i18nKeyB = `key-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    A = await seedCompany(direct, "uicfgA");
    B = await seedCompany(direct, "uicfgB");
    companyIds.push(A.companyId, B.companyId);

    // Seed direct cho CẢ 2 tenant (khẳng định leak = 0 row của B khi đứng ở A).
    for (const t of [A, B]) {
      const br = await direct.query(
        `INSERT INTO tenant_branding (company_id, primary_color, company_name)
         VALUES ($1, '#abcabc', $2) RETURNING id`,
        [t.companyId, `brand-${t.slug}`],
      );
      const nv = await direct.query(
        `INSERT INTO ui_navigation_config (company_id, key, label, route, display_order, is_visible)
         VALUES ($1, $2, 'L', '/r', 0, true) RETURNING id`,
        [t.companyId, t === B ? navKeyB : `nav-${randomUUID().slice(0, 8)}`],
      );
      const i18 = await direct.query(
        `INSERT INTO i18n_overrides (company_id, locale, namespace, key, value)
         VALUES ($1, 'vi', 'common', $2, 'v') RETURNING id`,
        [t.companyId, t === B ? i18nKeyB : `key-${randomUUID().slice(0, 8)}`],
      );
      if (t === B) {
        brandingB = br.rows[0].id;
        navB = nv.rows[0].id;
        i18nB = i18.rows[0].id;
      }
    }
  });

  afterAll(async () => {
    if (companyIds.length) await cleanupTenants(direct, companyIds);
    await app.end();
    await direct.end();
  });

  it("(1) withTenant(A) KHÔNG select được row branding/nav/i18n của tenant B (USING policy)", async () => {
    await withTenant(app, A.companyId, async (client) => {
      const br = await client.query("SELECT id FROM tenant_branding WHERE id = $1", [brandingB]);
      const nv = await client.query("SELECT id FROM ui_navigation_config WHERE id = $1", [navB]);
      const i18 = await client.query("SELECT id FROM i18n_overrides WHERE id = $1", [i18nB]);
      expect(br.rows).toHaveLength(0);
      expect(nv.rows).toHaveLength(0);
      expect(i18.rows).toHaveLength(0);
    });
    // Đối chứng: direct (bypass RLS) thấy được row B.
    const ctrl = await direct.query("SELECT id FROM tenant_branding WHERE id = $1", [brandingB]);
    expect(ctrl.rows).toHaveLength(1);
  });

  it("(2) withTenant(A) KHÔNG UPDATE đè được row branding của tenant B (USING ⇒ 0 row match)", async () => {
    await withTenant(app, A.companyId, async (client) => {
      const upd = await client.query(
        "UPDATE tenant_branding SET company_name = 'hacked' WHERE id = $1 RETURNING id",
        [brandingB],
      );
      expect(upd.rows).toHaveLength(0); // RLS USING không match row B từ ngữ cảnh A
    });
    const after = await direct.query("SELECT company_name FROM tenant_branding WHERE id = $1", [
      brandingB,
    ]);
    expect(after.rows[0].company_name).toBe(`brand-${B.slug}`); // không bị đổi
  });

  it("(2b) withTenant(A) KHÔNG INSERT được row gán company_id=B (WITH CHECK chặn)", async () => {
    await expect(
      withTenant(app, A.companyId, async (client) => {
        await client.query(
          `INSERT INTO ui_navigation_config (company_id, key, label, route, display_order, is_visible)
           VALUES ($1, $2, 'evil', '/x', 0, true)`,
          [B.companyId, `evil-${randomUUID().slice(0, 8)}`],
        );
      }),
    ).rejects.toThrow(); // WITH CHECK vi phạm (company_id != current_setting)
  });
});
