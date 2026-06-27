/**
 * S3-LEAVE-SEED-1 (PART A) — LEAVE permission catalog + role→data_scope grants (mig 0455).
 *
 * Colocated trong src/leave → vitest gom qua include glob `src/**\/*.spec.ts` (file kết .spec.ts).
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env trỏ DB dev chung làm hasDb=true
 * ⇒ assertion chạm DB chung = đỏ-giả; CHỈ chạy trên DB cô lập lane.
 *
 * RED-before-GREEN: trên DB migrate đến 0454, 30 cặp LEAVE + grant THIẾU ⇒ ĐỎ. Sau 0455 → GREEN.
 *
 * Phủ: (A) 30 cặp catalog tồn tại + is_sensitive đúng (loop, KHÔNG count===N — permissions là catalog
 *   toàn hệ có cả AUTH/HR/ATT) · (B) grant per-pair = ma trận WO (83 hàng + scope) · (C) DENY: ô trống
 *   KHÔNG có grant — đặc biệt manager KHÔNG leave-policy/leave-balance/leave-audit-log/leave-file ·
 *   (D) idempotent bộ-ba (ON CONFLICT DO NOTHING không drift scope).
 */

import { afterAll, describe, expect, it } from "vitest";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import { LEAVE_PERMISSIONS, LEAVE_PERMISSION_COUNT } from "./leave-permissions.const";

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

