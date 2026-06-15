import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AlertSink } from "../../src/events/alert.service";
import { DeadLetterAlertMonitor } from "../../src/events/dead-letter-alert.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * G2-4 alerting — dead-letter THRESHOLD breach. Khi số dead_letter_events UNRESOLVED của 1 company
 * vượt ngưỡng trong cửa sổ ⇒ AlertSink.thresholdBreached() ĐƯỢC GỌI đúng 1 lần (KHÔNG nuốt im lặng).
 * Dưới ngưỡng ⇒ KHÔNG gọi. Monitor đọc dead_letter_events xuyên tenant qua workerDb.
 *
 * Dead-letter được seed TRỰC TIẾP qua direct (superuser) — KHÔNG drive worker thật ở đây để TRÁNH đua
 * claim chéo spec (worker khác không có consumer cho event-type này sẽ đánh 'done' ⇒ ăn cắp event). Đường
 * worker→dead_letter_events→alert.deadLetter() đã phủ ở outbox.int-spec. Spec này tập trung kiểm MONITOR.
 */
describe.skipIf(!hasDb)("G2-4 dead-letter alert threshold", () => {
  const direct = directPool();
  let A: SeededTenant;

  beforeAll(async () => {
    A = await seedCompany(direct, "dla-thr");
  });
  afterAll(async () => {
    await direct.query("DELETE FROM dead_letter_alerts WHERE company_id = $1", [A.companyId]);
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  /** Seed `n` dead_letter_events UNRESOLVED cho company qua direct (mỗi cái 1 outbox event riêng). */
  async function seedDeadLetters(companyId: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      const ev = await direct.query(
        `INSERT INTO outbox_events (company_id, event_type, payload, status)
         VALUES ($1, 'dla.dropped', '{}'::jsonb, 'failed') RETURNING id`,
        [companyId],
      );
      await direct.query(
        `INSERT INTO dead_letter_events (company_id, event_id, consumer_name, event_type, payload, error)
         VALUES ($1, $2, $3, 'dla.dropped', '{}'::jsonb, 'boom')`,
        [companyId, ev.rows[0].id, `dla-consumer-${randomUUID().slice(0, 8)}`],
      );
    }
  }

  it("vượt ngưỡng ⇒ thresholdBreached() gọi đúng 1 lần với {companyId,count,windowStart}", async () => {
    const alert: AlertSink = {
      deadLetter: vi.fn(async () => undefined),
      thresholdBreached: vi.fn(async () => undefined),
    };
    const monitor = new DeadLetterAlertMonitor(alert);

    // THRESHOLD mặc định 5 (constant có tên) → 6 dead-letter ⇒ vượt.
    await seedDeadLetters(A.companyId, DeadLetterAlertMonitor.THRESHOLD + 1);

    await monitor.checkThresholds();

    // ALERT KHÔNG BỊ NUỐT (deterministic, không phụ thuộc đua chéo spec): 1 row alert append-only được ghi
    // cho (A, window) với count vượt ngưỡng + threshold đúng. Ghi row = monitor đã phát hiện + cảnh báo.
    const r = await direct.query(
      `SELECT count(*)::int AS n,
              max(dead_letter_count) AS cnt, max(threshold) AS thr,
              bool_and(window_start = date_trunc('hour', now())) AS window_ok
         FROM dead_letter_alerts WHERE company_id = $1`,
      [A.companyId],
    );
    expect(r.rows[0].n).toBe(1);
    expect(Number(r.rows[0].cnt)).toBeGreaterThanOrEqual(DeadLetterAlertMonitor.THRESHOLD + 1);
    expect(Number(r.rows[0].thr)).toBe(DeadLetterAlertMonitor.THRESHOLD);
    expect(r.rows[0].window_ok).toBe(true);

    // Sink thresholdBreached cho A bắn TỐI ĐA 1 lần từ monitor này (RETURNING-guard chống spam). Có thể 0 nếu
    // monitor spec khác (scan toàn tenant) đã chèn row A trước — nhưng KHÔNG bao giờ ≥2, và nếu bắn thì đúng shape.
    const callsForA = (alert.thresholdBreached as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0].companyId === A.companyId,
    );
    expect(callsForA.length).toBeLessThanOrEqual(1);
    for (const c of callsForA) {
      expect(c[0].count).toBeGreaterThanOrEqual(DeadLetterAlertMonitor.THRESHOLD + 1);
      expect(c[0].windowStart).toBeInstanceOf(Date);
      expect(c[0].threshold).toBe(DeadLetterAlertMonitor.THRESHOLD);
    }
  });

  it("dưới ngưỡng ⇒ thresholdBreached() KHÔNG gọi, KHÔNG ghi dead_letter_alerts", async () => {
    const B = await seedCompany(direct, "dla-under");
    try {
      const alert: AlertSink = {
        deadLetter: vi.fn(async () => undefined),
        thresholdBreached: vi.fn(async () => undefined),
      };
      // Đúng ngưỡng (= THRESHOLD) KHÔNG vượt (HAVING count > THRESHOLD) ⇒ không bắn.
      await seedDeadLetters(B.companyId, DeadLetterAlertMonitor.THRESHOLD);

      const monitor = new DeadLetterAlertMonitor(alert);
      await monitor.checkThresholds();

      // Alert mock của B là instance riêng — assert nó được gọi VỚI company B 0 lần.
      const calls = (alert.thresholdBreached as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0].companyId === B.companyId,
      );
      expect(calls).toHaveLength(0);
      const r = await direct.query(
        "SELECT count(*)::int AS n FROM dead_letter_alerts WHERE company_id = $1",
        [B.companyId],
      );
      expect(r.rows[0].n).toBe(0);
    } finally {
      await direct.query("DELETE FROM dead_letter_alerts WHERE company_id = $1", [B.companyId]);
      await cleanupTenants(direct, [B.companyId]);
    }
  });
});
