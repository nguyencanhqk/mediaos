import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { workerDb } from "../db/index";
import { assertWorkerRoleSafe } from "../db/worker-role";
import { ALERT_SINK, type AlertSink } from "./alert.service";
import { DeadLetterAlertMonitor } from "./dead-letter-alert.service";
import { EventBus } from "./event-bus";

interface ClaimedEvent {
  id: string;
  companyId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * OutboxWorker — đọc outbox qua workerDb (directPool, role mediaos_worker thấy mọi tenant), claim bằng
 * FOR UPDATE SKIP LOCKED, gọi consumer idempotent (processed_events), thất bại lặp lại ⇒ dead-letter +
 * alert. KHÔNG vòng lặp vô tận ở đây — `processBatch()` chạy 1 nhịp (test gọi trực tiếp; scheduler gọi định kỳ).
 */
@Injectable()
export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);
  static readonly MAX_ATTEMPTS = 5;
  private static readonly STALE_PROCESSING_MS = 5 * 60_000;
  private static readonly RETRY_BACKOFF_MS = 30_000;

  /** Đã kiểm role kết nối chưa (chỉ kiểm 1 lần). */
  private roleChecked = false;

  /**
   * Monitor ngưỡng dead-letter (G2-4). Optional để KHÔNG đổi mọi call-site `new OutboxWorker(bus, alert)`
   * hiện có (test + outbox.int-spec); khi vắng, tự dựng từ cùng AlertSink. DI prod truyền tường minh qua module.
   */
  private readonly monitor: DeadLetterAlertMonitor;

  constructor(
    private readonly bus: EventBus,
    @Inject(ALERT_SINK) private readonly alert: AlertSink,
    @Optional() monitor?: DeadLetterAlertMonitor,
  ) {
    this.monitor = monitor ?? new DeadLetterAlertMonitor(alert);
  }

  /**
   * Chặn worker chạy bằng role BYPASS RLS (review G2 H-1). Khi thiếu DATABASE_WORKER_URL, workerDb
   * fallback directPool có thể là superuser ⇒ RLS bị vô hiệu, cô lập tenant chỉ còn dựa kỷ luật dev
   * (vi phạm BẤT BIẾN #1). Prod: ném; dev: cảnh báo to. Logic gom về `assertWorkerRoleSafe` (G16 #3);
   * chỉ kiểm 1 lần/instance qua `roleChecked`.
   */
  private async assertWorkerRoleSafe(dbw: NonNullable<typeof workerDb>): Promise<void> {
    if (this.roleChecked) return;
    await assertWorkerRoleSafe(dbw, {
      context: "OutboxWorker",
      mode: "prod-only",
      logger: this.logger,
    });
    this.roleChecked = true;
  }

  async processBatch(batchSize = 20): Promise<{ claimed: number; deadLettered: number }> {
    const dbw = workerDb;
    if (!dbw) throw new Error("workerDb chưa cấu hình (DATABASE_WORKER_URL/DIRECT_URL).");
    await this.assertWorkerRoleSafe(dbw);

    // Reaper: event kẹt 'processing' quá lâu (worker crash giữa chừng) → trả lại 'pending' để retry.
    // make_interval(secs=>...) thay vì (int || ' milliseconds')::interval — bind param là integer,
    // `integer || text` ném lỗi runtime (review G2 FULL gate). secs nhận double nên backoff < 1s vẫn đúng.
    await dbw.execute(sql`
      UPDATE outbox_events SET status = 'pending', updated_at = now()
      WHERE status = 'processing'
        AND updated_at < now() - make_interval(secs => ${OutboxWorker.STALE_PROCESSING_MS / 1000})
    `);

    const claimed = await this.claim(batchSize);
    let deadLettered = 0;
    for (const ev of claimed) {
      deadLettered += await this.processEvent(ev);
    }

    // Sau 1 nhịp: kiểm ngưỡng dead-letter (G2-4). KHÔNG nuốt lỗi — log ERROR có stack; alert ngưỡng KHÔNG
    // được làm hỏng vòng claim/deadLetter (đã qua FULL gate G2). Idempotency ở chính checkThresholds (1 alert/window).
    try {
      await this.monitor.checkThresholds();
    } catch (monitorErr) {
      this.logger.error(
        `checkThresholds THẤT BẠI sau processBatch: ${monitorErr instanceof Error ? monitorErr.message : String(monitorErr)}`,
        monitorErr instanceof Error ? monitorErr.stack : undefined,
      );
    }

    return { claimed: claimed.length, deadLettered };
  }

  /** Claim atomically: chọn pending khả dụng, khoá SKIP LOCKED, set 'processing'. */
  private async claim(batchSize: number): Promise<ClaimedEvent[]> {
    const dbw = workerDb!;
    // CTE: inner SELECT...FOR UPDATE SKIP LOCKED và UPDATE chung 1 snapshot ⇒ claim atomic, không
    // double-claim dưới đồng thời (review G2: `UPDATE...WHERE id IN (subquery SKIP LOCKED)` có thể rò).
    //
    // ⚠️ S7-INT-OUTBOX-FIFO-1 (KI-059) — `ORDER BY` trong CTE `claimed` chỉ quyết định HÀNG NÀO được
    // claim; nó KHÔNG định thứ tự hàng của `RETURNING`. Thứ tự đó do planner sinh, nên bản cũ (UPDATE
    // là câu ngoài cùng) giao event cho consumer theo thứ tự tuỳ ý — đo thật trên lane: gieo seq 0..11
    // nhận về [0,8,10,7,6,11,5,2,1,4,3,9]. Bảng nhỏ thì plan tình cờ ra đúng FIFO ⇒ chạy cô lập là
    // XANH, chỉ lộ dưới tải, dạng hỏng-im-lặng ở mọi consumer phụ thuộc thứ tự.
    //
    // Vá: bọc UPDATE vào CTE thứ hai rồi `SELECT … ORDER BY` ở NGOÀI CÙNG — đây là chỗ DUY NHẤT
    // Postgres bảo đảm thứ tự. CẤM thay bằng sort ở tầng JS: làm vậy chỉ che triệu chứng ở đường này
    // và người sau thêm đường claim mới sẽ dính lại. CẤM bỏ `FOR UPDATE SKIP LOCKED`.
    // Tie-break `created_at, id` có ở CẢ HAI vế: vế trong để TẬP hàng được claim là tất định khi
    // `available_at` bằng nhau, vế ngoài để thứ tự giao là tất định.
    //
    // ⚠️ PHẠM VI BẢO ĐẢM — nói CHÍNH XÁC vì người sau sẽ dựa vào câu này:
    // bảo đảm chỉ có hiệu lực **trong MỘT lô claim của MỘT worker**. Ba chỗ nó KHÔNG với tới:
    //   1. Trong CÙNG một transaction: `available_at`/`created_at` đều mặc định `now()` = mốc BẮT ĐẦU
    //      TRANSACTION ⇒ nhiều event enqueue cùng tx bằng nhau ở CẢ HAI cột, tie-break rơi xuống `id`
    //      = UUID ngẫu nhiên. Thứ tự trong-tx là tất định-theo-tập nhưng KHÔNG phải thứ tự enqueue.
    //   2. Sau RETRY: `finalizeStatus` đẩy `available_at = now() + backoff` ⇒ event lỗi được giao SAU
    //      những event sinh sau nó. Đây là đánh đổi CÓ CHỦ ĐÍCH của backoff, không phải lỗi.
    //   3. Đa-instance: hai worker claim hai tập RỜI NHAU đồng thời — không có thứ tự chéo-worker nào.
    // Muốn thứ tự toàn cục đúng tuyệt đối cần cột đơn điệu (bigserial) + đổi hợp đồng đọc ⇒ WO RIÊNG,
    // đừng vá lén ở đây. Consumer nào cần thứ tự mạnh hơn phải tự chốt bằng dữ liệu trong payload.
    const res = await dbw.execute(sql`
      WITH claimed AS (
        SELECT id FROM outbox_events
        WHERE status = 'pending' AND available_at <= now()
        ORDER BY available_at, created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      ),
      updated AS (
        UPDATE outbox_events SET status = 'processing', updated_at = now()
        WHERE id IN (SELECT id FROM claimed)
        RETURNING id, company_id, event_type, payload, attempts, available_at, created_at
      )
      SELECT id, company_id, event_type, payload, attempts
      FROM updated
      ORDER BY available_at, created_at, id
    `);
    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      if (row.payload == null) {
        // payload NOT NULL ở schema; null = vi phạm toàn vẹn dữ liệu → ném (không nuốt bằng `?? {}`).
        throw new Error(
          `outbox event ${String(row.id)} có payload null — vi phạm toàn vẹn dữ liệu.`,
        );
      }
      return {
        id: row.id as string,
        companyId: row.company_id as string,
        eventType: row.event_type as string,
        payload: row.payload as Record<string, unknown>,
        attempts: Number(row.attempts ?? 0),
      };
    });
  }

  /** Xử lý 1 event qua mọi consumer của nó. Trả số dead-letter sinh ra. */
  private async processEvent(ev: ClaimedEvent): Promise<number> {
    const consumers = this.bus.consumersFor(ev.eventType);
    if (consumers.length === 0) {
      await this.setStatus(ev.id, "done");
      return 0;
    }

    let allOk = true;
    let deadLettered = 0;

    for (const consumer of consumers) {
      if (await this.isProcessed(consumer.consumerName, ev.id)) continue; // idempotent: đã xử lý

      try {
        await consumer.handle({
          eventId: ev.id,
          companyId: ev.companyId,
          eventType: ev.eventType,
          payload: ev.payload,
        });
        await this.markProcessed(consumer.consumerName, ev.id);
      } catch (err) {
        allOk = false;
        const message = err instanceof Error ? err.message : String(err);
        const nextAttempts = ev.attempts + 1;
        if (nextAttempts >= OutboxWorker.MAX_ATTEMPTS) {
          // Hết lượt: dead-letter + alert; đánh dấu consumer này đã xử lý để không retry vô hạn.
          await this.deadLetter(ev, consumer.consumerName, message);
          await this.markProcessed(consumer.consumerName, ev.id);
          deadLettered += 1;
        } else {
          this.logger.warn(
            `event ${ev.id} consumer ${consumer.consumerName} lỗi (lần ${nextAttempts}): ${message}`,
          );
        }
      }
    }

    await this.finalizeStatus(ev, allOk);
    return deadLettered;
  }

  private async finalizeStatus(ev: ClaimedEvent, allOk: boolean): Promise<void> {
    if (allOk) {
      await this.setStatus(ev.id, "done");
      return;
    }
    const nextAttempts = ev.attempts + 1;
    const dbw = workerDb!;
    if (nextAttempts >= OutboxWorker.MAX_ATTEMPTS) {
      await dbw.execute(sql`
        UPDATE outbox_events SET status = 'failed', attempts = ${nextAttempts}, updated_at = now()
        WHERE id = ${ev.id}
      `);
    } else {
      await dbw.execute(sql`
        UPDATE outbox_events
        SET status = 'pending', attempts = ${nextAttempts},
            available_at = now() + make_interval(secs => ${OutboxWorker.RETRY_BACKOFF_MS / 1000}),
            updated_at = now()
        WHERE id = ${ev.id}
      `);
    }
  }

  private async setStatus(id: string, status: "done" | "failed"): Promise<void> {
    await workerDb!.execute(sql`
      UPDATE outbox_events SET status = ${status}, updated_at = now() WHERE id = ${id}
    `);
  }

  private async isProcessed(consumerName: string, eventId: string): Promise<boolean> {
    const res = await workerDb!.execute(sql`
      SELECT 1 FROM processed_events WHERE consumer_name = ${consumerName} AND event_id = ${eventId}
    `);
    return res.rows.length > 0;
  }

  private async markProcessed(consumerName: string, eventId: string): Promise<void> {
    await workerDb!.execute(sql`
      INSERT INTO processed_events (consumer_name, event_id) VALUES (${consumerName}, ${eventId})
      ON CONFLICT (consumer_name, event_id) DO NOTHING
    `);
  }

  private async deadLetter(ev: ClaimedEvent, consumerName: string, error: string): Promise<void> {
    const dbw = workerDb!;
    // ON CONFLICT DO NOTHING + UNIQUE(event_id, consumer_name): crash giữa deadLetter↔markProcessed
    // ⇒ chạy lại KHÔNG tạo dead-letter trùng (review G2). Không có row trả về = đã dead-letter trước đó
    // ⇒ KHÔNG alert lại (tránh báo động kép).
    const res = await dbw.execute(sql`
      INSERT INTO dead_letter_events (company_id, event_id, consumer_name, event_type, payload, error)
      VALUES (${ev.companyId}, ${ev.id}, ${consumerName}, ${ev.eventType}, ${JSON.stringify(ev.payload)}::jsonb, ${error})
      ON CONFLICT (event_id, consumer_name) DO NOTHING
      RETURNING id
    `);
    if (res.rows.length === 0) return; // đã dead-letter (idempotent)
    const deadLetterId = (res.rows[0] as { id: string }).id;
    // Alert KHÔNG bao giờ rỗng (G2-4): sink mặc định log error. Lỗi alert không được nuốt im lặng.
    try {
      await this.alert.deadLetter({
        deadLetterId,
        eventId: ev.id,
        companyId: ev.companyId,
        eventType: ev.eventType,
        consumerName,
        error,
      });
    } catch (alertErr) {
      // Truyền stack vào logger để giữ cause chain (review silent-failure F4).
      this.logger.error(
        `alert dead-letter THẤT BẠI cho event ${ev.id}: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`,
        alertErr instanceof Error ? alertErr.stack : undefined,
      );
    }
  }
}
