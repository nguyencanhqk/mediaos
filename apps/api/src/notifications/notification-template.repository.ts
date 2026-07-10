import { Injectable } from "@nestjs/common";
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { notificationTemplates, type NotificationTemplate } from "../db/schema/noti";

/**
 * NotificationTemplateRepository — đọc danh mục `notification_templates` (DB-07 §7.2, S4-NOTI-BE-2
 * L1-repos). App role CHỈ có GRANT SELECT (migration 0479) — ghi company-override thuộc S4-NOTI-BE-3.
 *
 * Nhận `tx: TenantTx` từ caller — KHÔNG tự mở transaction (mirror `NotificationEventRepository`).
 */
@Injectable()
export class NotificationTemplateRepository {
  /**
   * Trả về template `status='Active'` cho (`eventId`, `channel`): ưu tiên company-override > global
   * (`ORDER BY company_id NULLS LAST`), khớp `locale` chính xác TRƯỚC; nếu KHÔNG có bản khớp locale, dùng
   * template `is_default=true` cùng (eventId, channel) làm fallback — company chỉ seed 1 bản mặc định
   * (chưa dịch đủ locale) vẫn resolve được thay vì rơi vào nhánh "template missing" oan (DB-07 §7.2
   * `is_default`). `deleted_at IS NULL` luôn áp cho cả 2 bước.
   */
  async findActiveTemplate(
    tx: TenantTx,
    companyId: string,
    eventId: string,
    channel: string,
    locale: string,
  ): Promise<NotificationTemplate | undefined> {
    const exact = await this.queryOne(
      tx,
      companyId,
      eventId,
      channel,
      eq(notificationTemplates.locale, locale),
    );
    if (exact) return exact;
    return this.queryOne(
      tx,
      companyId,
      eventId,
      channel,
      eq(notificationTemplates.isDefault, true),
    );
  }

  private async queryOne(
    tx: TenantTx,
    companyId: string,
    eventId: string,
    channel: string,
    extraCond: SQL,
  ): Promise<NotificationTemplate | undefined> {
    const rows = await tx
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.eventId, eventId),
          eq(notificationTemplates.channel, channel),
          eq(notificationTemplates.status, "Active"),
          isNull(notificationTemplates.deletedAt),
          or(
            eq(notificationTemplates.companyId, companyId),
            isNull(notificationTemplates.companyId),
          ),
          extraCond,
        ),
      )
      .orderBy(sql`${notificationTemplates.companyId} NULLS LAST`)
      .limit(1);
    return rows[0];
  }
}
