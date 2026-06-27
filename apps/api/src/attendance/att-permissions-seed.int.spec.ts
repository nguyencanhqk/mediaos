/**
 * S3-ATT-SEED-1 (PART A) — ATT permission catalog + role→data_scope grants (mig 0454).
 *
 * Colocated trong src/attendance → vitest gom qua include glob `src/**\/*.spec.ts` (file kết .spec.ts).
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env trỏ DB dev chung làm hasDb=true
 * ⇒ assertion chạm DB chung = đỏ-giả; CHỈ chạy trên DB cô lập lane.
 *
 * RED-before-GREEN: trên DB migrate đến 0453, 33 cặp ATT + grant THIẾU ⇒ ĐỎ. Sau 0454 → GREEN.
 *
 * Phủ: (A) 33 cặp catalog đúng is_sensitive · (B) grant per-pair = ma trận WO (đủ 93 hàng + scope) ·
 *   (C) DENY: ô trống KHÔNG có grant — đặc biệt manager KHÔNG shift/shift-assignment/attendance-rule/
 *   attendance-audit-log (bug đã block 3×) · (D) idempotent bộ-ba (ON CONFLICT DO NOTHING không drift).
 */

import { afterAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import { ATT_PERMISSIONS, ATT_PERMISSION_COUNT } from "./attendance-permissions.const";

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

type Scope = "Own" | "Team" | "Department" | "Company" | "System";

/** 1 hàng ma trận WO: scope per role (undefined = KHÔNG grant). */
interface MatrixRow {
  action: string;
  resource: string;
  emp?: Scope;
  mgr?: Scope;
  hr?: Scope;
  ca?: Scope;
}

// Ma trận grant WO (action·resource | employee | manager | hr | company-admin). "—" = undefined.
const MATRIX: MatrixRow[] = [
  { action: "check-in", resource: "attendance", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  { action: "check-out", resource: "attendance", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  { action: "view-own", resource: "attendance", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  { action: "view-team", resource: "attendance", mgr: "Team", hr: "Team", ca: "Team" },
  { action: "view-company", resource: "attendance", hr: "Company", ca: "Company" },
  {
    action: "view-detail",
    resource: "attendance",
    emp: "Own",
    mgr: "Team",
    hr: "Company",
    ca: "Company",
  },
  { action: "view-sensitive", resource: "attendance", hr: "Company", ca: "Company" },
  { action: "adjust-direct", resource: "attendance", hr: "Company", ca: "Company" },
  { action: "recalculate", resource: "attendance", hr: "Company", ca: "Company" },
  { action: "export", resource: "attendance", hr: "Company", ca: "Company" },
  { action: "create-own", resource: "adjustment", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  { action: "view-own", resource: "adjustment", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  { action: "view-team", resource: "adjustment", mgr: "Team", hr: "Team", ca: "Team" },
  { action: "view-company", resource: "adjustment", hr: "Company", ca: "Company" },
  { action: "approve", resource: "adjustment", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "reject", resource: "adjustment", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "cancel-own", resource: "adjustment", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  {
    action: "create-own",
    resource: "remote-request",
    emp: "Own",
    mgr: "Own",
    hr: "Own",
    ca: "Own",
  },
  { action: "view-own", resource: "remote-request", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  { action: "view-team", resource: "remote-request", mgr: "Team", hr: "Team", ca: "Team" },
  { action: "view-company", resource: "remote-request", hr: "Company", ca: "Company" },
  { action: "approve", resource: "remote-request", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "reject", resource: "remote-request", mgr: "Team", hr: "Company", ca: "Company" },
  {
    action: "cancel-own",
    resource: "remote-request",
    emp: "Own",
    mgr: "Own",
    hr: "Own",
    ca: "Own",
  },
  { action: "view", resource: "shift", hr: "Company", ca: "Company" },
  { action: "create", resource: "shift", hr: "Company", ca: "Company" },
  { action: "update", resource: "shift", hr: "Company", ca: "Company" },
  { action: "delete", resource: "shift", hr: "Company", ca: "Company" },
  { action: "view", resource: "shift-assignment", hr: "Company", ca: "Company" },
  { action: "update", resource: "shift-assignment", hr: "Company", ca: "Company" },
  { action: "view", resource: "attendance-rule", hr: "Company", ca: "Company" },
  { action: "config", resource: "attendance-rule", hr: "Company", ca: "Company" },
  { action: "view", resource: "attendance-audit-log", hr: "Company", ca: "Company" },
];

const ROLE_BY_KEY: Record<"emp" | "mgr" | "hr" | "ca", string> = {
  emp: "employee",
  mgr: "manager",
  hr: "hr",
  ca: "company-admin",
};

/** scope đã grant cho (role, action, resource); null nếu KHÔNG có hàng ALLOW. */
async function grantScope(
  direct: ReturnType<typeof directPool>,
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

describe.skipIf(!runIsolatedDb)(
  "S3-ATT-SEED-1 ATT permission catalog + grants (mig 0454, DB cô lập LANE_DB)",
  () => {
    const direct = directPool();

    afterAll(async () => {
      await direct.end();
    });

    // ── A. Catalog: đủ 33 cặp với is_sensitive đúng ──────────────────────────────
    describe("A. Catalog 33 cặp (action, resource_type)", () => {
      it("pin: ATT_PERMISSIONS có đúng 33 cặp", () => {
        expect(ATT_PERMISSION_COUNT).toBe(33);
        expect(ATT_PERMISSIONS.length).toBe(33);
      });

      for (const p of ATT_PERMISSIONS) {
        it(`(${p.action}:${p.resourceType}) tồn tại, is_sensitive=${p.sensitive}`, async () => {
          const res = await direct.query<{ is_sensitive: boolean }>(
            `SELECT is_sensitive FROM permissions WHERE action=$1 AND resource_type=$2`,
            [p.action, p.resourceType],
          );
          expect(res.rows.length, `cặp (${p.action}:${p.resourceType}) phải có sau 0454`).toBe(1);
          expect(res.rows[0].is_sensitive).toBe(p.sensitive);
        });
      }
    });

    // ── B. Grant per-pair = ma trận WO (mọi ô có giá trị) ────────────────────────
    describe("B. Role→data_scope grants = ma trận WO", () => {
      for (const row of MATRIX) {
        for (const key of ["emp", "mgr", "hr", "ca"] as const) {
          const expected = row[key];
          if (!expected) continue;
          const role = ROLE_BY_KEY[key];
          it(`${role} (${row.action}:${row.resource}) = ${expected}`, async () => {
            expect(await grantScope(direct, role, row.action, row.resource)).toBe(expected);
          });
        }
      }
    });

    // ── C. DENY: ô trống KHÔNG có grant (least-privilege) ────────────────────────
    describe("C. DENY ô trống — manager KHÔNG shift/rule/audit (bug block 3×)", () => {
      for (const row of MATRIX) {
        for (const key of ["emp", "mgr", "hr", "ca"] as const) {
          if (row[key]) continue;
          const role = ROLE_BY_KEY[key];
          it(`${role} KHÔNG có grant (${row.action}:${row.resource})`, async () => {
            expect(await grantScope(direct, role, row.action, row.resource)).toBeNull();
          });
        }
      }

      it("manager KHÔNG grant nào trên shift/shift-assignment/attendance-rule/attendance-audit-log", async () => {
        const res = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name='manager' AND r.company_id IS NULL
              AND p.resource_type IN ('shift','shift-assignment','attendance-rule','attendance-audit-log')`,
        );
        expect(res.rows[0].n, "manager least-privilege: 0 grant cấu hình/audit ATT").toBe(0);
      });
    });

    // ── D. Idempotent bộ-ba (ON CONFLICT DO NOTHING KHÔNG drift scope) ───────────
    it("D. Idempotent (triple): re-apply seed INSERT ON CONFLICT KHÔNG đổi scope", async () => {
      const snapshot = async () =>
        (
          await direct.query<{ k: string }>(
            `SELECT r.name || '|' || p.action || ':' || p.resource_type || '|' || rp.data_scope AS k
               FROM role_permissions rp
               JOIN roles r ON r.id = rp.role_id
               JOIN permissions p ON p.id = rp.permission_id
              WHERE r.name = ANY($1) AND r.company_id IS NULL AND rp.effect='ALLOW'
                AND p.resource_type IN ('attendance','adjustment','remote-request','shift',
                                        'shift-assignment','attendance-rule','attendance-audit-log')
              ORDER BY k`,
            [["employee", "manager", "hr", "company-admin"]],
          )
        ).rows
          .map((x) => x.k)
          .join("\n");

      const before = await snapshot();
      // Re-apply 3× mô phỏng migrator chạy lại: ON CONFLICT(role_id,permission_id,effect) DO NOTHING
      // với scope CỐ Ý SAI ('System') — KHÔNG được ghi đè scope đã seed (bộ-ba bất biến).
      for (let i = 0; i < 3; i++) {
        await direct.query(
          `INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
           SELECT r.id, p.id, 'ALLOW', 'System'
             FROM roles r CROSS JOIN permissions p
            WHERE r.name='employee' AND r.company_id IS NULL
              AND p.action='check-in' AND p.resource_type='attendance'
           ON CONFLICT (role_id, permission_id, effect) DO NOTHING`,
        );
      }
      const after = await snapshot();
      expect(after, "re-apply ON CONFLICT KHÔNG drift scope").toBe(before);
      expect(after).toContain("employee|check-in:attendance|Own");
    });
  },
);
