/**
 * S4-TASK-SEED-1 → S5-TASK-PIPELINE-1 — TASK permission catalog (24 cặp DB-06 §12.1: 23 ở mig 0485
 * + update-state:task ở mig 0499) + role→data_scope grants.
 *
 * Colocated trong src/foundation/seed → vitest gom qua `src/**\/*.spec.ts`. Gate cứng
 * `hasDb && LANE_DB` (bài học integration-test-lane-db-gate: chỉ .env → hasDb=true = đỏ-giả).
 *
 * RED-before-GREEN: trên DB migrate đến 0484, 13 cặp catalog THIẾU + delete:project/delete:task
 * còn is_sensitive=false + employee read:task còn @Company (default 0441) ⇒ ĐỎ. Sau 0485 → GREEN.
 *
 * Phủ (mirror att-permissions-seed / plan §6):
 *   (A) catalog đủ 23 cặp is_sensitive EXACT — delete:project/delete:task=true chứng minh bước
 *       UPDATE-nâng chạy (ON CONFLICT DO NOTHING không nâng được cặp 0005);
 *   (B) grant per-(role,pair) scope EXACT 67 hàng — đặc biệt employee read:task === 'Own'
 *       (chứng minh re-scope DELETE+INSERT: DB thật đang @Company);
 *   (C) DENY holes theo CẶP CỤ THỂ (done_when #5 — không chỉ đếm scope-class) + 5 grant HOÃN
 *       (TASK_DEFERRED_GRANTS — BE-2 lật khi enforce scope) + đếm EXACT trên tập 24 cặp canonical
 *       per role (8/20/19/24 sau 0499, miễn nhiễm legacy submit/manage/comment:comment);
 *   (D) idempotent: chạy lại TOÀN BỘ SQL 0485 lần 2 → snapshot không đổi; ON CONFLICT wrong-scope
 *       không drift bộ-ba;
 *   (E) catalog legacy không nhân đôi/không bị đụng (submit:task…, delete-project:project giữ nguyên).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../../../test/helpers/integration-db";
import {
  TASK_EXPECTED_GRANT_COUNTS,
  TASK_GRANT_MATRIX,
  TASK_PERMISSIONS,
  TASK_PERMISSION_COUNT,
} from "./task-permissions.const";

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

// tsconfig module=commonjs → dùng __dirname (như src/db/migrate.ts + force-before-backfill-order
// .int-spec.ts) thay vì import.meta (TS1343).
const MIGRATION_0485_SQL = join(
  __dirname,
  "..",
  "..",
  "..",
  "migrations",
  "0485_s4_taskseed1_task_perms.sql",
);

const ROLE_BY_KEY: Record<"emp" | "mgr" | "hr" | "ca", string> = {
  emp: "employee",
  mgr: "manager",
  hr: "hr",
  ca: "company-admin",
};

/** Cặp cụ thể done_when #5 PHẢI vắng grant (bất kể scope) — chống over-grant Own-scope lọt lưới đếm. */
const DENY_PAIRS: ReadonlyArray<{ role: string; action: string; resource: string }> = [
  // employee — project: chỉ read
  { role: "employee", action: "create", resource: "project" },
  { role: "employee", action: "update", resource: "project" },
  { role: "employee", action: "delete", resource: "project" },
  { role: "employee", action: "close", resource: "project" },
  { role: "employee", action: "archive", resource: "project" },
  { role: "employee", action: "manage-member", resource: "project" },
  { role: "employee", action: "view-report", resource: "project" },
  // employee — task: không hành động quản-lý/destructive
  { role: "employee", action: "assign", resource: "task" },
  { role: "employee", action: "delete", resource: "task" },
  { role: "employee", action: "export", resource: "task" },
  { role: "employee", action: "update-priority", resource: "task" },
  { role: "employee", action: "update-deadline", resource: "task" },
  { role: "employee", action: "file-delete", resource: "task" },
  { role: "employee", action: "view", resource: "task-audit-log" },
  // hr — không lifecycle/destructive project + không delete task (SPEC-06 §9 "Không mặc định")
  { role: "hr", action: "close", resource: "project" },
  { role: "hr", action: "delete", resource: "project" },
  { role: "hr", action: "archive", resource: "project" },
  { role: "hr", action: "manage-member", resource: "project" },
  { role: "hr", action: "delete", resource: "task" },
  // manager — không audit-log
  { role: "manager", action: "view", resource: "task-audit-log" },
  // ── 5 grant HOÃN (plan §7 — route sống pair-only, chưa có scope/owner-check): PHẢI vắng sau
  //    0485; S4-TASK-BE-2 grant cùng release enforcement rồi LẬT các assert này (khuôn RECON-2).
  { role: "employee", action: "create", resource: "task" },
  { role: "employee", action: "update", resource: "task" },
  { role: "manager", action: "create", resource: "task" },
  { role: "manager", action: "update", resource: "task" },
  { role: "manager", action: "delete", resource: "task" },
];

