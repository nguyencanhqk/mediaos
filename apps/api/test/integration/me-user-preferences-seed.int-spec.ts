/**
 * S5-ME-DB-1 — int-spec cho mig 0495 (user_preferences + seed module ME + 5 pair quyền + 20 grant Own).
 *
 * GATE CỨNG `hasDb && LANE_DB`: `.env` trỏ DATABASE_URL vào DB dev chung nên `hasDb` = true kể cả khi không
 * có DB cô lập ⇒ chỉ `skipIf(!hasDb)` cho ĐỎ-GIẢ / nhiễu dev. Chạy như CI:
 *     bash scripts/lane-db-setup.sh me-preferences-db --reset
 *     export LANE_DB=mediaos_me-preferences-db
 *     pnpm --filter @mediaos/api test -- me-user-preferences-seed
 *
 * PHẠM VI (WO DB-only): tenant-isolation (RLS+FORCE) + UNIQUE(company_id,user_id) upsert + seed-assert
 *   (module ME + 5 pair non-sensitive + 20 grant Own per-role §13) + CONTRACT cross-user (RLS KHÔNG cô lập
 *   user cùng tenant ⇒ IDOR deny thực thi ở ME-BE, đánh dấu it.todo — KHÔNG giả-xanh là đã chống ở DB).
 *
 * Deny-path đi ĐẦU (cross-tenant). Cross-tenant chính cũng auto-verify qua rls-registry.ts (case
 * user_preferences) → tenant-isolation.int-spec + rls-guards.int-spec + rls-coverage-assert.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";
import { appPool, directPool, hasDb } from "../helpers/integration-db";

const runIsolatedDb = hasDb && Boolean(process.env.LANE_DB);

// Tập canonical ME (khớp migration 0495 (D) + docs/permission-matrix-spec.md §9 mapping — chống pair-drift).
const ME_PAIRS = [
  { action: "access", resourceType: "me", code: "ME.ACCESS" },
  { action: "view", resourceType: "user-preference", code: "ME.PREFERENCE.VIEW_OWN" },
  { action: "update", resourceType: "user-preference", code: "ME.PREFERENCE.UPDATE_OWN" },
  { action: "update", resourceType: "avatar", code: "ME.AVATAR.UPDATE_OWN" },
  {
    action: "update",
    resourceType: "notification-preference",
    code: "ME.NOTIFICATION_PREFERENCE.UPDATE_OWN",
  },
] as const;

const ME_ROLES = ["employee", "manager", "hr", "company-admin"] as const;

// Nghiệp-vụ-nguồn KHÔNG được wrap thành pair ME (ME-DEC-002 / SPEC-09 §11.2 — dùng permission NGUỒN).
const FORBIDDEN_WRAPPER_PAIRS = [
  ["view", "me-attendance"],
  ["view", "me-leave"],
  ["view", "me-task"],
  ["view", "me-notification"],
  ["view", "me-profile"],
  ["export", "me-data"],
] as const;

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

describe.skipIf(!runIsolatedDb)("S5-ME-DB-1 — user_preferences + seed ME (DB cô lập)", () => {
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;

  beforeAll(async () => {
    direct = directPool();
    A = await seedCompany(direct, "mepref-a");
    B = await seedCompany(direct, "mepref-b");
  });

  afterAll(async () => {
    if (direct) {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
    }
  });

  // ─────────────── M — cross-tenant deny (RLS + FORCE), ĐI ĐẦU ───────────────
  describe("M — cross-tenant deny (RLS+FORCE ép company_id)", () => {
    it("app role dưới GUC company A KHÔNG thấy pref của B; SELECT/UPDATE chéo = 0 row", async () => {
      // Seed pref cho 1 user của B (direct = superuser, bypass RLS).
      const uB = await seedUser(direct, B.companyId, `mep-b-${Date.now()}@x.test`);
      const prefB = await direct.query(
        `INSERT INTO user_preferences (company_id, user_id, theme) VALUES ($1, $2, 'dark') RETURNING id`,
        [B.companyId, uB],
      );
      const prefBId = prefB.rows[0].id as string;

      const app = appPool();
      try {
        const client = await app.connect();
        try {
          await client.query(`SELECT set_config('app.current_company_id', $1, false)`, [
            A.companyId,
          ]);
          const leaked = await client.query(`SELECT 1 FROM user_preferences WHERE id = $1::uuid`, [
            prefBId,
          ]);
          expect(leaked.rowCount, "company A KHÔNG được thấy pref của B (RLS)").toBe(0);

          const upd = await client.query(
            `UPDATE user_preferences SET theme = 'light' WHERE id = $1::uuid`,
            [prefBId],
          );
          expect(upd.rowCount, "company A KHÔNG được UPDATE pref của B (RLS)").toBe(0);
        } finally {
          client.release();
        }
      } finally {
        await app.end();
      }
    });
  });

  // ─────────────── U — upsert idempotent theo UNIQUE(company_id, user_id) ───────────────
  describe("U — upsert idempotent (UNIQUE company_id,user_id)", () => {
    it("2 lần upsert cùng (company,user) → 1 row, giá trị = lần 2", async () => {
      const u = await seedUser(direct, A.companyId, `mep-upsert-${Date.now()}@x.test`);

      await direct.query(
        `INSERT INTO user_preferences (company_id, user_id, theme, locale)
         VALUES ($1, $2, 'light', 'vi')
         ON CONFLICT (company_id, user_id) DO UPDATE SET theme = EXCLUDED.theme, locale = EXCLUDED.locale`,
        [A.companyId, u],
      );
      await direct.query(
        `INSERT INTO user_preferences (company_id, user_id, theme, locale)
         VALUES ($1, $2, 'dark', 'en')
         ON CONFLICT (company_id, user_id) DO UPDATE SET theme = EXCLUDED.theme, locale = EXCLUDED.locale`,
        [A.companyId, u],
      );

      const res = await direct.query<{ n: string; theme: string; locale: string }>(
        `SELECT count(*)::text AS n, max(theme) AS theme, max(locale) AS locale
           FROM user_preferences WHERE company_id = $1 AND user_id = $2`,
        [A.companyId, u],
      );
      expect(Number(res.rows[0].n), "đúng 1 row/user (UNIQUE chặn nhân đôi)").toBe(1);
      expect(res.rows[0].theme).toBe("dark");
      expect(res.rows[0].locale).toBe("en");
    });

    it("INSERT thứ 2 (KHÔNG ON CONFLICT) cùng (company,user) → vi phạm UNIQUE", async () => {
      const u = await seedUser(direct, A.companyId, `mep-uniq-${Date.now()}@x.test`);
      await direct.query(
        `INSERT INTO user_preferences (company_id, user_id, theme) VALUES ($1, $2, 'system')`,
        [A.companyId, u],
      );
      await expect(
        direct.query(
          `INSERT INTO user_preferences (company_id, user_id, theme) VALUES ($1, $2, 'dark')`,
          [A.companyId, u],
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });

    it("CHECK theme/density chặn giá trị ngoài enum", async () => {
      const u = await seedUser(direct, A.companyId, `mep-chk-${Date.now()}@x.test`);
      await expect(
        direct.query(
          `INSERT INTO user_preferences (company_id, user_id, theme) VALUES ($1, $2, 'neon')`,
          [A.companyId, u],
        ),
      ).rejects.toThrow(/chk_user_preferences_theme|check constraint/i);
    });
  });

  // ─────────────── X — cross-user (in-tenant) CONTRACT: RLS KHÔNG cô lập user ───────────────
  describe("X — cross-user CONTRACT (RLS chỉ cô lập TENANT, KHÔNG user)", () => {
    it("app dưới GUC company A đọc được pref của CẢ 2 user cùng company (RLS không lọc user_id)", async () => {
      const u1 = await seedUser(direct, A.companyId, `mep-x1-${Date.now()}@x.test`);
      const u2 = await seedUser(direct, A.companyId, `mep-x2-${Date.now()}@x.test`);
      await direct.query(
        `INSERT INTO user_preferences (company_id, user_id, theme) VALUES ($1, $2, 'light'), ($1, $3, 'dark')
         ON CONFLICT (company_id, user_id) DO NOTHING`,
        [A.companyId, u1, u2],
      );

      const app = appPool();
      try {
        const client = await app.connect();
        try {
          await client.query(`SELECT set_config('app.current_company_id', $1, false)`, [
            A.companyId,
          ]);
          const rows = await client.query(
            `SELECT user_id FROM user_preferences WHERE user_id = ANY($1::uuid[])`,
            [[u1, u2]],
          );
          // RLS chỉ có GUC app.current_company_id (KHÔNG có app.current_user_id) ⇒ thấy CẢ 2 row.
          // ⇒ ME-BE PHẢI filter WHERE user_id = token-resolved để chống IDOR (SPEC-09 §14.4/§17.1).
          expect(rows.rowCount, "RLS không cô lập user cùng tenant — IDOR ép ở ME-BE").toBe(2);
        } finally {
          client.release();
        }
      } finally {
        await app.end();
      }
    });

    // IDOR deny-path THỰC (GET/PATCH /me/preferences chỉ trả/ghi pref của token-user) — ĐÓNG ở S5-ME-BE-2:
    // xem test/integration/me-preferences-avatar.int-spec.ts ("IDOR — PATCH của A KHÔNG đụng row của B").
    // KHÔNG rewrite file DB-seed này (giữ nguyên phạm vi WO gốc); todo giữ lại làm con trỏ lịch sử.
    it.todo("ME-BE: GET/PATCH /me/preferences chỉ đụng pref của token-resolved user (deny IDOR)");
  });

  // ─────────────── S — seed-assert (module ME + 5 pair + 20 grant Own per-role §13) ───────────────
  describe("S — seed-assert (module ME + catalog + grant)", () => {
    it("module ME active: group Experience, sort_order 80, is_mvp=true, is_core=false — đúng 1 row", async () => {
      const res = await direct.query<{
        module_group: string;
        sort_order: number;
        is_active: boolean;
        is_mvp: boolean;
        is_core: boolean;
      }>(
        `SELECT module_group, sort_order, is_active, is_mvp, is_core
           FROM modules WHERE module_code = 'ME' AND deleted_at IS NULL`,
      );
      expect(res.rowCount, "đúng 1 module ME").toBe(1);
      expect(res.rows[0].module_group).toBe("Experience");
      expect(Number(res.rows[0].sort_order)).toBe(80);
      expect(res.rows[0].is_active).toBe(true);
      expect(res.rows[0].is_mvp).toBe(true);
      expect(res.rows[0].is_core).toBe(false);
    });

    it.each(ME_PAIRS)(
      "$code → $action:$resourceType tồn tại, is_sensitive=false (cổng nav ME)",
      async (p) => {
        const res = await direct.query<{ is_sensitive: boolean }>(
          `SELECT is_sensitive FROM permissions WHERE action = $1 AND resource_type = $2`,
          [p.action, p.resourceType],
        );
        expect(res.rowCount, `pair ${p.code} phải có trong catalog`).toBe(1);
        expect(res.rows[0].is_sensitive, `${p.code} phải non-sensitive`).toBe(false);
      },
    );

    it.each(ME_ROLES)("role %s có ĐỦ 5 pair ME scope Own (§13 per-role)", async (role) => {
      for (const p of ME_PAIRS) {
        expect(
          await grantScope(direct, role, p.action, p.resourceType),
          `${role} phải có ${p.code} @ Own`,
        ).toBe("Own");
      }
    });

    it("tổng grant ME Own cho 4 role canonical = ĐÚNG 20 (không over/under-grant)", async () => {
      const res = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM role_permissions rp
           JOIN roles r       ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = ANY($1::text[]) AND r.company_id IS NULL AND r.deleted_at IS NULL
            AND rp.effect = 'ALLOW' AND rp.data_scope = 'Own'
            AND (p.action, p.resource_type) IN (
              ('access','me'),('view','user-preference'),('update','user-preference'),
              ('update','avatar'),('update','notification-preference'))`,
        [[...ME_ROLES]],
      );
      expect(Number(res.rows[0].n)).toBe(20);
    });

    it("KHÔNG có pair ME wrapper cho nghiệp-vụ-nguồn (ME-DEC-002 dùng permission NGUỒN)", async () => {
      const res = await direct.query<{ action: string; resource_type: string }>(
        `SELECT action, resource_type FROM permissions
          WHERE (action, resource_type) IN (
            ('view','me-attendance'),('view','me-leave'),('view','me-task'),
            ('view','me-notification'),('view','me-profile'),('export','me-data'))`,
      );
      expect(
        res.rows.map((r) => `${r.action}:${r.resource_type}`),
        `KHÔNG wrap: ${FORBIDDEN_WRAPPER_PAIRS.map((p) => p.join(":")).join(", ")}`,
      ).toEqual([]);
    });
  });

  // ─────────────── F — idempotent (re-seed grant KHÔNG drift) ───────────────
  describe("F — idempotent", () => {
    it("re-apply grant ME 3× → count + data_scope KHÔNG drift", async () => {
      const countSql = `SELECT count(*)::text AS n FROM role_permissions rp
                          JOIN permissions p ON p.id = rp.permission_id
                          JOIN roles r ON r.id = rp.role_id
                         WHERE r.company_id IS NULL AND r.name = ANY($1::text[])
                           AND (p.action, p.resource_type) IN (
                             ('access','me'),('view','user-preference'),('update','user-preference'),
                             ('update','avatar'),('update','notification-preference'))`;
      const before = (await direct.query<{ n: string }>(countSql, [[...ME_ROLES]])).rows[0].n;

      for (let i = 0; i < 3; i++) {
        for (const role of ME_ROLES) {
          for (const p of ME_PAIRS) {
            await direct.query(
              `WITH r AS (SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL),
                    p AS (SELECT id FROM permissions WHERE action = $2 AND resource_type = $3)
               INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
               SELECT r.id, p.id, 'ALLOW', 'Own' FROM r, p
               ON CONFLICT (role_id, permission_id, effect) DO NOTHING`,
              [role, p.action, p.resourceType],
            );
          }
        }
      }

      expect((await direct.query<{ n: string }>(countSql, [[...ME_ROLES]])).rows[0].n).toBe(before);
      for (const role of ME_ROLES) {
        for (const p of ME_PAIRS) {
          expect(await grantScope(direct, role, p.action, p.resourceType)).toBe("Own");
        }
      }
    });
  });
});
