import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { RoomBookingsService } from "./room-bookings.service";
import { CancelRoomBookingDto, CreateRoomBookingDto, ListRoomBookingsQueryDto } from "./rooms.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S11-ROOM-BE-1 — RoomBookingsController (ROOM-API-009..012). Prefix /room-bookings. MỎNG.
 *
 * `POST /room-bookings` gắn `@Idempotent()` dùng chung — `Idempotency-Key` DO FE SINH khi mở form (SPEC-14 §12,
 * API-15 §6.9): KHÔNG suy từ payload (huỷ rồi đặt lại y hệt trong 15′ sẽ bị phát lại lượt đã huỷ). Chống trùng
 * nghiệp vụ là việc của EXCLUDE, không phải idempotency. `cancel` KHÔNG cần idempotency (huỷ lặp ⇒ 409 rõ nghĩa).
 * MỌI `:id` = UUID ở biên.
 */
@Controller("room-bookings")
export class RoomBookingsController {
  constructor(private readonly bookings: RoomBookingsService) {}

  /** GET /room-bookings — lịch mọi phòng trong cửa sổ ≤ 31 ngày (009). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "room")
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListRoomBookingsQueryDto) {
    return this.bookings.list(req.user, query);
  }

  /** POST /room-bookings — đặt phòng (010). Idempotency-Key do client sinh. */
  @Post()
  @Idempotent()
  @UseGuards(PermissionGuard)
  @RequirePermission("book", "room")
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRoomBookingDto) {
    return this.bookings.create(req.user, dto);
  }

  /** GET /room-bookings/:id — chi tiết lượt (011). */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "room")
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.bookings.get(req.user, id);
  }

  /** POST /room-bookings/:id/cancel — Confirmed → Cancelled (012). */
  @Post(":id/cancel")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("cancel", "room-booking")
  @UsePipes(ZodValidationPipe)
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CancelRoomBookingDto,
  ) {
    return this.bookings.cancel(req.user, id, dto);
  }
}
