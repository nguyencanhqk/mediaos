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
// S4-INT-1 (additive): outbox→NOTI in-process bridge (TASK/PROJECT producer §19) — generic core
// (OutboxNotificationBridge, module-agnostic) + reader raw-SQL (TaskAudienceReader) + registrar OnModuleInit
// (TaskNotiBridgeRegistrar, đăng ký 8 mapping TASK/PROJECT). KHÔNG import TasksModule (acyclic — mirror
// TaskReminderJobHandler đọc thẳng bảng `tasks`).
import { OutboxNotificationBridge } from "./outbox-notification-bridge.service";
import { TaskAudienceReader } from "./task-audience.reader";
import { TaskNotiBridgeRegistrar } from "./task-noti-bridge.registrar";
// S5-GOAL-BE-2 (additive) — 2 mapping GOAL → NOTI (SPEC-10 §17) trên CÙNG bridge đã ship. Reader raw-SQL
// đọc thẳng goals/employee_profiles/org_units — KHÔNG import GoalsModule (acyclic, mirror TASK).
import { GoalAudienceReader } from "./goal-audience.reader";
import { GoalNotiBridgeRegistrar } from "./goal-noti-bridge.registrar";
// S4-INT-5 (additive): AUTH/HR → NOTI producer wiring. TÁI DÙNG OutboxNotificationBridge (INT-1) — đăng ký 3
// mapping (auth.user_created/password_reset_requested/user_locked) qua registrar OnModuleInit. KHÔNG import
// AuthModule/EmployeesModule (acyclic — consumer đọc payload, producer enqueue outbox ở service tương ứng).
import { AuthHrNotiBridgeRegistrar } from "./auth-hr-noti-bridge.registrar";
// S4-INT-4 (additive): outbox→NOTI 7 mapping ATT (đơn điều chỉnh công + đơn remote-work) qua CÙNG
// OutboxNotificationBridge INT-1 (TÁI DÙNG core generic — KHÔNG bridge/consumer mới) — reader raw-SQL
// (AttApprovalAudienceReader) + registrar OnModuleInit (AttNotiBridgeRegistrar, đăng ký 7 mapping ATT).
// KHÔNG import AttendanceModule (acyclic — đọc thẳng bảng, mirror INT-1).
import { AttApprovalAudienceReader } from "./att-approval-audience.reader";
import { AttNotiBridgeRegistrar } from "./att-noti-bridge.registrar";
// S4-INT-3 (additive): outbox→NOTI 5 mapping LEAVE (đơn nghỉ phép — submit/approve/reject/cancel/revoke)
// qua CÙNG OutboxNotificationBridge INT-1 (TÁI DÙNG core generic — KHÔNG bridge/consumer mới) — reader
// raw-SQL (LeaveApproverReader) + registrar OnModuleInit (LeaveNotiBridgeRegistrar, đăng ký 5 mapping).
// KHÔNG import LeaveModule (acyclic — đọc thẳng bảng employee_profiles, mirror INT-4).
import { LeaveApproverReader } from "./leave-approver.reader";
import { LeaveNotiBridgeRegistrar } from "./leave-noti-bridge.registrar";
// (additive): outbox→NOTI 3 mapping HR "yêu cầu cập nhật hồ sơ" (submit/approve/reject, SPEC-08 §15) qua
// CÙNG OutboxNotificationBridge INT-1. Catalog + template IN_APP đã seed từ trước nhưng THIẾU producer và
// THIẾU mapping ⇒ trước đó duyệt xong không ai nhận được thông báo. KHÔNG import EmployeesModule (acyclic).
import { PcrApproverAudienceReader } from "./pcr-approver-audience.reader";
import { HrPcrNotiBridgeRegistrar } from "./hr-pcr-noti-bridge.registrar";

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
    // S4-INT-1 (additive): outbox→NOTI bridge — registrar OnModuleInit đăng ký 8 consumer lên EventBus
    // (@Global EventsModule) tại boot.
    OutboxNotificationBridge,
    TaskAudienceReader,
    TaskNotiBridgeRegistrar,
    // S5-GOAL-BE-2 (additive) — GOAL_ASSIGNED / GOAL_FINALIZED (catalog + template seed 0507).
    GoalAudienceReader,
    GoalNotiBridgeRegistrar,
    // S4-INT-5 (additive): registrar OnModuleInit đăng ký 3 consumer AUTH lên EventBus (@Global EventsModule)
    // tại boot, tái dùng OutboxNotificationBridge — KHÔNG bridge/consumer mới.
    AuthHrNotiBridgeRegistrar,
    // S4-INT-4 (additive): reader + registrar ATT đăng ký 7 consumer lên EventBus (@Global EventsModule)
    // tại boot qua CÙNG OutboxNotificationBridge INT-1 ở trên (KHÔNG re-provide bridge).
    AttApprovalAudienceReader,
    AttNotiBridgeRegistrar,
    // S4-INT-3 (additive): reader + registrar LEAVE đăng ký 5 consumer lên EventBus (@Global EventsModule)
    // tại boot qua CÙNG OutboxNotificationBridge INT-1 ở trên (KHÔNG re-provide bridge).
    LeaveApproverReader,
    LeaveNotiBridgeRegistrar,
    // (additive): reader + registrar HR profile-change đăng ký 3 consumer lên EventBus (@Global
    // EventsModule) tại boot qua CÙNG OutboxNotificationBridge INT-1 ở trên (KHÔNG re-provide bridge).
    PcrApproverAudienceReader,
    HrPcrNotiBridgeRegistrar,
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
