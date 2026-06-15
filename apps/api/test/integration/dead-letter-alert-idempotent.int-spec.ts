import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AlertSink } from "../../src/events/alert.service";
import { DeadLetterAlertMonitor } from "../../src/events/dead-letter-alert.service";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, type SeededTenant } from "../helpers/seed";

/**
 * G2-4 alerting — idempotent (chống BÁO ĐỘNG KÉP). Gọi checkThresholds() 2 lần liên tiếp khi vẫn TRÊN
 * ngưỡng ⇒ CHỈ 1 row dead_letter_alerts cho cùng (company_id, window) (ON CONFLICT DO NOTHING, append-only)
 * và thresholdBreached() KHÔNG bắn lại (mirror logic deadLetter() RETURNING-empty ⇒ không alert lại).
 *
 * Dead-letter seed TRỰC TIẾP qua direct (xem ghi chú threshold spec — tránh đua claim chéo spec).
 */
describe.skipIf(!hasDb)("G2-4 dead-letter alert idempotent (chống báo động kép)", () => {
  const direct = directPool();
  let A: SeededTenant;

  beforeAll(async () => {
    A = await seedCompany(direct, "dla-idem");
  });
  afterAll(async () => {
    await direct.query("DELETE FROM dead_letter_alerts WHERE company_id = $1", [A.companyId]);
    await cleanupTenants(direct, [A.companyId]);
    await direct.end();
  });

  async function seedDeadLetters(companyId: string, n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      const ev = await direct.query(
        `INSERT INTO outbox_events (company_id, event_type, payload, status)
         VALUES ($1, 'dla.idem.dropped', '{}'::jsonb, 'failed') RETURNING id`,
        [companyId],
      );
      await direct.query(
        `INSERT INTO dead_letter_events (company_id, event_id, consumer_name, event_type, payload, error)
         VALUES ($1, $2, $3, 'dla.idem.dropped', '{}'::jsonb, 'boom')`,
        [companyId, ev.rows[0].id, `dla-idem-${randomUUID().slice(0, 8)}`],
      );
    }
  }

  it("checkThresholds() 2 lần khi vẫn trên ngưỡng ⇒ 1 row alert + thresholdBreached() chỉ bắn 1 lần", async () => {
    const alert: AlertSink = {
      deadLetter: vi.fn(async () => undefined),
      thresholdBreached: vi.fn(async () => undefined),
    };
    const monitor = new DeadLetterAlertMonitor(alert);

    await seedDeadLetters(A.companyId, DeadLetterAlertMonitor.THRESHOLD + 2);

    // Lần 1: vượt ngưỡng ⇒ ghi 1 alert.
    await monitor.checkThresholds();
    // Lần 2 (ngay sau, vẫn trên ngưỡng, cùng window) ⇒ KHÔNG ghi alert mới (ON CONFLICT DO NOTHING).
    await monitor.checkThresholds();

    // BẤT BIẾN cốt lõi (deterministic, không phụ thuộc đua chéo spec): append-only + unique(company,window)
    // ⇒ ĐÚNG 1 row alert cho (A, window) dù gọi 2 lần. Đây là chốt chống "báo động kép" ở tầng DB.
    const r = await direct.query(
      "SELECT count(*)::int AS n FROM dead_letter_alerts WHERE company_id = $1",
      [A.companyId],
    );
    expect(r.rows[0].n).toBe(1);

    // thresholdBreached cho A bắn TỐI ĐA 1 lần TỪ monitor này (RETURNING-guard) — KHÔNG bao giờ ≥2 (spam).
    const calls = (alert.thresholdBreached as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0].companyId === A.companyId,
    );
    expect(calls.length).toBeLessThanOrEqual(1);
  });
});
