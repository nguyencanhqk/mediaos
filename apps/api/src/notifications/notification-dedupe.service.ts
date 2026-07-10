import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { notifications } from "../db/schema/communication";
import {
  DEFAULT_DEDUPE,
  DEFAULT_DEDUPE_WINDOW_SECONDS,
  type DedupeStrategy,
} from "./notification-dedupe.const";

/** Cấu hình dedupe đã giải (catalog + DEFAULT_DEDUPE fallback). */
export interface ResolvedDedupe {
  strategy: DedupeStrategy;
  windowSeconds: number | null;
}

export interface ComputeKeyInput {
  strategy: DedupeStrategy;
  windowSeconds: number | null;
  eventCode: string;
  recipientUserId: string;
  sourceEntityId?: string | null;
  /** `dedupeKey` client cung cấp (DTO) — chỉ dùng cho strategy 'DedupeKey'. */
  dedupeKey?: string | null;
  /** Mốc thời gian (ms epoch) để tính bucket TimeWindow — dùng `occurredAt` DTO nếu có, else now. */
  occurredAtMs?: number;
}

export interface IsDuplicateKey {
  recipientUserId: string;
  eventCode: string;
  dedupeKey: string;
}

/**
 * S4-NOTI-BE-2 (L2-engine) — TÍNH dedupe_key + kiểm trùng TẦNG APP (tầng 1). Tầng 2 (chống race) là
 * partial-unique `uq_notifications_dedupe_active(company_id, recipient_user_id, event_code, dedupe_key)`
 * bắt ở INSERT (engine bọc SAVEPOINT, xem NotificationEngineService §6.2). Cả 2 tầng dùng CHUNG key ⇒ khớp
 * cột index (thiếu 1 cột ⇒ index coi NULL distinct ⇒ dedupe hỏng im lặng — plan §8).
 */
@Injectable()
export class NotificationDedupeService {
  /**
   * Catalog THẮNG: nếu `event.dedupeStrategy != 'None'` dùng nguyên catalog (+ window). Chỉ khi catalog='None'
   * mới rơi về `DEFAULT_DEDUPE` (2 event TASK ồn ào). Ngoài default + None ⇒ giữ 'None' (không dedupe).
   */
  resolveStrategy(event: {
    eventCode: string;
    dedupeStrategy: string;
    dedupeWindowSeconds: number | null;
  }): ResolvedDedupe {
    const catalog = event.dedupeStrategy as DedupeStrategy;
    if (catalog !== "None") {
      return { strategy: catalog, windowSeconds: event.dedupeWindowSeconds };
    }
    const fallback = DEFAULT_DEDUPE[event.eventCode];
    if (fallback) {
      return { strategy: fallback.strategy, windowSeconds: fallback.windowSeconds };
    }
    return { strategy: "None", windowSeconds: null };
  }

  /**
   * Trả `dedupe_key` ổn định theo strategy, hoặc `null` (⇒ engine KHÔNG set dedupe_key ⇒ không dedupe):
   *  • None → null.
   *  • DedupeKey → `{eventCode}:{dtoDedupeKey}` (once-ever, ổn định) — thiếu dtoDedupeKey ⇒ null.
   *  • EntityRecipient → `{eventCode}:{sourceEntityId}:{recipientUserId}` (once-ever) — thiếu entity ⇒ null.
   *  • TimeWindow → `{eventCode}:{sourceEntityId}:{recipientUserId}:{floor(epoch/window)}` — bucket: trùng
   *    TRONG bucket bị chặn, sang bucket kế cho qua.
   */
  computeKey(input: ComputeKeyInput): string | null {
    const { strategy, eventCode, recipientUserId } = input;
    const sourceEntityId = input.sourceEntityId ?? "";
    switch (strategy) {
      case "None":
        return null;
      case "DedupeKey":
        return input.dedupeKey ? `${eventCode}:${input.dedupeKey}` : null;
      case "EntityRecipient":
        return input.sourceEntityId
          ? `${eventCode}:${input.sourceEntityId}:${recipientUserId}`
          : null;
      case "TimeWindow": {
        const window =
          input.windowSeconds && input.windowSeconds > 0
            ? input.windowSeconds
            : DEFAULT_DEDUPE_WINDOW_SECONDS;
        const epochSeconds = Math.floor((input.occurredAtMs ?? Date.now()) / 1000);
        const bucket = Math.floor(epochSeconds / window);
        return `${eventCode}:${sourceEntityId}:${recipientUserId}:${bucket}`;
      }
      default:
        return null;
    }
  }

  /**
   * Tầng 1 (app): có notification CÒN HIỆU LỰC (deleted_at IS NULL) cùng
   * (company_id, recipient_user_id, event_code, dedupe_key) chưa? Filter khớp CHÍNH XÁC cột partial-unique
   * để tầng 1 và tầng 2 đồng nhất. company_id tường minh (defense-in-depth) + RLS trong `tx`.
   */
  async isDuplicate(tx: TenantTx, companyId: string, key: IsDuplicateKey): Promise<boolean> {
    const rows = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.companyId, companyId),
          eq(notifications.recipientUserId, key.recipientUserId),
          eq(notifications.eventCode, key.eventCode),
          eq(notifications.dedupeKey, key.dedupeKey),
          isNull(notifications.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
