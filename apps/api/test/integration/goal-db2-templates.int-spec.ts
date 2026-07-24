import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUDIT_OBJECT_TYPES } from "../../src/db/schema/audit";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * S5-GOAL-DB-2 — Đợt D template phân rã: task_templates + task_template_items (mig 0526) + seed cặp
 *   ('manage','task-template') (mig 0527) + UNION-ADD 'task_template' vào audit CHECK (mig 0528).
 *   Nguồn: DB-11 §6.3/§6.4 · SPEC-10 §11 · plan docs/plans/S5-GOAL-DB-2.md. RED-before-GREEN.
 *
 * Gate CỨNG `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env trỏ DB dev chung → hasDb=true nên
 * assert chạm DB chung = ĐỎ-GIẢ; CHỈ chạy trên DB cô lập lane. Ca journal (fs) KHÔNG gate.
 *
 * RED: DB migrate tới 0525 → bảng/pair/audit-value CHƯA có ⇒ suite ĐỎ. GREEN sau 0526–0528.
 *
 * Phủ (plan §3):
 *   1. Cross-tenant deny (RLS+FORCE literal-GUC) — 2 bảng.
 *   2. Soft-delete/grant: app UPDATE ok, DELETE → 42501 (không GRANT DELETE).
 *   3. UNIQUE (company,name) partial-active: trùng → 23505; xoá mềm rồi tái dùng tên → OK.
 *   4. CHECK default_priority: 'bogus' → 23514; 'high' → OK; NULL → OK.
 *   5. Seed-assert: cặp (manage:task-template) is_sensitive=false; manager=Department, company-admin=Company,
 *      employee/hr = KHÔNG.
 *   6. Audit UNION-ADD (head DB THẬT): CHECK ⊇ 'task_template'; NO-LOSS (toàn bộ AUDIT_OBJECT_TYPES + canary
 *      'defect'); app INSERT audit object_type='task_template' OK; object_type lạ vẫn 23514.
 *   7. Audit DO-block 0528 (probe table — NEO 2 TẦNG, KHÔNG chạm audit_logs): idempotent bare/ARRAY + vế phủ
 *      định BARE/ARRAY đứng TRƯỚC allow-list (chống lỗ tầng-1/2 — memory audit-check-union-parse-anchor-trap)
 *      + fail-closed 0-match/2-match.
 *   8. _journal.json fs-integrity (idx liên tục · when tăng ngặt-duy nhất · tag có .sql · 0526–0528 có mặt).
 */

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");
/** File audit PURE của WO này (probe test đọc CẢ file). ⚠ Đổi số thì SỬA CẢ Ở ĐÂY. */
const AUDIT_SQL = join(MIGRATIONS_DIR, "0528_s5_goaldb2_audit_task_template.sql");

const NEW_TYPE = "task_template";
/** Giá trị CHỈ tồn tại trong DB (0086), KHÔNG có trong AUDIT_OBJECT_TYPES — canary chống rewrite-from-TS. */
const DB_ONLY_CANARY = "defect";

/** Khớp 1 giá trị ở BIÊN, phủ cả dạng bare `{a,b,c}` lẫn dạng nháy `'a'` (escape ký tự regex). */
const inCheck = (def: string, value: string): boolean =>
  new RegExp(`[,{']${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[',}]`).test(def);

async function asTenant<T>(
  app: Pool,
  companyId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
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

/** Mã lỗi Postgres của 1 câu lệnh kỳ vọng THẤT BẠI; null nếu nó (bất ngờ) thành công. */
async function errCode(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "UNKNOWN";
  }
}

/** data_scope grant cho (role canonical system, action, resource); null nếu KHÔNG có hàng ALLOW. */
async function grantScope(
  direct: Pool,
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Ca 8 — journal integrity (thuần fs, KHÔNG gate LANE_DB). Canh lỗi drizzle bỏ migration khi `when` trùng.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("S5-GOAL-DB-2 · _journal.json toàn vẹn (fs — không cần DB)", () => {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"),
  ) as { entries: { idx: number; when: number; tag: string }[] };

  it("idx liên tục từ 0", () => {
    journal.entries.forEach((e, i) => {
      expect(e.idx, `entry #${i} (${e.tag}) có idx lệch`).toBe(i);
    });
  });

  it("`when` TĂNG NGẶT và DUY NHẤT (trùng ⇒ migration sau bị bỏ qua vĩnh viễn)", () => {
    const whens = journal.entries.map((e) => e.when);
    expect(new Set(whens).size, "có `when` trùng nhau").toBe(whens.length);
    for (let i = 1; i < journal.entries.length; i++) {
      expect(
        journal.entries[i].when,
        `${journal.entries[i].tag} có when <= ${journal.entries[i - 1].tag}`,
      ).toBeGreaterThan(journal.entries[i - 1].when);
    }
  });

  it("mỗi tag có file .sql tương ứng", () => {
    const files = new Set(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")));
    for (const e of journal.entries) {
      expect(files.has(`${e.tag}.sql`), `thiếu file ${e.tag}.sql`).toBe(true);
    }
  });

  for (const tag of [
    "0526_s5_goaldb2_task_templates",
    "0527_s5_goaldb2_seed_task_template_perm",
    "0528_s5_goaldb2_audit_task_template",
  ]) {
    it(`migration ${tag} có mặt trong journal`, () => {
      expect(
        journal.entries.some((e) => e.tag === tag),
        `journal thiếu ${tag}`,
      ).toBe(true);
    });
  }
});

