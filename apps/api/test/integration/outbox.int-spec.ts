import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseService } from "../../src/db/db.service";
import type { AlertSink } from "../../src/events/alert.service";
import { LoggerAlertSink } from "../../src/events/alert.service";
import { EventBus } from "../../src/events/event-bus";
import { OutboxService } from "../../src/events/outbox.service";
import { OutboxWorker } from "../../src/events/outbox-worker";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * G2-4 — transactional outbox + idempotency + dead-letter (ADR-0009). Postgres thật (CI).
 */
describe.skipIf(!hasDb)("G2-4 audit + outbox + event bus", () => {
  const direct = directPool();
  const dbsvc = new DatabaseService();
  const outbox = new OutboxService();
  let A: SeededTenant;

  beforeAll(async () => {
    A = await seedCompany(direct, "ob");
  });
  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  it("rollback nghiệp vụ ⇒ outbox KHÔNG có event (ghi cùng tx)", async () => {
    await expect(
      dbsvc.withTenant(A.companyId, async (tx) => {
        await outbox.enqueue(tx, { eventType: "x.rollback", payload: {} });
        throw new Error("rollback-please");
      }),
    ).rejects.toThrow("rollback-please");

    const r = await direct.query(
      "SELECT count(*)::int AS n FROM outbox_events WHERE company_id = $1 AND event_type = 'x.rollback'",
      [A.companyId],
    );
    expect(r.rows[0].n).toBe(0);
  });

  it("idempotent qua (consumer_name,event_id): re-claim KHÔNG gọi lại handler; 2 consumer đều chạy", async () => {
    const eventId = await dbsvc.withTenant(A.companyId, (tx) =>
      outbox.enqueue(tx, { eventType: "u.created", payload: { hello: "world" } }),
    );
    const calls1: string[] = [];
    const calls2: string[] = [];
    const bus = new EventBus();
    bus.register({
      consumerName: "ob-c1",
      eventType: "u.created",
      handle: async (ctx) => {
        calls1.push(ctx.eventId);
      },
    });
    bus.register({
      consumerName: "ob-c2",
      eventType: "u.created",
      handle: async (ctx) => {
        calls2.push(ctx.eventId);
      },
    });
    const worker = new OutboxWorker(bus, new LoggerAlertSink());

    await worker.processBatch();
    // Ép re-claim cùng event để chứng minh idempotency qua processed_events (không phải nhờ status=done).
    await direct.query(
      "UPDATE outbox_events SET status = 'pending', available_at = now() WHERE id = $1",
      [eventId],
    );
    await worker.processBatch();

    expect(calls1).toEqual([eventId]); // đúng 1 lần dù claim 2 lần
    expect(calls2).toEqual([eventId]); // consumer khác tên cùng event ⇒ cũng xử lý (không bị chặn)
  });

  it("handler lỗi tới hết lượt ⇒ dead_letter + alert KÊU (không nuốt lỗi)", async () => {
    const eventId = await dbsvc.withTenant(A.companyId, (tx) =>
      outbox.enqueue(tx, { eventType: "will.fail", payload: { a: 1 } }),
    );
    const bus = new EventBus();
    bus.register({
      consumerName: "always-fail",
      eventType: "will.fail",
      handle: async () => {
        throw new Error("boom");
      },
    });
    const alert: AlertSink = { deadLetter: vi.fn(async () => undefined) };
    const worker = new OutboxWorker(bus, alert);

    for (let i = 0; i <= OutboxWorker.MAX_ATTEMPTS; i++) {
      await direct.query("UPDATE outbox_events SET available_at = now() WHERE id = $1", [eventId]);
      await worker.processBatch();
    }

    expect(alert.deadLetter).toHaveBeenCalled();
    const dl = await direct.query(
      "SELECT count(*)::int AS n FROM dead_letter_events WHERE event_id = $1",
      [eventId],
    );
    expect(dl.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it("app role KHÔNG UPDATE/DELETE được audit_logs (append-only, bất biến #2)", async () => {
    await dbsvc.withTenant(A.companyId, async (tx) => {
      await tx.execute(sql`INSERT INTO audit_logs (action, object_type) VALUES ('seed', 'company')`);
    });

    const app = appPool(1);
    try {
      const c = await app.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
        await expect(c.query("UPDATE audit_logs SET action = 'x'")).rejects.toThrow(
          /permission denied/i,
        );
        await c.query("ROLLBACK");

        await c.query("BEGIN");
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
        await expect(c.query("DELETE FROM audit_logs")).rejects.toThrow(/permission denied/i);
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
    } finally {
      await app.end();
    }
  });
});
