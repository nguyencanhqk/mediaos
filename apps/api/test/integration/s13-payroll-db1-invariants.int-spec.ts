import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DASH_CANONICAL_ROLES } from "../../src/dashboard/dashboard-widget-catalog.const";
import { NOTI_CANONICAL_ROLES } from "../../src/foundation/seed/notification-event-catalog.const";
import { appPool, directPool, hasDb, workerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S13-PAYROLL-DB-1 (mig 0564 · 0565 · 0566) — CHỐT HỒI QUY cho nền dữ liệu PAYROLL
 * (DB-13 §5/§6/§10 · SPEC-11 §11/§13/§17/§18 · permission-matrix §9g).
 *
 * VÌ SAO FILE NÀY TỒN TẠI. Ba migration tự verify bằng khối DO/RAISE EXCEPTION, nhưng verify đó chỉ chạy ĐÚNG
 * MỘT LẦN lúc migrate — nó KHÔNG phải cổng đứng. Sau khi merge, một WO sau `GRANT UPDATE ON payslips`,
 * grant `('approve','payroll-period')` cho `payroll-officer` (phá four-eyes), flip `is_sensitive` của
 * `view-line` về false (mở đường wildcard `*:*`), hay DROP trigger `bonus_penalty_freeze_guard` — KHÔNG có gì
 * đỏ: tenant-isolation/rls-registry không phủ GRANT-per-bảng, xtenant-fk-ratchet chỉ phủ HÌNH DẠNG FK.
 * (mirror `s12-recruit-db1-invariants.int-spec.ts`; memory `reviewers-pass-real-bugs`,
 * `tests-can-pin-a-hole-open`, `canonical-seed-pin-regression`.)
 *
 * NƠI CHẠY: gate `hasDb`, KHÔNG gate `LANE_DB` — chạy THẬT trên CI.
 *
 * QUY TẮC: ma trận quyền so **SET-EQUALITY** (không chỉ đếm — đếm đúng mà sai người vẫn xanh); mọi ca ÂM có
 * ĐỐI CHỨNG DƯƠNG (`deny-cases-vacuous-without-allow-case`); mọi mutation trong tx ROLLBACK.
 */

/** Ma trận §9g — literal chép từ 0565, CỐ Ý không import (import lại chính nguồn là tautology). */
const EXPECTED_32: Array<[string, string, string, string]> = [
  ["employee", "access", "payroll", "Own"],
  ["employee", "view-own-payslip", "payslip", "Own"],
  ["employee", "acknowledge-own-payslip", "payslip", "Own"],
  ...(["payroll-officer", "company-admin"] as const).flatMap(
    (role): Array<[string, string, string, string]> => [
      [role, "access", "payroll", "Own"],
      [role, "view", "payroll-period", "Company"],
      [role, "manage", "payroll-period", "Company"],
      [role, "view-line", "payroll-period", "Company"],
      [role, "calculate", "payroll-period", "Company"],
      [role, "publish", "payroll-period", "Company"],
      [role, "reopen", "payroll-period", "Company"],
      [role, "view", "salary-profile", "Company"],
      [role, "manage", "salary-profile", "Company"],
      [role, "view", "bonus-penalty", "Company"],
      [role, "manage", "bonus-penalty", "Company"],
      [role, "approve", "bonus-penalty", "Company"],
      [role, "export", "payroll", "Company"],
      [role, "view-payslip", "payslip", "Company"],
    ],
  ),
  // four-eyes (PAY-DEC-007): CHỈ company-admin giữ cặp duyệt bảng lương. payroll-officer KHÔNG.
  ["company-admin", "approve", "payroll-period", "Company"],
];

/** 13 cặp is_sensitive=true (SPEC-11 §11.1). 4 cặp còn lại false. */
const SENSITIVE_13: Array<[string, string]> = [
  ["view-line", "payroll-period"],
  ["calculate", "payroll-period"],
  ["approve", "payroll-period"],
  ["publish", "payroll-period"],
  ["reopen", "payroll-period"],
  ["view", "salary-profile"],
  ["manage", "salary-profile"],
  ["view", "bonus-penalty"],
  ["manage", "bonus-penalty"],
  ["approve", "bonus-penalty"],
  ["export", "payroll"],
  ["view-payslip", "payslip"],
  ["view-own-payslip", "payslip"],
];

const NON_SENSITIVE_4: Array<[string, string]> = [
  ["access", "payroll"],
  ["view", "payroll-period"],
  ["manage", "payroll-period"],
  ["acknowledge-own-payslip", "payslip"],
];

/** 16 cặp di sản bị GỠ (§9g.1). Còn sống ở BẤT KỲ tầng nào là lỗ quyền lương. */
const LEGACY_REMOVED_16: Array<[string, string]> = [
  ["create", "payslip"],
  ["read", "payslip"],
  ["update", "payslip"],
  ["delete", "payslip"],
  ["view-salary", "payslip"],
  ["read-payslip", "payslip"],
  ["resolve-payslip-dispute", "payslip"],
  ["view-salary-profile", "salary_profile"],
  ["manage-salary-profile", "salary_profile"],
  ["manage-payroll-period", "payroll_period"],
  ["run-payroll", "payroll_period"],
  ["approve-payroll-period", "payroll_period"],
  ["publish-payroll-period", "payroll_period"],
  ["manage-bonus-penalty", "bonus_penalty"],
  ["approve-bonus-penalty", "bonus_penalty"],
  ["view-bonus-penalty", "bonus_penalty"],
];

const PAYROLL_TABLES = [
  "salary_profiles",
  "payroll_periods",
  "payroll_period_lines",
  "payslips",
  "payslip_items",
  "bonus_penalties",
  "payslip_acknowledgements",
] as const;

/** 3 sổ chỉ-INSERT — app role KHÔNG được UPDATE/DELETE (bất biến #2). */
const INSERT_ONLY_TABLES = ["payslips", "payslip_items", "payslip_acknowledgements"] as const;

describe.skipIf(!hasDb)("S13-PAYROLL-DB-1 · bất biến nền dữ liệu PAYROLL (mig 0564–0566)", () => {
  const direct = directPool();
  const app = appPool(3);
  const worker = workerPool(1);

  let A: SeededTenant;
  let B: SeededTenant;
  let uA: string;
  let uA2: string;
  let periodA: string;
  let periodB: string;

  async function asApp<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const out = await fn(c);
      await c.query("ROLLBACK");
      return out;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    A = await seedCompany(direct, "s13pa");
    B = await seedCompany(direct, "s13pb");
    uA = await seedUser(direct, A.companyId, `s13a-${randomUUID().slice(0, 8)}@a.test`);
    uA2 = await seedUser(direct, A.companyId, `s13a2-${randomUUID().slice(0, 8)}@a.test`);
    // tenant B chỉ cần TỒN TẠI kỳ lương để ca A3 trỏ chéo — không cần user riêng.
    const pa = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status) VALUES ($1,'2026-09','Draft') RETURNING id`,
      [A.companyId],
    );
    periodA = pa.rows[0].id as string;
    const pb = await direct.query(
      `INSERT INTO payroll_periods (company_id, period_month, status) VALUES ($1,'2026-09','Draft') RETURNING id`,
      [B.companyId],
    );
    periodB = pb.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
    await app.end();
    await worker.end();
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // A. Bất biến #1 — RLS + FORCE + cô lập tenant
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("A. RLS / cô lập tenant", () => {
    it("A1 cả 7 bảng có RLS ENABLE + FORCE + policy tenant_isolation", async () => {
      const { rows } = await direct.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        npolicy: string;
      }>(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*)::text FROM pg_policies p
                  WHERE p.schemaname='public' AND p.tablename=c.relname AND p.policyname='tenant_isolation') AS npolicy
           FROM pg_class c WHERE c.relname = ANY($1::text[])`,
        [[...PAYROLL_TABLES]],
      );
      expect(rows).toHaveLength(PAYROLL_TABLES.length);
      for (const r of rows) {
        expect(`${r.relname}:rls`, `${r.relname} thiếu ENABLE RLS`).toBe(`${r.relname}:rls`);
        expect(r.relrowsecurity, `${r.relname} thiếu ENABLE ROW LEVEL SECURITY`).toBe(true);
        expect(r.relforcerowsecurity, `${r.relname} thiếu FORCE ROW LEVEL SECURITY`).toBe(true);
        expect(r.npolicy, `${r.relname} thiếu policy tenant_isolation`).toBe("1");
      }
    });

    it("A2 ĐỐI CHỨNG DƯƠNG: INSERT payroll_period_lines đúng tenant đi qua", async () => {
      const id = await asApp(A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO payroll_period_lines (payroll_period_id, user_id, input_snapshot_json)
           VALUES ($1, $2, '{"workDays":22}'::jsonb) RETURNING id`,
          [periodA, uA],
        );
        return r.rows[0].id as string;
      });
      expect(id).toBeTruthy();
    });

    it("A3 ghi CHÉO TENANT vào payroll_period_lines bị chặn (composite tenant FK / RLS)", async () => {
      // Trong ngữ cảnh tenant A, trỏ vào kỳ của B: composite FK (company_id, payroll_period_id) không khớp.
      await expect(
        asApp(A.companyId, async (c) => {
          await c.query(
            `INSERT INTO payroll_period_lines (payroll_period_id, user_id, input_snapshot_json)
             VALUES ($1, $2, '{"workDays":22}'::jsonb)`,
            [periodB, uA],
          );
        }),
      ).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // B. Bất biến #2 — append-only / không hard-delete
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("B. append-only / GRANT", () => {
    it.each(INSERT_ONLY_TABLES)(
      "B1 %s: app role có 0 quyền UPDATE/DELETE (đọc CẢ relacl LẪN attacl)",
      async (tbl) => {
        // aclexplode, KHÔNG information_schema.column_privileges — column-GRANT là đường lách đã có tiền lệ.
        const { rows } = await direct.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM (
             SELECT x.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
              WHERE c.oid = $1::regclass AND x.grantee = 'mediaos_app'::regrole
                AND x.privilege_type IN ('UPDATE','DELETE')
             UNION ALL
             SELECT x.privilege_type FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
              WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
                AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type IN ('UPDATE','DELETE')
           ) z`,
          [tbl],
        );
        expect(rows[0].n).toBe("0");
      },
    );

    it.each(PAYROLL_TABLES)("B2 %s: app role KHÔNG có GRANT DELETE (soft delete)", async (tbl) => {
      const { rows } = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
          WHERE c.oid = $1::regclass AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type = 'DELETE'`,
        [tbl],
      );
      expect(rows[0].n).toBe("0");
    });

    it("B3 ĐỐI CHỨNG DƯƠNG: app role VẪN INSERT được payslips (kẻo B1/B2 xanh-rỗng)", async () => {
      const id = await asApp(A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO payslips
             (payroll_period_id, user_id, base_salary, gross, net, created_by, input_snapshot_json)
           VALUES ($1, $2, 100.00, 100.00, 100.00, $2, '{"workDays":1}'::jsonb) RETURNING id`,
          [periodA, uA2],
        );
        return r.rows[0].id as string;
      });
      expect(id).toBeTruthy();
    });

    it("B4 mediaos_worker: 0 quyền trên payroll_period_lines, 0 SELECT trên 3 bảng chở tiền", async () => {
      // DB-13 §4.3 (M7): PAYROLL v1 KHÔNG có system job đọc bảng lương (0 route, 0 handler).
      const { rows } = await direct.query<{ relname: string; privs: string | null }>(
        `SELECT c.relname,
                (SELECT string_agg(DISTINCT x.privilege_type, ',' ORDER BY x.privilege_type)
                   FROM aclexplode(c.relacl) x WHERE x.grantee = 'mediaos_worker'::regrole) AS privs
           FROM pg_class c WHERE c.relname = ANY($1::text[])`,
        [["payroll_period_lines", "salary_profiles", "payslips", "payslip_items"]],
      );
      for (const r of rows) {
        expect(r.privs, `mediaos_worker KHÔNG được có quyền trên ${r.relname}`).toBeNull();
      }
    });

    it("B5 ĐỐI CHỨNG DƯƠNG: worker VẪN còn SELECT trên payroll_periods/bonus_penalties (thu hồi không quá tay)", async () => {
      const { rows } = await direct.query<{ relname: string; privs: string | null }>(
        `SELECT c.relname,
                (SELECT string_agg(DISTINCT x.privilege_type, ',' ORDER BY x.privilege_type)
                   FROM aclexplode(c.relacl) x WHERE x.grantee = 'mediaos_worker'::regrole) AS privs
           FROM pg_class c WHERE c.relname = ANY($1::text[])`,
        [["payroll_periods", "bonus_penalties", "payslip_acknowledgements"]],
      );
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect(r.privs, `worker mất SELECT trên ${r.relname}`).toBe("SELECT");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // C. Chốt cuối ở DB — CHECK / UNIQUE / trigger
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("C. CHECK · UNIQUE · trigger", () => {
    it("C1 CHECK four-eyes: approved_by = submitted_by bị chặn (PAY-DEC-007)", async () => {
      await expect(
        direct.query(
          `INSERT INTO payroll_periods
             (company_id, period_month, status, attendance_period_id, submitted_by, approved_by, approved_at)
           VALUES ($1, '2026-10', 'Draft', NULL, $2, $2, now())`,
          [A.companyId, uA],
        ),
      ).rejects.toMatchObject({ constraint: "payroll_periods_four_eyes_check" });
    });

    it("C2 ĐỐI CHỨNG DƯƠNG four-eyes: hai người KHÁC nhau đi qua", async () => {
      const c = await direct.connect();
      try {
        await c.query("BEGIN");
        const r = await c.query(
          `INSERT INTO payroll_periods
             (company_id, period_month, status, submitted_by, approved_by, approved_at)
           VALUES ($1, '2026-11', 'Draft', $2, $3, now()) RETURNING id`,
          [A.companyId, uA, uA2],
        );
        expect(r.rows[0].id).toBeTruthy();
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });

    it("C3 CHECK status kỳ lương: 7 giá trị PascalCase; 'draft' di sản bị từ chối", async () => {
      // ⚠️ Hàng phải vi phạm ĐÚNG MỘT constraint: 'draft' không thuộc ('Draft','CollectingData') nên
      // `calculated_needs_attendance_check` cũng vỡ nếu attendance_period_id NULL, và PG báo CHECK TUỲ Ý
      // (pg-reports-arbitrary-check-when-multiple-violated) ⇒ gắn kỳ công thật để chỉ còn status là vế sai.
      const att = await direct.query<{ id: string }>(
        `INSERT INTO attendance_periods (company_id, period_month, status)
         VALUES ($1, '2026-12', 'open') RETURNING id`,
        [A.companyId],
      );
      await expect(
        direct.query(
          `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id)
           VALUES ($1,'2026-12','draft',$2)`,
          [A.companyId, att.rows[0].id],
        ),
      ).rejects.toMatchObject({ constraint: "payroll_periods_status_check" });
    });

    it("C4 CHECK kỳ đã tính PHẢI có nguồn công (calculated_needs_attendance)", async () => {
      await expect(
        direct.query(
          `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id)
           VALUES ($1,'2026-07','Calculated',NULL)`,
          [A.companyId],
        ),
      ).rejects.toMatchObject({
        constraint: "payroll_periods_calculated_needs_attendance_check",
      });
    });

    it("C5 CHECK cặp cờ đã-sinh-phiếu (payslips_generated_by ↔ _at)", async () => {
      await expect(
        direct.query(
          `INSERT INTO payroll_periods (company_id, period_month, status, payslips_generated_by)
           VALUES ($1,'2026-06','Draft',$2)`,
          [A.companyId, uA],
        ),
      ).rejects.toMatchObject({ constraint: "payroll_periods_generated_pair_check" });
    });

    it("C6 payroll_period_lines: UNIQUE là PARTIAL WHERE deleted_at IS NULL (tính lại phải upsert được)", async () => {
      const { rows } = await direct.query<{ pred: string | null; isunique: boolean }>(
        `SELECT pg_get_expr(i.indpred, i.indrelid) AS pred, i.indisunique AS isunique
           FROM pg_class ic JOIN pg_index i ON i.indexrelid = ic.oid
          WHERE ic.relname = 'payroll_period_lines_period_user_uq'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].isunique).toBe(true);
      // Unique THẲNG ở đây sẽ nổ 23505 ở lần tính thứ hai (dòng cũ xoá mềm vẫn chiếm khoá).
      expect(rows[0].pred).toBe("(deleted_at IS NULL)");
    });

    it("C7 payslips: UNIQUE THẲNG (company, kỳ, người) — chống sinh phiếu hai lần", async () => {
      const { rows } = await direct.query<{ pred: string | null }>(
        `SELECT pg_get_expr(i.indpred, i.indrelid) AS pred
           FROM pg_class ic JOIN pg_index i ON i.indexrelid = ic.oid
          WHERE ic.relname = 'payslips_period_user_uq' AND i.indisunique`,
      );
      expect(rows).toHaveLength(1);
      // Partial ở đây là lỗ: phiếu append-only, không có đường xoá để sinh lại.
      expect(rows[0].pred).toBeNull();
    });

    it("C8 ba trigger FSM di sản đã biến mất; trigger HẸP bonus_penalty_freeze_guard còn sống", async () => {
      const { rows } = await direct.query<{ tgname: string }>(
        `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND c.relname = ANY($1::text[]) ORDER BY t.tgname`,
        [[...PAYROLL_TABLES]],
      );
      const names = rows.map((r) => r.tgname);
      // Ba trigger cũ ép FSM chữ thường ⇒ giữ lại là chặn oan mọi chuyển tiếp mới.
      expect(names).not.toContain("payroll_period_status_guard");
      expect(names).not.toContain("bonus_penalty_guard");
      expect(names).not.toContain("payslip_ack_status_guard");
      // Nhưng bất biến TIỀN thì KHÔNG được gỡ trắng — CHECK không so được OLD/NEW.
      expect(names).toContain("bonus_penalty_freeze_guard");
    });

    it("C9 20 cột di sản đã biến mất khỏi 6 bảng (DROP COLUMN im lặng là lớp lỗi chính)", async () => {
      const gone: Array<[string, string]> = [
        ["salary_profiles", "salary_type"],
        ["salary_profiles", "pay_cycle"],
        ["salary_profiles", "currency"],
        ["salary_profiles", "status"],
        ["payroll_periods", "kpi_locked"],
        ["payslips", "entry_kind"],
        ["payslips", "replaces_payslip_id"],
        ["payslips", "kpi_amount"],
        ["payslips", "currency"],
        ["bonus_penalties", "source"],
        ["bonus_penalties", "reference_type"],
        ["bonus_penalties", "task_id"],
        ["bonus_penalties", "kpi_result_id"],
        ["bonus_penalties", "currency"],
        ["payslip_acknowledgements", "status"],
        ["payslip_acknowledgements", "reason"],
        ["payslip_acknowledgements", "resolved_by"],
        ["payslip_acknowledgements", "resolved_at"],
        ["payslip_acknowledgements", "resolution_note"],
        ["payslip_acknowledgements", "updated_at"],
      ];
      expect(gone).toHaveLength(20);
      const { rows } = await direct.query<{ tbl: string; col: string }>(
        `SELECT c.relname AS tbl, a.attname AS col
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
          WHERE c.relname = ANY($1::text[]) AND a.attnum > 0 AND NOT a.attisdropped`,
        [[...PAYROLL_TABLES]],
      );
      const present = new Set(rows.map((r) => `${r.tbl}.${r.col}`));
      const survivors = gone.filter(([t, c]) => present.has(`${t}.${c}`));
      expect(survivors, "cột di sản lẽ ra phải biến mất").toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // D. Seed quyền §9g — set-equality + wildcard + role
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("D. seed quyền / role", () => {
    it("D1 ma trận grant PAYROLL = ĐÚNG 32 bộ (role, action, resource, scope) — SET-EQUALITY", async () => {
      // Đếm đúng mà SAI NGƯỜI vẫn xanh ⇒ phải so từng bộ.
      const { rows } = await direct.query<{
        role: string;
        action: string;
        resource_type: string;
        data_scope: string;
      }>(
        `SELECT r.name AS role, p.action, p.resource_type, rp.data_scope
           FROM role_permissions rp
           JOIN roles r       ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE p.resource_type IN ('payroll','payroll-period','salary-profile','bonus-penalty','payslip')`,
      );
      const actual = rows
        .map((r) => `${r.role}|${r.action}|${r.resource_type}|${r.data_scope}`)
        .sort();
      const expected = EXPECTED_32.map((g) => g.join("|")).sort();
      expect(expected).toHaveLength(32);
      expect(actual).toEqual(expected);
    });

    it("D2 hr-manager / hr / manager = 0 cặp PAYROLL trên CẢ BA bảng (DECISIONS-01 Phương án B)", async () => {
      const { rows } = await direct.query<{ role: string; src: string }>(
        `SELECT r.name AS role, 'role_permissions' AS src
           FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name IN ('hr-manager','hr','manager') AND r.company_id IS NULL
            AND p.resource_type IN ('payroll','payroll-period','salary-profile','bonus-penalty','payslip')
         UNION ALL
         SELECT r.name, 'object_permissions'
           FROM object_permissions op JOIN roles r ON r.id = op.subject_id
           JOIN permissions p ON p.id = op.permission_id
          WHERE r.name IN ('hr-manager','hr','manager') AND r.company_id IS NULL
            AND p.resource_type IN ('payroll','payroll-period','salary-profile','bonus-penalty','payslip')`,
      );
      expect(rows).toEqual([]);
    });

    it("D3 cặp HR domain ('view-salary','employee') KHÔNG bị đụng — khác domain, thuộc SPEC-03", async () => {
      // Đối chứng DƯƠNG cho D2: nếu ai đó dọn quá tay sang masking hồ sơ nhân sự thì ca này đỏ.
      const { rows } = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = 'hr-manager' AND r.company_id IS NULL
            AND p.action = 'view-salary' AND p.resource_type = 'employee'`,
      );
      expect(rows[0].n).toBe("1");
    });

    it("D4 16 cặp di sản = 0 hàng ở CẢ BA bảng permissions/role_permissions/object_permissions", async () => {
      const { rows } = await direct.query<{ action: string; resource_type: string }>(
        `SELECT action, resource_type FROM permissions
          WHERE (action, resource_type) IN (${LEGACY_REMOVED_16.map(
            (_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`,
          ).join(", ")})`,
        LEGACY_REMOVED_16.flat(),
      );
      expect(rows).toEqual([]);
    });

    it("D5 is_sensitive: tập true ĐÚNG BẰNG 13 cặp; 4 cặp còn lại false (canonical-seed-pin-regression)", async () => {
      // Cặp lương để is_sensitive=false là đường ĂN THEO WILDCARD `*:*` — đúng lỗ §9g.1 #1 mà wave này vá.
      const { rows } = await direct.query<{
        action: string;
        resource_type: string;
        is_sensitive: boolean;
      }>(
        `SELECT action, resource_type, is_sensitive FROM permissions
          WHERE resource_type IN ('payroll','payroll-period','salary-profile','bonus-penalty','payslip')`,
      );
      expect(rows).toHaveLength(17);
      const sens = rows
        .filter((r) => r.is_sensitive)
        .map((r) => `${r.action}|${r.resource_type}`)
        .sort();
      expect(sens).toEqual(SENSITIVE_13.map((p) => p.join("|")).sort());
      const nonSens = rows
        .filter((r) => !r.is_sensitive)
        .map((r) => `${r.action}|${r.resource_type}`)
        .sort();
      expect(nonSens).toEqual(NON_SENSITIVE_4.map((p) => p.join("|")).sort());
    });

    it("D6 census 4 hình dạng wildcard: không role hệ thống nào giữ ('*','*')/('act','*')/('*','res')", async () => {
      // matches() là HAI vế độc lập ⇒ câu đo exact-only MÙ với wildcard
      // (permission-grant-census-must-cover-four-wildcard-shapes).
      const { rows } = await direct.query(
        `SELECT r.name AS role, p.action, p.resource_type
           FROM role_permissions rp
           JOIN roles r       ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.company_id IS NULL AND r.deleted_at IS NULL
            AND (p.action = '*' OR p.resource_type = '*')`,
      );
      expect(rows).toEqual([]);
    });

    it("D7 payroll-officer KHÔNG giữ ('approve','payroll-period') — four-eyes là ràng buộc QUYỀN", async () => {
      const { rows } = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.name = 'payroll-officer' AND r.company_id IS NULL
            AND p.action = 'approve' AND p.resource_type = 'payroll-period'`,
      );
      expect(rows[0].n).toBe("0");
    });

    it("D8 mọi role giữ approve/calculate:payroll-period đều giữ view-line (chống DUYỆT MÙ)", async () => {
      const { rows } = await direct.query<{ role: string }>(
        `SELECT DISTINCT r.name AS role
           FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
          WHERE rp.permission_id IN (
                  SELECT id FROM permissions
                   WHERE resource_type = 'payroll-period' AND action IN ('approve','calculate'))
            AND NOT EXISTS (
                  SELECT 1 FROM role_permissions rp2
                   WHERE rp2.role_id = rp.role_id
                     AND rp2.permission_id = (SELECT id FROM permissions
                                               WHERE action='view-line' AND resource_type='payroll-period'))`,
      );
      expect(rows).toEqual([]);
    });

    it("D9 mọi role giữ manage:bonus-penalty đều giữ view:salary-profile (picker PAYROLL-API-034)", async () => {
      const { rows } = await direct.query<{ role: string }>(
        `SELECT DISTINCT r.name AS role
           FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
          WHERE rp.permission_id = (SELECT id FROM permissions
                                     WHERE action='manage' AND resource_type='bonus-penalty')
            AND NOT EXISTS (
                  SELECT 1 FROM role_permissions rp2
                   WHERE rp2.role_id = rp.role_id
                     AND rp2.permission_id = (SELECT id FROM permissions
                                               WHERE action='view' AND resource_type='salary-profile'))`,
      );
      expect(rows).toEqual([]);
    });

    it("D10 role payroll-officer: id …0015, is_system, 2FA BẮT BUỘC, KHÔNG canonical", async () => {
      const { rows } = await direct.query<{
        id: string;
        is_system: boolean;
        requires_two_factor: boolean;
        company_id: string | null;
      }>(
        `SELECT id, is_system, requires_two_factor, company_id FROM roles
          WHERE name = 'payroll-officer' AND company_id IS NULL AND deleted_at IS NULL`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe("00000000-0000-0000-0000-000000000015");
      expect(rows[0].is_system).toBe(true);
      // PAY-DEC-009 — khác tiền lệ recruiter/asset-manager (false): lương là crown, owner đã chấp nhận.
      expect(rows[0].requires_two_factor).toBe(true);
      // KHÔNG canonical — thêm vào là làm đỏ pin auth-seed-canonical-roles / DASH / NOTI.
      expect(DASH_CANONICAL_ROLES as readonly string[]).not.toContain("payroll-officer");
      expect(NOTI_CANONICAL_ROLES as readonly string[]).not.toContain("payroll-officer");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // E. NOTI (mig 0566)
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("E. NOTI PAYROLL", () => {
    it("E1 4 event NOTI-EVENT-020..023, dedupe_strategy='DedupeKey' + window NULL", async () => {
      // Mặc định 'None' biến dedupeKey thành chuỗi trang trí (bài học 0479/0507/0538).
      const { rows } = await direct.query<{
        event_code: string;
        dedupe_strategy: string;
        dedupe_window_seconds: number | null;
        is_enabled: boolean;
        is_system_event: boolean;
        notification_type: string;
      }>(
        `SELECT event_code, dedupe_strategy, dedupe_window_seconds, is_enabled, is_system_event, notification_type
           FROM notification_events
          WHERE module_code = 'PAYROLL' AND company_id IS NULL AND deleted_at IS NULL
          ORDER BY event_code`,
      );
      expect(rows.map((r) => r.event_code)).toEqual([
        "PAYROLL_PERIOD_APPROVED",
        "PAYROLL_PERIOD_REJECTED",
        "PAYROLL_PERIOD_SUBMITTED",
        "PAYSLIP_PUBLISHED",
      ]);
      for (const r of rows) {
        expect(r.dedupe_strategy, r.event_code).toBe("DedupeKey");
        expect(r.dedupe_window_seconds, r.event_code).toBeNull();
        expect(r.is_enabled, r.event_code).toBe(true);
        // PAYROLL v1 KHÔNG có system job — mọi event đều event-driven.
        expect(r.is_system_event, r.event_code).toBe(false);
        expect(r.notification_type, r.event_code).toBe("Payroll");
      }
    });

    it("E2 CHECK nới trên CẢ HAI bảng, và `notifications` GIỮ nhánh IS NULL OR (lỗi 0507)", async () => {
      const { rows } = await direct.query<{ conname: string; def: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname IN ('chk_notification_events_module_code','chk_notification_events_type',
                            'chk_notifications_module_code','chk_notifications_notification_type')`,
      );
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        const needle = r.conname.includes("module_code") ? "'PAYROLL'" : "'Payroll'";
        expect(r.def, `${r.conname} thiếu ${needle}`).toContain(needle);
        if (r.conname.startsWith("chk_notifications_")) {
          // Hàng legacy để NULL (0479:249) — mất nhánh này là vỡ mọi notification cũ.
          expect(r.def, `${r.conname} mất nhánh IS NULL`).toContain("IS NULL");
        }
      }
    });

    it("E3 template PAYROLL KHÔNG mang biến số tiền (SPEC-11 §17/§18)", async () => {
      // NOTI đi qua nhiều kênh và KHÔNG có tầng masking riêng ⇒ payload TUYỆT ĐỐI không chở tiền.
      // Assert theo BIẾN, không theo văn xuôi: chữ "lương" trong «Bảng lương {period_month}» là TÊN đối tượng,
      // không phải số tiền — quét văn xuôi bằng regex thô sẽ đỏ oan (prettier/gitleaks-style false positive).
      // Danh sách biến cho phép là ĐÓNG: thêm biến mới phải sửa ca này, tức phải nghĩ về việc nó có chở tiền không.
      const ALLOWED_VARS = new Set([
        "actor_name",
        "period_month",
        "reason",
        "payroll_period_id",
      ]);
      const { rows } = await direct.query<{
        template_code: string;
        title_template: string;
        body_template: string;
        variables_schema: Record<string, unknown> | null;
      }>(
        `SELECT t.template_code, t.title_template, t.body_template, t.variables_schema
           FROM notification_templates t JOIN notification_events e ON e.id = t.event_id
          WHERE e.module_code = 'PAYROLL' AND t.company_id IS NULL AND t.deleted_at IS NULL`,
      );
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        const declared = Object.keys(r.variables_schema ?? {});
        // (1) mọi biến KHAI BÁO nằm trong allowlist money-free
        for (const v of declared) {
          expect(ALLOWED_VARS.has(v), `${r.template_code}: biến '${v}' ngoài allowlist money-free`).toBe(
            true,
          );
        }
        // (2) mọi placeholder DÙNG trong title/body đều đã khai báo — placeholder lạ là đường lọt trường
        //     ngoài schema (vd {net}) mà engine vẫn nội suy.
        const used = [
          ...r.title_template.matchAll(/\{(\w+)\}/g),
          ...r.body_template.matchAll(/\{(\w+)\}/g),
        ].map((m) => m[1]);
        for (const v of used) {
          expect(declared, `${r.template_code}: placeholder '{${v}}' không có trong variables_schema`)
            .toContain(v);
        }
      }
    });
  });
});
