import { Injectable } from "@nestjs/common";

/** Payload event nội bộ — JSON tự do (đã ràng buộc ở nơi enqueue). */
export type EventPayload = Record<string, unknown>;

/** Ngữ cảnh trao cho handler khi xử lý 1 event đã claim từ outbox. */
export interface EventContext {
  eventId: string;
  companyId: string;
  eventType: string;
  payload: EventPayload;
}

/** Handler PHẢI idempotent (có thể bị gọi lại sau crash giữa chừng). */
export type EventHandler = (ctx: EventContext) => Promise<void>;

export interface Consumer {
  /** Định danh consumer — khoá idempotency cùng event_id (processed_events). DUY NHẤT toàn hệ. */
  consumerName: string;
  eventType: string;
  handle: EventHandler;
}

/**
 * Sổ đăng ký consumer nội bộ (ADR-0009). NHIỀU consumer khác `consumerName` có thể cùng nghe 1
 * eventType — mỗi cái xử lý độc lập, idempotency riêng theo (consumer_name, event_id).
 */
@Injectable()
export class EventBus {
  private readonly byType = new Map<string, Consumer[]>();
  private readonly names = new Set<string>();

  register(consumer: Consumer): void {
    if (this.names.has(consumer.consumerName)) {
      throw new Error(`consumerName trùng: ${consumer.consumerName} (phải duy nhất toàn hệ).`);
    }
    this.names.add(consumer.consumerName);
    const list = this.byType.get(consumer.eventType) ?? [];
    list.push(consumer);
    this.byType.set(consumer.eventType, list);
  }

  /** Trả mọi consumer nghe `eventType` (rỗng nếu không ai nghe). */
  consumersFor(eventType: string): readonly Consumer[] {
    return this.byType.get(eventType) ?? [];
  }
}
