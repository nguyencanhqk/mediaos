import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { workerDb } from "../db/index";
import { assertWorkerRoleSafe } from "../db/worker-role";
import { ALERT_SINK, type AlertSink } from "./alert.service";

/**
 * DeadLetterAlertMonitor (G2-4) — phát hiện + cảnh báo khi dead-letter (event-dispatch / audit-write BỊ DROP)
 * dồn quá ngưỡng cho 1 company. Đọc dead_letter_events UNRESOLVED qua workerDb (role mediaos_worker, xuyên
 * tenant như OutboxWorker), GROUP BY company_id, so THRESHOLD trong cửa sổ cố định (truncate theo giờ).
 *
 * CHỐNG BÁO ĐỘNG KÉP: INSERT dead_letter_alerts ON CONFLICT(company_id, window_start) DO NOTHING RETURNING —
 * CHỈ khi có row trả về (alert MỚI cho cửa sổ này) mới gọi AlertSink.thresholdBreached (mirror deadLetter()
 * RETURNING-empty của OutboxWorker). Lỗi khi alert được log ERROR có stack — KHÔNG nuốt im lặng (cốt lõi G2-4).
 *
 * KHÔNG vòng lặp ở đây: `checkThresholds()` chạy 1 nhịp (OutboxWorker gọi sau processBatch; scheduler gọi định kỳ).
 */
@Injectable()
export class DeadLetterAlertMonitor {
  private readonly logger = new Logger(DeadLetterAlertMonitor.name);

  /** Ngưỡng dead-letter unresolved / company trong cửa sổ ⇒ cảnh báo (constant có tên, không magic number). */
  static readonly THRESHOLD = 5;

  /** Đã kiểm role kết nối an toàn chưa (chỉ kiểm 1 lần/instance). */
  private roleChecked = false;

  constructor(@Inject(ALERT_SINK) private readonly alert: AlertSink) {}

  private async assertRole(dbw: NonNullable<typeof workerDb>): Promise<void> {
    if (this.roleChecked) return;
    await assertWorkerRoleSafe(dbw, {
      context: "DeadLetterAlertMonitor",
      mode: "prod-only",
      logger: this.logger,
    });
    this.roleChecked = true;
  }

  /**
   * 1 nhịp: đếm dead_letter_events unresolved theo company; với company vượt THRESHOLD ⇒ ghi 1 alert
   * append-only cho cửa sổ giờ hiện tại (idempotent) + bắn thresholdBreached CHỈ khi alert MỚI được tạo.
   */
  async checkThresholds(): Promise<void> {
    const dbw = workerDb;
    if (!dbw) throw new Error("workerDb chưa cấu hình (DATABASE_WORKER_URL/DIRECT_URL).");
    await this.assertRole(dbw);

    // window_start = mốc giờ cố định ⇒ unique(company_id, window_start) idempotent (KHÔNG dùng now() trôi).
    const breaches = await dbw.execute(sql`
      SELECT company_id,
             count(*)::int AS dead_letter_count,
             date_trunc('hour', now()) AS window_start
        FROM dead_letter_events
       WHERE resolved_at IS NULL
       GROUP BY company_id
      HAVING count(*) > ${DeadLetterAlertMonitor.THRESHOLD}
    `);

    for (const r of breaches.rows) {
      const row = r as { company_id: string; dead_letter_count: number; window_start: string | Date };
      // pg trả timestamptz dạng string ở đường raw-execute này → chuẩn hoá về Date (hợp đồng ThresholdAlert.windowStart).
      const windowStart = row.window_start instanceof Date ? row.window_start : new Date(row.window_start);
      // INSERT append-only idempotent: ON CONFLICT(company_id, window_start) DO NOTHING.
      // company_id set TƯỜNG MINH theo từng nhóm — KHÔNG để default current_company_id trộn lẫn (worker xuyên tenant).
      const ins = await dbw.execute(sql`
        INSERT INTO dead_letter_alerts (company_id, window_start, dead_letter_count, threshold)
        VALUES (${row.company_id}, ${windowStart}, ${row.dead_letter_count}, ${DeadLetterAlertMonitor.THRESHOLD})
        ON CONFLICT (company_id, window_start) DO NOTHING
        RETURNING id
      `);
      if (ins.rows.length === 0) continue; // đã cảnh báo cửa sổ này ⇒ KHÔNG bắn lại (chống báo động kép)

      // Alert MỚI: bắn sink. Lỗi alert KHÔNG được nuốt im lặng — log ERROR có stack (review silent-failure F4).
      try {
        await this.alert.thresholdBreached({
          companyId: row.company_id,
          count: row.dead_letter_count,
          windowStart,
          threshold: DeadLetterAlertMonitor.THRESHOLD,
        });
      } catch (alertErr) {
        this.logger.error(
          `alert threshold-breach THẤT BẠI cho company ${row.company_id}: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`,
          alertErr instanceof Error ? alertErr.stack : undefined,
        );
      }
    }
  }
}
