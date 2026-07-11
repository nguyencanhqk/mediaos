import { Injectable, NotFoundException } from "@nestjs/common";
import type { NotificationTemplateAdminPatch } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { NotificationEventRepository } from "./notification-event.repository";
import {
  NotificationTemplateRepository,
  type TemplateOverridePatch,
} from "./notification-template.repository";
import { assertTemplateVariablesSafe } from "./notification-engine.errors";
import type { NotificationEvent, NotificationTemplate } from "../db/schema/noti";

const EVENT_NOT_FOUND_CODE = "NOTI-ERR-EVENT-NOT-FOUND";
const TEMPLATE_NOT_FOUND_CODE = "NOTI-ERR-TEMPLATE-NOT-FOUND";

/**
 * S4-NOTI-BE-4 — business logic ADMIN config WRITE (CLAUDE.md §5: logic ở Service, KHÔNG ở Controller).
 * Cả 2 thao tác bọc TRONG MỘT `withTenant` (RLS+FORCE — BẤT BIẾN #1): find (404 nếu ngoài tầm) → ghi
 * company-override → audit.record CÙNG transaction (BẤT BIẾN #2: audit append-only, ghi trọn vẹn hay
 * rollback cùng nghiệp vụ, KHÔNG audit mồ côi).
 *
 * KHÔNG BAO GIỜ UPDATE hàng global (company_id NULL): repo rẽ nhánh INSERT company-override; 0479 WITH
 * CHECK company_id=GUC là backstop cứng nếu code lỡ sai.
 */
@Injectable()
export class NotificationAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly eventRepo: NotificationEventRepository,
    private readonly templateRepo: NotificationTemplateRepository,
    private readonly audit: AuditService,
  ) {}

  /** PATCH /notifications/events/{id} — bật/tắt event (company-override). */
  async toggleEvent(
    companyId: string,
    actorUserId: string,
    eventId: string,
    isEnabled: boolean,
  ): Promise<NotificationEvent> {
    return this.db.withTenant(companyId, async (tx) => {
      const source = await this.eventRepo.findByIdForCompany(tx, companyId, eventId);
      if (!source) {
        throw new NotFoundException({
          code: EVENT_NOT_FOUND_CODE,
          message: "Notification event không tồn tại hoặc ngoài phạm vi công ty.",
        });
      }
      const before = this.eventConfigSnapshot(source);
      const override = await this.eventRepo.upsertCompanyOverride(
        tx,
        companyId,
        source,
        isEnabled,
        actorUserId,
      );
      await this.audit.record(tx, {
        action: "notification_config_updated",
        objectType: "notification",
        objectId: override.id,
        actorUserId,
        moduleCode: "NOTI",
        before,
        after: this.eventConfigSnapshot(override),
        resultStatus: "Success",
        sensitivityLevel: "Sensitive",
        dataScope: "Company",
      });
      return override;
    });
  }

  /** PATCH /notifications/templates/{id} — sửa nội dung (company-override). */
  async patchTemplate(
    companyId: string,
    actorUserId: string,
    templateId: string,
    patch: NotificationTemplateAdminPatch,
  ): Promise<NotificationTemplate> {
    // Quét biến cấm TRƯỚC khi chạm DB (422, loud) — chỉ trên field text được PATCH (KHÔNG chạm hàng global).
    assertTemplateVariablesSafe([
      patch.title_template,
      patch.body_template,
      patch.short_body_template,
      patch.action_label_template,
      patch.target_url_template,
    ]);

    const repoPatch: TemplateOverridePatch = {
      titleTemplate: patch.title_template,
      bodyTemplate: patch.body_template,
      shortBodyTemplate: patch.short_body_template,
      actionLabelTemplate: patch.action_label_template,
      targetUrlTemplate: patch.target_url_template,
      status: patch.status,
    };

    return this.db.withTenant(companyId, async (tx) => {
      const source = await this.templateRepo.findByIdForCompany(tx, companyId, templateId);
      if (!source) {
        throw new NotFoundException({
          code: TEMPLATE_NOT_FOUND_CODE,
          message: "Notification template không tồn tại hoặc ngoài phạm vi công ty.",
        });
      }
      const before = this.templateContentSnapshot(source);
      const override = await this.templateRepo.upsertCompanyOverride(
        tx,
        companyId,
        source,
        repoPatch,
        actorUserId,
      );
      await this.audit.record(tx, {
        action: "notification_template_updated",
        objectType: "notification",
        objectId: override.id,
        actorUserId,
        moduleCode: "NOTI",
        before,
        after: this.templateContentSnapshot(override),
        resultStatus: "Success",
        sensitivityLevel: "Sensitive",
        dataScope: "Company",
      });
      return override;
    });
  }

  /** Snapshot config event cho audit before/after (KHÔNG dump toàn row — chỉ field đổi được). */
  private eventConfigSnapshot(row: NotificationEvent): Record<string, unknown> {
    return {
      id: row.id,
      company_id: row.companyId,
      event_code: row.eventCode,
      is_enabled: row.isEnabled,
    };
  }

  /** Snapshot nội dung template cho audit before/after (masker sẽ che field nhạy cảm nếu có). */
  private templateContentSnapshot(row: NotificationTemplate): Record<string, unknown> {
    return {
      id: row.id,
      company_id: row.companyId,
      template_code: row.templateCode,
      title_template: row.titleTemplate,
      body_template: row.bodyTemplate,
      short_body_template: row.shortBodyTemplate,
      action_label_template: row.actionLabelTemplate,
      target_url_template: row.targetUrlTemplate,
      status: row.status,
    };
  }
}
