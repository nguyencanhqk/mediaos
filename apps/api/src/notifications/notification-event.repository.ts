import { Injectable } from "@nestjs/common";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { notificationEvents, type NotificationEvent } from "../db/schema/noti";
import { isUniqueViolation } from "../common/db-error";

/**
 * NotificationEventRepository — đọc danh mục `notification_events` (DB-07 §7.1) + ghi COMPANY-OVERRIDE
 * (bật/tắt event theo công ty — S4-NOTI-BE-4). App role có GRANT SELECT (0479) + INSERT,UPDATE (0487) —
 * KHÔNG DELETE. RLS policy nullable-tenant 0479 (WITH CHECK company_id=GUC, KHÔNG "OR IS NULL") chặn CỨNG
 * mọi ghi vào hàng company_id NULL (global): vì vậy bật/tắt event global = INSERT hàng override MỚI, KHÔNG
 * UPDATE hàng global.
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

  /**
   * BE-4 — resolve 1 event theo `id` trong tầm nhìn công ty: company-override (company_id=GUC) ∪ global
   * (company_id IS NULL), chưa xoá. `id` có thể trỏ hàng global (bật/tắt lần đầu) hoặc hàng override đã có.
   * RLS đã giới hạn tenant; filter companyId/isNull tường minh = defense-in-depth (BẤT BIẾN #1).
   */
  async findByIdForCompany(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<NotificationEvent | undefined> {
    const rows = await tx
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.id, id),
          isNull(notificationEvents.deletedAt),
          or(eq(notificationEvents.companyId, companyId), isNull(notificationEvents.companyId)),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * BE-4 — bật/tắt event = ghi COMPANY-OVERRIDE (KHÔNG BAO GIỜ UPDATE hàng global). Rẽ nhánh theo
   * `sourceRow.companyId` (KHÔNG suy theo id lẻ — risk #1):
   *   • sourceRow ĐÃ là override của company (companyId===companyId) → UPDATE in-place, predicate KÉP
   *     (id AND company_id) defense-in-depth.
   *   • sourceRow là global (companyId===null) → tìm override sẵn theo (companyId, eventCode): có → UPDATE;
   *     không → INSERT CLONE toàn bộ field NOT NULL từ global + companyId + is_enabled mới. Đua 2 admin
   *     cùng company (23505 trên uq_company_code_active) → SAVEPOINT rollback + fallback UPDATE (risk #2:
   *     lỗi 23505 làm abort transaction cha nếu KHÔNG bọc savepoint).
   */
  async upsertCompanyOverride(
    tx: TenantTx,
    companyId: string,
    sourceRow: NotificationEvent,
    isEnabled: boolean,
    actorUserId: string,
  ): Promise<NotificationEvent> {
    if (sourceRow.companyId === companyId) {
      return this.updateOverrideById(tx, companyId, sourceRow.id, isEnabled, actorUserId);
    }

    // sourceRow là global → tìm override sẵn của company theo eventCode.
    const existing = await this.findCompanyOverrideByCode(tx, companyId, sourceRow.eventCode);
    if (existing) {
      return this.updateOverrideById(tx, companyId, existing.id, isEnabled, actorUserId);
    }

    // Chưa có override → INSERT clone. Bọc SAVEPOINT: 23505 (đua) chỉ rollback nhánh này, KHÔNG poison tx cha.
    try {
      return await tx.transaction(async (sp) => {
        const inserted = await sp
          .insert(notificationEvents)
          .values({
            companyId,
            moduleCode: sourceRow.moduleCode,
            eventCode: sourceRow.eventCode,
            eventName: sourceRow.eventName,
            description: sourceRow.description,
            notificationType: sourceRow.notificationType,
            defaultPriority: sourceRow.defaultPriority,
            defaultChannels: sourceRow.defaultChannels,
            recipientRuleConfig: sourceRow.recipientRuleConfig,
            dedupeStrategy: sourceRow.dedupeStrategy,
            dedupeWindowSeconds: sourceRow.dedupeWindowSeconds,
            throttleConfig: sourceRow.throttleConfig,
            isEnabled,
            isSystemEvent: sourceRow.isSystemEvent,
            metadata: sourceRow.metadata,
            createdBy: actorUserId,
            updatedBy: actorUserId,
          })
          .returning();
        return inserted[0];
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.findCompanyOverrideByCode(tx, companyId, sourceRow.eventCode);
        if (raced) {
          return this.updateOverrideById(tx, companyId, raced.id, isEnabled, actorUserId);
        }
      }
      throw err;
    }
  }

  private async findCompanyOverrideByCode(
    tx: TenantTx,
    companyId: string,
    eventCode: string,
  ): Promise<NotificationEvent | undefined> {
    const rows = await tx
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.companyId, companyId),
          eq(notificationEvents.eventCode, eventCode),
          isNull(notificationEvents.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async updateOverrideById(
    tx: TenantTx,
    companyId: string,
    id: string,
    isEnabled: boolean,
    actorUserId: string,
  ): Promise<NotificationEvent> {
    const updated = await tx
      .update(notificationEvents)
      .set({ isEnabled, updatedBy: actorUserId, updatedAt: new Date() })
      // predicate KÉP id + company_id (defense-in-depth): KHÔNG bao giờ chạm hàng global (company_id NULL).
      .where(and(eq(notificationEvents.id, id), eq(notificationEvents.companyId, companyId)))
      .returning();
    return updated[0];
  }
}

/** Bộ lọc admin catalog (NOTI-API-301) — trước khi in-memory phân trang (catalog nhỏ, <100 dòng). */
export interface NotificationEventCatalogFilter {
  moduleCode?: string;
  eventCode?: string;
  enabled?: boolean;
  search?: string;
}
