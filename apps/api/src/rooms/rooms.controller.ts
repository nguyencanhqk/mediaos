import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import {
  CreateRoomDto,
  ListRoomsQueryDto,
  RoomAvailabilityQueryDto,
  RoomBookingsWindowQueryDto,
  RoomUsageSummaryQueryDto,
  UpdateRoomDto,
} from "./rooms.dto";
import { RoomsService } from "./rooms.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S11-ROOM-BE-1 — RoomsController (ROOM-API-001..008). Prefix /rooms. MỎNG — chỉ định tuyến.
 *
 * ⚠️ THỨ TỰ ROUTE: `GET /rooms/availability` (003) và `GET /rooms/usage-summary` (004) PHẢI khai TRƯỚC
 * `GET /rooms/:id` (005) — nếu không Nest nuốt thành `:id` ⇒ 400 sai chỗ (bài học `goals/tree`).
 *
 * Mỗi route @UseGuards(PermissionGuard) + @RequirePermission ĐÚNG cặp seed 0554; pipe Zod CẤP METHOD (KI-068);
 * MỌI `:id` = UUID ở biên (`ParseUUIDPipe`) — ratchet param-uuid không tăng.
 */
@Controller("rooms")
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  /** GET /rooms — danh sách phân trang (001). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "room")
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListRoomsQueryDto) {
    return this.rooms.list(req.user, query);
  }

  /** GET /rooms/availability — phòng trống trong khung giờ (003). KHAI TRƯỚC ':id'. */
  @Get("availability")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "room")
  @UsePipes(ZodValidationPipe)
  availability(@Req() req: AuthenticatedRequest, @Query() query: RoomAvailabilityQueryDto) {
    return this.rooms.availability(req.user, query);
  }

  /** GET /rooms/usage-summary — thống kê sử dụng (004). KHAI TRƯỚC ':id'. */
  @Get("usage-summary")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "room")
  @UsePipes(ZodValidationPipe)
  usageSummary(@Req() req: AuthenticatedRequest, @Query() query: RoomUsageSummaryQueryDto) {
    return this.rooms.usageSummary(req.user, query);
  }

  /** POST /rooms — tạo phòng (002). */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "room")
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRoomDto) {
    return this.rooms.create(req.user, dto);
  }

  /** GET /rooms/:id — chi tiết + upcomingCount (005). */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "room")
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.rooms.get(req.user, id);
  }

  /** PATCH /rooms/:id — sửa/kích hoạt/vô hiệu; body `.strict()` (006). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "room")
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.rooms.update(req.user, id, dto);
  }

  /** DELETE /rooms/:id — xoá MỀM (007). */
  @Delete(":id")
  @HttpCode(204)
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "room")
  async remove(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    await this.rooms.remove(req.user, id);
  }

  /** GET /rooms/:id/bookings — lịch + lịch sử một phòng (008). */
  @Get(":id/bookings")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "room")
  @UsePipes(ZodValidationPipe)
  bookings(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: RoomBookingsWindowQueryDto,
  ) {
    return this.rooms.bookingsOfRoom(req.user, id, query);
  }
}
