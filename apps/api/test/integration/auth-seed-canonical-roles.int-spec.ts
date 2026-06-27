import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * S2-AUTH-SEED-1 / L1-SEED-MIG — Canonical roles + per-pair data_scope seed (mig 0444).
 *
 * Nguồn sự thật: docs/plans/S2-AUTH-SEED-1.md §13 PERMISSION MATRIX (IMPLEMENTATION-05 §13).
 *
 * RED-before-GREEN: chạy trên DB migrate đến 0443 → các cặp §13 (vd view:me) THIẾU / scope SAI ⇒ ĐỎ.
 * Sau 0444 → GREEN. Lưu bằng chứng RED bằng cách chạy suite này trên DB chain 0000→0443 trước.
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env trỏ DB dev chung làm hasDb=true,
 * assertion sẽ chạm DB chung = đỏ-giả. Vì vậy CHỈ chạy khi LANE_DB set (DB cô lập).
 *
 * BẤT BIẾN kiểm chứng:
 *   #1 tenant: super-admin KHÔNG seed ở migration (company_id NULL) — assert KHÔNG có system role 'super-admin'.
 *   #2 append-only: app role KHÔNG UPDATE role_permissions → đổi scope = DELETE+INSERT.
 */

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

// ── §13 PERMISSION MATRIX → per-pair (role, action, resource_type, data_scope) ──────────
// "-" trong §13 = KHÔNG grant (không có hàng ở đây). Super-Admin = runtime (KHÔNG migration).
type Grant = { role: string; action: string; resourceType: string; scope: string };

const SEED_GRANTS: Grant[] = [
  // AUTH.ME.VIEW — view:me = Own cho CẢ 4 role canonical (KHÔNG Company)
  { role: "employee", action: "view", resourceType: "me", scope: "Own" },
  { role: "manager", action: "view", resourceType: "me", scope: "Own" },
  { role: "hr", action: "view", resourceType: "me", scope: "Own" },
  { role: "company-admin", action: "view", resourceType: "me", scope: "Own" },
  // AUTH.USER.VIEW
  { role: "hr", action: "view", resourceType: "user", scope: "Company" },
  { role: "company-admin", action: "view", resourceType: "user", scope: "Company" },
  // AUTH.USER.CREATE
  { role: "company-admin", action: "create", resourceType: "user", scope: "Company" },
  // AUTH.USER.LOCK
  { role: "company-admin", action: "lock", resourceType: "user", scope: "Company" },
  // AUTH.ROLE.VIEW
  { role: "company-admin", action: "view", resourceType: "role", scope: "Company" },
  // AUTH.PERMISSION.VIEW
  { role: "company-admin", action: "view", resourceType: "permission", scope: "Company" },
  // HR.EMPLOYEE.VIEW — read:employee : employee=Own, manager=Team, hr=Company, company-admin=Company
  { role: "employee", action: "read", resourceType: "employee", scope: "Own" },
  { role: "manager", action: "read", resourceType: "employee", scope: "Team" },
  { role: "hr", action: "read", resourceType: "employee", scope: "Company" },
  { role: "company-admin", action: "read", resourceType: "employee", scope: "Company" },
  // HR.EMPLOYEE.VIEW_SENSITIVE — view-sensitive:employee (is_sensitive): employee=Own, hr=Company, company-admin=Company (manager KHÔNG)
  { role: "employee", action: "view-sensitive", resourceType: "employee", scope: "Own" },
  { role: "hr", action: "view-sensitive", resourceType: "employee", scope: "Company" },
  { role: "company-admin", action: "view-sensitive", resourceType: "employee", scope: "Company" },
  // HR.EMPLOYEE.CREATE
  { role: "hr", action: "create", resourceType: "employee", scope: "Company" },
  { role: "company-admin", action: "create", resourceType: "employee", scope: "Company" },
  // HR.EMPLOYEE.UPDATE
  { role: "hr", action: "update", resourceType: "employee", scope: "Company" },
  { role: "company-admin", action: "update", resourceType: "employee", scope: "Company" },
  // HR.EMPLOYEE.CHANGE_STATUS
  { role: "hr", action: "change-status", resourceType: "employee", scope: "Company" },
  { role: "company-admin", action: "change-status", resourceType: "employee", scope: "Company" },
  // HR.EMPLOYEE.DELETE — hr KHÔNG (mặc định), company-admin=Company
  { role: "company-admin", action: "delete", resourceType: "employee", scope: "Company" },
  // HR.EMPLOYEE.EXPORT
  { role: "hr", action: "export", resourceType: "employee", scope: "Company" },
  { role: "company-admin", action: "export", resourceType: "employee", scope: "Company" },
  // HR.DEPARTMENT.VIEW — read:department : employee=Company, manager=Department, hr=Company, company-admin=Company
  { role: "employee", action: "read", resourceType: "department", scope: "Company" },
  { role: "manager", action: "read", resourceType: "department", scope: "Department" },
  { role: "hr", action: "read", resourceType: "department", scope: "Company" },
  { role: "company-admin", action: "read", resourceType: "department", scope: "Company" },
  // HR.DEPARTMENT.CREATE
  { role: "hr", action: "create", resourceType: "department", scope: "Company" },
  { role: "company-admin", action: "create", resourceType: "department", scope: "Company" },
  // HR.POSITION.VIEW — read:position : employee=Company, manager=Company, hr=Company, company-admin=Company
  { role: "employee", action: "read", resourceType: "position", scope: "Company" },
  { role: "manager", action: "read", resourceType: "position", scope: "Company" },
  { role: "hr", action: "read", resourceType: "position", scope: "Company" },
  { role: "company-admin", action: "read", resourceType: "position", scope: "Company" },
  // HR.PROFILE_CHANGE_REQUEST.CREATE — create:profile-change-request = Own cho CẢ 4 role
  { role: "employee", action: "create", resourceType: "profile-change-request", scope: "Own" },
  { role: "manager", action: "create", resourceType: "profile-change-request", scope: "Own" },
  { role: "hr", action: "create", resourceType: "profile-change-request", scope: "Own" },
  { role: "company-admin", action: "create", resourceType: "profile-change-request", scope: "Own" },
  // HR.PROFILE_CHANGE_REQUEST.APPROVE
  { role: "hr", action: "approve", resourceType: "profile-change-request", scope: "Company" },
  {
    role: "company-admin",
    action: "approve",
    resourceType: "profile-change-request",
    scope: "Company",
  },
];

