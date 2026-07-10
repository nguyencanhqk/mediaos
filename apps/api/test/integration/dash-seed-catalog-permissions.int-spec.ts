/**
 * S4-DASH-SEED-1 — int-spec cho mig 0484 (catalog widget DASH + 7 cặp quyền + role grants) và
 * DashboardConfigSeeder (default dashboard_widget_configs per-company).
 *
 * GATE CỨNG `hasDb && LANE_DB`: `.env` trỏ DATABASE_URL vào DB dev chung nên `hasDb` = true kể cả khi không
 * có DB cô lập ⇒ chỉ `skipIf(!hasDb)` sẽ cho ĐỎ-GIẢ. Chạy:
 *     TURBO_FORCE=1 pnpm --filter @mediaos/contracts build
 *     bash scripts/lane-db-setup.sh dashseed --reset
 *     LANE_DB=mediaos_dashseed npx vitest run test/integration/dash-seed-catalog-permissions.int-spec.ts
 *
 * Seeder chạy qua ĐƯỜNG THẬT (MasterDataSeedRunner.reconcileCompany, app role + RLS FORCE) — KHÔNG gọi
 * seed() trực tiếp, KHÔNG owner. Mirror att-master-data-seeder.int.spec.ts.
 *
 * MỌI mốc đọc từ `src/dashboard/dashboard-widget-catalog.const.ts` — không hard-code chuỗi rời, để migration
 * / seeder / test không lệch nhau âm thầm.
 *
 * Deny-path đi ĐẦU (M, E2, E3). Test M là grant-matrix VÉT CẠN cho CẢ 4 role canonical: plan v2/v3 chỉ deny
 * employee+manager, bỏ sót `hr` — role trung-quyền dễ leo thang nhất; DO-block grant nhầm `hr` thì toàn bộ
 * suite vẫn XANH.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../../src/foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
import { DashboardConfigSeeder } from "../../src/dashboard/dashboard-config.seeder";
import {
  DASH_ADMIN_ONLY_PAIRS,
  DASH_CANONICAL_ROLES,
  DASH_DEFAULT_CONFIG,
  DASH_GRANT_MATRIX,
  DASH_PERMISSION_PAIRS,
  DASH_WIDGET_CATALOG,
  DASH_WIDGET_COUNT,
  DASH_WIDGET_GATE_PAIR,
  DASH_WIDGETS_NOT_SEEDED,
} from "../../src/dashboard/dashboard-widget-catalog.const";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";
import { directPool, hasDb } from "../helpers/integration-db";

const runIsolatedDb = hasDb && Boolean(process.env.LANE_DB);
const SEED_KEY = "dash.default-configs";

const pairKey = (action: string, resourceType: string): string => `${action}:${resourceType}`;

/** data_scope đã grant cho (role canonical, action, resource); null nếu KHÔNG có hàng ALLOW. */
async function grantScope(
  direct: Pool,
  role: string,
  action: string,
  resourceType: string,
): Promise<string | null> {
  const res = await direct.query<{ data_scope: string }>(
    `SELECT rp.data_scope
       FROM role_permissions rp
       JOIN roles r       ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = $1 AND r.company_id IS NULL AND r.deleted_at IS NULL
        AND p.action = $2 AND p.resource_type = $3
        AND rp.effect = 'ALLOW'`,
    [role, action, resourceType],
  );
  return res.rows[0]?.data_scope ?? null;
}

/** Toàn bộ cặp DASH mà 1 role được grant, dạng "action:resource@scope". */
async function dashGrantsOfRole(direct: Pool, role: string): Promise<string[]> {
  const res = await direct.query<{ action: string; resource_type: string; data_scope: string }>(
    `SELECT p.action, p.resource_type, rp.data_scope
       FROM role_permissions rp
       JOIN roles r       ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = $1 AND r.company_id IS NULL AND r.deleted_at IS NULL
        AND rp.effect = 'ALLOW'
        AND (p.resource_type IN ('dashboard-config', 'dashboard-audit-log')
             OR (p.resource_type = 'dashboard' AND p.action LIKE 'view-%'))`,
    [role],
  );
  return res.rows.map((r) => `${r.action}:${r.resource_type}@${r.data_scope}`).sort();
}

async function configRows(
  direct: Pool,
  companyId: string,
): Promise<Array<{ dashboardType: string; widgetCode: string; sortOrder: number }>> {
  const res = await direct.query<{
    dashboard_type: string;
    widget_code: string;
    sort_order: number;
  }>(
    `SELECT c.dashboard_type, w.widget_code, c.sort_order
       FROM dashboard_widget_configs c
       JOIN dashboard_widgets w ON w.id = c.widget_id
      WHERE c.company_id = $1 AND c.deleted_at IS NULL`,
    [companyId],
  );
  return res.rows.map((r) => ({
    dashboardType: r.dashboard_type,
    widgetCode: r.widget_code,
    sortOrder: r.sort_order,
  }));
}

