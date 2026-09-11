import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb, workerPool } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S15-PAYROLL-DB-1 (mig 0570 · 0571) — CHỐT HỒI QUY cho nền dữ liệu PAYROLL v2
 * (DB-13 §12.1/§12.2.a/§12.4/§13 · SPEC-11 §11.3/§12.1/§13.6 E · permission-matrix §9g.2).
 *
 * VÌ SAO FILE NÀY TỒN TẠI — giống lý do của `s13-payroll-db1-invariants`: hai migration tự verify bằng
 * khối `DO/RAISE`, nhưng verify đó chạy ĐÚNG MỘT LẦN lúc migrate, KHÔNG phải cổng đứng. Sau khi merge,
 * một WO sau có thể `GRANT DELETE ON salary_components`, flip `is_sensitive` của `view:statutory-rate`
 * về false (mở đường wildcard `*:*`), DROP `salary_components_engine_kind_check` (mở lại bẫy fail-open
 * `net = 0`), hay gỡ `EXCLUDE` của `payroll_dependents` (biến ERR-032 thành mã chết) — và KHÔNG có gì
 * đỏ.
 *
 * ⚠️ Khối VERIFY trong migration chạy bằng role `mediaos` (SUPERUSER/BYPASSRLS) ⇒ nó chứng minh policy
 * TỒN TẠI, không chứng minh policy ĐÚNG. Nhóm A dưới đây chạy bằng `mediaos_app` — đó mới là chỗ bất
 * biến #1 được chứng minh.
 *
 * NƠI CHẠY: gate `hasDb`, KHÔNG gate `LANE_DB` — chạy THẬT trên CI.
 *
 * QUY TẮC: ma trận quyền so **SET-EQUALITY** (đếm đúng mà sai người vẫn xanh); mọi ca ÂM có ĐỐI CHỨNG
 * DƯƠNG (`deny-cases-vacuous-without-allow-case`); mọi mutation trong tx ROLLBACK.
 */

/** Vị từ loại role của TENANT FIXTURE khỏi census quét-mọi-scope — chép từ `s13-payroll-db1-invariants`. */
const NOT_FIXTURE_TENANT = `
            AND NOT EXISTS (
              SELECT 1 FROM companies c
               WHERE c.id = r.company_id
                 AND c.name = 'Company ' || c.slug
                 AND c.slug ~ '-[0-9a-f]{8}$'
            )`;

/** Bảy bảng mới của mig 0570. */
const V2_TABLES = [
  "salary_profile_items",
  "payroll_employee_settings",
  "payroll_dependents",
  "salary_components",
  "payroll_statutory_rates",
  "payroll_templates",
  "payroll_template_components",
] as const;

/**
 * 🔴 NGOẠI LỆ CÓ CHỦ ĐÍCH — bảng PAYROLL DUY NHẤT có `GRANT DELETE` (DB-13 §13.6).
 *
 * Nhóm B assert **BA CHIỀU** quanh hằng này: (a) mọi bảng NGOÀI tập có 0 DELETE; (b) bảng TRONG tập
 * PHẢI CÓ DELETE (kẻo ai đó thu hồi rồi `PUT /payroll/templates/:id/components` vỡ trong im lặng);
 * (c) tập có ĐÚNG MỘT phần tử — thêm phần tử thứ hai buộc phải sửa spec và đi qua review, không lặng
 * lẽ trôi. Thiếu (c) là ratchet mất răng cho MỌI bảng sau.
 */
const DELETE_ALLOWED = ["payroll_template_components"] as const;

/** 17 cặp quyền v2 — literal chép từ 0571, CỐ Ý không import (import lại chính nguồn là tautology). */
const V2_PAIRS: Array<[string, string]> = [
  ["view", "payroll-employee"],
  ["manage", "payroll-employee"],
  ["view", "salary-component"],
  ["manage", "salary-component"],
  ["view", "payroll-template"],
  ["manage", "payroll-template"],
  ["view", "statutory-rate"],
  ["manage", "statutory-rate"],
  ["view", "payroll-advance"],
  ["manage", "payroll-advance"],
  ["approve", "payroll-advance"],
  ["view-own", "payroll-advance"],
  ["view", "payment-batch"],
  ["manage", "payment-batch"],
  ["view", "payroll-budget"],
  ["manage", "payroll-budget"],
  ["view", "payroll-report"],
];

/** Ma trận grant v2 — 31 hàng (SPEC-11 §11.3 ghi chú 7). */
const EXPECTED_31: Array<[string, string, string, string]> = [
  ["employee", "view-own", "payroll-advance", "Own"],
  ...(
    [
      ["view", "payroll-employee"],
      ["manage", "payroll-employee"],
      ["view", "salary-component"],
      ["manage", "salary-component"],
      ["view", "payroll-template"],
      ["manage", "payroll-template"],
      ["view", "statutory-rate"],
      ["view", "payroll-advance"],
      ["manage", "payroll-advance"],
      ["approve", "payroll-advance"],
      ["view", "payment-batch"],
      ["manage", "payment-batch"],
      ["view", "payroll-budget"],
      ["view", "payroll-report"],
    ] as Array<[string, string]>
  ).map(([a, r]): [string, string, string, string] => ["payroll-officer", a, r, "Company"]),
  ...(
    [
      ["view", "payroll-employee"],
      ["manage", "payroll-employee"],
      ["view", "salary-component"],
      ["manage", "salary-component"],
      ["view", "payroll-template"],
      ["manage", "payroll-template"],
      ["view", "statutory-rate"],
      ["manage", "statutory-rate"],
      ["view", "payroll-advance"],
      ["manage", "payroll-advance"],
      ["approve", "payroll-advance"],
      ["view", "payment-batch"],
      ["manage", "payment-batch"],
      ["view", "payroll-budget"],
      ["manage", "payroll-budget"],
      ["view", "payroll-report"],
    ] as Array<[string, string]>
  ).map(([a, r]): [string, string, string, string] => ["company-admin", a, r, "Company"]),
];

