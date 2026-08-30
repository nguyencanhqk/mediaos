import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { RoomBookingsService } from "./room-bookings.service";
import { MyRoomBookingsQueryDto } from "./rooms.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S11-ROOM-BE-1 — GET /me/room-bookings (ROOM-API-013 · SPEC-14 §9 ROOM-SCREEN-005). Controller RIÊNG (mirror
 * `MeAssetsController`): chủ thể LUÔN là user từ token — `MyRoomBookingsQueryDto` không khai `userId` ⇒ zod strip;
 * service cũng không đọc. Cặp gate = chính `('view','room')` (permission-matrix §9e — là BỘ LỌC, không phải scope
 * riêng; bài học `read-path-gate-pair-must-match-download-pair`).
 */
@Controller()
export class MeRoomBookingsController {
  constructor(private readonly bookings: RoomBookingsService) {}

  @Get("me/room-bookings")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "room")
  @UsePipes(ZodValidationPipe)
  mine(@Req() req: AuthenticatedRequest, @Query() query: MyRoomBookingsQueryDto) {
    return this.bookings.listMine(req.user, query);
  }
}
