import { Module } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module";
import { MeRoomBookingsController } from "./me-room-bookings.controller";
import { RoomAccessService } from "./room-access.service";
import { RoomBookingsController } from "./room-bookings.controller";
import { RoomBookingsRepository } from "./room-bookings.repository";
import { RoomBookingsService } from "./room-bookings.service";
import { RoomPeopleRepository } from "./room-people.repository";
import { RoomsController } from "./rooms.controller";
import { RoomsRepository } from "./rooms.repository";
import { RoomsService } from "./rooms.service";

/**
 * S11-ROOM-BE-1 — RoomsModule (SPEC-14 · DB-16 · API-15).
 *
 * imports: PermissionModule — PermissionGuard + DataScopeService (scope `view`/`book`/`cancel`/`manage` §13.6).
 * AuditService + OutboxService đến từ EventsModule (@Global) — ghi TRONG cùng tx nghiệp vụ.
 *
 * NOTI: registrar (`room.booking.confirmed`/`room.booking.cancelled` → ROOM_BOOKING_CONFIRMED/CANCELLED) + job
 * `ROOM_BOOKING_REMINDER` sống ở `notifications/**` (tiền lệ GOAL/TASK/ASSET) — module này KHÔNG import
 * NotificationsModule và ngược lại.
 */
@Module({
  imports: [PermissionModule],
  controllers: [RoomsController, RoomBookingsController, MeRoomBookingsController],
  providers: [
    RoomAccessService,
    RoomPeopleRepository,
    RoomsRepository,
    RoomBookingsRepository,
    RoomsService,
    RoomBookingsService,
  ],
  exports: [RoomsService, RoomBookingsService],
})
export class RoomsModule {}