/** 13 `resource_type` định nghĩa "PAYROLL" — LITERAL, KHÔNG `LIKE 'payroll%'` (lọc LIKE bỏ sót 6/13). */
const PAYROLL_RESOURCES = [
  "payroll",
  "payroll-period",
  "salary-profile",
  "bonus-penalty",
  "payslip",
  "payroll-employee",
  "salary-component",
  "payroll-template",
  "statutory-rate",
  "payroll-advance",
  "payment-batch",
  "payroll-budget",
  "payroll-report",
] as const;

/** 10 `audit_logs.object_type` mới (SPEC-11 §12.1 ghi chú 4) ⇒ tổng 14 cho PAYROLL. */
const V2_OBJECT_TYPES = [
  "payroll_employee",
  "payroll_employee_setting",
  "payroll_dependent",
  "salary_component",
  "payroll_template",
  "payroll_statutory_rate",
  "payroll_advance",
  "payroll_payment_batch",
  "payroll_budget",
  "payroll_report",
] as const;

/** Bốn tài nguyên có cặp view/manage tách đôi và vế `manage` CHỞ TIỀN (SPEC-11 §11.3 ghi chú 8). */
const MANAGE_IMPLIES_VIEW = [
  "payroll-advance",
  "payment-batch",
  "payroll-budget",
  "salary-component",
] as const;

/** Mã thành phần hợp lệ cho fixture: `^[A-Z][A-Z0-9_]{0,31}$`, KHÔNG tiền tố SYS_/TL_/GT_. */
function fixtureCode(prefix = "RLS"): string {
  return `${prefix}_${randomUUID().slice(0, 8).toUpperCase().replace(/-/g, "")}`;
}

