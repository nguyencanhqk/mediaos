import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

/**
 * S4-NOTI-DB-1 — Notification Core cross-tenant deny-path (RED trước GREEN, mig 0479).
 *
 * Cô lập chéo tenant trên 3 bảng MỚI DB-07 §7.1/7.2/7.4:
 *   - notification_events / notification_templates: company_id NULLABLE (catalog global + company override).
 *     Policy NULLABLE-TENANT (USING company_id=GUC OR company_id IS NULL / WITH CHECK company_id=GUC) —
 *     mẫu sequence_counters/public_holidays/system_job_runs ⇒ hàng GLOBAL (company_id NULL) HIỂN THỊ ở
 *     MỌI tenant; hàng company-scoped của B KHÔNG lọt sang A. INSERT company_id=B qua app role bị chặn
 *     (grant SELECT-only hoặc RLS WITH CHECK) ⇒ rejects.
 *   - notification_delivery_logs: company_id NOT NULL, policy tenant chuẩn (literal-GUC). withTenant(A)
 *     SELECT 0 hàng B; INSERT company_id=B bị RLS WITH CHECK chặn.
 *
 * RED trước land: 3 bảng chưa tồn tại ⇒ seed throw ⇒ suite đỏ. GREEN sau migration 0479.
 *
 * Gate: hasDb && LANE_DB — .env làm hasDb=true → thiếu LANE_DB thì chạy DB dev chung ⇒ đỏ-giả
 * (memory integration-test-lane-db-gate). LANE_DB bắt buộc cho DB cô lập mediaos_<lane>.
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

/** Seed 1 notification_event — companyId=null ⇒ GLOBAL (catalog dùng chung), NOT NULL cột theo DB-07 §7.1. */
async function seedEvent(direct: Pool, companyId: string | null): Promise<string> {
  const r = await direct.query(
    `INSERT INTO notification_events
       (company_id, module_code, event_code, event_name, notification_type,
        default_priority, default_channels, dedupe_strategy, is_enabled, is_system_event)
     VALUES ($1, 'TASK', $2, 'NOTI iso event', 'Task', 'Normal',
             '["IN_APP"]'::jsonb, 'None', true, false) RETURNING id`,
    [companyId, `NOTI_EVT_${randomUUID().slice(0, 8)}`],
  );
  return r.rows[0].id as string;
}

/** Seed 1 notification_template (FK event_id) — companyId=null ⇒ GLOBAL, NOT NULL cột theo DB-07 §7.2. */
async function seedTemplate(
  direct: Pool,
  companyId: string | null,
  eventId: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO notification_templates
       (company_id, event_id, template_code, channel, locale, title_template,
        body_template, version, status, is_default)
     VALUES ($1, $2, $3, 'IN_APP', 'vi-VN', 'NOTI {{x}}', 'NOTI body', 1, 'Active', false) RETURNING id`,
    [companyId, eventId, `NOTI_TPL_${randomUUID().slice(0, 8)}`],
  );
  return r.rows[0].id as string;
}

/** Seed 1 notifications legacy-shape (mig 0010) — nền FK notification_delivery_logs.notification_id. */
async function seedNotification(direct: Pool, companyId: string, userId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO notifications (company_id, user_id, type, body)
     VALUES ($1, $2, 'general', 'noti-iso') RETURNING id`,
    [companyId, userId],
  );
  return r.rows[0].id as string;
}

