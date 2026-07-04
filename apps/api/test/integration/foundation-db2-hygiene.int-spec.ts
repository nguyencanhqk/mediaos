import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S2-FND-DB-2-A-mig — DB hygiene theo DB-09 §8.5–8.9 (migration 0472). DB-behavior int-spec:
 *  (A) 5 index canonical tồn tại ĐÚNG shape/predicate (assert pg_indexes.indexdef, KHÔNG chỉ tên).
 *  (B) uq_file_links_entity_file_active — UNIQUE partial 6 cột + enforcement (dup → 23505; khác file_id → ok).
 *  (C) DEDUP correctness (temp table mirror + dedup SQL y hệt migration): giữ 1 hàng theo
 *      is_primary DESC, created_at ASC, id ASC; link khác file_id KHÔNG bị soft-delete nhầm.
 *  (D) 2-tenant isolation: link giống-hệt-business-key ở A và B KHÔNG đụng uq (company_id trong khoá).
 *  (E) audit_logs append-only 2 LỚP (BẤT BIẾN #2 / QA-06):
 *        lớp-1 REVOKE (0432): app-role UPDATE/DELETE → 'permission denied' (chưa tới trigger).
 *        lớp-2 TRIGGER (0472): kể cả khi GRANT UPDATE/DELETE cho mediaos_app (trong tx rollback → KHÔNG rò ra
 *          connection khác) → BỊ CHẶN bởi trigger, message chứa 'append-only' (ĐỘC LẬP với grant lớp-1).
 *        POSITIVE: superuser/directPool UPDATE VÀ DELETE audit_logs THÀNH CÔNG (denylist chỉ trúng mediaos_app
 *          → KHÔNG brick retention/archive job).
 *  (F) function + trigger tồn tại đúng shape (pg_proc / pg_trigger).
 *
 * Gate: hasDb (DATABASE_DIRECT_URL+URL) + LANE_DB (DB cô lập theo lane). Thiếu LANE_DB → SKIP để KHÔNG chạm
 * DB dev chung 'mediaos' (memory: integration-test-lane-db-gate, CLAUDE.md §9.5). audit_logs = crown-jewel.
 */

const hasLaneDb = hasDb && !!process.env.LANE_DB;

interface PgLikeError {
  code?: string;
  constraint?: string;
  message?: string;
}
function pgErr(e: unknown): PgLikeError {
  return (e ?? {}) as PgLikeError;
}

// 5 index canonical DB-09 (mig 0472) + kỳ vọng shape (token phải xuất hiện trong pg_indexes.indexdef).
const CANONICAL_INDEXES: ReadonlyArray<{
  name: string;
  table: string;
  mustContain: readonly string[];
}> = [
  {
    name: "idx_files_company_status",
    table: "files",
    mustContain: [
      "company_id",
      "upload_status",
      "uploaded_at",
      "DESC",
      "WHERE (deleted_at IS NULL)",
    ],
  },
  {
    name: "idx_files_cleanup_deleted",
    table: "files",
    mustContain: ["deleted_at", "WHERE (deleted_at IS NOT NULL)"],
  },
  {
    name: "idx_file_access_logs_company_time",
    table: "file_access_logs",
    mustContain: ["company_id", "created_at", "DESC"],
  },
  {
    name: "idx_sequence_counters_reset",
    table: "sequence_counters",
    // predicate PascalCase khớp CHECK 0434; Postgres normalize IN (...) → = ANY (ARRAY[...]).
    mustContain: ["reset_policy", "last_reset_at", "Yearly", "Monthly", "Daily"],
  },
  {
    name: "idx_audit_logs_company_entity",
    table: "audit_logs",
    mustContain: ["company_id", "entity_type", "entity_id", "created_at", "DESC"],
  },
];

describe.skipIf(!hasLaneDb)(
  "S2-FND-DB-2 DB hygiene (mig 0472) — index/uq/audit append-only lớp-2",
  () => {
    const direct = directPool();
    const app = appPool();

    let A: SeededTenant;
    let B: SeededTenant;
    let userA: string;
    let userB: string;
    let fileA1: string;
    let fileA2: string;
    let fileB1: string;
    let auditRowId: string;

    async function seedFile(companyId: string, userId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO files
         (company_id, original_name, stored_name, mime_type, file_size_bytes, storage_provider, storage_path, uploaded_by)
       VALUES ($1, 'o.pdf', $2, 'application/pdf', 10, 'S3', $3, $4)
       RETURNING id`,
        [companyId, `s-${randomUUID()}.pdf`, `path/${randomUUID()}.pdf`, userId],
      );
      return r.rows[0].id as string;
    }

    /** INSERT file_link qua direct (superuser bypass RLS) — company_id tường minh. Trả về id. */
    async function seedLink(opts: {
      companyId: string;
      fileId: string;
      userId: string;
      moduleCode: string;
      entityType: string;
      entityId: string;
      linkType: string;
      isPrimary?: boolean;
    }): Promise<string> {
      const r = await direct.query(
        `INSERT INTO file_links
         (company_id, file_id, module_code, entity_type, entity_id, link_type, is_primary, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
        [
          opts.companyId,
          opts.fileId,
          opts.moduleCode,
          opts.entityType,
          opts.entityId,
          opts.linkType,
          opts.isPrimary ?? false,
          opts.userId,
        ],
      );
      return r.rows[0].id as string;
    }

    beforeAll(async () => {
      A = await seedCompany(direct, "db2-a");
      B = await seedCompany(direct, "db2-b");
      userA = await seedUser(direct, A.companyId, `a-${randomUUID()}@t.local`);
      userB = await seedUser(direct, B.companyId, `b-${randomUUID()}@t.local`);
      fileA1 = await seedFile(A.companyId, userA);
      fileA2 = await seedFile(A.companyId, userA);
      fileB1 = await seedFile(B.companyId, userB);

      const l = await direct.query(
        `INSERT INTO audit_logs (company_id, action, object_type) VALUES ($1, 'seed', 'company') RETURNING id`,
        [A.companyId],
      );
      auditRowId = l.rows[0].id as string;
    });

    afterAll(async () => {
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
    });

    /** Chạy fn bằng app role (mediaos_app) với tenant context set (PgBouncer txn-mode compat). */
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

    // ── (A) Presence + shape: 5 index canonical DB-09 (assert indexdef, KHÔNG chỉ tên) ──────────────
    describe("(A) 5 index canonical DB-09 tồn tại đúng shape/predicate", () => {
      for (const idx of CANONICAL_INDEXES) {
        it(`${idx.name} tồn tại trên ${idx.table} + đủ token shape`, async () => {
          const res = await direct.query<{ indexdef: string }>(
            `SELECT indexdef FROM pg_indexes WHERE tablename = $1 AND indexname = $2`,
            [idx.table, idx.name],
          );
          expect(res.rows.length, `index ${idx.name} phải tồn tại (mig 0472)`).toBe(1);
          const def = res.rows[0].indexdef;
          for (const token of idx.mustContain) {
            expect(def, `${idx.name}.indexdef phải chứa '${token}' — shape sai`).toContain(token);
          }
        });
      }

      it("idx_file_access_logs_company_time KHÔNG trùng file_access_logs_company_id_idx (cả 2 cùng tồn tại)", async () => {
        const res = await direct.query<{ indexname: string }>(
          `SELECT indexname FROM pg_indexes
          WHERE tablename = 'file_access_logs'
            AND indexname IN ('idx_file_access_logs_company_time', 'file_access_logs_company_id_idx')`,
        );
        const names = res.rows.map((r) => r.indexname).sort();
        expect(names).toEqual([
          "file_access_logs_company_id_idx",
          "idx_file_access_logs_company_time",
        ]);
      });

      it("idx_audit_logs_entity (0432, module_code-led) GIỮ NGUYÊN — KHÔNG bị DROP", async () => {
        const res = await direct.query<{ indexdef: string }>(
          `SELECT indexdef FROM pg_indexes WHERE tablename = 'audit_logs' AND indexname = 'idx_audit_logs_entity'`,
        );
        expect(res.rows.length, "idx_audit_logs_entity (0432) phải còn sống").toBe(1);
        expect(res.rows[0].indexdef).toContain("module_code");
      });
    });

    // ── (B) uq_file_links_entity_file_active — shape + enforcement ───────────────────────────────────
    describe("(B) uq_file_links_entity_file_active — UNIQUE partial 6 cột + enforcement", () => {
      it("tồn tại UNIQUE partial 6 cột WHERE deleted_at IS NULL", async () => {
        const res = await direct.query<{ indexdef: string }>(
          `SELECT indexdef FROM pg_indexes
          WHERE tablename = 'file_links' AND indexname = 'uq_file_links_entity_file_active'`,
        );
        expect(res.rows.length, "uq_file_links_entity_file_active phải tồn tại (mig 0472)").toBe(1);
        const def = res.rows[0].indexdef;
        expect(def).toContain("UNIQUE");
        for (const col of [
          "company_id",
          "module_code",
          "entity_type",
          "entity_id",
          "file_id",
          "link_type",
        ]) {
          expect(def, `uq indexdef phải chứa cột '${col}'`).toContain(col);
        }
        expect(def).toContain("WHERE (deleted_at IS NULL)");
      });

      it("uq_file_links_primary_per_entity_type (0433, 5 cột is_primary) GIỮ NGUYÊN — khác ngữ nghĩa", async () => {
        const res = await direct.query<{ indexdef: string }>(
          `SELECT indexdef FROM pg_indexes
          WHERE tablename = 'file_links' AND indexname = 'uq_file_links_primary_per_entity_type'`,
        );
        expect(res.rows.length, "uq is_primary (0433) phải còn sống").toBe(1);
        expect(res.rows[0].indexdef).toContain("is_primary");
      });

      it("INSERT trùng ĐÚNG 6-cột key (active) → 23505; khác file_id cùng entity → ok", async () => {
        const eid = randomUUID();
        const base = {
          companyId: A.companyId,
          userId: userA,
          moduleCode: "HR",
          entityType: "employee",
          entityId: eid,
          linkType: "Attachment",
        };
        // 1) link đầu (file A1) — ok.
        const first = await seedLink({ ...base, fileId: fileA1, isPrimary: true });
        expect(first).toBeTruthy();

        // 2) link TRÙNG y hệt 6-cột (cùng file A1) → uq violation 23505.
        let caught: unknown;
        try {
          await seedLink({ ...base, fileId: fileA1, isPrimary: false });
        } catch (e) {
          caught = e;
        }
        expect(caught, "link trùng 6-cột active phải bị chặn").toBeDefined();
        expect(pgErr(caught).code, "phải là unique_violation 23505").toBe("23505");
        expect(pgErr(caught).constraint ?? pgErr(caught).message ?? "").toContain(
          "uq_file_links_entity_file_active",
        );

        // 3) khác file_id (file A2) cùng entity → khoá 6-cột KHÁC → ok.
        const other = await seedLink({ ...base, fileId: fileA2, isPrimary: false });
        expect(other, "link khác file_id cùng entity phải insert được").toBeTruthy();
      });
    });

    // ── (C) DEDUP correctness (temp table mirror + dedup SQL y hệt migration 0472) ───────────────────
    describe("(C) dedup file_links — giữ 1 theo is_primary DESC, created_at ASC, id ASC", () => {
      it("dup 6-cột (kèm 2 is_primary) → giữ đúng 1 winner; khác file_id KHÔNG bị soft-delete", async () => {
        const c = await direct.connect();
        try {
          await c.query("BEGIN");
          // Temp table mirror cấu trúc file_links (subset cột dedup) — ON COMMIT DROP + rollback.
          await c.query(`
          CREATE TEMP TABLE dedup_probe (
            id uuid PRIMARY KEY,
            company_id uuid, module_code varchar(50), entity_type varchar(100),
            entity_id uuid, file_id uuid, link_type varchar(100),
            is_primary boolean, created_at timestamptz, deleted_at timestamptz
          ) ON COMMIT DROP
        `);

          const co = randomUUID();
          const eid = randomUUID();
          const fid1 = randomUUID(); // group 1: is_primary tiebreak
          const fid2 = randomUUID(); // control: khác file_id
          const fid3 = randomUUID(); // group 2: id-ASC tiebreak

          // GROUP 1 (fid1): A primary/T1, B primary/T2, C non-primary/T0(sớm nhất).
          //   is_primary DESC ⇒ A,B trước C; created_at ASC giữa 2 primary ⇒ A thắng. winner=A.
          const idA = "11111111-1111-1111-1111-111111111111";
          const idB = "22222222-2222-2222-2222-222222222222";
          const idC = "33333333-3333-3333-3333-333333333333";
          // CONTROL (fid2): D — khoá 6-cột KHÁC (file_id khác) ⇒ rn=1 ⇒ giữ.
          const idD = "44444444-4444-4444-4444-444444444444";
          // GROUP 2 (fid3): E,F non-primary, created_at BẰNG NHAU ⇒ id ASC ⇒ E(id thấp) thắng.
          const idE = "55555555-5555-5555-5555-555555555555";
          const idF = "66666666-6666-6666-6666-666666666666";

          const rows: Array<[string, string, boolean, string]> = [
            // [id, file_id, is_primary, created_at]
            [idA, fid1, true, "2026-01-01T10:00:00Z"],
            [idB, fid1, true, "2026-01-01T11:00:00Z"],
            [idC, fid1, false, "2026-01-01T09:00:00Z"],
            [idD, fid2, false, "2026-01-01T12:00:00Z"],
            [idE, fid3, false, "2026-01-02T08:00:00Z"],
            [idF, fid3, false, "2026-01-02T08:00:00Z"],
          ];
          for (const [id, fileId, isPrimary, createdAt] of rows) {
            await c.query(
              `INSERT INTO dedup_probe
               (id, company_id, module_code, entity_type, entity_id, file_id, link_type, is_primary, created_at, deleted_at)
             VALUES ($1, $2, 'HR', 'employee', $3, $4, 'Attachment', $5, $6::timestamptz, NULL)`,
              [id, co, eid, fileId, isPrimary, createdAt],
            );
          }

          // Dedup SQL Y HỆT migration 0472 (mirror — thứ tự is_primary DESC, created_at ASC, id ASC).
          await c.query(`
          WITH ranked AS (
            SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY company_id, module_code, entity_type, entity_id, file_id, link_type
                ORDER BY is_primary DESC, created_at ASC, id ASC
              ) AS rn
            FROM dedup_probe
            WHERE deleted_at IS NULL
          )
          UPDATE dedup_probe f SET deleted_at = now()
          FROM ranked WHERE f.id = ranked.id AND ranked.rn > 1
        `);

          const active = await c.query<{ id: string }>(
            `SELECT id FROM dedup_probe WHERE deleted_at IS NULL ORDER BY id`,
          );
          const activeIds = active.rows.map((r) => r.id);

          // group1 winner = A; control D còn sống; group2 winner = E (id ASC). B,C,F soft-deleted.
          expect(activeIds).toEqual([idA, idD, idE]);

          // Khẳng định phần dư ĐÃ soft-delete (deleted_at NOT NULL) — không hard-delete.
          const deleted = await c.query<{ id: string }>(
            `SELECT id FROM dedup_probe WHERE deleted_at IS NOT NULL ORDER BY id`,
          );
          expect(deleted.rows.map((r) => r.id)).toEqual([idB, idC, idF]);

          await c.query("ROLLBACK");
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      });
    });

    // ── (D) 2-tenant isolation: link giống-hệt-business-key ở A và B KHÔNG đụng uq ───────────────────
    describe("(D) 2-tenant isolation — company_id nằm trong uq key", () => {
      it("link business-key giống hệt ở A và B đều insert được (không đụng uq)", async () => {
        const eid = randomUUID(); // cùng entity_id business ở cả 2 tenant
        const linkA = await seedLink({
          companyId: A.companyId,
          fileId: fileA1,
          userId: userA,
          moduleCode: "HR",
          entityType: "employee",
          entityId: eid,
          linkType: "Contract",
          isPrimary: true,
        });
        const linkB = await seedLink({
          companyId: B.companyId,
          fileId: fileB1,
          userId: userB,
          moduleCode: "HR",
          entityType: "employee",
          entityId: eid,
          linkType: "Contract",
          isPrimary: true,
        });
        expect(linkA).toBeTruthy();
        expect(linkB, "tenant B KHÔNG đụng uq với tenant A (company_id trong khoá)").toBeTruthy();
      });
    });

    // ── (E) audit_logs append-only — LỚP-1 REVOKE ───────────────────────────────────────────────────
    describe("(E1) audit_logs append-only LỚP-1 (REVOKE 0432)", () => {
      it("app-role UPDATE audit_logs → permission denied (chưa tới trigger)", async () => {
        await expect(
          asTenant(A.companyId, async (c) => {
            await c.query(`UPDATE audit_logs SET action = 'x' WHERE id = $1`, [auditRowId]);
          }),
        ).rejects.toThrow(/permission denied/i);
      });

      it("app-role DELETE audit_logs → permission denied (chưa tới trigger)", async () => {
        await expect(
          asTenant(A.companyId, async (c) => {
            await c.query(`DELETE FROM audit_logs WHERE id = $1`, [auditRowId]);
          }),
        ).rejects.toThrow(/permission denied/i);
      });
    });

    // ── (E) audit_logs append-only — LỚP-2 TRIGGER (độc lập với grant lớp-1) ─────────────────────────
    // Kỹ thuật: GRANT + SET LOCAL ROLE mediaos_app TRONG 1 transaction rồi ROLLBACK. GRANT chưa-commit
    // KHÔNG rò ra connection khác (MVCC catalog) ⇒ KHÔNG đua với audit-logs-appendonly.int-spec chạy song song.
    describe("(E2) audit_logs append-only LỚP-2 (TRIGGER — QA-06) ĐỘC LẬP với grant", () => {
      async function attemptAsGrantedApp(
        op: "UPDATE" | "DELETE",
      ): Promise<PgLikeError | undefined> {
        const c = await direct.connect();
        let caught: unknown;
        try {
          await c.query("BEGIN");
          // temp-GRANT (chỉ trong tx này) — bỏ qua lớp-1 REVOKE để ép chạm trigger lớp-2.
          await c.query("GRANT UPDATE, DELETE ON audit_logs TO mediaos_app");
          await c.query("SET LOCAL ROLE mediaos_app"); // current_user = mediaos_app
          try {
            if (op === "UPDATE") {
              await c.query(`UPDATE audit_logs SET action = 'tampered' WHERE id = $1`, [
                auditRowId,
              ]);
            } else {
              await c.query(`DELETE FROM audit_logs WHERE id = $1`, [auditRowId]);
            }
          } catch (e) {
            caught = e;
          }
        } finally {
          // ROLLBACK: hoàn tác GRANT + reset SET LOCAL ROLE (tx-scoped). An toàn kể cả tx đã abort.
          await c.query("ROLLBACK").catch(() => undefined);
          c.release();
        }
        return caught === undefined ? undefined : pgErr(caught);
      }

      it("mediaos_app UPDATE audit_logs bị TRIGGER chặn — message chứa 'append-only'", async () => {
        const err = await attemptAsGrantedApp("UPDATE");
        expect(err, "UPDATE phải bị trigger lớp-2 chặn dù ĐÃ grant").toBeDefined();
        expect(err?.message ?? "").toContain("append-only");
      });

      it("mediaos_app DELETE audit_logs bị TRIGGER chặn — message chứa 'append-only' (độc lập grant)", async () => {
        const err = await attemptAsGrantedApp("DELETE");
        expect(err, "DELETE phải bị trigger lớp-2 chặn dù ĐÃ grant DELETE").toBeDefined();
        expect(err?.message ?? "").toContain("append-only");
      });
    });

    // ── (E) POSITIVE: superuser/directPool UPDATE + DELETE THÀNH CÔNG (denylist chỉ trúng mediaos_app) ──
    describe("(E3) POSITIVE — superuser mutate audit_logs OK (không brick retention/archive)", () => {
      it("directPool UPDATE VÀ DELETE audit_logs đều thành công (rollback giữ row cho cleanup)", async () => {
        const c = await direct.connect();
        try {
          await c.query("BEGIN");
          const u = await c.query(`UPDATE audit_logs SET action = 'sup-ok' WHERE id = $1`, [
            auditRowId,
          ]);
          expect(u.rowCount, "superuser UPDATE phải sửa đúng 1 row").toBe(1);
          const d = await c.query(`DELETE FROM audit_logs WHERE id = $1`, [auditRowId]);
          expect(d.rowCount, "superuser DELETE phải xoá đúng 1 row").toBe(1);
          await c.query("ROLLBACK"); // giữ nguyên row để cleanupTenants xử lý
        } catch (e) {
          await c.query("ROLLBACK").catch(() => undefined);
          throw e;
        } finally {
          c.release();
        }
      });
    });

    // ── (F) function + trigger tồn tại đúng shape (pg_proc / pg_trigger) ─────────────────────────────
    describe("(F) function + trigger append-only lớp-2 tồn tại", () => {
      it("function audit_logs_block_mutation() tồn tại (pg_proc)", async () => {
        const res = await direct.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM pg_proc WHERE proname = 'audit_logs_block_mutation'`,
        );
        expect(res.rows[0].n, "function audit_logs_block_mutation phải tồn tại").toBeGreaterThan(0);
      });

      it("trigger trg_audit_logs_block_mutation BEFORE UPDATE OR DELETE trên audit_logs (pg_trigger)", async () => {
        const res = await direct.query<{ tgtype: number }>(
          `SELECT t.tgtype
           FROM pg_trigger t
          WHERE t.tgname = 'trg_audit_logs_block_mutation'
            AND t.tgrelid = 'audit_logs'::regclass
            AND NOT t.tgisinternal`,
        );
        expect(
          res.rows.length,
          "trigger trg_audit_logs_block_mutation phải tồn tại trên audit_logs",
        ).toBe(1);
        // tgtype bitmask: bit0=ROW(1)/STATEMENT(0), bit1=BEFORE(2), bit4=UPDATE(16), bit3=DELETE(8).
        const tgtype = res.rows[0].tgtype;
        expect(tgtype & 2, "phải là BEFORE trigger").toBe(2); // BEFORE
        expect(tgtype & 1, "phải là STATEMENT-level (bit0=0)").toBe(0); // FOR EACH STATEMENT
        expect(tgtype & 16, "phải phủ UPDATE").toBe(16);
        expect(tgtype & 8, "phải phủ DELETE").toBe(8);
      });
    });
  },
);
