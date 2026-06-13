import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * G11-F7 — PERIOD-LOCK IMMUTABILITY (DB-level, RED-first).
 *
 * Bằng chứng cho BẤT BIẾN §2.2 (append-only/immutability cho kỳ đã khoá): kỳ công
 * `attendance_periods` đã `status='locked'` (chốt feed payroll G12) KHÔNG được mở lại
 * (locked→open). App role `mediaos_app` có GRANT UPDATE (migration 0061) ⇒ nếu không có
 * guard ở tầng DB, một UPDATE qua chính role app có thể đảo khoá ngầm.
 *
 * Lớp bảo vệ này là TRIGGER BEFORE UPDATE (migration 0064) — KHÔNG phải RLS. Để chứng minh
 * đúng "thứ chặn là trigger" (không phải RLS vô tình chặn / xanh-giả):
 *   1. CORE DENY: set_config('app.current_company_id', companyId) ⇒ RLS CHO QUA đúng tenant,
 *      rồi UPDATE locked→open bị TRIGGER từ chối (RAISE EXCEPTION). Đây là deny-path thật.
 *   2. ALLOW (sanity, chống xanh-giả): cùng tenant context, UPDATE hợp lệ trên kỳ 'open'
 *      (đổi field khác) và transition open→locked PHẢI cho qua — trigger chỉ chặn locked→open.
 *   3. RLS-vẫn-nguyên (regression guard): KHÔNG set company context (hoặc sai tenant) ⇒ RLS
 *      chặn TRƯỚC (0 row) — chứng minh trigger là lớp PHỤ THÊM, fire SAU khi RLS cho qua,
 *      không thay thế tenant isolation §2.1.
 *
 * Chạy trên Postgres THẬT, DB cô lập (mediaos_g11f7). KHÔNG mock.
 */

const PERIOD_MONTH = "2026-05";

/** Mở 1 transaction trên app-pool với tenant context set LOCAL (mirror withTenant của app). */
async function withTenantTx<T>(
  client: PoolClient,
  companyId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    if (companyId !== null) {
      await client.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
    }
    const out = await fn();
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback noise */
    }
    throw e;
  }
}

describe.skipIf(!hasDb)("G11-F7 attendance period-lock immutability (trigger BEFORE UPDATE)", () => {
  const direct = directPool();
  const app = appPool(1);

  let A: SeededTenant;
  let periodId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "periodlock");
    // Seed 1 kỳ công 'open' qua DIRECT (superuser) — chỉ dựng lưới, không phản ánh đường app.
    const res = await direct.query(
      `INSERT INTO attendance_periods (company_id, period_month, status)
       VALUES ($1, $2, 'open') RETURNING id`,
      [A.companyId, PERIOD_MONTH],
    );
    periodId = res.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
  });

  it("ALLOW (sanity): qua app role + đúng tenant, lock kỳ open→locked PHẢI thành công (RLS cho qua, trigger không chặn transition hợp lệ)", async () => {
    const client = await app.connect();
    try {
      const r = await withTenantTx(client, A.companyId, () =>
        client.query(
          `UPDATE attendance_periods
             SET status = 'locked', locked_at = now()
           WHERE id = $1 RETURNING status`,
          [periodId],
        ),
      );
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].status).toBe("locked");
    } finally {
      client.release();
    }
  });

  it("ALLOW (sanity): UPDATE field khác trên kỳ đã locked (giữ status='locked') PHẢI cho qua — trigger chỉ chặn locked→open, không chặn mutation hợp lệ", async () => {
    const client = await app.connect();
    try {
      const r = await withTenantTx(client, A.companyId, () =>
        client.query(
          `UPDATE attendance_periods
             SET updated_at = now()
           WHERE id = $1 RETURNING status`,
          [periodId],
        ),
      );
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].status).toBe("locked");
    } finally {
      client.release();
    }
  });

  it("CORE DENY: qua app role + đúng tenant (RLS CHO QUA), UPDATE locked→open bị TRIGGER từ chối (RAISE EXCEPTION)", async () => {
    const client = await app.connect();
    try {
      await expect(
        withTenantTx(client, A.companyId, () =>
          client.query(
            `UPDATE attendance_periods SET status = 'open' WHERE id = $1`,
            [periodId],
          ),
        ),
      ).rejects.toThrow(/attendance_period_lock/i);
    } finally {
      client.release();
    }

    // Hậu kiểm: kỳ vẫn 'locked' (transaction đã ROLLBACK, không rò mutation).
    const after = await direct.query(
      `SELECT status FROM attendance_periods WHERE id = $1`,
      [periodId],
    );
    expect(after.rows[0].status).toBe("locked");
  });

  it("RLS-vẫn-nguyên (regression): KHÔNG set company context ⇒ RLS chặn TRƯỚC (0 row), trigger là lớp phụ không thay tenant isolation", async () => {
    const client = await app.connect();
    try {
      const r = await withTenantTx(client, null, () =>
        client.query(
          `UPDATE attendance_periods SET status = 'open' WHERE id = $1`,
          [periodId],
        ),
      );
      // RLS lọc hàng trước khi trigger có cơ hội fire ⇒ 0 row, KHÔNG ném exception.
      expect(r.rowCount).toBe(0);
    } finally {
      client.release();
    }

    const after = await direct.query(
      `SELECT status FROM attendance_periods WHERE id = $1`,
      [periodId],
    );
    expect(after.rows[0].status).toBe("locked");
  });
});