// Cặp §13 cần CÓ trong catalog permissions sau 0444 (gồm verb MỚI khác legacy).
const REQUIRED_CATALOG = [
  { action: "view", resourceType: "me", sensitive: false },
  { action: "view", resourceType: "user", sensitive: false },
  { action: "lock", resourceType: "user", sensitive: false },
  { action: "view", resourceType: "role", sensitive: false },
  { action: "view", resourceType: "permission", sensitive: false },
  { action: "view-sensitive", resourceType: "employee", sensitive: true },
  { action: "create", resourceType: "profile-change-request", sensitive: false },
  { action: "approve", resourceType: "profile-change-request", sensitive: false },
  { action: "change-status", resourceType: "employee", sensitive: false },
  { action: "export", resourceType: "employee", sensitive: false },
];

// Cặp TUYỆT ĐỐI KHÔNG được role-grant cho 4 role canonical (assert CHỈ trên role canonical).
const FORBIDDEN_PAIRS = [
  { action: "reveal-secret", resourceType: "platform-account" },
  { action: "view-salary", resourceType: "employee" },
  { action: "update-salary", resourceType: "employee" },
];

const CANONICAL_ROLES = ["employee", "manager", "hr", "company-admin"] as const;

describe.skipIf(!runIsolatedDb)(
  "S2-AUTH-SEED-1 canonical roles + per-pair data_scope (mig 0444, DB cô lập LANE_DB)",
  () => {
    const direct = directPool();

    afterAll(async () => {
      await direct.end();
    });

    // ── A. Catalog đủ cặp §13 (verb MỚI) ────────────────────────────────────────────
    describe("A. Permission catalog gaps §13 seeded", () => {
      for (const p of REQUIRED_CATALOG) {
        it(`catalog has (${p.action}:${p.resourceType}) is_sensitive=${p.sensitive}`, async () => {
          const res = await direct.query<{ is_sensitive: boolean }>(
            `SELECT is_sensitive FROM permissions WHERE action=$1 AND resource_type=$2`,
            [p.action, p.resourceType],
          );
          expect(
            res.rows.length,
            `permission (${p.action}:${p.resourceType}) phải tồn tại sau 0444`,
          ).toBe(1);
          expect(
            res.rows[0].is_sensitive,
            `(${p.action}:${p.resourceType}) is_sensitive phải = ${p.sensitive}`,
          ).toBe(p.sensitive);
        });
      }
    });

    // ── B. 2 system role MỚI manager/hr + tái dùng employee/company-admin ────────────
    describe("B. System roles manager/hr created (company_id NULL, is_system=true)", () => {
      for (const name of ["manager", "hr"] as const) {
        it(`system role '${name}' exists (company_id NULL, is_system=true)`, async () => {
          const res = await direct.query<{ company_id: string | null; is_system: boolean }>(
            `SELECT company_id, is_system FROM roles WHERE name=$1 AND deleted_at IS NULL`,
            [name],
          );
          expect(res.rows.length, `role '${name}' phải tồn tại đúng 1 row`).toBe(1);
          expect(res.rows[0].company_id, `role '${name}' phải company_id NULL (system)`).toBeNull();
          expect(res.rows[0].is_system, `role '${name}' phải is_system=true`).toBe(true);
        });
      }

      it("không tạo trùng / không gộp hr-manager(…009) media-era vào hr", async () => {
        // hr-manager (…009) vẫn còn nguyên, KHÔNG bị đổi tên/xoá.
        const hrm = await direct.query<{ id: string }>(
          `SELECT id FROM roles WHERE id='00000000-0000-0000-0000-000000000009'`,
        );
        expect(hrm.rows.length, "hr-manager(…009) media-era KHÔNG bị xoá").toBe(1);
        // 'hr' canonical là role MỚI khác id …009.
        const hr = await direct.query<{ id: string }>(
          `SELECT id FROM roles WHERE name='hr' AND deleted_at IS NULL`,
        );
        expect(hr.rows[0].id).not.toBe("00000000-0000-0000-0000-000000000009");
      });

      it("BẤT BIẾN #1: KHÔNG seed system role 'super-admin' company_id NULL ở migration", async () => {
        const sa = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM roles WHERE name='super-admin' AND company_id IS NULL`,
        );
        expect(sa.rows[0].n, "super-admin = runtime company-scoped, KHÔNG seed migration").toBe(0);
      });
    });

    // ── C. Per-pair data_scope đúng BẢNG §13 (KHÔNG phẳng theo role) ──────────────────
    describe("C. Per-pair data_scope = §13", () => {
      for (const g of SEED_GRANTS) {
        it(`${g.role} (${g.action}:${g.resourceType}) data_scope=${g.scope}`, async () => {
          const res = await direct.query<{ data_scope: string; effect: string }>(
            `SELECT rp.data_scope, rp.effect
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.name=$1 AND r.deleted_at IS NULL
                AND p.action=$2 AND p.resource_type=$3 AND rp.effect='ALLOW'`,
            [g.role, g.action, g.resourceType],
          );
          expect(
            res.rows.length,
            `${g.role} phải có grant ALLOW (${g.action}:${g.resourceType})`,
          ).toBe(1);
          expect(
            res.rows[0].data_scope,
            `${g.role} (${g.action}:${g.resourceType}) data_scope phải = ${g.scope} (§13)`,
          ).toBe(g.scope);
        });
      }
    });

    // ── D. Deny: 4 role canonical KHÔNG có cặp out-of-scope ──────────────────────────
    describe("D. Canonical roles KHÔNG có cặp cấm (assert CHỈ role canonical)", () => {
      for (const fp of FORBIDDEN_PAIRS) {
        it(`KHÔNG role canonical nào có (${fp.action}:${fp.resourceType})`, async () => {
          const res = await direct.query<{ role: string }>(
            `SELECT r.name AS role
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.name = ANY($1)
                AND p.action=$2 AND p.resource_type=$3`,
            [CANONICAL_ROLES, fp.action, fp.resourceType],
          );
          expect(
            res.rows.map((x) => x.role),
            `Cặp cấm (${fp.action}:${fp.resourceType}) KHÔNG được grant cho role canonical`,
          ).toEqual([]);
        });
      }

      it("manager KHÔNG có view-sensitive:employee (§13)", async () => {
        const res = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name='manager' AND p.action='view-sensitive' AND p.resource_type='employee'`,
        );
        expect(res.rows[0].n, "manager KHÔNG được view-sensitive:employee").toBe(0);
      });

      it("hr KHÔNG có delete:employee (§13 mặc định)", async () => {
        const res = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name='hr' AND p.action='delete' AND p.resource_type='employee'`,
        );
        expect(res.rows[0].n, "hr KHÔNG được delete:employee mặc định (chỉ company-admin)").toBe(0);
      });
    });

    // ── E. Idempotent đo BỘ BA (role, pair, data_scope) — re-apply seed không drift ──
    it("E. Idempotent bộ-ba: re-apply seed INSERT ON CONFLICT KHÔNG đổi (role,pair,scope)", async () => {
      const snapshot = async () =>
        (
          await direct.query<{ k: string }>(
            `SELECT r.name || '|' || p.action || ':' || p.resource_type || '|' || rp.data_scope AS k
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.name = ANY($1) AND rp.effect='ALLOW'
              ORDER BY k`,
            [CANONICAL_ROLES],
          )
        ).rows
          .map((x) => x.k)
          .join("\n");

      const before = await snapshot();
      // Mô phỏng re-apply: INSERT ON CONFLICT(role_id,permission_id,effect) DO NOTHING — KHÔNG ghi đè scope.
      await direct.query(
        `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
         SELECT r.id, p.id, 'ALLOW', 'Company'
           FROM roles r CROSS JOIN permissions p
          WHERE r.name='employee' AND p.action='view' AND p.resource_type='me'
         ON CONFLICT (role_id, permission_id, effect) DO NOTHING`,
      );
      const after = await snapshot();
      expect(after, "re-apply ON CONFLICT KHÔNG được drift scope (bộ-ba bất biến)").toBe(before);
      // view:me của employee vẫn = Own (KHÔNG bị ghi đè thành Company qua ON CONFLICT)
      expect(after).toContain("employee|view:me|Own");
    });

    // ── F. company-admin grant media/foundation parked KHÔNG đổi count ───────────────
    it("F. company-admin grant parked (foundation-*/channel/project/content/platform-account) còn nguyên", async () => {
      const res = await direct.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id='00000000-0000-0000-0000-000000000001'
            AND (p.resource_type LIKE 'foundation-%'
                 OR p.resource_type IN ('channel','project','content','platform-account','workflow-instance','step'))`,
      );
      expect(
        res.rows[0].n,
        "grant media/foundation parked của company-admin phải > 0 (KHÔNG bị blanket DELETE)",
      ).toBeGreaterThan(0);
    });
  },
);

