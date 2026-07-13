import { Injectable } from "@nestjs/common";
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import {
  notificationEvents,
  notificationTemplates,
  type NotificationTemplate,
} from "../db/schema/noti";
import { isUniqueViolation } from "../common/db-error";

/**
 * NotificationTemplateRepository — đọc danh mục `notification_templates` (DB-07 §7.2) + ghi COMPANY-OVERRIDE
 * (sửa nội dung template theo công ty — S4-NOTI-BE-4). App role có GRANT SELECT (0479) + INSERT,UPDATE
 * (0487) — KHÔNG DELETE. RLS policy nullable-tenant 0479 (WITH CHECK company_id=GUC) chặn CỨNG mọi ghi vào
 * hàng global (company_id NULL): sửa template global = INSERT hàng override MỚI, KHÔNG UPDATE hàng global.
 *
 * Nhận `tx: TenantTx` từ caller — KHÔNG tự mở transaction (trừ SAVEPOINT chống đua INSERT override).
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

  /**
   * GET /notifications/templates/{id} (NOTI-API-303 thu hẹp — detail, KHÔNG list). Visibility = company
   * override (company_id=GUC) ∪ global (company_id IS NULL) — mirror findActiveTemplate; KHÔNG lọc status
   * (admin cần xem CẢ Draft/Inactive/Archived, không chỉ 'Active'). `deleted_at IS NULL` vẫn áp.
   */
  async findByIdForCompany(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<NotificationTemplate | undefined> {
    const rows = await tx
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.id, id),
          isNull(notificationTemplates.deletedAt),
          or(
            eq(notificationTemplates.companyId, companyId),
            isNull(notificationTemplates.companyId),
          ),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * S4-NOTI-BE-5 — GET /notifications/templates (NOTI-API-303 LIST, mở lại scope gốc). Visibility = company
   * override (company_id=GUC) ∪ global (company_id IS NULL), chưa xoá — RLS (nullable-tenant 0479) đã tự
   * giới hạn tenant; filter companyId/isNull tường minh = defense-in-depth (BẤT BIẾN #1, KHÔNG dựa hoàn
   * toàn RLS). Mirror listCatalog của events: merge "override thắng global" theo (event_id, template_code,
   * channel, locale) — `company_id NULLS LAST` đưa hàng override (NOT NULL) lên TRƯỚC hàng global cùng khoá,
   * lấy "gặp đầu tiên mỗi khoá" = company thắng.
   *
   * INNER JOIN `notification_events` để lấy `event_code` (template chỉ mang event_id) — cho filter
   * `eventCode`. Event global (company_id NULL) luôn hiển thị dưới RLS nên join KHÔNG rớt template; KHÔNG
   * fan-out (join theo id = PK). KHÔNG lọc `status` (admin cần xem CẢ Draft/Inactive/Archived).
   * Filter + sort in-memory (catalog nhỏ, mirror listCatalog); phân trang do controller (mirror events).
   */
  async listForCompany(
    tx: TenantTx,
    companyId: string,
    filter: NotificationTemplateCatalogFilter,
  ): Promise<NotificationTemplate[]> {
    const rows = await tx
      .select({ template: notificationTemplates, eventCode: notificationEvents.eventCode })
      .from(notificationTemplates)
      .innerJoin(notificationEvents, eq(notificationTemplates.eventId, notificationEvents.id))
      .where(
        and(
          isNull(notificationTemplates.deletedAt),
          or(
            eq(notificationTemplates.companyId, companyId),
            isNull(notificationTemplates.companyId),
          ),
        ),
      )
      .orderBy(
        notificationTemplates.templateCode,
        sql`${notificationTemplates.companyId} NULLS LAST`,
      );

    const merged = new Map<string, { template: NotificationTemplate; eventCode: string }>();
    for (const row of rows) {
      const key = `${row.template.eventId}::${row.template.templateCode}::${row.template.channel}::${row.template.locale}`;
      if (!merged.has(key)) merged.set(key, row);
    }

    let list = [...merged.values()];
    if (filter.eventId) list = list.filter((r) => r.template.eventId === filter.eventId);
    if (filter.eventCode) list = list.filter((r) => r.eventCode === filter.eventCode);
    if (filter.channel) list = list.filter((r) => r.template.channel === filter.channel);
    if (filter.locale) list = list.filter((r) => r.template.locale === filter.locale);
    list.sort((a, b) => a.template.templateCode.localeCompare(b.template.templateCode));
    return list.map((r) => r.template);
  }

  /**
   * BE-4 — sửa template = ghi COMPANY-OVERRIDE (KHÔNG BAO GIỜ UPDATE hàng global). Rẽ nhánh theo
   * `sourceRow.companyId` (KHÔNG suy theo id lẻ — risk #1):
   *   • sourceRow ĐÃ là override của company → UPDATE in-place (predicate KÉP id + company_id).
   *   • sourceRow là global → tìm override sẵn theo (companyId, templateCode): có → UPDATE; không → INSERT
   *     CLONE toàn bộ field từ global rồi ghi đè các field client PATCH. Đua 2 admin (23505 trên
   *     uq_company_code_active) → SAVEPOINT + fallback UPDATE.
   * `patch` chỉ chứa field client gửi (undefined = giữ nguyên giá trị clone/hiện tại).
   */
  async upsertCompanyOverride(
    tx: TenantTx,
    companyId: string,
    sourceRow: NotificationTemplate,
    patch: TemplateOverridePatch,
    actorUserId: string,
  ): Promise<NotificationTemplate> {
    if (sourceRow.companyId === companyId) {
      return this.updateOverrideById(tx, companyId, sourceRow.id, patch, actorUserId);
    }

    const existing = await this.findCompanyOverrideByCode(tx, companyId, sourceRow.templateCode);
    if (existing) {
      return this.updateOverrideById(tx, companyId, existing.id, patch, actorUserId);
    }

    // INSERT clone từ global + ghi đè field PATCH. SAVEPOINT: 23505 (đua) rollback nhánh này, KHÔNG poison cha.
    try {
      return await tx.transaction(async (sp) => {
        const inserted = await sp
          .insert(notificationTemplates)
          .values({
            companyId,
            eventId: sourceRow.eventId,
            templateCode: sourceRow.templateCode,
            channel: sourceRow.channel,
            locale: sourceRow.locale,
            titleTemplate: patch.titleTemplate ?? sourceRow.titleTemplate,
            bodyTemplate: patch.bodyTemplate ?? sourceRow.bodyTemplate,
            shortBodyTemplate:
              patch.shortBodyTemplate !== undefined
                ? patch.shortBodyTemplate
                : sourceRow.shortBodyTemplate,
            actionLabelTemplate:
              patch.actionLabelTemplate !== undefined
                ? patch.actionLabelTemplate
                : sourceRow.actionLabelTemplate,
            targetUrlTemplate:
              patch.targetUrlTemplate !== undefined
                ? patch.targetUrlTemplate
                : sourceRow.targetUrlTemplate,
            variablesSchema: sourceRow.variablesSchema,
            samplePayload: sourceRow.samplePayload,
            version: sourceRow.version,
            status: patch.status ?? sourceRow.status,
            isDefault: sourceRow.isDefault,
            effectiveFrom: sourceRow.effectiveFrom,
            effectiveTo: sourceRow.effectiveTo,
            metadata: sourceRow.metadata,
            createdBy: actorUserId,
            updatedBy: actorUserId,
          })
          .returning();
        return inserted[0];
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await this.findCompanyOverrideByCode(tx, companyId, sourceRow.templateCode);
        if (raced) {
          return this.updateOverrideById(tx, companyId, raced.id, patch, actorUserId);
        }
      }
      throw err;
    }
  }

  private async findCompanyOverrideByCode(
    tx: TenantTx,
    companyId: string,
    templateCode: string,
  ): Promise<NotificationTemplate | undefined> {
    const rows = await tx
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.companyId, companyId),
          eq(notificationTemplates.templateCode, templateCode),
          isNull(notificationTemplates.deletedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async updateOverrideById(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: TemplateOverridePatch,
    actorUserId: string,
  ): Promise<NotificationTemplate> {
    const set: Record<string, unknown> = { updatedBy: actorUserId, updatedAt: new Date() };
    if (patch.titleTemplate !== undefined) set.titleTemplate = patch.titleTemplate;
    if (patch.bodyTemplate !== undefined) set.bodyTemplate = patch.bodyTemplate;
    if (patch.shortBodyTemplate !== undefined) set.shortBodyTemplate = patch.shortBodyTemplate;
    if (patch.actionLabelTemplate !== undefined)
      set.actionLabelTemplate = patch.actionLabelTemplate;
    if (patch.targetUrlTemplate !== undefined) set.targetUrlTemplate = patch.targetUrlTemplate;
    if (patch.status !== undefined) set.status = patch.status;

    const updated = await tx
      .update(notificationTemplates)
      .set(set)
      // predicate KÉP id + company_id: KHÔNG bao giờ chạm hàng global (company_id NULL).
      .where(and(eq(notificationTemplates.id, id), eq(notificationTemplates.companyId, companyId)))
      .returning();
    return updated[0];
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

/**
 * S4-NOTI-BE-5 — bộ lọc GET /notifications/templates (NOTI-API-303 LIST) áp SAU merge in-memory (catalog
 * nhỏ, mirror NotificationEventCatalogFilter). Tất cả optional; `eventCode` khớp qua join event.
 */
export interface NotificationTemplateCatalogFilter {
  eventId?: string;
  eventCode?: string;
  channel?: string;
  locale?: string;
}

/**
 * BE-4 — field template được PATCH (camelCase, đã map từ DTO snake_case ở service). `undefined` = KHÔNG
 * đổi (giữ giá trị clone/hiện tại); `null` (short/action/target) = xoá tường minh về NULL.
 */
export interface TemplateOverridePatch {
  titleTemplate?: string;
  bodyTemplate?: string;
  shortBodyTemplate?: string | null;
  actionLabelTemplate?: string | null;
  targetUrlTemplate?: string | null;
  status?: string;
}
