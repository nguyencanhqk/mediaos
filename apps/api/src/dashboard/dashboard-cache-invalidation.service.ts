import { Injectable, Logger } from "@nestjs/common";
import {
  DASH_CACHE_INVALIDATION_MAP,
  widgetsForInvalidationEvent,
} from "./dashboard-cache-invalidation.const";
import { DashboardWidgetCacheService } from "./dashboard-widget-cache.service";

export interface InvalidateResult {
  eventCode: string;
  invalidatedWidgets: string[];
  rowsAffected: number;
}

/**
 * S4-INT-2 — DashboardCacheInvalidationService: map eventCode (registry §9.5 reconciled,
 * dashboard-cache-invalidation.const.ts) → widget cần invalidate, rồi soft-delete cache row ACTIVE tương ứng
 * (BẤT BIẾN #1 company_id qua withTenant + BẤT BIẾN #2 KHÔNG DELETE — DashboardWidgetCacheService.
 * invalidateByWidgetId chỉ UPDATE deleted_at).
 *
 * Per-widget fire-and-forget: 1 widget lỗi (vd catalog global thiếu — resolveWidgetId ném) KHÔNG chặn các
 * widget còn lại của cùng event (mirror triết lý NOTI intake — 1 event có thể chạm nhiều widget độc lập).
 * eventCode KHÔNG có trong map ⇒ ném lỗi loud (controller map 400 DASH-ERR-UNKNOWN_INVALIDATION_EVENT) —
 * KHÔNG âm thầm no-op, đúng yêu cầu "mã không có producer bị loại/map" (Đội 3 đối chiếu bằng test 400).
 */
@Injectable()
export class DashboardCacheInvalidationService {
  private readonly logger = new Logger(DashboardCacheInvalidationService.name);

  constructor(private readonly cache: DashboardWidgetCacheService) {}

  /** true nếu eventCode nằm trong registry reconciled (map có mapping widget). */
  isKnownEvent(eventCode: string): boolean {
    return Object.prototype.hasOwnProperty.call(DASH_CACHE_INVALIDATION_MAP, eventCode);
  }

  async invalidate(
    companyId: string,
    eventCode: string,
    userIds?: readonly string[],
  ): Promise<InvalidateResult> {
    const widgetCodes = widgetsForInvalidationEvent(eventCode);
    if (!widgetCodes) {
      throw new Error(`DASH cache invalidate: eventCode ngoài registry (${eventCode})`);
    }

    const invalidatedWidgets: string[] = [];
    let rowsAffected = 0;
    for (const widgetCode of widgetCodes) {
      try {
        const widgetId = await this.cache.resolveWidgetId(companyId, widgetCode);
        rowsAffected += await this.cache.invalidateByWidgetId(
          companyId,
          widgetId,
          widgetCode,
          userIds,
        );
        invalidatedWidgets.push(widgetCode);
      } catch (err) {
        // Fire-and-forget theo widget — 1 widget catalog thiếu KHÔNG chặn các widget khác của cùng event.
        this.logger.error(
          `invalidate(${eventCode}) widget=${widgetCode} THẤT BẠI: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { eventCode, invalidatedWidgets, rowsAffected };
  }
}