// Ma trận grant WO (action·resource | employee | manager | hr | company-admin). "—" = undefined. 83 cell.
const MATRIX: MatrixRow[] = [
  // leave
  { action: "view-own", resource: "leave", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  { action: "create", resource: "leave", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  { action: "submit", resource: "leave", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  { action: "update-draft", resource: "leave", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  { action: "cancel-own", resource: "leave", emp: "Own", mgr: "Own", hr: "Own", ca: "Own" },
  { action: "view", resource: "leave", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "approve", resource: "leave", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "reject", resource: "leave", mgr: "Team", hr: "Company", ca: "Company" },
  { action: "cancel-any", resource: "leave", hr: "Company", ca: "Company" },
  { action: "revoke", resource: "leave", hr: "Company", ca: "Company" },
  { action: "export", resource: "leave", hr: "Company", ca: "Company" },
  // leave-balance
  {
    action: "view-own",
    resource: "leave-balance",
    emp: "Own",
    mgr: "Own",
    hr: "Own",
    ca: "Own",
  },
  { action: "view", resource: "leave-balance", hr: "Company", ca: "Company" },
  { action: "view-transaction", resource: "leave-balance", hr: "Company", ca: "Company" },
  { action: "adjust", resource: "leave-balance", hr: "Company", ca: "Company" },
  // leave-calendar
  {
    action: "view-own",
    resource: "leave-calendar",
    emp: "Own",
    mgr: "Own",
    hr: "Own",
    ca: "Own",
  },
  // CA capped at Team for view-team (NOT Company)
  { action: "view-team", resource: "leave-calendar", mgr: "Team", hr: "Team", ca: "Team" },
  { action: "view-company", resource: "leave-calendar", hr: "Company", ca: "Company" },
  // leave-type (all 4 read types)
  {
    action: "view",
    resource: "leave-type",
    emp: "Company",
    mgr: "Company",
    hr: "Company",
    ca: "Company",
  },
  { action: "create", resource: "leave-type", hr: "Company", ca: "Company" },
  { action: "update", resource: "leave-type", hr: "Company", ca: "Company" },
  { action: "delete", resource: "leave-type", hr: "Company", ca: "Company" },
  // leave-policy
  { action: "view", resource: "leave-policy", hr: "Company", ca: "Company" },
  { action: "create", resource: "leave-policy", hr: "Company", ca: "Company" },
  { action: "update", resource: "leave-policy", hr: "Company", ca: "Company" },
  { action: "delete", resource: "leave-policy", hr: "Company", ca: "Company" },
  // leave-file (employee Own; manager NONE)
  { action: "view", resource: "leave-file", emp: "Own", hr: "Company", ca: "Company" },
  { action: "upload", resource: "leave-file", emp: "Own", hr: "Company", ca: "Company" },
  { action: "delete", resource: "leave-file", emp: "Own", hr: "Company", ca: "Company" },
  // leave-audit-log
  { action: "view", resource: "leave-audit-log", hr: "Company", ca: "Company" },
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
  "S3-LEAVE-SEED-1 LEAVE permission catalog + grants (mig 0455, DB cô lập LANE_DB)",
  () => {
    const direct = directPool();

    afterAll(async () => {
      await direct.end();
    });

    // ── A. Catalog: đủ 30 cặp với is_sensitive đúng (loop, KHÔNG count toàn bảng) ──
    describe("A. Catalog 30 cặp (action, resource_type)", () => {
      it("pin: LEAVE_PERMISSIONS có đúng 30 cặp", () => {
        expect(LEAVE_PERMISSION_COUNT).toBe(30);
        expect(LEAVE_PERMISSIONS.length).toBe(30);
      });

      for (const p of LEAVE_PERMISSIONS) {
        it(`(${p.action}:${p.resourceType}) tồn tại, is_sensitive=${p.sensitive}`, async () => {
          const res = await direct.query<{ is_sensitive: boolean }>(
            `SELECT is_sensitive FROM permissions WHERE action=$1 AND resource_type=$2`,
            [p.action, p.resourceType],
          );
          expect(res.rows.length, `cặp (${p.action}:${p.resourceType}) phải có sau 0455`).toBe(1);
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
    describe("C. DENY ô trống — manager KHÔNG policy/balance/audit/file", () => {
      for (const row of MATRIX) {
        for (const key of ["emp", "mgr", "hr", "ca"] as const) {
          if (row[key]) continue;
          const role = ROLE_BY_KEY[key];
          it(`${role} KHÔNG có grant (${row.action}:${row.resource})`, async () => {
            expect(await grantScope(direct, role, row.action, row.resource)).toBeNull();
          });
        }
      }

      it("manager KHÔNG grant nào trên leave-policy/leave-audit-log/leave-file (admin-only)", async () => {
        const res = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name='manager' AND r.company_id IS NULL
              AND p.resource_type IN ('leave-policy','leave-audit-log','leave-file')`,
        );
        expect(res.rows[0].n, "manager least-privilege: 0 grant policy/audit/file LEAVE").toBe(0);
      });

      // leave-balance: self-service view-own (Own) ĐƯỢC phép cho mọi role (mirror view-own:leave /
      // view-own:leave-calendar) — least-privilege chỉ chặn ADMIN balance (view/view-transaction/adjust).
      it("manager KHÔNG có grant ADMIN trên leave-balance (chỉ self-service view-own:Own)", async () => {
        const admin = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name='manager' AND r.company_id IS NULL
              AND p.resource_type='leave-balance'
              AND p.action IN ('view','view-transaction','adjust')`,
        );
        expect(admin.rows[0].n, "manager: 0 grant ADMIN trên leave-balance").toBe(0);

        // Grant DUY NHẤT của manager trên leave-balance = view-own/Own (self-service).
        const all = await direct.query<{ action: string; data_scope: string }>(
          `SELECT p.action, rp.data_scope
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name='manager' AND r.company_id IS NULL
              AND p.resource_type='leave-balance' AND rp.effect='ALLOW'`,
        );
        expect(all.rows).toEqual([{ action: "view-own", data_scope: "Own" }]);
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
                AND p.resource_type IN ('leave','leave-type','leave-policy','leave-balance',
                                        'leave-calendar','leave-file','leave-audit-log')
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
              AND p.action='view-own' AND p.resource_type='leave'
           ON CONFLICT (role_id, permission_id, effect) DO NOTHING`,
        );
      }
      const after = await snapshot();
      expect(after, "re-apply ON CONFLICT KHÔNG drift scope").toBe(before);
      expect(after).toContain("employee|view-own:leave|Own");
    });
  },
);
