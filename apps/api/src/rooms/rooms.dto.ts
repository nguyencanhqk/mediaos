import { createZodDto } from "nestjs-zod";
import {
  cancelRoomBookingSchema,
  createRoomBookingSchema,
  createRoomSchema,
  listRoomBookingsQuerySchema,
  listRoomsQuerySchema,
  myRoomBookingsQuerySchema,
  roomAvailabilityQuerySchema,
  roomBookingsWindowQuerySchema,
  roomUsageSummaryQuerySchema,
  updateRoomSchema,
} from "@mediaos/contracts";

/**
 * S11-ROOM-BE-1 — DTO biên module ROOM. Nguồn sự thật = Zod ở `@mediaos/contracts/room` (`createZodDto` ⇒ metatype
 * tồn tại lúc chạy ⇒ `ZodValidationPipe` cấp METHOD chiếu được schema — KI-068).
 */

// ── Phòng (001–008) ──
export class ListRoomsQueryDto extends createZodDto(listRoomsQuerySchema) {}
export class CreateRoomDto extends createZodDto(createRoomSchema) {}
/** `.strict()` — khoá lạ ⇒ 400 tại biên. */
export class UpdateRoomDto extends createZodDto(updateRoomSchema) {}
export class RoomAvailabilityQueryDto extends createZodDto(roomAvailabilityQuerySchema) {}
export class RoomUsageSummaryQueryDto extends createZodDto(roomUsageSummaryQuerySchema) {}
export class RoomBookingsWindowQueryDto extends createZodDto(roomBookingsWindowQuerySchema) {}

// ── Lượt đặt (009–013) ──
export class ListRoomBookingsQueryDto extends createZodDto(listRoomBookingsQuerySchema) {}
export class CreateRoomBookingDto extends createZodDto(createRoomBookingSchema) {}
export class CancelRoomBookingDto extends createZodDto(cancelRoomBookingSchema) {}
/** KHÔNG khai `userId` ⇒ zod strip; user từ token (chống IDOR). */
export class MyRoomBookingsQueryDto extends createZodDto(myRoomBookingsQuerySchema) {}