describe.skipIf(!hasDb)(
  "S15-PAYROLL-DB-1 · bất biến nền dữ liệu PAYROLL v2 (mig 0570–0571)",
  () => {
    const direct = directPool();
    const app = appPool(3);
    const worker = workerPool(1);

    let A: SeededTenant;
    let B: SeededTenant;
    let uA: string;
    let profileA: string;

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
      A = await seedCompany(direct, "s15pa");
      B = await seedCompany(direct, "s15pb");
      uA = await seedUser(direct, A.companyId, `s15a-${randomUUID().slice(0, 8)}@a.test`);
      const sp = await direct.query(
        `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary)
       VALUES ($1, $2, '2026-01-01', 10000000.00) RETURNING id`,
        [A.companyId, uA],
      );
      profileA = sp.rows[0].id as string;
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
      await worker.end();
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // A. Bất biến #1 — RLS + FORCE + cô lập tenant (chạy bằng mediaos_app, KHÔNG bypass)
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("A. RLS / cô lập tenant", () => {
      it("A1 cả 7 bảng mới có RLS ENABLE + FORCE + policy tenant_isolation", async () => {
        const { rows } = await direct.query<{
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
          npolicy: string;
        }>(
          `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                (SELECT count(*) FROM pg_policies p
                  WHERE p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS npolicy
           FROM pg_class c WHERE c.relname = ANY($1::text[])`,
          [[...V2_TABLES]],
        );
        expect(rows).toHaveLength(V2_TABLES.length);
        for (const r of rows) {
          expect(r.relrowsecurity, `${r.relname} thiếu RLS ENABLE`).toBe(true);
          expect(r.relforcerowsecurity, `${r.relname} thiếu FORCE RLS`).toBe(true);
          expect(Number(r.npolicy), `${r.relname} thiếu policy tenant_isolation`).toBe(1);
        }
      });

      it("A2 ĐỐI CHỨNG DƯƠNG: INSERT đúng tenant đi qua (kẻo A1/A3 xanh vì bảng rỗng)", async () => {
        const id = await asApp(A.companyId, async (c) => {
          const r = await c.query(
            `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
           VALUES ($1, $2, 'ĐỐI CHỨNG DƯƠNG', 'earning', 'formula', 'BASE_SALARY') RETURNING id`,
            [A.companyId, fixtureCode("POS")],
          );
          return r.rows[0].id as string;
        });
        expect(id).toBeTruthy();
      });

      it("A3 tenant A KHÔNG thấy hàng của tenant B trên cả 7 bảng", async () => {
        // Gieo 1 hàng cho B trên mỗi bảng bằng direct (bypass RLS), rồi đọc bằng app-role trong ngữ cảnh A.
        const tplB = await direct.query(
          `INSERT INTO payroll_templates (company_id, code, name, scope)
         VALUES ($1, $2, 'B tpl', 'company') RETURNING id`,
          [B.companyId, fixtureCode("BTPL")],
        );
        const compB = await direct.query(
          `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
         VALUES ($1, $2, 'B comp', 'earning', 'formula', 'BASE_SALARY') RETURNING id`,
          [B.companyId, fixtureCode("BCMP")],
        );
        await direct.query(
          `INSERT INTO payroll_template_components (company_id, template_id, component_id)
         VALUES ($1, $2, $3)`,
          [B.companyId, tplB.rows[0].id, compB.rows[0].id],
        );

        const seen = await asApp(A.companyId, async (c) => {
          const out: Record<string, number> = {};
          for (const t of [
            "payroll_templates",
            "salary_components",
            "payroll_template_components",
          ]) {
            const r = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE company_id = $1`, [
              B.companyId,
            ]);
            out[t] = r.rows[0].n as number;
          }
          return out;
        });
        for (const [t, n] of Object.entries(seen)) {
          expect(n, `${t}: tenant A ĐỌC ĐƯỢC hàng của B — RLS thủng`).toBe(0);
        }
      });

      it("A4 ghi CHÉO TENANT bị chặn (policy WITH CHECK / composite tenant FK)", async () => {
        await expect(
          asApp(A.companyId, (c) =>
            c.query(
              `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
             VALUES ($1, $2, 'cross', 'earning', 'formula', 'BASE_SALARY')`,
              [B.companyId, fixtureCode("XT")],
            ),
          ),
        ).rejects.toThrow();
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // B. GRANT — soft delete + ngoại lệ DELETE + worker
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("B. GRANT", () => {
      async function appPrivs(table: string): Promise<string[]> {
        const { rows } = await direct.query<{ privilege_type: string }>(
          `SELECT DISTINCT x.privilege_type
           FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
          WHERE c.relname = $1 AND x.grantee = 'mediaos_app'::regrole
          UNION
         SELECT DISTINCT x.privilege_type
           FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND x.grantee = 'mediaos_app'::regrole`,
          [table],
        );
        return rows.map((r) => r.privilege_type).sort();
      }

      it.each(V2_TABLES.filter((t) => !(DELETE_ALLOWED as readonly string[]).includes(t)))(
        "B1 %s: app role KHÔNG có GRANT DELETE (soft delete — bất biến #2)",
        async (tbl) => {
          expect(await appPrivs(tbl)).not.toContain("DELETE");
        },
      );

      it("B2 payroll_template_components PHẢI CÓ GRANT DELETE (ngoại lệ có chủ đích, DB-13 §13.6)", async () => {
        // Vế THỨ HAI của assert hai chiều: thiếu nó thì ai đó REVOKE DELETE và API-053 (đặt lại danh
        // sách thành phần trong một tx) vỡ trong IM LẶNG — không ca nào đỏ.
        expect(await appPrivs("payroll_template_components")).toContain("DELETE");
      });

      it("B3 DELETE_ALLOWED có ĐÚNG MỘT phần tử — thêm bảng thứ hai phải đi qua review", () => {
        // Không có ca này thì B1 tự co lại mỗi lần ai đó nới DELETE cho một bảng mới: ratchet mất răng.
        expect(DELETE_ALLOWED).toHaveLength(1);
        expect(DELETE_ALLOWED[0]).toBe("payroll_template_components");
      });

      it("B4 ĐỐI CHỨNG DƯƠNG: app role VẪN INSERT được (kẻo B1 xanh vì mất sạch quyền)", async () => {
        for (const t of V2_TABLES) {
          expect(await appPrivs(t), `${t} mất INSERT`).toContain("INSERT");
          expect(await appPrivs(t), `${t} mất SELECT`).toContain("SELECT");
        }
      });

      it("B5 mediaos_worker: 0 quyền trên cả 7 bảng mới", async () => {
        const { rows } = await direct.query<{ relname: string; n: string }>(
          `SELECT c.relname, count(*) AS n
           FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
          WHERE c.relname = ANY($1::text[]) AND x.grantee = 'mediaos_worker'::regrole
          GROUP BY c.relname`,
          [[...V2_TABLES]],
        );
        expect(rows, `worker có quyền trên: ${rows.map((r) => r.relname).join(", ")}`).toEqual([]);
      });

      it("B6 ĐỐI CHỨNG DƯƠNG: worker KHÔNG MẤT SELECT ở nơi 0564 cố ý giữ (thu hồi quá tay)", async () => {
        for (const t of ["payroll_periods", "bonus_penalties", "payslip_acknowledgements"]) {
          const { rows } = await direct.query<{ n: string }>(
            `SELECT count(*) AS n FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
            WHERE c.relname = $1 AND x.grantee = 'mediaos_worker'::regrole
              AND x.privilege_type = 'SELECT'`,
            [t],
          );
          expect(Number(rows[0].n), `worker MẤT SELECT trên ${t}`).toBe(1);
        }
      });

      it("B7 ĐỐI CHỨNG DƯƠNG: worker THỰC SỰ đọc được payroll_periods (quyền ACL không phải lời hứa suông)", async () => {
        const c = await worker.connect();
        try {
          await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
          await expect(c.query("SELECT count(*) FROM payroll_periods")).resolves.toBeTruthy();
        } finally {
          c.release();
        }
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // C. CHECK / UNIQUE / EXCLUDE — chốt cuối ở DB
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("C. CHECK · UNIQUE · EXCLUDE", () => {
      /** Bóc SQLSTATE thật — drizzle/pg bọc lỗi, đọc `.code` của chính error pg. */
      async function expectSqlState(
        run: () => Promise<unknown>,
        state: string,
        what: string,
      ): Promise<void> {
        let code: string | undefined;
        try {
          await run();
        } catch (e) {
          code = (e as { code?: string }).code;
        }
        expect(code, `${what}: kỳ vọng SQLSTATE ${state}, nhận ${code ?? "KHÔNG NÉM"}`).toBe(state);
      }

      it("C1 engine_kind_check (chiều 1): kind='aggregate' mà value_type='fixed' bị CHẶN", async () => {
        await expectSqlState(
          () =>
            asApp(A.companyId, (c) =>
              c.query(
                `INSERT INTO salary_components
                 (company_id, code, name, kind, value_type, fixed_amount, is_system)
               VALUES ($1, $2, 'agg-fixed', 'aggregate', 'fixed', 0, true)`,
                [A.companyId, fixtureCode("C1")],
              ),
            ),
          "23514",
          "aggregate + fixed(0) — ĐÂY LÀ BẪY FAIL-OPEN net=0 mà CHECK phải chặn",
        );
      });

      it("C2 engine_kind_check (chiều 2): value_type='engine' mà kind<>'aggregate' bị CHẶN", async () => {
        await expectSqlState(
          () =>
            asApp(A.companyId, (c) =>
              c.query(
                `INSERT INTO salary_components (company_id, code, name, kind, value_type, is_system)
               VALUES ($1, $2, 'engine-earning', 'earning', 'engine', true)`,
                [A.companyId, fixtureCode("C2")],
              ),
            ),
          "23514",
          "engine + earning",
        );
      });

      it("C3 ĐỐI CHỨNG DƯƠNG: aggregate + engine + is_system đi qua", async () => {
        const id = await asApp(A.companyId, async (c) => {
          const r = await c.query(
            `INSERT INTO salary_components (company_id, code, name, kind, value_type, is_system)
           VALUES ($1, $2, 'agg-engine', 'aggregate', 'engine', true) RETURNING id`,
            [A.companyId, fixtureCode("C3")],
          );
          return r.rows[0].id as string;
        });
        expect(id).toBeTruthy();
      });

      it("C4 system_not_deletable: xoá MỀM hàng is_system bị CHẶN ngay ở DB", async () => {
        // Lỗ nếu thiếu: hàng seed rơi khỏi partial unique (WHERE deleted_at IS NULL) ⇒ người dùng TẠO
        // LẠI `TONG_KHAU_TRU` với công thức tuỳ ý và CHE nút engine.
        await expectSqlState(
          () =>
            asApp(A.companyId, async (c) => {
              const r = await c.query(
                `INSERT INTO salary_components (company_id, code, name, kind, value_type, is_system)
               VALUES ($1, $2, 'sys', 'aggregate', 'engine', true) RETURNING id`,
                [A.companyId, fixtureCode("C4")],
              );
              return c.query(`UPDATE salary_components SET deleted_at = now() WHERE id = $1`, [
                r.rows[0].id,
              ]);
            }),
          "23514",
          "xoá mềm hàng is_system",
        );
      });

      it("C5 ĐỐI CHỨNG DƯƠNG: hàng KHÔNG is_system xoá mềm được bình thường", async () => {
        const ok = await asApp(A.companyId, async (c) => {
          const r = await c.query(
            `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
           VALUES ($1, $2, 'user comp', 'earning', 'formula', 'BASE_SALARY') RETURNING id`,
            [A.companyId, fixtureCode("C5")],
          );
          const u = await c.query(
            `UPDATE salary_components SET deleted_at = now() WHERE id = $1 RETURNING id`,
            [r.rows[0].id],
          );
          return u.rowCount;
        });
        expect(ok).toBe(1);
      });

      it.each(["SYS_GROSS", "TL_ABC", "GT_XYZ"])(
        "C6 code_shape_check: mã %s CHE biến hệ thống bị CHẶN",
        async (code) => {
          await expectSqlState(
            () =>
              asApp(A.companyId, (c) =>
                c.query(
                  `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
                 VALUES ($1, $2, 'shadow', 'earning', 'formula', 'BASE_SALARY')`,
                  [A.companyId, code],
                ),
              ),
            "23514",
            `mã ${code}`,
          );
        },
      );

      it("C7 ĐỐI CHỨNG DƯƠNG: mã thường (SYSTEM_X — KHÔNG khớp SYS\\_) đi qua", async () => {
        // ⚠️ Ca này cũng ghim rằng escape `\\_` trong CHECK là ĐÚNG: nếu ai đó viết 'SYS_%' không escape
        //    thì `_` thành ký tự đại diện và `SYSTEM_X` sẽ BỊ CHẶN OAN ⇒ ca này ĐỎ.
        const id = await asApp(A.companyId, async (c) => {
          const r = await c.query(
            `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
           VALUES ($1, 'SYSTEM_X', 'ok', 'earning', 'formula', 'BASE_SALARY') RETURNING id`,
            [A.companyId],
          );
          return r.rows[0].id as string;
        });
        expect(id).toBeTruthy();
      });

      it("C8 payroll_dependents: khoảng hiệu lực CHỒNG LẤP ném 23P01 (KHÔNG phải 23505)", async () => {
        // Ghim MÃ SQLSTATE, không ghim message: service bóc 23P01 từ error.cause → 409 ERR-032; map
        // nhầm sang 23505 ⇒ 500 ở vùng đỏ (drizzle-wraps-pg-error-code-in-cause).
        await expectSqlState(
          () =>
            asApp(A.companyId, async (c) => {
              await c.query(
                `INSERT INTO payroll_dependents
                 (company_id, user_id, full_name, relationship, effective_from, effective_to)
               VALUES ($1, $2, 'Trùng Tên', 'Child', '2026-01-01', '2026-06-30')`,
                [A.companyId, uA],
              );
              return c.query(
                `INSERT INTO payroll_dependents
                 (company_id, user_id, full_name, relationship, effective_from, effective_to)
               VALUES ($1, $2, 'Trùng Tên', 'Child', '2026-06-01', NULL)`,
                [A.companyId, uA],
              );
            }),
          "23P01",
          "NPT trùng tên, khoảng giao nhau",
        );
      });

      it("C9 ĐỐI CHỨNG DƯƠNG: hai NPT KHÁC TÊN chồng khoảng vẫn đi qua (EXCLUDE không quá tay)", async () => {
        const n = await asApp(A.companyId, async (c) => {
          await c.query(
            `INSERT INTO payroll_dependents (company_id, user_id, full_name, relationship, effective_from)
           VALUES ($1, $2, 'Con A', 'Child', '2026-01-01')`,
            [A.companyId, uA],
          );
          const r = await c.query(
            `INSERT INTO payroll_dependents (company_id, user_id, full_name, relationship, effective_from)
           VALUES ($1, $2, 'Con B', 'Child', '2026-01-01') RETURNING id`,
            [A.companyId, uA],
          );
          return r.rowCount;
        });
        expect(n).toBe(1);
      });

      it("C10 ĐỐI CHỨNG DƯƠNG: cùng tên nhưng khoảng RỜI NHAU đi qua", async () => {
        const n = await asApp(A.companyId, async (c) => {
          await c.query(
            `INSERT INTO payroll_dependents
             (company_id, user_id, full_name, relationship, effective_from, effective_to)
           VALUES ($1, $2, 'Rời Nhau', 'Child', '2026-01-01', '2026-03-31')`,
            [A.companyId, uA],
          );
          const r = await c.query(
            `INSERT INTO payroll_dependents
             (company_id, user_id, full_name, relationship, effective_from, effective_to)
           VALUES ($1, $2, 'Rời Nhau', 'Child', '2026-04-01', NULL) RETURNING id`,
            [A.companyId, uA],
          );
          return r.rowCount;
        });
        expect(n).toBe(1);
      });

      it.each([
        ["0", "pay_ratio_pct = 0"],
        ["101", "pay_ratio_pct = 101"],
      ])("C11 salary_profiles_pay_ratio_check chặn %s", async (val) => {
        await expectSqlState(
          () =>
            asApp(A.companyId, (c) =>
              c.query(
                `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, pay_ratio_pct)
               VALUES ($1, $2, '2027-01-01', 1000, $3)`,
                [A.companyId, uA, val],
              ),
            ),
          "23514",
          `pay_ratio_pct = ${val}`,
        );
      });

      it("C12 payroll_period_lines_grossup_check chặn 31 vòng", async () => {
        const period = await direct.query(
          `INSERT INTO payroll_periods (company_id, period_month, status)
         VALUES ($1, '2026-11', 'Draft') RETURNING id`,
          [A.companyId],
        );
        await expectSqlState(
          () =>
            asApp(A.companyId, (c) =>
              c.query(
                `INSERT INTO payroll_period_lines
                 (company_id, payroll_period_id, user_id, input_snapshot_json, gross_up_iterations)
               VALUES ($1, $2, $3, '{"workDays":22}'::jsonb, 31)`,
                [A.companyId, period.rows[0].id, uA],
              ),
            ),
          "23514",
          "gross_up_iterations = 31",
        );
      });

      it("C13 payroll_period_lines_fingerprint_check chặn chuỗi không phải SHA-256 hex", async () => {
        const period = await direct.query(
          `INSERT INTO payroll_periods (company_id, period_month, status)
         VALUES ($1, '2026-12', 'Draft') RETURNING id`,
          [A.companyId],
        );
        await expectSqlState(
          () =>
            asApp(A.companyId, (c) =>
              c.query(
                `INSERT INTO payroll_period_lines
                 (company_id, payroll_period_id, user_id, input_snapshot_json, template_fingerprint)
               VALUES ($1, $2, $3, '{"workDays":22}'::jsonb, 'khong-phai-sha256')`,
                [A.companyId, period.rows[0].id, uA],
              ),
            ),
          "23514",
          "template_fingerprint sai hình dạng",
        );
      });

      it("C14 bank_pair_check: số TK không có tên chủ TK bị CHẶN (dòng UNC không gửi được)", async () => {
        await expectSqlState(
          () =>
            asApp(A.companyId, (c) =>
              c.query(
                `INSERT INTO payroll_employee_settings (company_id, user_id, bank_account_number)
               VALUES ($1, $2, '0123456789')`,
                [A.companyId, uA],
              ),
            ),
          "23514",
          "bank_account_number đơn độc",
        );
      });

      it("C15 statutory_rates_brackets_check: 6 bậc bị CHẶN (phải ĐÚNG 7)", async () => {
        await expectSqlState(
          () =>
            asApp(A.companyId, (c) =>
              c.query(
                `INSERT INTO payroll_statutory_rates
                 (company_id, effective_from, si_employee_pct, hi_employee_pct, ui_employee_pct,
                  si_employer_pct, hi_employer_pct, ui_employer_pct, union_employer_pct,
                  union_employee_pct, si_cap, hi_cap, ui_cap, base_wage, min_region_wage,
                  personal_deduction, dependent_deduction, pit_brackets)
               VALUES ($1, '2030-01-01', 8,1.5,1, 17.5,3,1, 2,1, 1,1,1, 1,1, 1,1,
                       '[{"upTo":1,"rate":5},{"upTo":2,"rate":10},{"upTo":3,"rate":15},
                         {"upTo":4,"rate":20},{"upTo":5,"rate":25},{"upTo":null,"rate":30}]'::jsonb)`,
                [A.companyId],
              ),
            ),
          "23514",
          "pit_brackets 6 phần tử",
        );
      });

      it("C16 templates_scope_pair_check: scope='company' mà có org_unit_id bị CHẶN", async () => {
        await expectSqlState(
          () =>
            asApp(A.companyId, (c) =>
              c.query(
                `INSERT INTO payroll_templates (company_id, code, name, scope, org_unit_id)
               VALUES ($1, $2, 'sai cặp', 'company', gen_random_uuid())`,
                [A.companyId, fixtureCode("C16")],
              ),
            ),
          "23514",
          "scope=company + org_unit_id",
        );
      });

      it("C17 salary_profile_items_profile_component_uq: trùng mã trong MỘT hồ sơ ném 23505", async () => {
        await expectSqlState(
          () =>
            asApp(A.companyId, async (c) => {
              await c.query(
                `INSERT INTO salary_profile_items (company_id, salary_profile_id, component_code, amount)
               VALUES ($1, $2, 'PC_900', 100)`,
                [A.companyId, profileA],
              );
              return c.query(
                `INSERT INTO salary_profile_items (company_id, salary_profile_id, component_code, amount)
               VALUES ($1, $2, 'PC_900', 200)`,
                [A.companyId, profileA],
              );
            }),
          "23505",
          "hai item cùng component_code — chốt cuối của ERR-014 kind=profile-item-duplicate",
        );
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // D. Seed quyền toàn cục (mig 0571)
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("D. seed quyền", () => {
      it("D1 catalog PAYROLL = ĐÚNG 34 cặp / 30 sensitive / 4 không sensitive", async () => {
        const { rows } = await direct.query<{
          action: string;
          resource_type: string;
          is_sensitive: boolean;
        }>(
          `SELECT action, resource_type, is_sensitive FROM permissions WHERE resource_type = ANY($1::text[])`,
          [[...PAYROLL_RESOURCES]],
        );
        expect(rows).toHaveLength(34);
        expect(rows.filter((r) => r.is_sensitive)).toHaveLength(30);
        const nonSensitive = rows
          .filter((r) => !r.is_sensitive)
          .map((r) => `${r.action}:${r.resource_type}`)
          .sort();
        // SET-EQUALITY, không chỉ đếm: 4 cặp không-sensitive phải ĐÚNG là 4 cặp cũ của §11.1.
        expect(nonSensitive).toEqual(
          [
            "access:payroll",
            "acknowledge-own-payslip:payslip",
            "manage:payroll-period",
            "view:payroll-period",
          ].sort(),
        );
      });

      it("D2 17 cặp v2 đều tồn tại và ĐỀU is_sensitive=true", async () => {
        const { rows } = await direct.query<{ pair: string; is_sensitive: boolean }>(
          `SELECT action || ':' || resource_type AS pair, is_sensitive FROM permissions
          WHERE (action, resource_type) IN (${V2_PAIRS.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")})`,
          V2_PAIRS.flat(),
        );
        expect(rows).toHaveLength(17);
        const notSensitive = rows.filter((r) => !r.is_sensitive).map((r) => r.pair);
        expect(notSensitive, "cặp lương để is_sensitive=false ⇒ ăn theo wildcard *:*").toEqual([]);
      });

      it("D3 ma trận grant v2 = ĐÚNG 31 bộ (role, action, resource, scope) — SET-EQUALITY", async () => {
        const { rows } = await direct.query<{
          name: string;
          action: string;
          resource_type: string;
          data_scope: string;
        }>(
          `SELECT ro.name, p.action, p.resource_type, rp.data_scope
           FROM role_permissions rp
           JOIN roles ro ON ro.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ro.company_id IS NULL AND ro.deleted_at IS NULL
            AND p.resource_type = ANY($1::text[])`,
          [
            [
              "payroll-employee",
              "salary-component",
              "payroll-template",
              "statutory-rate",
              "payroll-advance",
              "payment-batch",
              "payroll-budget",
              "payroll-report",
            ],
          ],
        );
        const got = rows
          .map((r) => `${r.name}|${r.action}|${r.resource_type}|${r.data_scope}`)
          .sort();
        const want = EXPECTED_31.map((g) => g.join("|")).sort();
        expect(got).toEqual(want);
      });

      it("D4 tổng grant PAYROLL (v1 + v2) = ĐÚNG 63", async () => {
        const { rows } = await direct.query<{ n: string }>(
          `SELECT count(*) AS n
           FROM role_permissions rp
           JOIN roles ro ON ro.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ro.company_id IS NULL AND ro.deleted_at IS NULL
            AND p.resource_type = ANY($1::text[])`,
          [[...PAYROLL_RESOURCES]],
        );
        expect(Number(rows[0].n)).toBe(63);
      });

      it("D5 hr / hr-manager / manager = 0 cặp PAYROLL trên CẢ role_permissions LẪN object_permissions", async () => {
        const { rows } = await direct.query<{ src: string; name: string; pair: string }>(
          `SELECT 'role_permissions' AS src, ro.name, p.action || ':' || p.resource_type AS pair
           FROM role_permissions rp
           JOIN roles ro ON ro.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ro.name IN ('hr','hr-manager','manager') AND p.resource_type = ANY($1::text[])
          UNION ALL
         SELECT 'object_permissions', ro.name, p.action || ':' || p.resource_type
           FROM object_permissions op
           JOIN permissions p ON p.id = op.permission_id
           JOIN roles ro ON ro.id::text = op.subject_id::text
          WHERE ro.name IN ('hr','hr-manager','manager') AND p.resource_type = ANY($1::text[])`,
          [[...PAYROLL_RESOURCES]],
        );
        expect(rows, JSON.stringify(rows)).toEqual([]);
      });

      it("D6 payroll-officer KHÔNG giữ manage:statutory-rate và manage:payroll-budget", async () => {
        const { rows } = await direct.query<{ pair: string }>(
          `SELECT p.action || ':' || p.resource_type AS pair
           FROM role_permissions rp
           JOIN roles ro ON ro.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ro.name = 'payroll-officer' AND ro.company_id IS NULL
            AND (p.action, p.resource_type) IN (('manage','statutory-rate'), ('manage','payroll-budget'))`,
        );
        expect(rows.map((r) => r.pair)).toEqual([]);
      });

      it("D7 ĐỐI CHỨNG DƯƠNG: payroll-officer VẪN giữ vế ĐỌC của hai tài nguyên đó", async () => {
        // Thiếu ca này thì D6 xanh cả khi payroll-officer mất sạch quyền lương.
        const { rows } = await direct.query<{ pair: string }>(
          `SELECT p.action || ':' || p.resource_type AS pair
           FROM role_permissions rp
           JOIN roles ro ON ro.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE ro.name = 'payroll-officer' AND ro.company_id IS NULL
            AND (p.action, p.resource_type) IN (('view','statutory-rate'), ('view','payroll-budget'))`,
        );
        expect(rows.map((r) => r.pair).sort()).toEqual([
          "view:payroll-budget",
          "view:statutory-rate",
        ]);
      });

      it.each(MANAGE_IMPLIES_VIEW)(
        "D8 mọi role giữ manage:%s đều giữ view:%s (không có đường đọc lại số vừa ghi ⇒ áp lực rò tiền qua route GHI)",
        async (resource) => {
          const { rows } = await direct.query<{ name: string }>(
            `SELECT r.name
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.deleted_at IS NULL AND p.action = 'manage' AND p.resource_type = $1
              ${NOT_FIXTURE_TENANT}
              AND NOT EXISTS (
                SELECT 1 FROM role_permissions rp2
                  JOIN permissions p2 ON p2.id = rp2.permission_id
                 WHERE rp2.role_id = rp.role_id AND p2.action = 'view' AND p2.resource_type = $1)`,
            [resource],
          );
          expect(rows.map((r) => r.name)).toEqual([]);
        },
      );

      it("D9 mọi role giữ manage:payroll-template đều giữ view:salary-component", async () => {
        const { rows } = await direct.query<{ name: string }>(
          `SELECT r.name
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.deleted_at IS NULL AND p.action = 'manage' AND p.resource_type = 'payroll-template'
            ${NOT_FIXTURE_TENANT}
            AND NOT EXISTS (
              SELECT 1 FROM role_permissions rp2
                JOIN permissions p2 ON p2.id = rp2.permission_id
               WHERE rp2.role_id = rp.role_id AND p2.action = 'view'
                 AND p2.resource_type = 'salary-component')`,
        );
        expect(rows.map((r) => r.name)).toEqual([]);
      });

      it("D10 mọi role giữ approve:payroll-advance đều giữ view:payroll-advance (chống DUYỆT MÙ)", async () => {
        const { rows } = await direct.query<{ name: string }>(
          `SELECT r.name
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.deleted_at IS NULL AND p.action = 'approve' AND p.resource_type = 'payroll-advance'
            ${NOT_FIXTURE_TENANT}
            AND NOT EXISTS (
              SELECT 1 FROM role_permissions rp2
                JOIN permissions p2 ON p2.id = rp2.permission_id
               WHERE rp2.role_id = rp.role_id AND p2.action = 'view'
                 AND p2.resource_type = 'payroll-advance')`,
        );
        expect(rows.map((r) => r.name)).toEqual([]);
      });

      it("D11 ĐỐI CHỨNG DƯƠNG: câu census D8–D10 vẫn THẤY role THẬT sau khi lọc fixture", async () => {
        // Bộ lọc NOT_FIXTURE_TENANT có thể vô tình làm mù cả role sản phẩm. Ca này chứng minh nó không:
        // company-admin (company_id IS NULL) PHẢI xuất hiện khi bỏ vế NOT EXISTS.
        const { rows } = await direct.query<{ name: string }>(
          `SELECT DISTINCT r.name
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.deleted_at IS NULL AND p.action = 'manage' AND p.resource_type = 'payroll-advance'
            ${NOT_FIXTURE_TENANT}`,
        );
        expect(rows.map((r) => r.name)).toContain("company-admin");
        expect(rows.map((r) => r.name)).toContain("payroll-officer");
      });

      it("D12 census 4 hình dạng wildcard: không role nào (trừ super-admin) giữ ('*','*')/('act','*')/('*','res')", async () => {
        const { rows } = await direct.query<{ name: string; pair: string }>(
          `SELECT r.name, p.action || ':' || p.resource_type AS pair
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE r.deleted_at IS NULL AND r.name <> 'super-admin'
            ${NOT_FIXTURE_TENANT}
            AND (p.action = '*' OR p.resource_type = '*')`,
        );
        expect(rows, JSON.stringify(rows)).toEqual([]);
      });

      it("D13 object_permissions = 0 hàng trỏ cặp PAYROLL (hình dạng bypass MẠNH NHẤT)", async () => {
        const { rows } = await direct.query<{ pair: string }>(
          `SELECT p.action || ':' || p.resource_type AS pair
           FROM object_permissions op JOIN permissions p ON p.id = op.permission_id
          WHERE p.resource_type = ANY($1::text[])`,
          [[...PAYROLL_RESOURCES]],
        );
        expect(rows.map((r) => r.pair)).toEqual([]);
      });

      it("D14 CHECK audit_logs.object_type chứa đủ 10 giá trị v2 (thiếu ⇒ 500 trên đường ĐỌC)", async () => {
        const { rows } = await direct.query<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'audit_logs'::regclass AND contype = 'c' AND conname LIKE '%object_type%'`,
        );
        expect(rows.length).toBe(1);
        for (const t of V2_OBJECT_TYPES) {
          expect(rows[0].def, `object_type '${t}' thiếu trong CHECK`).toContain(`${t}`);
        }
        // NO-LOSS: 4 giá trị v1 vẫn còn.
        for (const t of ["payroll_period", "salary_profile", "bonus_penalty", "payslip"]) {
          expect(rows[0].def, `object_type v1 '${t}' BIẾN MẤT`).toContain(t);
        }
      });

      it("D15 ĐỐI CHỨNG DƯƠNG: ghi audit với object_type mới ĐI QUA, với mã lạ bị CHẶN", async () => {
        // D14 đọc định nghĩa CHECK; ca này chứng minh CHECK thật sự áp (định nghĩa đúng mà constraint
        // NOT VALID thì D14 vẫn xanh).
        const ok = await asApp(A.companyId, async (c) => {
          const r = await c.query(
            `INSERT INTO audit_logs (company_id, actor_user_id, action, object_type, object_id)
           VALUES ($1, $2, 'view', 'payroll_report', NULL) RETURNING id`,
            [A.companyId, uA],
          );
          return r.rowCount;
        });
        expect(ok).toBe(1);

        let code: string | undefined;
        try {
          await asApp(A.companyId, (c) =>
            c.query(
              `INSERT INTO audit_logs (company_id, actor_user_id, action, object_type, object_id)
             VALUES ($1, $2, 'view', 'khong_co_trong_ban_do', NULL)`,
              [A.companyId, uA],
            ),
          );
        } catch (e) {
          code = (e as { code?: string }).code;
        }
        expect(code).toBe("23514");
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // E. Backfill EXPAND (mig 0570 khối 6)
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("E. backfill expand-contract", () => {
      it("E1 cột salary_profiles.allowances VẪN CÒN — CONTRACT là WO RIÊNG", async () => {
        const { rows } = await direct.query<{ n: string }>(
          `SELECT count(*) AS n FROM information_schema.columns
          WHERE table_name = 'salary_profiles' AND column_name = 'allowances'`,
        );
        expect(Number(rows[0].n), "allowances đã bị gỡ — đó là CONTRACT, không phải WO này").toBe(
          1,
        );
      });

      it("E2 mọi hồ sơ lương ĐANG SỐNG có số item KHỚP độ dài allowances (per-profile, không so tổng)", async () => {
        // So TỔNG là tautology trên DB sạch (0 = 0) và bỏ lọt lỗi BÙ TRỪ (hồ sơ A thiếu 1, B thừa 1).
        const { rows } = await direct.query<{ id: string; src: number; dst: number }>(
          `SELECT sp.id,
                jsonb_array_length(sp.allowances) AS src,
                (SELECT count(*)::int FROM salary_profile_items i
                  WHERE i.company_id = sp.company_id AND i.salary_profile_id = sp.id
                    AND i.deleted_at IS NULL) AS dst
           FROM salary_profiles sp
          WHERE sp.deleted_at IS NULL AND jsonb_array_length(sp.allowances) > 0`,
        );
        const bad = rows.filter((r) => Number(r.src) !== Number(r.dst));
        expect(bad, `hồ sơ lệch: ${JSON.stringify(bad)}`).toEqual([]);
      });

      it("E3 mã backfill theo khuôn PC_nnn và KHÔNG đụng tiền tố cấm của catalog", async () => {
        const { rows } = await direct.query<{ component_code: string }>(
          `SELECT DISTINCT component_code FROM salary_profile_items
          WHERE component_code LIKE 'PC\\_%'`,
        );
        for (const r of rows) {
          expect(r.component_code).toMatch(/^PC_\d{3}$/);
        }
      });
    });
  },
);
