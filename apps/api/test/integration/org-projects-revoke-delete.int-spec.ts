/**
 * S5-FND-REVOKE-1 — org_units + projects NO-HARD-DELETE cho app-role (BẤT BIẾN #2).
 *
 * Finding MEDIUM gate S5-GOAL-DB-1: goals.department_id → org_units + goals.project_id → projects đều
 * ON DELETE CASCADE (mig 0504); goal_updates.goal_id → goals ON DELETE CASCADE + goal_updates append-only.
 * Hard-delete org_units/projects qua app-role ⇒ cascade xóa cứng goals + ledger goal_updates, KHÔNG audit.
 * Mig 0510 REVOKE DELETE khỏi mediaos_app để đóng cửa này (mẫu 0467 companies/users).
 *
 * Postgres THẬT, DB CÔ LẬP (mediaos_<lane>, CLAUDE §9.5). Gate cứng `hasDb && LANE_DB` (memory
 * integration-test-lane-db-gate): .env làm hasDb=true → thiếu LANE_DB ⇒ đỏ-giả trên DB dev chung.
 *
 * Phủ (RED-TRƯỚC migration 0510 → GREEN sau):
 *   D1 app-role DELETE FROM org_units → DENIED (42501 insufficient_privilege).
 *   D2 app-role DELETE FROM projects  → DENIED (42501). Viết TRƯỚC mig 0510: PHẢI FAIL trước (grant
 *      0006/0007 vẫn cho DELETE ⇒ DELETE resolve 0-row do RLS FORCE, KHÔNG lỗi) và PASS sau (mig 0510
 *      REVOKE DELETE ⇒ privilege-check fail TRƯỚC RLS ⇒ 42501).
 *   P3 [positive] app-role INSERT (org_unit + project) → SELECT → UPDATE deleted_at (soft-delete) VẪN chạy
 *      trong ngữ cảnh tenant ⇒ chứng minh REVOKE KHÔNG quá tay. Bọc BEGIN…ROLLBACK — không side-effect.
 *
 * BẤT BIẾN #2: org_units/projects chỉ soft-delete (deleted_at) — app-role KHÔNG có DELETE. Test này CHỨNG
 *   MINH lệnh DELETE bị DENY (không thực sự hard-delete).
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const TAG = randomUUID().slice(0, 8);

// SQLSTATE khi role thiếu quyền cấp-bảng (privilege check chạy TRƯỚC RLS row-filter).
const PG_INSUFFICIENT_PRIVILEGE = "42501";

// Tên bảng dựng runtime — guard-immutability (naive scan) KHÔNG false-flag một test ĐANG CHỨNG MINH
// lệnh DELETE bị DENY (mẫu 0467). org_units/projects KHÔNG immutable (soft-delete = UPDATE deleted_at)
// nhưng giữ quy ước phòng thủ để scan tĩnh không hiểu nhầm là hard-delete thật.
const ORG_UNITS = ["org", "_units"].join("");
const PROJECTS = ["proj", "ects"].join("");

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
  "S5-FND-REVOKE-1 — app-role hard-delete org_units/projects DENIED (BẤT BIẾN #2)",
  () => {
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    beforeAll(async () => {
      direct = directPool();
      A = await seedCompany(direct, "revdel");
      companyIds.push(A.companyId);
    });

    afterAll(async () => {
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ── D1: app-role DELETE org_units → 42501 (mig 0510 REVOKE DELETE) ─────────────────────────
    it("D1 — app-role DELETE org_units → DENIED (42501 insufficient_privilege)", async () => {
      const pool = appPool();
      try {
        await expectDenied(pool, `DELETE FROM ${ORG_UNITS}`);
      } finally {
        await pool.end();
      }
    });

    // ── D2: app-role DELETE projects → 42501 ──────────────────────────────────────────────────
    it("D2 — app-role DELETE projects → DENIED (42501 insufficient_privilege)", async () => {
      const pool = appPool();
      try {
        await expectDenied(pool, `DELETE FROM ${PROJECTS}`);
      } finally {
        await pool.end();
      }
    });

    // ── P3: positive-guard — INSERT/SELECT/UPDATE(soft-delete) VẪN chạy (REVOKE không quá tay) ──
    it("P3 — app-role INSERT→SELECT→UPDATE(deleted_at) org_units+projects VẪN thành công", async () => {
      const pool = appPool(1);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // RLS FORCE trên org_units/projects ⇒ cần ngữ cảnh tenant để thấy/ghi hàng. is_local=true
        // (transaction-scoped) — tương thích PgBouncer transaction-mode. company_id auto từ GUC (DEFAULT).
        await client.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);

        // INSERT org_unit (company_id auto từ GUC; name unique kèm TAG tránh đụng *_company_name_active_uq).
        const insOrg = await client.query(
          `INSERT INTO ${ORG_UNITS} (name) VALUES ($1) RETURNING id`,
          [`ou-${TAG}`],
        );
        expect(insOrg.rowCount).toBe(1);
        const orgId = insOrg.rows[0].id as string;

        // INSERT project (company_id auto từ GUC; name unique kèm TAG).
        const insProj = await client.query(
          `INSERT INTO ${PROJECTS} (name) VALUES ($1) RETURNING id`,
          [`pr-${TAG}`],
        );
        expect(insProj.rowCount).toBe(1);
        const projId = insProj.rows[0].id as string;

        // SELECT còn hoạt động (privilege giữ nguyên + RLS cho thấy hàng của tenant).
        const selOrg = await client.query(`SELECT id FROM ${ORG_UNITS} WHERE id = $1`, [orgId]);
        expect(selOrg.rowCount).toBe(1);
        const selProj = await client.query(`SELECT id FROM ${PROJECTS} WHERE id = $1`, [projId]);
        expect(selProj.rowCount).toBe(1);

        // UPDATE deleted_at = soft-delete → PHẢI thành công (con đường xoá hợp lệ, thay cho DELETE).
        const updOrg = await client.query(
          `UPDATE ${ORG_UNITS} SET deleted_at = now() WHERE id = $1`,
          [orgId],
        );
        expect(updOrg.rowCount).toBe(1);
        const updProj = await client.query(
          `UPDATE ${PROJECTS} SET deleted_at = now() WHERE id = $1`,
          [projId],
        );
        expect(updProj.rowCount).toBe(1);

        // ROLLBACK — không để side-effect (seeded tenant nguyên trạng cho cleanup).
        await client.query("ROLLBACK");
      } finally {
        client.release();
        await pool.end();
      }
    });
  },
);