/**
 * G. BẤT BIẾN #2 (append-only) — app role (mediaos_app) KHÔNG có grant UPDATE trên role_permissions
 *    (mig 0005:109 = GRANT SELECT, INSERT, DELETE — KHÔNG UPDATE). Vì thế "đổi scope" PHẢI = DELETE+INSERT
 *    trong 1 transaction (mig 0441 cũng tài liệu hoá: "đổi scope = delete+insert (đồng nhất effect)").
 *
 * Khẳng định grant-LEVEL (KHÔNG phải RLS 0-row): seed hàng role_permissions qua `direct` (superuser, bypass
 * RLS) cho một role TENANT-SCOPED (company_id = công ty A) ⇒ hàng HIỂN THỊ + GHI ĐƯỢC dưới RLS app context
 * (policy WITH CHECK yêu cầu role.company_id = current). UPDATE thất bại CHỈ vì THIẾU grant UPDATE.
 *
 * Idiom tái dùng từ auth-appendonly.int-spec.ts: asTenant() + rejects.toThrow(/permission denied/).
 * Gate: hasDb && LANE_DB (KHÔNG chạm DB dev chung 'mediaos' — memory integration-test-lane-db-gate).
 */
describe.skipIf(!runIsolatedDb)(
  "S2-AUTH-SEED-1 role_permissions APPEND-ONLY: app role UPDATE DENIED → đổi scope = DELETE+INSERT (BẤT BIẾN #2)",
  () => {
    const direct = directPool();
    const app = appPool();

    let A: SeededTenant;
    let tenantRoleId: string;
    let permissionId: string;

    beforeAll(async () => {
      A = await seedCompany(direct, "rp-ao");
      // Role TENANT-SCOPED (company_id = A) — không phải system role: app context (company_id=A) THẤY +
      // được phép GHI (RLS WITH CHECK pass). Nếu là system role (company_id NULL), DELETE/INSERT của app
      // sẽ bị RLS chặn ⇒ KHÔNG phân biệt được "thiếu grant" với "RLS chặn". Tenant role tách bạch 2 lớp.
      tenantRoleId = await seedRole(direct, A.companyId, "rp-ao-role");
      // Permission catalog (toàn cục, không company_id). Verb riêng để KHÔNG đụng cặp §13 seeded.
      permissionId = await seedPermissionCatalog(direct, "rp-ao-action", "rp-ao-resource", false);

      // Seed role_permission qua DIRECT (bypass RLS/grant) — hàng app role sẽ thử UPDATE (kỳ vọng denied)
      // rồi DELETE+INSERT (kỳ vọng success). data_scope='Own' (mig 0441 CHECK ∈ Own/Team/Department/Company/System).
      await direct.query(
        `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
         VALUES ($1, $2, 'ALLOW', 'Own')
         ON CONFLICT (role_id, permission_id, effect) DO UPDATE SET data_scope = EXCLUDED.data_scope`,
        [tenantRoleId, permissionId],
      );
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
      await app.end();
    });

    /** Run fn inside a transaction as app role với tenant context set (mirror auth-appendonly.int-spec.ts). */
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

    it("hàng seed HIỂN THỊ dưới app RLS context (chứng minh deny sau = grant-level, KHÔNG phải RLS 0-row)", async () => {
      const visible = await asTenant(A.companyId, async (c) => {
        const r = await c.query<{ data_scope: string }>(
          `SELECT data_scope FROM role_permissions WHERE role_id=$1 AND permission_id=$2 AND effect='ALLOW'`,
          [tenantRoleId, permissionId],
        );
        return r.rows;
      });
      expect(visible.length, "app role PHẢI thấy hàng (tenant role → RLS USING pass)").toBe(1);
      expect(visible[0].data_scope).toBe("Own");
    });

    it("app role UPDATE role_permissions data_scope is DENIED (append-only — no UPDATE grant, mig 0005:109)", async () => {
      await expect(
        asTenant(A.companyId, async (c) => {
          await c.query(
            `UPDATE role_permissions SET data_scope = 'Company' WHERE role_id=$1 AND permission_id=$2 AND effect='ALLOW'`,
            [tenantRoleId, permissionId],
          );
        }),
      ).rejects.toThrow(/permission denied/);
    });

    it("đổi scope = DELETE(role_id,permission_id,effect)+INSERT (scope mới) trong 1 transaction SUCCEEDS (BẤT BIẾN #2)", async () => {
      // App role có GRANT SELECT,INSERT,DELETE → DELETE đúng (role_id,permission_id,effect) rồi INSERT lại
      // với data_scope MỚI, atomically trong 1 transaction. Đây là cách CANONICAL đổi scope khi không có UPDATE.
      await asTenant(A.companyId, async (c) => {
        const del = await c.query(
          `DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2 AND effect='ALLOW'`,
          [tenantRoleId, permissionId],
        );
        expect(del.rowCount, "DELETE đúng hàng cũ (1 row)").toBe(1);
        await c.query(
          `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
           VALUES ($1, $2, 'ALLOW', 'Company')`,
          [tenantRoleId, permissionId],
        );
      });

      // Đọc lại bằng direct (bypass RLS) — scope đã đổi 'Own' → 'Company' qua DELETE+INSERT, KHÔNG qua UPDATE.
      const after = await direct.query<{ data_scope: string }>(
        `SELECT data_scope FROM role_permissions WHERE role_id=$1 AND permission_id=$2 AND effect='ALLOW'`,
        [tenantRoleId, permissionId],
      );
      expect(after.rows.length, "đúng 1 hàng sau DELETE+INSERT").toBe(1);
      expect(after.rows[0].data_scope, "scope đã đổi sang 'Company' qua DELETE+INSERT").toBe(
        "Company",
      );
    });
  },
);
