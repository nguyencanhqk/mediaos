import { Injectable } from "@nestjs/common";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { notificationEvents, type NotificationEvent } from "../db/schema/noti";

/**
 * NotificationEventRepository — đọc danh mục `notification_events` (DB-07 §7.1, S4-NOTI-BE-2 L1-repos).
 * App role CHỈ có GRANT SELECT trên bảng này (migration 0479) — ghi company-override thuộc S4-NOTI-BE-3,
 * KHÔNG làm ở đây.
 *
 * Mọi method nhận `tx: TenantTx` từ caller (engine service — S4-NOTI-BE-2 L2 — mở `withTenant` MỘT LẦN
 * cho cả luồng intake, có thể bọc SAVEPOINT quanh phần ghi mỗi recipient) — repo KHÔNG tự mở transaction
 * (mirror pattern `MyNotificationsRepository`, CLAUDE.md §2 bất biến #1 vẫn giữ vì RLS sống trong `tx`
 * do `withTenant` cấp).
 */
@Injectable()
export class NotificationEventRepository {
  /**
   * Trả về event ĐANG HIỆU LỰC cho `eventCode`: ưu tiên company-override > global — `ORDER BY company_id
   * NULLS LAST` đưa hàng company-scoped (company_id NOT NULL) lên trước hàng global (company_id NULL) khi
   * cả 2 cùng tồn tại (unique index 0479 đảm bảo TỐI ĐA 1 hàng mỗi loại còn hiệu lực). CHỈ trả về hàng
   * THẮNG nếu `is_enabled=true` — override công ty đã tắt tường minh PHẢI thắng dù global đang bật (KHÔNG
   * rơi xuống global khi company đã disable — đúng ngữ nghĩa "company-override thắng global" 2 chiều).
   * `deleted_at IS NULL` luôn áp cho cả 2 loại hàng.
   *
   * RLS (policy nullable-tenant 0479: `company_id = GUC OR company_id IS NULL`) đã tự giới hạn hàng thấy
   * được đúng tenant; filter `companyId` tường minh dưới đây là defense-in-depth (CLAUDE.md §2 bất biến #1
   * — company_id ở MỌI query, không dựa hoàn toàn vào kỷ luật RLS).
   */
  async findEnabledEvent(
    tx: TenantTx,
    companyId: string,
    eventCode: string,
  ): Promise<NotificationEvent | undefined> {
    const rows = await tx
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.eventCode, eventCode),
          isNull(notificationEvents.deletedAt),
          or(eq(notificationEvents.companyId, companyId), isNull(notificationEvents.companyId)),
        ),
      )
      .orderBy(sql`${notificationEvents.companyId} NULLS LAST`)
      .limit(1);

    const winner = rows[0];
    if (!winner || !winner.isEnabled) return undefined;
    return winner;
  }

  /** Bộ lọc GET /notifications/events (NOTI-API-301, API-07 §14.1) — admin catalog. */
  async listCatalog(
    tx: TenantTx,
    companyId: string,
    filter: NotificationEventCatalogFilter,
  ): Promise<NotificationEvent[]> {
    // Visibility = company override (company_id=GUC) ∪ global (company_id IS NULL), chưa xoá — RLS
    // (nullable-tenant 0479) đã tự giới hạn; filter companyId tường minh = defense-in-depth (BẤT BIẾN #1).
    const rows = await tx
      .select()
      .from(notificationEvents)
      .where(
        and(
          isNull(notificationEvents.deletedAt),
          or(eq(notificationEvents.companyId, companyId), isNull(notificationEvents.companyId)),
        ),
      )
      // company_id NULLS LAST ⇒ hàng override (NOT NULL) đứng TRƯỚC hàng global cùng event_code — merge
      // bên dưới lấy "trước tiên gặp mỗi eventCode" = company thắng global (mirror findEnabledEvent).
      .orderBy(notificationEvents.eventCode, sql`${notificationEvents.companyId} NULLS LAST`);

    const merged = new Map<string, NotificationEvent>();
    for (const row of rows) {
      if (!merged.has(row.eventCode)) merged.set(row.eventCode, row);
    }

    let list = [...merged.values()];
    if (filter.moduleCode) list = list.filter((e) => e.moduleCode === filter.moduleCode);
    if (filter.eventCode) list = list.filter((e) => e.eventCode === filter.eventCode);
    if (filter.enabled !== undefined) list = list.filter((e) => e.isEnabled === filter.enabled);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(
        (e) => e.eventCode.toLowerCase().includes(q) || e.eventName.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => a.eventCode.localeCompare(b.eventCode));
    return list;
  }
}

/** Bộ lọc admin catalog (NOTI-API-301) — trước khi in-memory phân trang (catalog nhỏ, <100 dòng). */
export interface NotificationEventCatalogFilter {
  moduleCode?: string;
  eventCode?: string;
  enabled?: boolean;
  search?: string;
}
