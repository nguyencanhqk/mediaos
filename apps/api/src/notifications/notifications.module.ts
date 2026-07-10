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

@Module({
  imports: [DatabaseModule, EventsModule, RealtimeEmitterModule, PermissionModule],
  controllers: [NotificationsController, MyNotificationsController],
  providers: [
    NotificationsRepository,
    NotificationPreferencesRepository,
    NotificationsService,
    DeviceTokenService,
    MyNotificationsRepository,
    MyNotificationsService,
  ],
  exports: [NotificationsService, DeviceTokenService],
})
export class NotificationsModule {}
