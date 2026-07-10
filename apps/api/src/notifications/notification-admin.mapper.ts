import type {
  NotificationDeliveryLogAdminItem,
  NotificationEventAdminItem,
  NotificationTemplateAdminItem,
} from "@mediaos/contracts";
import type {
  NotificationEvent,
  NotificationTemplate,
  NotificationDeliveryLog,
} from "../db/schema/noti";

/**
 * S4-NOTI-BE-3 — pure mapping DB row → response snake_case (API-07 §14.1/§14.3/§15.1). KHÔNG I/O, dễ
 * unit-test, giữ notification-admin.controller.ts gọn (mirror my-notifications.mapper.ts).
 */
export function toEventAdminItem(row: NotificationEvent): NotificationEventAdminItem {
  return {
    id: row.id,
    company_id: row.companyId,
    is_company_override: row.companyId !== null,
    module_code: row.moduleCode,
    event_code: row.eventCode,
    event_name: row.eventName,
    description: row.description,
    notification_type: row.notificationType,
    default_priority: row.defaultPriority,
    default_channels: row.defaultChannels,
    dedupe_strategy: row.dedupeStrategy,
    dedupe_window_seconds: row.dedupeWindowSeconds,
    is_enabled: row.isEnabled,
    is_system_event: row.isSystemEvent,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toTemplateAdminItem(row: NotificationTemplate): NotificationTemplateAdminItem {
  return {
    id: row.id,
    company_id: row.companyId,
    is_company_override: row.companyId !== null,
    event_id: row.eventId,
    template_code: row.templateCode,
    channel: row.channel,
    locale: row.locale,
    title_template: row.titleTemplate,
    body_template: row.bodyTemplate,
    short_body_template: row.shortBodyTemplate,
    action_label_template: row.actionLabelTemplate,
    target_url_template: row.targetUrlTemplate,
    variables_schema: row.variablesSchema,
    status: row.status,
    is_default: row.isDefault,
    version: row.version,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toDeliveryLogAdminItem(
  row: NotificationDeliveryLog,
): NotificationDeliveryLogAdminItem {
  return {
    id: row.id,
    notification_id: row.notificationId,
    recipient_user_id: row.recipientUserId,
    channel: row.channel,
    provider: row.provider,
    delivery_status: row.deliveryStatus,
    attempt_no: row.attemptNo,
    max_attempts: row.maxAttempts,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    sent_at: row.sentAt ? row.sentAt.toISOString() : null,
    failed_at: row.failedAt ? row.failedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  };
}
