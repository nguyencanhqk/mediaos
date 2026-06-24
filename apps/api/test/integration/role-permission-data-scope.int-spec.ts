import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  type SeededTenant,
} from "../helpers/seed";

/**
 * S2-AUTH-DB-1 (🔴 RED) — role_permissions.data_scope (mig 0441).
 *
 * Canonical RBAC scope Own/Team/Department/Company/System per grant (IMPLEMENTATION-05 §13 / BACKEND-03 / DB-02).
 * WO này CHỈ thêm CỘT + CHECK + giữ RLS (seed scope = S2-AUTH-SEED-1, resolver = S2-AUTH-BE-2).
 *
 * RED→GREEN: chạy trên DB CHƯA áp 0441 ⇒ ĐỎ (cột/CHECK chưa có). Áp 0441 ⇒ XANH.
 * Đích (done_when):
 *   1. cột data_scope NOT NULL DEFAULT 'Company' + CHECK 5 giá trị (additive — effect giữ nguyên).
 *   2. default áp khi INSERT không truyền data_scope (backfill row cũ = 'Company', KHÔNG 'System').
 *   3. CHECK chặn giá trị ngoài tập.
 *   4. RLS ENABLE+FORCE trên role_permissions GIỮ NGUYÊN (BẤT BIẾN #1) + cross-tenant deny còn xanh.
 *
 * Gate hasDb && LANE_DB (CLAUDE.md §9.5 / memory: integration-test-lane-db-gate). Thiếu LANE_DB → SKIP
 * (tránh chạm DB dev chung 'mediaos' → đỏ-giả/xanh-giả). Mirror: audit-logs-appendonly.int-spec.ts.
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S2-AUTH-DB-1 role_permissions.data_scope (mig 0441)", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let B: SeededTenant;
  let permId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "rpds-a");
    B = await seedCompany(direct, "rpds-b");
    permId = await seedPermissionCatalog(direct, "view", "rpds-employee", false);
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
  });

  /** Run fn as app role (RLS enforced) with tenant context set to companyId. */
  async function asTenant<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
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

  it("cột data_scope tồn tại: NOT NULL + DEFAULT 'Company'", async () => {
    const col = await direct.query(
      `SELECT is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'role_permissions' AND column_name = 'data_scope'`,
    );
    expect(col.rows.length).toBe(1);
    expect(col.rows[0].is_nullable).toBe("NO");
    expect(String(col.rows[0].column_default)).toContain("Company");
  });

  it("default áp khi INSERT không truyền data_scope (backfill row = 'Company', KHÔNG 'System')", async () => {
    const roleId = await seedRole(direct, A.companyId, "rpds-role-default");
    // seedRolePermission KHÔNG truyền data_scope → DEFAULT áp dụng
    await seedRolePermission(direct, roleId, permId, "ALLOW");

    const row = await direct.query(
      `SELECT data_scope FROM role_permissions WHERE role_id = $1 AND permission_id = $2`,
      [roleId, permId],
    );
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].data_scope).toBe("Company");
    expect(row.rows[0].data_scope).not.toBe("System");
  });

  it("CHECK chấp nhận đủ 5 giá trị scope hợp lệ", async () => {
    const roleId = await seedRole(direct, A.companyId, "rpds-role-valid");
    for (const scope of ["Own", "Team", "Department", "Company", "System"]) {
      const p = await seedPermissionCatalog(direct, `act-${scope}`, "rpds-employee", false);
      await expect(
        direct.query(
          `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
           VALUES ($1, $2, 'ALLOW', $3)`,
          [roleId, p, scope],
        ),
      ).resolves.toBeDefined();
    }
  });

  it("CHECK chặn giá trị data_scope ngoài tập (deny-path)", async () => {
    const roleId = await seedRole(direct, A.companyId, "rpds-role-bad");
    await expect(
      direct.query(
        `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
         VALUES ($1, $2, 'ALLOW', 'Global')`,
        [roleId, permId],
      ),
    ).rejects.toThrow(/role_permissions_data_scope_chk|check constraint/i);
  });

  it("RLS ENABLE+FORCE trên role_permissions GIỮ NGUYÊN (BẤT BIẾN #1 — additive không nới)", async () => {
    const flags = await direct.query(
      `SELECT relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname = 'role_permissions'`,
    );
    expect(flags.rows[0].relrowsecurity).toBe(true);
    expect(flags.rows[0].relforcerowsecurity).toBe(true);
  });

  it("cross-tenant deny: app role context company A KHÔNG đọc role_permissions của company B", async () => {
    const roleB = await seedRole(direct, B.companyId, "rpds-role-b-only");
    await seedRolePermission(direct, roleB, permId, "ALLOW");

    const seen = await asTenant(A.companyId, (c) =>
      c.query(
        `SELECT rp.role_id FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
          WHERE r.company_id = $1`,
        [B.companyId],
      ),
    );
    expect(seen.rows.length).toBe(0);
  });
});