describe.skipIf(!runIsolatedDb)(
  "S4-TASK-SEED-1 TASK permission catalog + grants (mig 0485, DB cô lập LANE_DB)",
  () => {
    const direct = directPool();

    afterAll(async () => {
      await direct.end();
    });

    /** scope đã grant ALLOW cho (role, action, resource); null nếu KHÔNG có hàng. */
    async function grantScope(
      role: string,
      action: string,
      resource: string,
    ): Promise<string | null> {
      const res = await direct.query<{ data_scope: string }>(
        `SELECT rp.data_scope
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name=$1 AND r.company_id IS NULL AND r.deleted_at IS NULL
            AND p.action=$2 AND p.resource_type=$3 AND rp.effect='ALLOW'`,
        [role, action, resource],
      );
      return res.rows.length > 0 ? res.rows[0].data_scope : null;
    }

    // ── A. Catalog: đủ 24 cặp (23 owner-chốt 2026-07-09 + update-state:task 0499) ──
    describe("A. Catalog 24 cặp canonical (action, resource_type)", () => {
      it("pin: TASK_PERMISSIONS có đúng 24 cặp (8 sensitive — update-state non-sensitive)", () => {
        expect(TASK_PERMISSION_COUNT).toBe(24);
        expect(TASK_PERMISSIONS.length).toBe(24);
        expect(TASK_PERMISSIONS.filter((p) => p.sensitive).length).toBe(8);
      });

      for (const p of TASK_PERMISSIONS) {
        it(`(${p.action}:${p.resourceType}) tồn tại, is_sensitive=${p.sensitive}`, async () => {
          const res = await direct.query<{ is_sensitive: boolean }>(
            `SELECT is_sensitive FROM permissions WHERE action=$1 AND resource_type=$2`,
            [p.action, p.resourceType],
          );
          expect(res.rows.length, `cặp (${p.action}:${p.resourceType}) phải có sau 0485`).toBe(1);
          expect(res.rows[0].is_sensitive).toBe(p.sensitive);
        });
      }
    });

    // ── B. Grant per-pair = ma trận (mọi ô có giá trị — 67 hàng seed ở 0485) ─────
    describe("B. Role→data_scope grants = ma trận SPEC-06 §9", () => {
      for (const row of TASK_GRANT_MATRIX) {
        for (const key of ["emp", "mgr", "hr", "ca"] as const) {
          const expected = row[key];
          if (!expected) continue;
          const role = ROLE_BY_KEY[key];
          it(`${role} (${row.action}:${row.resource}) = ${expected}`, async () => {
            expect(await grantScope(role, row.action, row.resource)).toBe(expected);
          });
        }
      }

      it("re-scope THẬT: employee read:task = Own (0441 default là Company — DELETE+INSERT phải chạy)", async () => {
        expect(await grantScope("employee", "read", "task")).toBe("Own");
      });
    });

    // ── C. DENY holes theo cặp cụ thể + đếm EXACT trên tập canonical ─────────────
    describe("C. DENY holes (done_when #5) + exact-count chống over-grant", () => {
      for (const d of DENY_PAIRS) {
        it(`${d.role} KHÔNG có grant (${d.action}:${d.resource}) — bất kể scope`, async () => {
          expect(await grantScope(d.role, d.action, d.resource)).toBeNull();
        });
      }

      // Ô trống còn lại của ma trận (ngoài DENY_PAIRS tường minh) cũng phải trống.
      for (const row of TASK_GRANT_MATRIX) {
        for (const key of ["emp", "mgr", "hr", "ca"] as const) {
          if (row[key]) continue;
          const role = ROLE_BY_KEY[key];
          const listed = DENY_PAIRS.some(
            (d) => d.role === role && d.action === row.action && d.resource === row.resource,
          );
          if (listed) continue;
          it(`${role} KHÔNG có grant (${row.action}:${row.resource})`, async () => {
            expect(await grantScope(role, row.action, row.resource)).toBeNull();
          });
        }
      }

      it("đếm EXACT trên tập 24 cặp canonical: employee 8 · manager 20 · hr 19 · company-admin 24", async () => {
        const res = await direct.query<{ name: string; n: number }>(
          `WITH canonical AS (
             SELECT p.id FROM permissions p
              WHERE (p.action, p.resource_type) IN (${TASK_PERMISSIONS.map(
                (_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`,
              ).join(",")})
           )
           SELECT r.name, COUNT(*)::int AS n
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN canonical c ON c.id = rp.permission_id
            WHERE r.company_id IS NULL AND r.deleted_at IS NULL
              AND r.name IN ('employee','manager','hr','company-admin')
              AND rp.effect='ALLOW'
            GROUP BY r.name`,
          TASK_PERMISSIONS.flatMap((p) => [p.action, p.resourceType]),
        );
        const byRole = Object.fromEntries(res.rows.map((r) => [r.name, r.n]));
        expect(byRole).toEqual(TASK_EXPECTED_GRANT_COUNTS);
      });
    });

    // ── D. Idempotent: chạy lại TOÀN BỘ 0485 + probe ON CONFLICT wrong-scope ─────
    describe("D. Idempotent", () => {
      const snapshot = async () =>
        (
          await direct.query<{ k: string }>(
            `SELECT r.name || '|' || p.action || ':' || p.resource_type || '|' ||
                    rp.effect || '|' || rp.data_scope AS k
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.company_id IS NULL
                AND p.resource_type IN ('project','task','task-audit-log','comment')
              ORDER BY k`,
          )
        ).rows
          .map((x) => x.k)
          .join("\n");

      it("re-run TOÀN BỘ SQL 0485 lần 2 = no-op (snapshot grant + catalog không đổi)", async () => {
        const sql = readFileSync(MIGRATION_0485_SQL, "utf8");
        const before = await snapshot();
        const catalogBefore = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM permissions`,
        );
        for (const stmt of sql.split("--> statement-breakpoint")) {
          const trimmed = stmt.trim();
          if (trimmed.length === 0) continue;
          await direct.query(trimmed);
        }
        const after = await snapshot();
        const catalogAfter = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM permissions`,
        );
        expect(after, "re-run 0485 KHÔNG được đổi grant/scope nào").toBe(before);
        expect(catalogAfter.rows[0].n, "re-run 0485 KHÔNG được thêm permission row").toBe(
          catalogBefore.rows[0].n,
        );
      });

      it("ON CONFLICT bộ-ba: INSERT scope CỐ Ý SAI không ghi đè scope đã seed", async () => {
        const before = await snapshot();
        for (let i = 0; i < 3; i++) {
          await direct.query(
            `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
             SELECT r.id, p.id, 'ALLOW', 'System'
               FROM roles r CROSS JOIN permissions p
              WHERE r.name='employee' AND r.company_id IS NULL
                AND p.action='read' AND p.resource_type='task'
             ON CONFLICT (role_id, permission_id, effect) DO NOTHING`,
          );
        }
        const after = await snapshot();
        expect(after, "re-apply ON CONFLICT KHÔNG drift scope").toBe(before);
        expect(after).toContain("employee|read:task|ALLOW|Own");
      });
    });

    // ── E. Legacy giữ nguyên — 0485 không đụng/không nhân đôi ────────────────────
    describe("E. Catalog legacy không bị đụng", () => {
      // KHÔNG assert grant comment:comment ở đây — thuộc task-recon-grants (RECON-2 sẽ lật).
      for (const legacy of [
        { action: "submit", resource: "task" },
        { action: "manage", resource: "task" },
        { action: "manage", resource: "project" },
        { action: "assign", resource: "project" },
        { action: "comment", resource: "comment" },
      ]) {
        it(`catalog (${legacy.action}:${legacy.resource}) đúng 1 row, is_sensitive=false`, async () => {
          const res = await direct.query<{ is_sensitive: boolean }>(
            `SELECT is_sensitive FROM permissions WHERE action=$1 AND resource_type=$2`,
            [legacy.action, legacy.resource],
          );
          expect(res.rows.length).toBe(1);
          expect(res.rows[0].is_sensitive).toBe(false);
        });
      }

      it("cặp legacy dị dạng (delete-project:project) giữ nguyên is_sensitive=true, không nhân đôi", async () => {
        const res = await direct.query<{ is_sensitive: boolean }>(
          `SELECT is_sensitive FROM permissions WHERE action='delete-project' AND resource_type='project'`,
        );
        expect(res.rows.length).toBe(1);
        expect(res.rows[0].is_sensitive).toBe(true);
      });
    });
  },
);
