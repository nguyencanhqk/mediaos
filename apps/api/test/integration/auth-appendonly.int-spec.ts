import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S2-AUTH-DB-2 — login_logs + user_security_events APPEND-ONLY (BẤT BIẾN #2, mig 0443).
 *
 * Cả hai = log bảo mật. app role (mediaos_app) GRANT SELECT,INSERT ONLY (KHÔNG UPDATE/DELETE) → mọi
 * UPDATE/DELETE bằng app role PHẢI BỊ TỪ CHỐI (permission denied — grant-level, KHÔNG phải RLS 0-row).
 *
 * Để khẳng định ĐÚNG grant-level (không phải RLS lọc): seed hàng bằng `direct` (superuser, bypass RLS) vào
 * CÙNG tenant mà app set ngữ cảnh → hàng HIỂN THỊ dưới RLS ⇒ UPDATE/DELETE thất bại CHỈ vì thiếu grant.
 * Mirror: audit-logs-appendonly.int-spec.ts.
 *
 * Gate: hasDb (DATABASE_*) + LANE_DB (DB cô lập theo lane) — thiếu LANE_DB → SKIP để KHÔNG chạm DB dev chung
 * 'mediaos' (memory: integration-test-lane-db-gate, CLAUDE.md §9.5).
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)("S2-AUTH-DB-2 auth logs append-only (mediaos_app)", () => {
  const direct = directPool();
  const app = appPool();

  let A: SeededTenant;
  let userId: string;
  let loginLogId: string;
  let securityEventId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "auth-ao");
    userId = await seedUser(direct, A.companyId, "auth-ao-user@x.test");

    // Seed via superuser (bypass RLS/grants) — hàng app role sẽ thử mutate (kỳ vọng bị từ chối permission).
    const ll = await direct.query(
      `INSERT INTO login_logs (company_id, user_id, email, normalized_email, login_status)
       VALUES ($1, $2, 'seed@x.test', 'seed@x.test', 'success')
       RETURNING id`,
      [A.companyId, userId],
    );
    loginLogId = ll.rows[0].id as string;

    const se = await direct.query(
      `INSERT INTO user_security_events (company_id, user_id, event_type, severity)
       VALUES ($1, $2, 'seed_event', 'info')
       RETURNING id`,
      [A.companyId, userId],
    );
    securityEventId = se.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
    await app.end();
  });

  /** Run fn inside a transaction as app role with tenant context set. */
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

  // ── login_logs ────────────────────────────────────────────────────────────────
  it("INSERT login_logs via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
    const inserted = await asTenant(A.companyId, async (c) => {
      // company_id điền tự động qua DEFAULT current_setting('app.current_company_id').
      const r = await c.query(
        `INSERT INTO login_logs (user_id, email, normalized_email, login_status)
         VALUES ($1, 'app@x.test', 'app@x.test', 'failed')
         RETURNING id`,
        [userId],
      );
      return r.rows[0].id as string;
    });
    expect(inserted).toBeTruthy();
  });

  it("app role UPDATE on login_logs is DENIED (append-only — no UPDATE grant)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`UPDATE login_logs SET login_status = 'blocked' WHERE id = $1`, [loginLogId]);
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("app role DELETE on login_logs is DENIED (append-only — no DELETE grant)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`DELETE FROM login_logs WHERE id = $1`, [loginLogId]);
      }),
    ).rejects.toThrow(/permission denied/);
  });

  // ── user_security_events ────────────────────────────────────────────────────────
  it("INSERT user_security_events via app role SUCCEEDS (GRANT SELECT,INSERT)", async () => {
    const inserted = await asTenant(A.companyId, async (c) => {
      const r = await c.query(
        `INSERT INTO user_security_events (user_id, event_type, severity)
         VALUES ($1, 'PASSWORD_CHANGED', 'info')
         RETURNING id`,
        [userId],
      );
      return r.rows[0].id as string;
    });
    expect(inserted).toBeTruthy();
  });

  it("app role UPDATE on user_security_events is DENIED (append-only — no UPDATE grant)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`UPDATE user_security_events SET severity = 'critical' WHERE id = $1`, [
          securityEventId,
        ]);
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("app role DELETE on user_security_events is DENIED (append-only — no DELETE grant)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query(`DELETE FROM user_security_events WHERE id = $1`, [securityEventId]);
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
