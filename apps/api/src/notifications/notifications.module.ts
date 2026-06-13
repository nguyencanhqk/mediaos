import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { RealtimeEmitterModule } from "../realtime/realtime-emitter.module";
import { NotificationsRepository } from "./notifications.repository";
import { NotificationPreferencesRepository } from "./notification-preferences.repository";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";

@Module({
  imports: [DatabaseModule, EventsModule, RealtimeEmitterModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsRepository,
    NotificationPreferencesRepository,
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
