/**
 * S5-LMS-DB-1 — migration 0509 UNION-ADD `lms_sso` + `lms_sync` vào CHECK `audit_logs.object_type`
 * (plan `docs/plans/S5-LMS-DB-1.md`, wave S5-LMS §4 B03). Postgres THẬT, DB CÔ LẬP. RED-before-GREEN.
 *
 * Gate CỨNG `hasDb && LANE_DB` cho mọi ca chạm DB (memory `integration-test-lane-db-gate`: `.env` trỏ
 * DB dev chung ⇒ hasDb=true nhưng DB đó thiếu migration band ⇒ đỏ-giả). Ca 6 (journal) thuần-fs nên
 * KHÔNG gate — nó canh một lỗi im lặng (`when` trùng) mà không cần Postgres.
 *
 * Phủ (plan §3):
 *   1. CHECK ⊇ 'lms_sso' + 'lms_sync' (khớp biên — phủ cả dạng bare `{a,b}` lẫn quoted `'a'`).
 *   2. NO-LOSS: CHECK ⊇ TOÀN BỘ `AUDIT_OBJECT_TYPES` + canary `defect` (giá trị CHỈ có ở DB, KHÔNG có
 *      trong mảng TS — 0086 thêm, xem audit.ts:159-160). Đây là ca DUY NHẤT bắt được lỗi nguy hiểm nhất
 *      của WO: DO-block DROP+ADD dựng lại constraint từ snapshot ⇒ mất giá trị cũ ⇒ audit đang chạy vỡ.
 *   3. app role INSERT audit_logs 2 object_type mới (company_id resolve từ GUC).
 *   4. object_type lạ vẫn 23514 (CHECK không bị nới thành free-text).
 *   5. Idempotent trên ARTIFACT THẬT qua PROBE TABLE (KHÔNG chạm audit_logs — xem ghi chú dưới).
 *   6. Journal integrity: idx liên tục · `when` tăng ngặt + DUY NHẤT · mỗi tag có file .sql.
 *   7. Append-only còn nguyên sau DROP+ADD CONSTRAINT (grant + trigger 0472).
 *
 * ⚠ VÌ SAO CA 5 DÙNG PROBE TABLE, KHÔNG CHẠM `audit_logs`: CI đặt `LANE_DB=mediaos` — MỘT DB dùng chung
 * cho ~128 file int-spec chạy song song. `ALTER TABLE audit_logs DROP CONSTRAINT` trong test sẽ lấy
 * ACCESS EXCLUSIVE và chặn/deadlock INSERT audit của suite khác ⇒ đỏ-giả ngẫu nhiên ở spec KHÔNG liên quan.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUDIT_OBJECT_TYPES } from "../../src/db/schema/audit";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

const runIsolatedDb = hasDb && !!process.env.LANE_DB;

const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");
/** Tên file migration của WO này. ⚠ Đổi số (va với S5-GOAL-DB-2) thì SỬA CẢ Ở ĐÂY — plan §2 Bước 0. */
const MIGRATION_SQL = join(MIGRATIONS_DIR, "0509_s5_lmsdb1_audit_lms_object_types.sql");

/** 2 giá trị object_type WO này mở. */
const NEW_TYPES = ["lms_sso", "lms_sync"] as const;
/** Giá trị CHỈ tồn tại trong DB (0086), KHÔNG có trong AUDIT_OBJECT_TYPES — canary chống rewrite-from-TS. */
const DB_ONLY_CANARY = "defect";

/** Khớp 1 giá trị ở BIÊN, phủ cả dạng bare `{a,b,c}` lẫn dạng nháy `'a'` (0474 re-stamp dạng bare).
 *  Escape giá trị: hôm nay không object_type nào chứa ký tự đặc biệt regex, nhưng khi mai có
 *  (`.`/`+`/`|`/`(`) thì chuỗi chưa escape thành false-positive IM LẶNG. */
const inCheck = (def: string, value: string): boolean =>
  new RegExp(`[,{']${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[',}]`).test(def);

