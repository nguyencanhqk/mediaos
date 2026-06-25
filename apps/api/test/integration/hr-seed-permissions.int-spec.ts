import { afterAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../helpers/integration-db";

/**
 * S2-HR-SEED-1 — HR permission gaps + role grants (mig 0445), nối tiếp 0444 (S2-AUTH-SEED-1).
 *
 * Nguồn sự thật: docs/plans/S2-HR-SEED-1.md · API-10 PERMISSION MATRIX §5.2/§6.2 · IMPLEMENTATION-05 §13.
 *
 * RED-before-GREEN: chạy trên DB migrate đến 0444 → cặp 0445 (vd manage:master-data, hr update:position)
 * THIẾU ⇒ ĐỎ. Sau 0445 → GREEN.
 *
 * Gate hasDb && LANE_DB (memory integration-test-LANE_DB-gate): .env trỏ DB dev chung làm hasDb=true,
 * assertion chạm DB chung = đỏ-giả. CHỈ chạy khi LANE_DB set (DB cô lập).
 *
 * BẤT BIẾN kiểm chứng:
 *   • done_when 2: cặp HR mới (DEPARTMENT.* / POSITION.* / MASTER_DATA.MANAGE / EMPLOYEE_CODE.PREVIEW)
 *     có catalog + grant hr/company-admin = Company.
 *   • done_when 3: sensitive (view-salary/update-salary:employee · reveal-secret:platform-account) KHÔNG
 *     auto-grant qua wildcard cho 4 role canonical; 7 cặp 0445 đều is_sensitive=false.
 *   • Idempotent đo BỘ BA (role,pair,scope).
 *   • Regression: grant 0444 (read:department / read:position cho manager/employee) KHÔNG bị đụng.
 */

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

type Grant = { role: string; action: string; resourceType: string; scope: string };

// ── API-10 §6.2 → cặp 0445 (hr + company-admin = Company). manager/employee KHÔNG (trống §6.2). ──
const SEED_GRANTS: Grant[] = [
  // HR.DEPARTMENT.UPDATE / DELETE
  { role: "hr", action: "update", resourceType: "department", scope: "Company" },
  { role: "company-admin", action: "update", resourceType: "department", scope: "Company" },
  { role: "hr", action: "delete", resourceType: "department", scope: "Company" },
  { role: "company-admin", action: "delete", resourceType: "department", scope: "Company" },
  // HR.POSITION.CREATE / UPDATE / DELETE
  { role: "hr", action: "create", resourceType: "position", scope: "Company" },
  { role: "company-admin", action: "create", resourceType: "position", scope: "Company" },
  { role: "hr", action: "update", resourceType: "position", scope: "Company" },
  { role: "company-admin", action: "update", resourceType: "position", scope: "Company" },
  { role: "hr", action: "delete", resourceType: "position", scope: "Company" },
  { role: "company-admin", action: "delete", resourceType: "position", scope: "Company" },
  // HR.MASTER_DATA.MANAGE
  { role: "hr", action: "manage", resourceType: "master-data", scope: "Company" },
  { role: "company-admin", action: "manage", resourceType: "master-data", scope: "Company" },
  // HR.EMPLOYEE_CODE.PREVIEW
  { role: "hr", action: "preview", resourceType: "employee-code", scope: "Company" },
  { role: "company-admin", action: "preview", resourceType: "employee-code", scope: "Company" },
];

// Catalog cặp MỚI 0445 phải có (gồm cặp đã có 0005/0019 — kiểm tồn tại + is_sensitive=false).
const REQUIRED_CATALOG = [
  { action: "update", resourceType: "department", sensitive: false },
  { action: "delete", resourceType: "department", sensitive: false },
  { action: "create", resourceType: "position", sensitive: false },
  { action: "update", resourceType: "position", sensitive: false },
  { action: "delete", resourceType: "position", sensitive: false },
  { action: "manage", resourceType: "master-data", sensitive: false },
  { action: "preview", resourceType: "employee-code", sensitive: false },
];

// Cặp TUYỆT ĐỐI KHÔNG được role-grant cho 4 role canonical (assert CHỈ trên role canonical).
const FORBIDDEN_PAIRS = [
  { action: "view-salary", resourceType: "employee" },
  { action: "update-salary", resourceType: "employee" },
  { action: "reveal-secret", resourceType: "platform-account" },
];

const CANONICAL_ROLES = ["employee", "manager", "hr", "company-admin"] as const;

describe.skipIf(!runIsolatedDb)(
  "S2-HR-SEED-1 HR permission gaps + grants (mig 0445, DB cô lập LANE_DB)",
  () => {
    const direct = directPool();

    afterAll(async () => {
      await direct.end();
    });

    // ── A. Catalog đủ cặp 0445 (is_sensitive=false) ─────────────────────────────────
    describe("A. Catalog gaps seeded (is_sensitive=false)", () => {
      for (const p of REQUIRED_CATALOG) {
        it(`catalog has (${p.action}:${p.resourceType}) is_sensitive=${p.sensitive}`, async () => {
          const res = await direct.query<{ is_sensitive: boolean }>(
            `SELECT is_sensitive FROM permissions WHERE action=$1 AND resource_type=$2`,
            [p.action, p.resourceType],
          );
          expect(
            res.rows.length,
            `permission (${p.action}:${p.resourceType}) phải tồn tại sau 0445`,
          ).toBe(1);
          expect(
            res.rows[0].is_sensitive,
            `(${p.action}:${p.resourceType}) is_sensitive phải = ${p.sensitive}`,
          ).toBe(p.sensitive);
        });
      }
    });

    // ── B. Per-pair data_scope đúng API-10 §6.2 ─────────────────────────────────────
    describe("B. Per-pair data_scope = API-10 §6.2 (hr/company-admin = Company)", () => {
      for (const g of SEED_GRANTS) {
        it(`${g.role} (${g.action}:${g.resourceType}) data_scope=${g.scope}`, async () => {
          const res = await direct.query<{ data_scope: string }>(
            `SELECT rp.data_scope
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.name=$1 AND r.company_id IS NULL AND r.deleted_at IS NULL
                AND p.action=$2 AND p.resource_type=$3 AND rp.effect='ALLOW'`,
            [g.role, g.action, g.resourceType],
          );
          expect(
            res.rows.length,
            `${g.role} phải có grant ALLOW (${g.action}:${g.resourceType})`,
          ).toBe(1);
          expect(
            res.rows[0].data_scope,
            `${g.role} (${g.action}:${g.resourceType}) data_scope phải = ${g.scope} (API-10 §6.2)`,
          ).toBe(g.scope);
        });
      }
    });

    // ── C. manager/employee KHÔNG có write/master-data/employee-code (API-10 §6.2 trống) ──
    describe("C. manager/employee KHÔNG có cặp write/master-data/employee-code", () => {
      const lowRoles = ["manager", "employee"] as const;
      const writePairs = [
        { action: "update", resourceType: "department" },
        { action: "delete", resourceType: "department" },
        { action: "create", resourceType: "position" },
        { action: "update", resourceType: "position" },
        { action: "delete", resourceType: "position" },
        { action: "manage", resourceType: "master-data" },
        { action: "preview", resourceType: "employee-code" },
      ];
      for (const role of lowRoles) {
        for (const wp of writePairs) {
          it(`${role} KHÔNG có (${wp.action}:${wp.resourceType})`, async () => {
            const res = await direct.query<{ n: number }>(
              `SELECT COUNT(*)::int AS n
                 FROM role_permissions rp
                 JOIN roles r ON r.id = rp.role_id
                 JOIN permissions p ON p.id = rp.permission_id
                WHERE r.name=$1 AND r.company_id IS NULL
                  AND p.action=$2 AND p.resource_type=$3`,
              [role, wp.action, wp.resourceType],
            );
            expect(res.rows[0].n, `${role} KHÔNG được grant (${wp.action}:${wp.resourceType})`).toBe(
              0,
            );
          });
        }
      }
    });

    // ── D. Sensitive KHÔNG auto-grant cho 4 role canonical (done_when 3) ─────────────
    describe("D. Sensitive KHÔNG vào 4 role canonical (assert CHỈ role canonical)", () => {
      for (const fp of FORBIDDEN_PAIRS) {
        it(`KHÔNG role canonical nào có (${fp.action}:${fp.resourceType})`, async () => {
          const res = await direct.query<{ role: string }>(
            `SELECT r.name AS role
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.name = ANY($1) AND r.company_id IS NULL
                AND p.action=$2 AND p.resource_type=$3`,
            [CANONICAL_ROLES, fp.action, fp.resourceType],
          );
          expect(
            res.rows.map((x) => x.role),
            `Sensitive (${fp.action}:${fp.resourceType}) KHÔNG được auto-grant cho role canonical`,
          ).toEqual([]);
        });
      }

      it("đếm đúng: 14 grant 0445 (7 cặp × hr+company-admin) tồn tại", async () => {
        const res = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name IN ('hr','company-admin') AND r.company_id IS NULL
              AND rp.effect='ALLOW' AND rp.data_scope='Company'
              AND (p.action,p.resource_type) IN (
                ('update','department'),('delete','department'),
                ('create','position'),('update','position'),('delete','position'),
                ('manage','master-data'),('preview','employee-code'))`,
        );
        expect(res.rows[0].n, "đúng 14 grant 0445 (7 cặp × 2 role) = Company").toBe(14);
      });
    });

    // ── E. Regression: grant 0444 KHÔNG bị đụng (read:department/read:position manager/employee) ──
    describe("E. Regression — grant 0444 read:* còn nguyên (KHÔNG blanket DELETE)", () => {
      const carry: Grant[] = [
        { role: "manager", action: "read", resourceType: "department", scope: "Department" },
        { role: "employee", action: "read", resourceType: "department", scope: "Company" },
        { role: "manager", action: "read", resourceType: "position", scope: "Company" },
        { role: "employee", action: "read", resourceType: "position", scope: "Company" },
      ];
      for (const g of carry) {
        it(`${g.role} (${g.action}:${g.resourceType}) vẫn = ${g.scope} (seed 0444 bất biến)`, async () => {
          const res = await direct.query<{ data_scope: string }>(
            `SELECT rp.data_scope
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.name=$1 AND r.company_id IS NULL AND r.deleted_at IS NULL
                AND p.action=$2 AND p.resource_type=$3 AND rp.effect='ALLOW'`,
            [g.role, g.action, g.resourceType],
          );
          expect(res.rows.length, `${g.role} (${g.action}:${g.resourceType}) phải còn (0444)`).toBe(
            1,
          );
          expect(res.rows[0].data_scope, `scope 0444 bất biến`).toBe(g.scope);
        });
      }
    });

    // ── F. Idempotent đo BỘ BA — re-apply ON CONFLICT KHÔNG drift scope ──────────────
    it("F. Idempotent bộ-ba: re-apply INSERT ON CONFLICT KHÔNG đổi (role,pair,scope)", async () => {
      const snapshot = async () =>
        (
          await direct.query<{ k: string }>(
            `SELECT r.name || '|' || p.action || ':' || p.resource_type || '|' || rp.data_scope AS k
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.name = ANY($1) AND r.company_id IS NULL AND rp.effect='ALLOW'
              ORDER BY k`,
            [CANONICAL_ROLES],
          )
        ).rows
          .map((x) => x.k)
          .join("\n");

      const before = await snapshot();
      // Mô phỏng re-apply scope SAI: INSERT ON CONFLICT(role_id,permission_id,effect) DO NOTHING — KHÔNG ghi đè.
      await direct.query(
        `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
         SELECT r.id, p.id, 'ALLOW', 'Own'
           FROM roles r CROSS JOIN permissions p
          WHERE r.name='hr' AND r.company_id IS NULL
            AND p.action='manage' AND p.resource_type='master-data'
         ON CONFLICT (role_id, permission_id, effect) DO NOTHING`,
      );
      const after = await snapshot();
      expect(after, "re-apply ON CONFLICT KHÔNG được drift scope (bộ-ba bất biến)").toBe(before);
      expect(after, "hr manage:master-data vẫn = Company (KHÔNG bị Own ghi đè)").toContain(
        "hr|manage:master-data|Company",
      );
    });

    // ── G. company-admin grant media/foundation parked còn nguyên (KHÔNG blanket DELETE) ──
    it("G. company-admin grant parked (foundation-*/channel/project/content) còn nguyên", async () => {
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
