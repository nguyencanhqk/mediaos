import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * S4-DASH-DB-1 — DASH Core deny-path (RED before GREEN, mig 0482, DB-07 §8.1/8.2/8.3).
 *
 * 1. RLS cross-tenant deny (literal-GUC) trên dashboard_widget_configs + dashboard_widget_cache:
 *    withTenant(A) KHÔNG thấy hàng của B (USING) + INSERT company_id=B bị WITH CHECK chặn.
 * 2. No-context ⇒ 0 row (configs/cache tenant-scoped, company_id NOT NULL, KHÔNG skipNoContext):
 *    GUC rỗng ⇒ NULLIF→NULL ⇒ policy lọc hết.
 * 3. Constraint: uq (company_id, cache_key) chặn trùng; CHECK expires_at < generated_at REJECT;
 *    CHECK cache_scope/status/dashboard_type ngoài enum REJECT; CHECK role_user_scope (Role⇒role_id NULL) REJECT.
 *
 * Gate CỨNG: hasDb && LANE_DB — .env làm hasDb=true → thiếu LANE_DB thì chạy DB dev chung ⇒ đỏ-giả
 * (memory: integration-test-lane-db-gate). LANE_DB bắt buộc cho DB cô lập mediaos_<lane>.
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

/** Chạy fn trong 1 transaction có GUC tenant = companyId (mẫu set_config local=true, PgBouncer txn-mode). */
async function asTenant<T>(
  app: Pool,
  companyId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Chạy fn KHÔNG có ngữ cảnh tenant (GUC rỗng tường minh) — mô phỏng "no tenant context". */
async function asNoContext<T>(app: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_company_id', '', true)");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Seed widget (direct/superuser, bypass RLS) TENANT-scoped → trả widgetId cho config/cache FK. */
async function seedWidget(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO dashboard_widgets
       (company_id, widget_code, module_code, name, widget_type, required_permission_code,
        default_data_scope, data_source_key, component_key, is_cacheable, status)
     VALUES ($1, $2, 'TASK', 'Deny Widget', 'List', 'DASH.WIDGET.VIEW_MY_TASKS',
             'Own', 'my-tasks', 'MyTasksWidget', true, 'Active') RETURNING id`,
    [companyId, `DENY_WGT_${randomUUID().slice(0, 8)}`],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!hasLaneDb)("S4-DASH-DB-1 DASH Core deny-path + constraints", () => {
  const direct = directPool();
  const app = appPool(2);

  let A: SeededTenant;
  let B: SeededTenant;
  let widgetB: string;
  let configB: string;
  let cacheB: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "dash-deny-a");
    B = await seedCompany(direct, "dash-deny-b");

    widgetB = await seedWidget(direct, B.companyId);
    configB = (
      await direct.query(
        `INSERT INTO dashboard_widget_configs
           (company_id, widget_id, dashboard_type, config_scope, is_enabled, sort_order)
         VALUES ($1, $2, 'Employee', 'Company', true, 0) RETURNING id`,
        [B.companyId, widgetB],
      )
    ).rows[0].id as string;
    cacheB = (
      await direct.query(
        `INSERT INTO dashboard_widget_cache
           (company_id, widget_id, dashboard_type, cache_scope, cache_key, data, status, generated_at, expires_at)
         VALUES ($1, $2, 'System', 'Company', $3, '{}'::jsonb, 'Fresh', now(), now() + interval '5 minutes')
         RETURNING id`,
        [B.companyId, widgetB, `deny-cache-${randomUUID().slice(0, 8)}`],
      )
    ).rows[0].id as string;
  });

  afterAll(async () => {
    for (const companyId of [A.companyId, B.companyId]) {
      await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM dashboard_widget_configs WHERE company_id = $1", [companyId]);
      await direct.query("DELETE FROM dashboard_widgets WHERE company_id = $1", [companyId]);
    }
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  // ── 1. RLS cross-tenant deny (literal-GUC) ────────────────────────────────
  it("withTenant(A): cannot SELECT B's dashboard_widget_configs (RLS USING)", async () => {
    const rows = await asTenant(app, A.companyId, async (c) => {
      const r = await c.query(`SELECT id FROM dashboard_widget_configs WHERE id = $1`, [configB]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("withTenant(A): cannot SELECT B's dashboard_widget_cache (RLS USING)", async () => {
    const rows = await asTenant(app, A.companyId, async (c) => {
      const r = await c.query(`SELECT id FROM dashboard_widget_cache WHERE id = $1`, [cacheB]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("withTenant(A): INSERT dashboard_widget_cache company_id=B rejected by RLS WITH CHECK", async () => {
    await expect(
      asTenant(app, A.companyId, async (c) => {
        await c.query(
          `INSERT INTO dashboard_widget_cache
             (company_id, widget_id, dashboard_type, cache_scope, cache_key, data, expires_at)
           VALUES ($1, $2, 'System', 'Company', $3, '{}'::jsonb, now() + interval '5 minutes')`,
          [B.companyId, widgetB, `forge-${randomUUID().slice(0, 8)}`],
        );
      }),
    ).rejects.toThrow();
  });

  // ── 2. No tenant context ⇒ 0 row (tenant-scoped, NOT skipNoContext) ────────
  it("no context: SELECT dashboard_widget_configs ⇒ 0 row", async () => {
    const rows = await asNoContext(app, async (c) => {
      const r = await c.query(`SELECT id FROM dashboard_widget_configs WHERE id = $1`, [configB]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("no context: SELECT dashboard_widget_cache ⇒ 0 row", async () => {
    const rows = await asNoContext(app, async (c) => {
      const r = await c.query(`SELECT id FROM dashboard_widget_cache WHERE id = $1`, [cacheB]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  // ── 3. Constraints (CHECK/uq — áp cả với direct/superuser) ─────────────────
  it("uq (company_id, cache_key): 2 cache cùng key/company → unique violation", async () => {
    const key = `dup-cache-${randomUUID().slice(0, 8)}`;
    await direct.query(
      `INSERT INTO dashboard_widget_cache
         (company_id, widget_id, dashboard_type, cache_scope, cache_key, data, expires_at)
       VALUES ($1, $2, 'System', 'Company', $3, '{}'::jsonb, now() + interval '5 minutes')`,
      [B.companyId, widgetB, key],
    );
    await expect(
      direct.query(
        `INSERT INTO dashboard_widget_cache
           (company_id, widget_id, dashboard_type, cache_scope, cache_key, data, expires_at)
         VALUES ($1, $2, 'System', 'Company', $3, '{}'::jsonb, now() + interval '5 minutes')`,
        [B.companyId, widgetB, key],
      ),
    ).rejects.toThrow(/uq_dashboard_widget_cache_key_active|duplicate key/);
  });

  it("CHECK expires_at < generated_at → REJECT (chk_dashboard_widget_cache_time)", async () => {
    await expect(
      direct.query(
        `INSERT INTO dashboard_widget_cache
           (company_id, widget_id, dashboard_type, cache_scope, cache_key, data, generated_at, expires_at)
         VALUES ($1, $2, 'System', 'Company', $3, '{}'::jsonb,
                 '2026-01-01T10:00:00Z', '2026-01-01T09:00:00Z')`,
        [B.companyId, widgetB, `bad-time-${randomUUID().slice(0, 8)}`],
      ),
    ).rejects.toThrow(/chk_dashboard_widget_cache_time/);
  });

  it("CHECK cache_scope ngoài enum → REJECT (chk_dashboard_widget_cache_scope)", async () => {
    await expect(
      direct.query(
        `INSERT INTO dashboard_widget_cache
           (company_id, widget_id, dashboard_type, cache_scope, cache_key, data, expires_at)
         VALUES ($1, $2, 'System', 'Galaxy', $3, '{}'::jsonb, now() + interval '5 minutes')`,
        [B.companyId, widgetB, `bad-scope-${randomUUID().slice(0, 8)}`],
      ),
    ).rejects.toThrow(/chk_dashboard_widget_cache_scope/);
  });

  it("CHECK status ngoài enum → REJECT (chk_dashboard_widget_cache_status)", async () => {
    await expect(
      direct.query(
        `INSERT INTO dashboard_widget_cache
           (company_id, widget_id, dashboard_type, cache_scope, cache_key, data, status, expires_at)
         VALUES ($1, $2, 'System', 'Company', $3, '{}'::jsonb, 'Frozen', now() + interval '5 minutes')`,
        [B.companyId, widgetB, `bad-status-${randomUUID().slice(0, 8)}`],
      ),
    ).rejects.toThrow(/chk_dashboard_widget_cache_status/);
  });

  it("CHECK dashboard_type ngoài enum → REJECT (chk_dashboard_widget_cache_dashboard_type)", async () => {
    await expect(
      direct.query(
        `INSERT INTO dashboard_widget_cache
           (company_id, widget_id, dashboard_type, cache_scope, cache_key, data, expires_at)
         VALUES ($1, $2, 'Overlord', 'Company', $3, '{}'::jsonb, now() + interval '5 minutes')`,
        [B.companyId, widgetB, `bad-dtype-${randomUUID().slice(0, 8)}`],
      ),
    ).rejects.toThrow(/chk_dashboard_widget_cache_dashboard_type/);
  });

  it("CHECK role_user_scope: config_scope=Role mà role_id NULL → REJECT", async () => {
    await expect(
      direct.query(
        `INSERT INTO dashboard_widget_configs
           (company_id, widget_id, dashboard_type, config_scope, is_enabled, sort_order)
         VALUES ($1, $2, 'Employee', 'Role', true, 0)`,
        [B.companyId, widgetB],
      ),
    ).rejects.toThrow(/chk_dashboard_widget_configs_role_user_scope/);
  });

  it("CHECK role_user_scope: config_scope=User mà user_id NULL → REJECT", async () => {
    await expect(
      direct.query(
        `INSERT INTO dashboard_widget_configs
           (company_id, widget_id, dashboard_type, config_scope, is_enabled, sort_order)
         VALUES ($1, $2, 'Employee', 'User', true, 0)`,
        [B.companyId, widgetB],
      ),
    ).rejects.toThrow(/chk_dashboard_widget_configs_role_user_scope/);
  });
});
