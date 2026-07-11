import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { RealtimeEmitterModule } from "../realtime/realtime-emitter.module";
// S4-NOTI-BE-1: MyNotificationsController dùng @UseGuards(PermissionGuard) — PermissionGuard cần
// PermissionService (provider của PermissionModule) trong cùng nhánh DI (mirror leave.module.ts).
import { PermissionModule } from "../permission/permission.module";
import { NotificationsRepository } from "./notifications.repository";
import { NotificationPreferencesRepository } from "./notification-preferences.repository";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { DeviceTokenService } from "./device-token.service";
// S4-NOTI-BE-1 (additive): My-Notification API — cột MỚI, controller/service/repo RIÊNG (xem
// my-notifications.controller.ts header vì sao TÁCH khỏi NotificationsController cũ).
import { MyNotificationsController } from "./my-notifications.controller";
import { MyNotificationsService } from "./my-notifications.service";
import { MyNotificationsRepository } from "./my-notifications.repository";
// S4-NOTI-BE-2 (additive): event intake + notification engine. Đường HTTP nội bộ
// (InternalNotificationsController → POST /internal/v1/notifications/events) + đường in-process
// (NotificationEngineService.intake, S4-INT-1 outbox consumer gọi sau). Reuse AuditService/EventBus
// (EventsModule) + RealtimeEmitterService (RealtimeEmitterModule) + DatabaseService (@Global) đã import.
// KHÔNG đăng ký consumer eventType TASK ở đây (INT-1 làm) — chỉ cung cấp provider engine + 3 repo catalog.
import { InternalNotificationsController } from "./internal-notifications.controller";
import { NotificationEngineService } from "./notification-engine.service";
import { NotificationEventRepository } from "./notification-event.repository";
import { NotificationTemplateRepository } from "./notification-template.repository";
import { NotificationDeliveryLogRepository } from "./notification-delivery-log.repository";
import { NotificationRecipientResolverService } from "./notification-recipient-resolver.service";
import { NotificationRendererService } from "./notification-renderer.service";
import { NotificationDedupeService } from "./notification-dedupe.service";
// S4-NOTI-BE-3 (additive): admin config READ-ONLY (GET events/templates/delivery-logs — xem
// notification-admin.controller.ts header vì sao KHÔNG có PATCH ở vòng này) + reminder job TASK_DUE_SOON/
// TASK_OVERDUE (@SystemJobHandler, gom bởi SchedulerModule qua DiscoveryService — KHÔNG cần
// SchedulerModule import module này vì NotificationsModule đã ở AppModule root, xem app.module.ts).
import { NotificationAdminController } from "./notification-admin.controller";
// S4-NOTI-BE-4 (additive): admin config WRITE service (PATCH events/templates → company-override + audit).
import { NotificationAdminService } from "./notification-admin.service";
import { TaskReminderJobHandler } from "./task-reminder.job-handler";

@Module({
  imports: [DatabaseModule, EventsModule, RealtimeEmitterModule, PermissionModule],
  controllers: [
    NotificationsController,
    // NotificationAdminController TRƯỚC MyNotificationsController: route tĩnh 1-segment "events"/
    // "delivery-logs" sẽ bị MyNotificationsController.@Get(':id') (wildcard 1-segment) nuốt nếu đăng ký
    // sau (Express khớp theo THỨ TỰ đăng ký — xem header notification-admin.controller.ts).
    NotificationAdminController,
    MyNotificationsController,
    InternalNotificationsController,
  ],
  providers: [
    NotificationsRepository,
    NotificationPreferencesRepository,
    NotificationsService,
    DeviceTokenService,
    MyNotificationsRepository,
    MyNotificationsService,
    // S4-NOTI-BE-2 (additive): engine pipeline + 3 repo đọc catalog + resolver/renderer/dedupe.
    NotificationEngineService,
    NotificationEventRepository,
    NotificationTemplateRepository,
    NotificationDeliveryLogRepository,
    NotificationRecipientResolverService,
    NotificationRendererService,
    NotificationDedupeService,
    // S4-NOTI-BE-3 (additive): reminder job handler (đọc tasks + gọi engine.intake in-process).
    TaskReminderJobHandler,
    // S4-NOTI-BE-4 (additive): admin config WRITE (company-override + audit trong 1 withTenant tx).
    NotificationAdminService,
  ],
  // Export engine cho S4-INT-1 (outbox consumer gọi intake() in-process).
  // S4-DASH-BE-2 (additive): + MyNotificationsService cho NOTIFICATIONS widget handler (DASH inject qua DI —
  // KHÔNG re-provide instance thứ 2). Chỉ thêm vào exports[], KHÔNG method mới.
  exports: [
    NotificationsService,
    DeviceTokenService,
    NotificationEngineService,
    MyNotificationsService,
  ],
})
export class NotificationsModule {}