/** Seed 1 notification_delivery_log (company_id NOT NULL, FK notification/user) — DB-07 §7.4. */
async function seedDeliveryLog(
  direct: Pool,
  companyId: string,
  userId: string,
  notificationId: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO notification_delivery_logs
       (company_id, notification_id, recipient_user_id, channel, delivery_status, attempt_no, max_attempts)
     VALUES ($1, $2, $3, 'IN_APP', 'Sent', 1, 1) RETURNING id`,
    [companyId, notificationId, userId],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!hasLaneDb)(
  "S4-NOTI-DB-1 Notification Core cross-tenant isolation (RLS, 2-tenant)",
  () => {
    const direct = directPool();
    const app = appPool(2);

    let A: SeededTenant;
    let B: SeededTenant;
    let gEvent: string; // GLOBAL (company_id NULL)
    let gTemplate: string; // GLOBAL
    let aEvent: string;
    let bEvent: string;
    let aTemplate: string;
    let bTemplate: string;
    let aUser: string;
    let bUser: string;
    let bNoti: string;
    let aLog: string;
    let bLog: string;

    beforeAll(async () => {
      A = await seedCompany(direct, "noti-core-a");
      B = await seedCompany(direct, "noti-core-b");

      // Hàng GLOBAL (company_id NULL) — nullable-tenant policy phải hiển thị cho MỌI tenant.
      gEvent = await seedEvent(direct, null);
      gTemplate = await seedTemplate(direct, null, gEvent);

      // Hàng company-scoped (company_id NOT NULL) — cô lập chéo tenant.
      aEvent = await seedEvent(direct, A.companyId);
      bEvent = await seedEvent(direct, B.companyId);
      aTemplate = await seedTemplate(direct, A.companyId, aEvent);
      bTemplate = await seedTemplate(direct, B.companyId, bEvent);

      aUser = await seedUser(direct, A.companyId, `noti-a-${randomUUID().slice(0, 8)}@x.test`);
      bUser = await seedUser(direct, B.companyId, `noti-b-${randomUUID().slice(0, 8)}@x.test`);
      const aNoti = await seedNotification(direct, A.companyId, aUser);
      bNoti = await seedNotification(direct, B.companyId, bUser);
      aLog = await seedDeliveryLog(direct, A.companyId, aUser, aNoti);
      bLog = await seedDeliveryLog(direct, B.companyId, bUser, bNoti);
    });

    afterAll(async () => {
      // Xoá tường minh 3 bảng mới TRƯỚC cleanupTenants (cleanupTenants chưa biết chúng). delivery_logs
      // (con notifications) trước, rồi templates (FK event) → events.
      for (const companyId of [A.companyId, B.companyId]) {
        await direct.query("DELETE FROM notification_delivery_logs WHERE company_id = $1", [
          companyId,
        ]);
        await direct.query("DELETE FROM notification_templates WHERE company_id = $1", [companyId]);
        await direct.query("DELETE FROM notification_events WHERE company_id = $1", [companyId]);
      }
      // Hàng GLOBAL (company_id NULL) — cleanupTenants/DELETE-by-company KHÔNG phủ ⇒ xoá theo id.
      // Template trước event (FK event_id).
      await direct.query("DELETE FROM notification_templates WHERE id = $1", [gTemplate]);
      await direct.query("DELETE FROM notification_events WHERE id = $1", [gEvent]);
      await cleanupTenants(direct, [A.companyId, B.companyId]);
      await direct.end();
      await app.end();
    });

    async function visible(companyId: string, table: string, ids: string[]): Promise<Set<string>> {
      return asTenant(app, companyId, async (c) => {
        const r = await c.query(`SELECT id FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
        return new Set(r.rows.map((x) => x.id as string));
      });
    }

    // ── notification_events (nullable-tenant) ───────────────────────────────────
    describe("notification_events (nullable-tenant)", () => {
      it("withTenant(A): thấy event GLOBAL (company_id NULL) + của A, KHÔNG thấy của B", async () => {
        const seen = await visible(A.companyId, "notification_events", [gEvent, aEvent, bEvent]);
        expect(seen.has(gEvent)).toBe(true);
        expect(seen.has(aEvent)).toBe(true);
        expect(seen.has(bEvent)).toBe(false);
      });

      it("withTenant(B): thấy GLOBAL + của B, KHÔNG thấy của A", async () => {
        const seen = await visible(B.companyId, "notification_events", [gEvent, aEvent, bEvent]);
        expect(seen.has(gEvent)).toBe(true);
        expect(seen.has(bEvent)).toBe(true);
        expect(seen.has(aEvent)).toBe(false);
      });

      it("withTenant(A): INSERT notification_events company_id=B bị chặn (rejects)", async () => {
        await expect(
          asTenant(app, A.companyId, (c) =>
            c.query(
              `INSERT INTO notification_events
                 (company_id, module_code, event_code, event_name, notification_type,
                  default_priority, default_channels, dedupe_strategy, is_enabled, is_system_event)
               VALUES ($1, 'TASK', $2, 'x-tenant', 'Task', 'Normal',
                       '["IN_APP"]'::jsonb, 'None', true, false)`,
              [B.companyId, `XT_${randomUUID().slice(0, 8)}`],
            ),
          ),
        ).rejects.toThrow();
      });
    });

    // ── notification_templates (nullable-tenant) ────────────────────────────────
    describe("notification_templates (nullable-tenant)", () => {
      it("withTenant(A): thấy template GLOBAL + của A, KHÔNG thấy của B", async () => {
        const seen = await visible(A.companyId, "notification_templates", [
          gTemplate,
          aTemplate,
          bTemplate,
        ]);
        expect(seen.has(gTemplate)).toBe(true);
        expect(seen.has(aTemplate)).toBe(true);
        expect(seen.has(bTemplate)).toBe(false);
      });

      it("withTenant(A): INSERT notification_templates company_id=B bị chặn (rejects)", async () => {
        await expect(
          asTenant(app, A.companyId, (c) =>
            c.query(
              `INSERT INTO notification_templates
                 (company_id, event_id, template_code, channel, locale, title_template,
                  body_template, version, status, is_default)
               VALUES ($1, $2, $3, 'IN_APP', 'vi-VN', 'x', 'x', 1, 'Active', false)`,
              [B.companyId, bEvent, `XT_${randomUUID().slice(0, 8)}`],
            ),
          ),
        ).rejects.toThrow();
      });
    });

    // ── notification_delivery_logs (company_id NOT NULL) ────────────────────────
    describe("notification_delivery_logs (tenant NOT NULL)", () => {
      it("withTenant(A): SELECT thấy log của A, KHÔNG thấy log của B", async () => {
        const seen = await visible(A.companyId, "notification_delivery_logs", [aLog, bLog]);
        expect(seen.has(aLog)).toBe(true);
        expect(seen.has(bLog)).toBe(false);
      });

      it("withTenant(B): SELECT thấy log của B, KHÔNG thấy log của A", async () => {
        const seen = await visible(B.companyId, "notification_delivery_logs", [aLog, bLog]);
        expect(seen.has(bLog)).toBe(true);
        expect(seen.has(aLog)).toBe(false);
      });

      it("withTenant(A): INSERT notification_delivery_logs company_id=B bị RLS WITH CHECK chặn (rejects)", async () => {
        await expect(
          asTenant(app, A.companyId, (c) =>
            c.query(
              `INSERT INTO notification_delivery_logs
                 (company_id, notification_id, recipient_user_id, channel, delivery_status, attempt_no, max_attempts)
               VALUES ($1, $2, $3, 'IN_APP', 'Sent', 1, 1)`,
              [B.companyId, bNoti, bUser],
            ),
          ),
        ).rejects.toThrow();
      });
    });
  },
);