describe.skipIf(!runIsolatedDb)(
  "S5-GOAL-DB-2 task_templates + seed pair + audit UNION-ADD (mig 0526–0528, DB cô lập LANE_DB)",
  () => {
    const direct = directPool();
    const app = appPool(2);

    let A: SeededTenant;
    let B: SeededTenant;
    let tplA: string;
    let tplB: string;

    async function seedTemplate(companyId: string, name?: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO task_templates (company_id, name) VALUES ($1, $2) RETURNING id`,
        [companyId, name ?? `tpl-${randomUUID().slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    }

    beforeAll(async () => {
      A = await seedCompany(direct, "ttplA");
      B = await seedCompany(direct, "ttplB");
      tplA = await seedTemplate(A.companyId);
      tplB = await seedTemplate(B.companyId);
    });

    afterAll(async () => {
      for (const id of [A?.companyId, B?.companyId].filter(Boolean)) {
        await direct.query("DELETE FROM task_template_items WHERE company_id = $1", [id]);
        await direct.query("DELETE FROM task_templates WHERE company_id = $1", [id]);
      }
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
    });

    // ── 1. Cross-tenant deny (RLS+FORCE literal-GUC) ──────────────────────────────
    describe("1. Cô lập tenant task_templates/items (RLS+FORCE)", () => {
      it("app GUC=A thấy template của A, KHÔNG thấy của B", async () => {
        const seen = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query<{ id: string }>("SELECT id FROM task_templates");
          return new Set(r.rows.map((x) => x.id));
        });
        expect(seen.has(tplA)).toBe(true);
        expect(seen.has(tplB)).toBe(false);
      });

      it("app GUC=A KHÔNG chèn được template company_id=B (WITH CHECK chặn forge tenant)", async () => {
        await expect(
          asTenant(app, A.companyId, (c) =>
            c.query(`INSERT INTO task_templates (company_id, name) VALUES ($1, 'forge')`, [
              B.companyId,
            ]),
          ),
        ).rejects.toThrow(/row-level security/i);
      });

      it("app GUC=A KHÔNG thấy item của B", async () => {
        const itemB = await direct.query(
          `INSERT INTO task_template_items (company_id, template_id, title) VALUES ($1, $2, 'itB') RETURNING id`,
          [B.companyId, tplB],
        );
        const seen = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query<{ id: string }>("SELECT id FROM task_template_items");
          return new Set(r.rows.map((x) => x.id));
        });
        expect(seen.has(itemB.rows[0].id)).toBe(false);
      });

      it("app ngoài ngữ cảnh tenant → 0 template", async () => {
        const c = await app.connect();
        try {
          const r = await c.query("SELECT id FROM task_templates");
          expect(r.rows).toHaveLength(0);
        } finally {
          c.release();
        }
      });
    });

    // ── 2. Soft-delete / grant (BẤT BIẾN #2 — soft-delete = UPDATE, KHÔNG DELETE) ──
    describe("2. Grant soft-delete (app SELECT/INSERT/UPDATE — KHÔNG DELETE)", () => {
      it("app UPDATE task_templates (soft-delete) THÀNH CÔNG", async () => {
        const id = await seedTemplate(A.companyId);
        await asTenant(app, A.companyId, (c) =>
          c.query(`UPDATE task_templates SET deleted_at = now() WHERE id = $1`, [id]),
        );
        const r = await direct.query(`SELECT deleted_at FROM task_templates WHERE id=$1`, [id]);
        expect(r.rows[0].deleted_at).not.toBeNull();
      });

      it("app DELETE task_templates bị TỪ CHỐI (soft-delete only)", async () => {
        await expect(
          asTenant(app, A.companyId, (c) =>
            c.query(`DELETE FROM task_templates WHERE id = $1`, [tplA]),
          ),
        ).rejects.toThrow(/permission denied/);
      });

      it("app DELETE task_template_items bị TỪ CHỐI (soft-delete only)", async () => {
        const it0 = await direct.query(
          `INSERT INTO task_template_items (company_id, template_id, title) VALUES ($1, $2, 'del') RETURNING id`,
          [A.companyId, tplA],
        );
        await expect(
          asTenant(app, A.companyId, (c) =>
            c.query(`DELETE FROM task_template_items WHERE id = $1`, [it0.rows[0].id]),
          ),
        ).rejects.toThrow(/permission denied/);
      });
    });

    // ── 3. UNIQUE (company,name) partial-active ──────────────────────────────────
    describe("3. UNIQUE (company_id, name) WHERE deleted_at IS NULL", () => {
      it("trùng tên (chưa xoá) trong cùng company → 23505", async () => {
        const name = `dup-${randomUUID().slice(0, 8)}`;
        await seedTemplate(A.companyId, name);
        const code = await errCode(() => seedTemplate(A.companyId, name));
        expect(code).toBe("23505");
      });

      it("xoá mềm rồi tái dùng cùng tên → OK (partial index)", async () => {
        const name = `reuse-${randomUUID().slice(0, 8)}`;
        const first = await seedTemplate(A.companyId, name);
        await direct.query(`UPDATE task_templates SET deleted_at = now() WHERE id = $1`, [first]);
        const code = await errCode(() => seedTemplate(A.companyId, name));
        expect(code).toBeNull();
      });

      it("cùng tên nhưng KHÁC company → OK (unique theo company)", async () => {
        const name = `cross-${randomUUID().slice(0, 8)}`;
        await seedTemplate(A.companyId, name);
        const code = await errCode(() => seedTemplate(B.companyId, name));
        expect(code).toBeNull();
      });
    });

    // ── 4. CHECK default_priority (DB-06 §8.5) ───────────────────────────────────
    describe("4. CHECK default_priority", () => {
      async function insertItem(priority: string | null): Promise<string | null> {
        return errCode(() =>
          direct.query(
            `INSERT INTO task_template_items (company_id, template_id, title, default_priority)
             VALUES ($1, $2, 'p', $3)`,
            [A.companyId, tplA, priority],
          ),
        );
      }
      it("default_priority='bogus' → 23514", async () => {
        expect(await insertItem("bogus")).toBe("23514");
      });
      it("default_priority='high' → OK", async () => {
        expect(await insertItem("high")).toBeNull();
      });
      it("default_priority=NULL → OK", async () => {
        expect(await insertItem(null)).toBeNull();
      });
    });

    // ── 5. Seed-assert cặp (manage:task-template) (mig 0527) ─────────────────────
    describe("5. Seed quyền (manage:task-template)", () => {
      it("cặp tồn tại, is_sensitive=false", async () => {
        const r = await direct.query<{ is_sensitive: boolean }>(
          `SELECT is_sensitive FROM permissions WHERE action='manage' AND resource_type='task-template'`,
        );
        expect(r.rows.length).toBe(1);
        expect(r.rows[0].is_sensitive).toBe(false);
      });

      it("manager = Department", async () => {
        expect(await grantScope(direct, "manager", "manage", "task-template")).toBe("Department");
      });
      it("company-admin = Company", async () => {
        expect(await grantScope(direct, "company-admin", "manage", "task-template")).toBe(
          "Company",
        );
      });
      it("employee KHÔNG có (D2)", async () => {
        expect(await grantScope(direct, "employee", "manage", "task-template")).toBeNull();
      });
      it("hr KHÔNG có (D2)", async () => {
        expect(await grantScope(direct, "hr", "manage", "task-template")).toBeNull();
      });
      it("tổng grant = 2 cho 4 role canonical (chống over/under-grant)", async () => {
        const r = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name = ANY($1) AND r.company_id IS NULL AND r.deleted_at IS NULL
              AND rp.effect='ALLOW' AND p.action='manage' AND p.resource_type='task-template'`,
          [["employee", "manager", "hr", "company-admin"]],
        );
        expect(r.rows[0].n).toBe(2);
      });
    });

    // ── 6. Audit UNION-ADD trên head DB THẬT (mig 0528) ──────────────────────────
    describe("6. audit_logs CHECK object_type += task_template", () => {
      async function checkDef(): Promise<string> {
        const r = await direct.query<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid='audit_logs'::regclass AND contype='c' AND conname LIKE '%object_type%'`,
        );
        expect(r.rows.length, "phải có ĐÚNG 1 CHECK object_type trên audit_logs").toBe(1);
        return r.rows[0].def;
      }

      it("CHECK ⊇ 'task_template'", async () => {
        expect(inCheck(await checkDef(), NEW_TYPE)).toBe(true);
      });

      it("NO-LOSS: CHECK ⊇ toàn bộ AUDIT_OBJECT_TYPES (mảng TS)", async () => {
        const def = await checkDef();
        const missing = AUDIT_OBJECT_TYPES.filter((t) => !inCheck(def, t));
        expect(missing, `CHECK thiếu ${missing.length} giá trị của mảng TS`).toEqual([]);
      });

      it(`NO-LOSS canary: CHECK vẫn giữ '${DB_ONLY_CANARY}' (chỉ có ở DB)`, async () => {
        expect(inCheck(await checkDef(), DB_ONLY_CANARY)).toBe(true);
      });

      it("app INSERT audit object_type='task_template' (company_id từ GUC) OK", async () => {
        const row = await asTenant(app, A.companyId, async (c) => {
          const r = await c.query<{ company_id: string }>(
            `INSERT INTO audit_logs (action, object_type, object_id)
             VALUES ('create', $1, $2) RETURNING company_id`,
            [NEW_TYPE, randomUUID()],
          );
          return r.rows[0];
        });
        expect(row.company_id).toBe(A.companyId);
      });

      it("object_type lạ vẫn 23514 (không nới thành free-text)", async () => {
        const code = await errCode(() =>
          asTenant(app, A.companyId, (c) =>
            c.query(`INSERT INTO audit_logs (action, object_type) VALUES ('x', 'tpl_bogus')`),
          ),
        );
        expect(code).toBe("23514");
      });
    });

    // ── 7. DO-block 0528 trên PROBE TABLE — NEO 2 TẦNG + fail-closed (KHÔNG chạm audit_logs) ──
    describe("7. Idempotent + NEO 2 tầng của 0528 (probe table)", () => {
      /** Đọc file 0528 (pure-audit), đổi tên bảng đích sang probe, tách statement. */
      function stmtsFor(probe: string): string[] {
        return readFileSync(AUDIT_SQL, "utf8")
          .replaceAll("audit_logs", probe)
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }

      /** Tập giá trị allow-list hiện có trong CHECK của probe (đọc dạng bare `{…}` sau khi 0528 re-stamp). */
      async function probeValues(c: PoolClient, probe: string): Promise<string[]> {
        const r = await c.query<{ def: string }>(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid=$1::regclass AND contype='c' AND conname LIKE '%object_type%'`,
          [probe],
        );
        const def = r.rows[0].def;
        const bare = def.match(/\{[^}]*\}/);
        if (bare)
          return bare[0]
            .slice(1, -1)
            .split(",")
            .map((s) => s.replace(/^"|"$/g, ""));
        return [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      }

      /** Dựng probe table + CHECK theo `setup`, chạy `fn`, ROLLBACK cuối (hermetic). */
      async function onProbe<T>(
        setup: (probe: string) => string | null,
        fn: (ctx: {
          c: PoolClient;
          probe: string;
          run: () => Promise<void>;
          values: () => Promise<string[]>;
        }) => Promise<T>,
      ): Promise<T> {
        const probe = `probe_ttpl_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
        const c = await direct.connect();
        try {
          await c.query("BEGIN");
          await c.query(`CREATE TABLE ${probe} (id serial PRIMARY KEY, object_type text NOT NULL)`);
          const ddl = setup(probe);
          if (ddl) await c.query(ddl);
          return await fn({
            c,
            probe,
            run: async () => {
              for (const s of stmtsFor(probe)) await c.query(s);
            },
            values: () => probeValues(c, probe),
          });
        } finally {
          await c.query("ROLLBACK").catch(() => undefined);
          c.release();
        }
      }

      const SHAPES: { name: string; check: (probe: string) => string }[] = [
        {
          name: "bare '{a,b}'::text[]",
          check: (p) =>
            `ALTER TABLE ${p} ADD CONSTRAINT ${p}_object_type_chk
               CHECK (object_type = ANY ('{company,user,defect}'::text[]))`,
        },
        {
          name: "ARRAY['a'::text, …]",
          check: (p) =>
            `ALTER TABLE ${p} ADD CONSTRAINT ${p}_object_type_chk
               CHECK (object_type = ANY (ARRAY['company'::text, 'user'::text, 'defect'::text]))`,
        },
      ];

      for (const shape of SHAPES) {
        it(`dạng ${shape.name}: chạy 2 lần → union đúng, lần 2 không đổi`, async () => {
          await onProbe(shape.check, async ({ run, values }) => {
            const before = await values();
            await run();
            const after1 = await values();
            expect([...after1].sort()).toEqual([...new Set([...before, NEW_TYPE])].sort());
            await run();
            expect([...(await values())].sort()).toEqual([...after1].sort());
          });
        });
      }

      it("tên constraint KHÔNG chuẩn nhưng khớp LIKE (đúng 1) → vẫn union đúng", async () => {
        await onProbe(
          (p) =>
            `ALTER TABLE ${p} ADD CONSTRAINT ${p}_custom_object_type_guard
               CHECK (object_type = ANY ('{company,user}'::text[]))`,
          async ({ run, values }) => {
            await run();
            expect([...(await values())].sort()).toEqual(["company", NEW_TYPE, "user"].sort());
          },
        );
      });

      // ── NEO TẦNG-1 (bare): vế phủ định `{ghost}` đứng TRƯỚC allow-list. Đây là lỗ 0509 KHÔNG phủ (0509
      //    chỉ test vế phủ định dạng ARRAY, đặt SAU allow-list). Trên tầng-1 CHƯA-NEO: parse nhặt {ghost}
      //    ⇒ mất company/user + nuốt ghost ⇒ ca này ĐỎ. NEO `object_type = ANY` ⇒ XANH.
      it("vế phủ định BARE trước allow-list → KHÔNG hút 'ghost', GIỮ company/user (neo tầng-1)", async () => {
        await onProbe(
          (p) =>
            `ALTER TABLE ${p} ADD CONSTRAINT ${p}_object_type_chk
               CHECK (object_type <> ALL('{ghost}'::text[])
                      AND object_type = ANY('{company,user}'::text[]))`,
          async ({ run, values }) => {
            await run();
            const after = await values();
            expect(after, "'ghost' (vế cấm) KHÔNG được lọt allow-list").not.toContain("ghost");
            expect([...after].sort()).toEqual(["company", NEW_TYPE, "user"].sort());
          },
        );
      });

      // ── NEO TẦNG-2 (ARRAY): vế phủ định ARRAY đứng TRƯỚC allow-list (0509 đặt SAU nên không phủ ca này).
      it("vế phủ định ARRAY trước allow-list → KHÔNG hút 'ghost', GIỮ company (neo tầng-2)", async () => {
        await onProbe(
          (p) =>
            `ALTER TABLE ${p} ADD CONSTRAINT ${p}_object_type_chk
               CHECK (object_type <> ALL(ARRAY['ghost'::text])
                      AND object_type = ANY(ARRAY['company'::text]))`,
          async ({ run, values }) => {
            await run();
            const after = await values();
            expect(after).not.toContain("ghost");
            expect([...after].sort()).toEqual(["company", NEW_TYPE].sort());
          },
        );
      });

      it("0 constraint object_type → THROW fail-closed", async () => {
        await onProbe(
          () => null,
          async ({ run }) => {
            await expect(run()).rejects.toThrow(/so match = 0|fail-closed/i);
          },
        );
      });

      it("2 constraint khớp LIKE → THROW (không đoán bừa)", async () => {
        await onProbe(
          (p) => `ALTER TABLE ${p} ADD CONSTRAINT ${p}_a_object_type_chk
                    CHECK (object_type = ANY ('{company}'::text[]))`,
          async ({ c, probe, run }) => {
            await c.query(`ALTER TABLE ${probe} ADD CONSTRAINT ${probe}_b_object_type_chk
                             CHECK (object_type <> 'nope')`);
            await expect(run()).rejects.toThrow(/so match = 2|fail-closed/i);
          },
        );
      });
    });
  },
);
