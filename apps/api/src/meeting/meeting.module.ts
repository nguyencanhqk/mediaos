import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { MeetingRepository } from "./meeting.repository";
import { MeetingService } from "./meeting.service";
import { MeetingController } from "./meeting.controller";

@Module({
  imports: [DatabaseModule, EventsModule],
  controllers: [MeetingController],
  providers: [MeetingRepository, MeetingService],
  exports: [MeetingService],
})
export class MeetingModule {}
