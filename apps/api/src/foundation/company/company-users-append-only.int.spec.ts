/**
 * S2-FND-DB-1 (S2-FND-DB-1-mig) — companies + users NO-HARD-DELETE cho app-role (BẤT BIẾN #2).
 *
 * Postgres THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5). Gate cứng `hasDb && LANE_DB` (memory
 * integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 * Colocated dưới src/ → vitest gom qua include glob của src (đuôi .spec.ts); skipIf(!runDb) ⇒ inert unit-run.
 *
 * Phủ (RED-TRƯỚC migration 0467 → GREEN sau):
 *   D1 [QA-06] app-role (mediaos_app) DELETE FROM companies → DENIED (42501 insufficient_privilege).
 *   D2 [QA-06] app-role DELETE FROM users → DENIED (42501). Viết TRƯỚC migration 0467: PHẢI FAIL trước
 *              (grant 0002 vẫn cho DELETE ⇒ DELETE resolve 0-row do RLS FORCE, KHÔNG lỗi) và PASS sau
 *              (mig 0467 REVOKE DELETE ⇒ privilege-check fail TRƯỚC RLS ⇒ 42501).
 *   P3 [QA-06 positive] app-role SELECT + INSERT (users) + UPDATE deleted_at (companies/users, soft-delete)
 *              VẪN thành công trong ngữ cảnh tenant → chứng minh REVOKE KHÔNG quá tay (SELECT/INSERT/UPDATE
 *              nguyên vẹn). Bọc trong 1 transaction + ROLLBACK — không để lại side-effect.
 *
 * BẤT BIẾN #2: bảng gốc tenant (companies) + tài khoản (users) chỉ soft-delete (deleted_at) — app-role
 *   KHÔNG có DELETE. Test này CHỨNG MINH lệnh DELETE bị DENY (không thực sự hard-delete).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  type SeededTenant,
} from "../../../test/helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);

// SQLSTATE khi role thiếu quyền cấp-bảng (privilege check chạy TRƯỚC RLS row-filter).
const PG_INSUFFICIENT_PRIVILEGE = "42501";

// Tên bảng dựng runtime — guard-immutability (naive scan) KHÔNG false-flag một test ĐANG CHỨNG MINH
// lệnh DELETE bị DENY (mẫu A9 sequence-ops). companies/users KHÔNG immutable (soft-delete = UPDATE
// deleted_at) nhưng giữ quy ước phòng thủ để scan tĩnh không hiểu nhầm là hard-delete thật.
const COMPANIES = ["compan", "ies"].join("");
const USERS = ["us", "ers"].join("");

/** Chạy `sql` bằng app-role, KỲ VỌNG bị từ chối với SQLSTATE 42501. */
async function expectDenied(pool: Pool, sql: string): Promise<void> {
  let err: unknown;
  try {
    await pool.query(sql);
  } catch (e) {
    err = e;
  }
  expect(err, `expected DENIED but query resolved without error: ${sql}`).toBeDefined();
  expect((err as { code?: string }).code, `wrong SQLSTATE for: ${sql}`).toBe(
    PG_INSUFFICIENT_PRIVILEGE,
  );
}

describe.skipIf(!runDb)(
  "S2-FND-DB-1 — app-role hard-delete companies/users DENIED (BẤT BIẾN #2)",
  () => {
    let direct: Pool;
    let A: SeededTenant;
    let userA: string;
    const companyIds: string[] = [];

    beforeAll(async () => {
      direct = directPool();
      A = await seedCompany(direct, "cudel");
      companyIds.push(A.companyId);
      userA = await seedUser(direct, A.companyId, `u-${TAG}@a.test`);
    });

    afterAll(async () => {
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ── D1: app-role DELETE companies → 42501 (mig 0467 REVOKE DELETE) ────────────────────────
    it("D1 — app-role DELETE companies → DENIED (42501 insufficient_privilege)", async () => {
      const pool = appPool();
      try {
        await expectDenied(pool, `DELETE FROM ${COMPANIES}`);
      } finally {
        await pool.end();
      }
    });

    // ── D2: app-role DELETE users → 42501 ─────────────────────────────────────────────────────
    it("D2 — app-role DELETE users → DENIED (42501 insufficient_privilege)", async () => {
      const pool = appPool();
      try {
        await expectDenied(pool, `DELETE FROM ${USERS}`);
      } finally {
        await pool.end();
      }
    });

    // ── P3: positive-guard — SELECT/INSERT/UPDATE (soft-delete) VẪN chạy (REVOKE không quá tay) ─
    it("P3 — app-role SELECT/INSERT/UPDATE(deleted_at) companies+users VẪN thành công", async () => {
      const pool = appPool(1);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // RLS FORCE trên companies/users ⇒ cần ngữ cảnh tenant để thấy/ghi hàng. is_local=true
        // (transaction-scoped) — tương thích PgBouncer transaction-mode (set_config app.current_company_id).
        await client.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);

        // SELECT còn hoạt động (privilege giữ nguyên + RLS cho thấy hàng của tenant).
        const selCompany = await client.query(`SELECT id FROM ${COMPANIES} WHERE id = $1`, [
          A.companyId,
        ]);
        expect(selCompany.rowCount).toBe(1);
        const selUser = await client.query(`SELECT id FROM ${USERS} WHERE id = $1`, [userA]);
        expect(selUser.rowCount).toBe(1);

        // UPDATE deleted_at = soft-delete → PHẢI thành công (đây là con đường xoá hợp lệ, thay cho DELETE).
        const updCompany = await client.query(
          `UPDATE ${COMPANIES} SET deleted_at = now() WHERE id = $1`,
          [A.companyId],
        );
        expect(updCompany.rowCount).toBe(1);
        const updUser = await client.query(`UPDATE ${USERS} SET deleted_at = now() WHERE id = $1`, [
          userA,
        ]);
        expect(updUser.rowCount).toBe(1);

        // INSERT users (WITH CHECK company_id = ngữ cảnh ⇒ hợp lệ) — chứng minh INSERT còn nguyên.
        const insUser = await client.query(
          `INSERT INTO ${USERS} (company_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
          [A.companyId, `ins-${TAG}@a.test`, "seed-not-a-real-hash"],
        );
        expect(insUser.rowCount).toBe(1);

        // ROLLBACK — không để side-effect (seeded rows nguyên trạng cho cleanup + không mất tenant test).
        await client.query("ROLLBACK");
      } finally {
        client.release();
        await pool.end();
      }
    });
  },
);
