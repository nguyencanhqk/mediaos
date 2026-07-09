import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S4-NOTI-DB-1 — notification_delivery_logs APPEND-ONLY (BẤT BIẾN #2, mig 0479).
 *
 * Bảng delivery-log là APPEND-ONLY theo thiết kế (CLAUDE §2 · DB-07 §7.4 quy tắc 5 "không xoá cứng").
 * App role (mediaos_app) chỉ có GRANT SELECT,INSERT — KHÔNG UPDATE/DELETE:
 *   - INSERT qua app role (đúng tenant) THÀNH CÔNG.
 *   - UPDATE qua app role → permission denied (rejects).
 *   - DELETE qua app role → permission denied (rejects).
 *   - Seed direct/superuser THÀNH CÔNG (hàng tồn tại) — REVOKE chỉ áp cho app role.
 * Retry = ghi hàng attempt_no MỚI (INSERT), KHÔNG update in-place.
 *
 * RED trước land: bảng chưa tồn tại ⇒ seed throw ⇒ suite đỏ. GREEN sau migration 0479.
 * Gate: hasDb && LANE_DB (chỉ .env → hasDb=true = đỏ-giả; memory integration-test-lane-db-gate).
 */
const hasLaneDb = hasDb && !!process.env.LANE_DB;

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
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

describe.skipIf(!hasLaneDb)(
  "S4-NOTI-DB-1 notification_delivery_logs append-only (mediaos_app)",
  () => {
    const direct = directPool();
    const app = appPool(1);

    let A: SeededTenant;
    let userA: string;
    let notiA: string;
    let seededLogId: string;

    beforeAll(async () => {
      A = await seedCompany(direct, "noti-ndl-a");
      userA = await seedUser(direct, A.companyId, `ndl-${randomUUID().slice(0, 8)}@x.test`);
      const noti = await direct.query(
        `INSERT INTO notifications (company_id, user_id, type, body)
         VALUES ($1, $2, 'general', 'ndl-noti') RETURNING id`,
        [A.companyId, userA],
      );
      notiA = noti.rows[0].id as string;
      // Seed direct/superuser (bypass grant) — attempt_no=1 <= max_attempts=3 (chk_..._attempt).
      const log = await direct.query(
        `INSERT INTO notification_delivery_logs
           (company_id, notification_id, recipient_user_id, channel, delivery_status, attempt_no, max_attempts)
         VALUES ($1, $2, $3, 'EMAIL', 'Pending', 1, 3) RETURNING id`,
        [A.companyId, notiA, userA],
      );
      seededLogId = log.rows[0].id as string;
    });

    afterAll(async () => {
      await direct.query("DELETE FROM notification_delivery_logs WHERE company_id = $1", [
        A.companyId,
      ]);
      await cleanupTenants(direct, [A.companyId]);
      await direct.end();
      await app.end();
    });

    it("direct/superuser seed OK — hàng delivery_log tồn tại", async () => {
      const r = await direct.query("SELECT id FROM notification_delivery_logs WHERE id = $1", [
        seededLogId,
      ]);
      expect(r.rows).toHaveLength(1);
    });

    it("INSERT qua app role (đúng tenant) THÀNH CÔNG (GRANT SELECT,INSERT)", async () => {
      const inserted = await asTenant(app, A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO notification_delivery_logs
             (company_id, notification_id, recipient_user_id, channel, delivery_status, attempt_no, max_attempts)
           VALUES ($1, $2, $3, 'IN_APP', 'Sent', 1, 1) RETURNING id`,
          [A.companyId, notiA, userA],
        );
        return r.rows[0].id as string;
      });
      expect(inserted).toBeTruthy();
    });

    it("retry = INSERT hàng attempt_no mới (append), KHÔNG update in-place", async () => {
      const inserted = await asTenant(app, A.companyId, async (c) => {
        const r = await c.query(
          `INSERT INTO notification_delivery_logs
             (company_id, notification_id, recipient_user_id, channel, delivery_status, attempt_no, max_attempts)
           VALUES ($1, $2, $3, 'EMAIL', 'Failed', 2, 3) RETURNING id`,
          [A.companyId, notiA, userA],
        );
        return r.rows[0].id as string;
      });
      expect(inserted).toBeTruthy();
    });

    it("app role UPDATE bị TỪ CHỐI (append-only — không GRANT UPDATE)", async () => {
      await expect(
        asTenant(app, A.companyId, (c) =>
          c.query(`UPDATE notification_delivery_logs SET delivery_status = 'Sent' WHERE id = $1`, [
            seededLogId,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it("app role DELETE bị TỪ CHỐI (append-only — không GRANT DELETE)", async () => {
      await expect(
        asTenant(app, A.companyId, (c) =>
          c.query(`DELETE FROM notification_delivery_logs WHERE id = $1`, [seededLogId]),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  },
);