describe.skipIf(!runIsolatedDb)("S4-DASH-SEED-1 — catalog widget + quyền DASH (DB cô lập)", () => {
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let runner: MasterDataSeedRunner;

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "dashseed-a");
    B = await seedCompany(direct, "dashseed-b");

    const dbsvc = new DatabaseService();
    const registry = new MasterDataSeederRegistry();
    registry.register(new DashboardConfigSeeder());
    runner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);
  });

  afterAll(async () => {
    if (direct) {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
    }
  });

  // ─────────────── M — grant-matrix VÉT CẠN (deny + positive), ĐI ĐẦU ───────────────
  describe("M — grant-matrix vét cạn (API-10:283-312)", () => {
    it.each(DASH_CANONICAL_ROLES)(
      "role %s có ĐÚNG tập cặp DASH của mình — không thừa, không thiếu",
      async (role) => {
        const expected = DASH_GRANT_MATRIX.filter((g) => g.role === role)
          .map((g) => `${g.action}:${g.resourceType}@${g.dataScope}`)
          .sort();
        expect(await dashGrantsOfRole(direct, role)).toEqual(expected);
      },
    );

    it.each(DASH_CANONICAL_ROLES.filter((r) => r !== "company-admin"))(
      "role %s VẮNG MẶT mọi cặp admin-only (chống leo thang, đặc biệt là hr)",
      async (role) => {
        for (const pair of DASH_ADMIN_ONLY_PAIRS) {
          const inMatrix = DASH_GRANT_MATRIX.some(
            (g) =>
              g.role === role && g.action === pair.action && g.resourceType === pair.resourceType,
          );
          expect(
            inMatrix,
            `matrix không được cấp ${pairKey(pair.action, pair.resourceType)} cho ${role}`,
          ).toBe(false);

          const scope = await grantScope(direct, role, pair.action, pair.resourceType);
          expect(
            scope,
            `${role} KHÔNG được có ${pairKey(pair.action, pair.resourceType)}`,
          ).toBeNull();
        }
      },
    );

    it("company-admin có đủ 4 cặp admin-only, scope khớp matrix", async () => {
      for (const pair of DASH_ADMIN_ONLY_PAIRS) {
        const expected = DASH_GRANT_MATRIX.find(
          (g) =>
            g.role === "company-admin" &&
            g.action === pair.action &&
            g.resourceType === pair.resourceType,
        );
        expect(
          expected,
          `matrix phải cấp ${pairKey(pair.action, pair.resourceType)} cho company-admin`,
        ).toBeDefined();
        expect(await grantScope(direct, "company-admin", pair.action, pair.resourceType)).toBe(
          expected!.dataScope,
        );
      }
    });

    it("hr CÓ view-manager:dashboard (API-10:285 MGR, HR(✓), CA) — plan v3 bỏ sót", async () => {
      expect(await grantScope(direct, "hr", "view-manager", "dashboard")).toBe("Own");
    });
  });

  // ─────────────── E2 — cặp phantom KHÔNG được tồn tại ───────────────
  describe("E2 — deny: cặp phantom", () => {
    it("KHÔNG tồn tại cặp '*:dashboard-widget' nào (invariant Option B)", async () => {
      const res = await direct.query<{ action: string }>(
        `SELECT action FROM permissions WHERE resource_type = 'dashboard-widget'`,
      );
      expect(res.rows.map((r) => r.action)).toEqual([]);
    });

    it("KHÔNG tồn tại refresh:dashboard-cache (API-10:313 SA-only ⇒ không role nào để grant)", async () => {
      const res = await direct.query(
        `SELECT 1 FROM permissions WHERE action = 'refresh' AND resource_type = 'dashboard-cache'`,
      );
      expect(res.rowCount).toBe(0);
    });
  });

  // ─────────────── E3 — chống pair-drift ───────────────
  describe("E3 — DASH_WIDGET_GATE_PAIR trỏ vào cặp permission THẬT", () => {
    it.each(Object.entries(DASH_WIDGET_GATE_PAIR))(
      "%s → cặp gate tồn tại trong bảng permissions",
      async (widgetCode, pair) => {
        const res = await direct.query(
          `SELECT 1 FROM permissions WHERE action = $1 AND resource_type = $2`,
          [pair.action, pair.resourceType],
        );
        expect(
          res.rowCount,
          `${widgetCode} → ${pairKey(pair.action, pair.resourceType)} không có trong permissions`,
        ).toBe(1);
      },
    );

    it("mọi widget trong catalog đều có entry gate-pair", () => {
      const missing = DASH_WIDGET_CATALOG.map((w) => w.widgetCode).filter(
        (code) => !(code in DASH_WIDGET_GATE_PAIR),
      );
      expect(missing).toEqual([]);
    });
  });

  // ─────────────── A / A2 — catalog widget ───────────────
  describe("A — catalog widget GLOBAL", () => {
    it(`đúng ${DASH_WIDGET_COUNT} widget, tập widget_code khớp const`, async () => {
      const res = await direct.query<{ widget_code: string }>(
        `SELECT widget_code FROM dashboard_widgets WHERE company_id IS NULL AND deleted_at IS NULL`,
      );
      const actual = res.rows.map((r) => r.widget_code).sort();
      expect(actual).toEqual(DASH_WIDGET_CATALOG.map((w) => w.widgetCode).sort());
      expect(actual).toHaveLength(DASH_WIDGET_COUNT);
    });

    it.each(DASH_WIDGET_CATALOG)("$widgetCode khớp từng trường với const", async (w) => {
      const res = await direct.query<Record<string, unknown>>(
        `SELECT module_code, widget_type, required_permission_code, default_data_scope,
                data_source_key, component_key, is_system_widget, status
           FROM dashboard_widgets
          WHERE company_id IS NULL AND deleted_at IS NULL AND widget_code = $1`,
        [w.widgetCode],
      );
      expect(res.rowCount).toBe(1);
      const row = res.rows[0]!;
      expect(row["module_code"]).toBe(w.moduleCode);
      expect(row["widget_type"]).toBe(w.widgetType);
      expect(row["required_permission_code"]).toBe(w.requiredPermissionCode);
      expect(row["default_data_scope"]).toBe(w.defaultDataScope);
      expect(row["data_source_key"]).toBe(w.dataSourceKey);
      expect(row["component_key"]).toBe(w.componentKey);
      expect(row["is_system_widget"]).toBe(true);
      expect(row["status"]).toBe("Active");
    });

    it("widget CỐ Ý không seed thì VẮNG MẶT (trim MVP — DRIFT vs DB-07 §14.3)", async () => {
      const res = await direct.query<{ widget_code: string }>(
        `SELECT widget_code FROM dashboard_widgets WHERE company_id IS NULL AND widget_code = ANY($1::text[])`,
        [[...DASH_WIDGETS_NOT_SEEDED]],
      );
      expect(res.rows.map((r) => r.widget_code)).toEqual([]);
    });
  });

  // ─────────────── C — catalog quyền ───────────────
  describe("C — catalog quyền DASH", () => {
    it.each(DASH_PERMISSION_PAIRS)(
      "$specCode → $action:$resourceType tồn tại, is_sensitive=$isSensitive",
      async (p) => {
        const res = await direct.query<{ is_sensitive: boolean }>(
          `SELECT is_sensitive FROM permissions WHERE action = $1 AND resource_type = $2`,
          [p.action, p.resourceType],
        );
        expect(res.rowCount).toBe(1);
        expect(res.rows[0]!.is_sensitive).toBe(p.isSensitive);
      },
    );

    it("read:dashboard (mig 0100) GIỮ NGUYÊN non-sensitive — không bị đụng", async () => {
      const res = await direct.query<{ is_sensitive: boolean }>(
        `SELECT is_sensitive FROM permissions WHERE action = 'read' AND resource_type = 'dashboard'`,
      );
      expect(res.rowCount).toBe(1);
      expect(res.rows[0]!.is_sensitive).toBe(false);
    });
  });

  // ─────────────── G / F — default config qua runner (app role, RLS FORCE) ───────────────
  describe("G — default dashboard_widget_configs (MasterDataSeedRunner.reconcileCompany)", () => {
    it("reconcileCompany(A) seed đúng tập DASH_DEFAULT_CONFIG, config_scope=Company, role/user NULL", async () => {
      const outcomes = await runner.reconcileCompany(A.companyId);
      const dash = outcomes.find((o) => o.seedKey === SEED_KEY);
      expect(dash?.ok, "batch dash.default-configs phải ok").toBe(true);

      const actual = (await configRows(direct, A.companyId))
        .map((r) => `${r.dashboardType}:${r.widgetCode}:${r.sortOrder}`)
        .sort();
      const expected = DASH_DEFAULT_CONFIG.map(
        (e) => `${e.dashboardType}:${e.widgetCode}:${e.sortOrder}`,
      ).sort();
      expect(actual).toEqual(expected);

      const meta = await direct.query<{
        config_scope: string;
        role_id: string | null;
        user_id: string | null;
        is_enabled: boolean;
      }>(
        `SELECT config_scope, role_id, user_id, is_enabled
           FROM dashboard_widget_configs WHERE company_id = $1 AND deleted_at IS NULL`,
        [A.companyId],
      );
      for (const row of meta.rows) {
        expect(row.config_scope).toBe("Company");
        expect(row.role_id).toBeNull();
        expect(row.user_id).toBeNull();
        expect(row.is_enabled).toBe(true);
      }
    });

    it("PROJECT_PROGRESS có trong catalog nhưng KHÔNG có default config nào (DB-07 §14.3)", async () => {
      expect(DASH_WIDGET_CATALOG.some((w) => w.widgetCode === "PROJECT_PROGRESS")).toBe(true);
      const rows = await configRows(direct, A.companyId);
      expect(rows.filter((r) => r.widgetCode === "PROJECT_PROGRESS")).toEqual([]);
    });
  });

  describe("F — idempotent", () => {
    it("reconcileCompany(A) lần 2 → count configs KHÔNG đổi, không sinh row trùng khoá nghiệp vụ", async () => {
      const before = (await configRows(direct, A.companyId)).length;
      await runner.reconcileCompany(A.companyId);
      const after = await configRows(direct, A.companyId);
      expect(after).toHaveLength(before);

      const dup = await direct.query<{ n: string }>(
        `SELECT count(*) AS n FROM (
           SELECT company_id, widget_id, dashboard_type, config_scope
             FROM dashboard_widget_configs
            WHERE company_id = $1 AND deleted_at IS NULL AND role_id IS NULL AND user_id IS NULL
            GROUP BY 1,2,3,4 HAVING count(*) > 1
         ) d`,
        [A.companyId],
      );
      expect(Number(dup.rows[0]!.n)).toBe(0);
    });

    it("re-apply grant 3× → grant count + data_scope KHÔNG drift", async () => {
      const countSql = `SELECT count(*) AS n FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                         WHERE p.resource_type IN ('dashboard','dashboard-config','dashboard-audit-log')`;
      const before = (await direct.query<{ n: string }>(countSql)).rows[0]!.n;

      for (let i = 0; i < 3; i++) {
        for (const g of DASH_GRANT_MATRIX) {
          await direct.query(
            `WITH r AS (SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL),
                  p AS (SELECT id FROM permissions WHERE action = $2 AND resource_type = $3)
             INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
             SELECT r.id, p.id, 'ALLOW', $4 FROM r, p
             ON CONFLICT (role_id, permission_id, effect) DO NOTHING`,
            [g.role, g.action, g.resourceType, g.dataScope],
          );
        }
      }

      expect((await direct.query<{ n: string }>(countSql)).rows[0]!.n).toBe(before);
      for (const g of DASH_GRANT_MATRIX) {
        expect(await grantScope(direct, g.role, g.action, g.resourceType)).toBe(g.dataScope);
      }
    });
  });

  // ─────────────── I — cross-tenant (company thứ 2 CÓ THẬT) ───────────────
  describe("I — cross-tenant", () => {
    it("config của company B KHÔNG lộ dưới GUC company A (RLS + FORCE)", async () => {
      // Ở N=1 chỉ có 1 company. KHÔNG plant tenant thứ 2 thì test XANH-GIẢ (không chứng minh được RLS).
      await runner.reconcileCompany(B.companyId);
      const bRows = await configRows(direct, B.companyId);
      expect(bRows.length, "company B phải có config thật, nếu không assert dưới là xanh-giả").toBe(
        DASH_DEFAULT_CONFIG.length,
      );

      const app = new Pool({ connectionString: process.env["DATABASE_URL"], max: 1 });
      try {
        const client = await app.connect();
        try {
          await client.query(`SELECT set_config('app.current_company_id', $1, false)`, [
            A.companyId,
          ]);
          const leaked = await client.query(
            `SELECT 1 FROM dashboard_widget_configs WHERE company_id = $1::uuid`,
            [B.companyId],
          );
          expect(leaked.rowCount, "company A KHÔNG được thấy config của B").toBe(0);

          const own = await client.query(
            `SELECT 1 FROM dashboard_widget_configs WHERE company_id = $1::uuid`,
            [A.companyId],
          );
          expect(own.rowCount, "company A vẫn phải thấy config của chính mình").toBe(
            DASH_DEFAULT_CONFIG.length,
          );
        } finally {
          client.release();
        }
      } finally {
        await app.end();
      }
    });
  });
});
