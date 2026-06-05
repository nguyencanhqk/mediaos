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
}
