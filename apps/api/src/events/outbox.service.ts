import { Injectable } from "@nestjs/common";
import type { TenantTx } from "../db/db.service";
import { outboxEvents } from "../db/schema";
import type { EventPayload } from "./event-bus";

export interface NewEvent {
  eventType: string;
  payload: EventPayload;
}

/**
 * Transactional outbox (ADR-0009): `enqueue` chèn event CÙNG transaction nghiệp vụ (`withTenant`).
 * Rollback nghiệp vụ ⇒ event cũng biến mất (không phát event ma). company_id từ ngữ cảnh (DB DEFAULT).
 */
@Injectable()
export class OutboxService {
  async enqueue(tx: TenantTx, event: NewEvent): Promise<string> {
    const [row] = await tx
      .insert(outboxEvents)
      .values({ eventType: event.eventType, payload: event.payload })
      .returning({ id: outboxEvents.id });
    return row.id;
  }

  /**
   * S13-PAYROLL-BE-2 (additive) — chèn NHIỀU event trong MỘT câu lệnh.
   *
   * Dùng khi một hành động nghiệp vụ phát N event cùng lúc (`publish` một kỳ lương 500 người phát 500
   * `PAYSLIP_PUBLISHED`): 500 lượt `enqueue` là 500 round-trip nằm trong transaction nghiệp vụ đang
   * giữ row-lock trên kỳ.
   *
   * ⚠️ Outbox **KHÔNG FIFO** (worker lấy theo `available_at` + khoá hàng, `RETURNING` không giữ thứ
   * tự chèn) — không consumer/test nào được assert thứ tự phát, kể cả khi chèn một lô.
   */
  async enqueueMany(tx: TenantTx, events: readonly NewEvent[]): Promise<string[]> {
    if (events.length === 0) return [];
    const rows = await tx
      .insert(outboxEvents)
      .values(events.map((e) => ({ eventType: e.eventType, payload: e.payload })))
      .returning({ id: outboxEvents.id });
    return rows.map((r) => r.id);
  }
}