/** Chạy fn trong 1 transaction app-role có ngữ cảnh tenant (set_config txn-local — PgBouncer txn-mode). */
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Ca 6 — journal integrity (thuần fs, KHÔNG cần Postgres nên KHÔNG gate LANE_DB).
// Canh lỗi CHẾT NGƯỜI mà không test nào khác bắt: drizzle áp migration theo `when` TĂNG NGẶT ⇒ hai
// entry cùng `when` (rất dễ xảy ra khi resolve conflict _journal.json giữa 2 WO song song) khiến cái
// sau KHÔNG BAO GIỜ CHẠY, im lặng: CI xanh, PROD 23514.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("S5-LMS-DB-1 · _journal.json toàn vẹn (fs — không cần DB)", () => {
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

  it("migration 0509 của WO này có mặt trong journal", () => {
    const tag = MIGRATION_SQL.split(/[\\/]/)
      .pop()!
      .replace(/\.sql$/, "");
    expect(
      journal.entries.some((e) => e.tag === tag),
      `journal thiếu entry ${tag}`,
    ).toBe(true);
  });
});

describe.skipIf(!runIsolatedDb)(
  "S5-LMS-DB-1 · CHECK audit_logs.object_type += lms_sso/lms_sync (mig 0509)",
  () => {
    let direct: Pool;
    let app: Pool;
    let tenant: SeededTenant;
    const companyIds: string[] = [];

    beforeAll(async () => {
      direct = directPool();
      app = appPool();
      tenant = await seedCompany(direct, "lmsaudit");
      companyIds.push(tenant.companyId);
    });

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await app.end();
      await direct.end();
    });

    /** constraintdef THẬT của CHECK object_type. */
    async function checkDef(): Promise<string> {
      const r = await direct.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid='audit_logs'::regclass AND contype='c' AND conname LIKE '%object_type%'`,
      );
      expect(r.rows.length, "phải có ĐÚNG 1 CHECK object_type trên audit_logs").toBe(1);
      return r.rows[0].def;
    }

    // ── 1. Hai giá trị mới có trong CHECK ──
    for (const t of NEW_TYPES) {
      it(`CHECK object_type ⊇ '${t}'`, async () => {
        expect(inCheck(await checkDef(), t)).toBe(true);
      });
    }

    // ── 2. NO-LOSS: không giá trị cũ nào bị đánh rơi khi DROP+ADD CONSTRAINT ──
    it("NO-LOSS: CHECK ⊇ toàn bộ AUDIT_OBJECT_TYPES (mảng TS) sau migration", async () => {
      const def = await checkDef();
      const missing = AUDIT_OBJECT_TYPES.filter((t) => !inCheck(def, t));
      expect(missing, `CHECK thiếu ${missing.length} giá trị của mảng TS`).toEqual([]);
    });

    it(`NO-LOSS canary: CHECK vẫn giữ '${DB_ONLY_CANARY}' (chỉ có ở DB, KHÔNG có trong mảng TS)`, async () => {
      // Nếu ca này đỏ ⇒ DO-block đã dựng lại CHECK từ snapshot TS thay vì cộng dồn từ pg_constraint
      // ⇒ mọi audit_logs cũ mang object_type ngoài mảng TS sẽ 23514. Bất biến #2 (append-only) vỡ.
      expect(inCheck(await checkDef(), DB_ONLY_CANARY)).toBe(true);
    });

    // ── 3/4. Đường ghi THẬT của BE-1/BE-2 ──
    for (const t of NEW_TYPES) {
      it(`app role INSERT audit_logs object_type='${t}' thành công, company_id từ GUC`, async () => {
        const row = await asTenant(app, tenant.companyId, async (c) => {
          const r = await c.query<{ company_id: string }>(
            `INSERT INTO audit_logs (action, object_type, object_id)
             VALUES ($1, $2, $3) RETURNING company_id`,
            [t === "lms_sso" ? "sso_link_minted" : "lms_user_sync", t, randomUUID()],
          );
          return r.rows[0];
        });
        expect(row.company_id).toBe(tenant.companyId);
      });
    }

    it("object_type lạ vẫn bị CHECK chặn (23514) — không nới thành free-text", async () => {
      const code = await errCode(() =>
        asTenant(app, tenant.companyId, (c) =>
          c.query(`INSERT INTO audit_logs (action, object_type) VALUES ('x', 'lms_bogus')`),
        ),
      );
      expect(code).toBe("23514");
    });

    // ── 5. Idempotent trên artifact THẬT, cách ly hoàn toàn khỏi audit_logs ──
    describe("5. Idempotent của 0509 (probe table — KHÔNG chạm audit_logs)", () => {
      /** Đọc file migration, đổi tên bảng đích sang probe, tách statement. */
      function stmtsFor(probe: string): string[] {
        return readFileSync(MIGRATION_SQL, "utf8")
          .replaceAll("audit_logs", probe)
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }

      /** Tập giá trị hiện có trong CHECK của probe table. */
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

      // 2 dạng constraintdef THẬT tồn tại trong DB này: bare (audit_logs_object_type_chk sau 0474)
      // và ARRAY[...::text] (dạng Postgres render khi ADD CONSTRAINT viết bằng ARRAY literal —
      // xem chk_audit_logs_actor_type). DO-block phải xử được CẢ HAI.
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

      /** Dựng probe table + CHECK theo `setup`, chạy `runs` lượt migration, ROLLBACK cuối (hermetic). */
      async function onProbe<T>(
        setup: (probe: string) => string | null,
        fn: (ctx: {
          c: PoolClient;
          probe: string;
          run: () => Promise<void>;
          values: () => Promise<string[]>;
        }) => Promise<T>,
      ): Promise<T> {
        const probe = `probe_audit_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

      for (const shape of SHAPES) {
        it(`dạng ${shape.name}: chạy 2 lần → union đúng, lần 2 không đổi gì`, async () => {
          await onProbe(shape.check, async ({ run, values }) => {
            const before = await values();
            await run();
            const after1 = await values();

            // union = cũ ∪ {lms_sso, lms_sync}; KHÔNG mất giá trị nào
            expect([...after1].sort()).toEqual([...new Set([...before, ...NEW_TYPES])].sort());

            await run(); // lần 2
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
            expect([...(await values())].sort()).toEqual(["company", "user", ...NEW_TYPES].sort());
          },
        );
      });

      // ── Các nhánh FAIL-CLOSED (điểm khác biệt cốt lõi vs mẫu 0506, vốn chỉ NOTICE + RETURN).
      //    Không pin bằng test thì một lần sửa sau này có thể lặng lẽ đưa fail-open trở lại mà suite vẫn xanh.
      it("KHÔNG có constraint object_type nào (0 match) → migration THROW, không im lặng bỏ qua", async () => {
        await onProbe(
          () => null,
          async ({ run }) => {
            await expect(run()).rejects.toThrow(/so match = 0|fail-closed/i);
          },
        );
      });

      it("có 2 constraint khớp LIKE → migration THROW (không đoán bừa cái nào)", async () => {
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

      it("CHECK hợp thành có vế PHỦ ĐỊNH → KHÔNG hút giá trị bị cấm vào danh sách cho phép (no-gain)", async () => {
        // Bẫy thật: quét nháy đơn trên CẢ constraintdef sẽ nhặt 'ghost_value' từ vế `<> 'ghost_value'`
        // ⇒ giá trị đang bị CẤM tường minh lại được cho phép, chỉ kèm 1 NOTICE. Tầng 2 phải neo vào ARRAY[…].
        await onProbe(
          (p) =>
            `ALTER TABLE ${p} ADD CONSTRAINT ${p}_object_type_chk
               CHECK (object_type = ANY (ARRAY['company'::text, 'user'::text])
                      AND object_type <> 'ghost_value')`,
          async ({ run, values }) => {
            await run();
            const after = await values();
            expect(after).not.toContain("ghost_value");
            expect([...after].sort()).toEqual(["company", "user", ...NEW_TYPES].sort());
          },
        );
      });
    });

    // ── 7. DROP+ADD CONSTRAINT KHÔNG được đụng lớp append-only (grant 0472 + trigger) ──
    describe("7. Append-only audit_logs còn nguyên sau khi swap constraint", () => {
      for (const priv of ["UPDATE", "DELETE"]) {
        it(`mediaos_app KHÔNG có quyền ${priv} trên audit_logs`, async () => {
          const r = await direct.query<{ ok: boolean }>(
            `SELECT has_table_privilege('mediaos_app','audit_logs',$1) AS ok`,
            [priv],
          );
          expect(r.rows[0].ok).toBe(false);
        });
      }

      it("trigger chặn mutation (0472) vẫn tồn tại", async () => {
        const r = await direct.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_trigger
            WHERE tgrelid='audit_logs'::regclass AND NOT tgisinternal
              AND tgname = 'trg_audit_logs_block_mutation'`,
        );
        expect(Number(r.rows[0].n)).toBe(1);
      });
    });
  },
);
