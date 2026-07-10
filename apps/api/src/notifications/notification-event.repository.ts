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
}
