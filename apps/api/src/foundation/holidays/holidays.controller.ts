import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import {
  CheckWorkingDayQueryDto,
  CreateHolidayDto,
  HolidayListQueryDto,
  UpdateHolidayDto,
} from "./holidays.dto";
import { HolidaysService } from "./holidays.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * FOUNDATION-BE-6 — HTTP surface cho public_holidays. Mọi route gated PermissionGuard (@RequirePermission,
 * fail-closed). Resource = 'foundation-holiday' (seed mig 0435): view (đọc/tra ngày làm việc) · manage (CRUD).
 * Đọc trả CẢ holiday công ty + global (override company>global); ghi chỉ holiday riêng công ty.
 */
@Controller("foundation/public-holidays")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get()
  @RequirePermission("view", "foundation-holiday")
  list(@Req() req: AuthenticatedRequest, @Query() query: HolidayListQueryDto) {
    return this.holidays.listHolidays(req.user.companyId, query);
  }

  @Get("check-working-day")
  @RequirePermission("view", "foundation-holiday")
  checkWorkingDay(@Req() req: AuthenticatedRequest, @Query() query: CheckWorkingDayQueryDto) {
    return this.holidays.checkWorkingDay(req.user.companyId, query);
  }

  @Post()
  @RequirePermission("manage", "foundation-holiday")
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateHolidayDto) {
    return this.holidays.createHoliday(req.user, dto);
  }

  @Patch(":id")
  @RequirePermission("manage", "foundation-holiday")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateHolidayDto,
  ) {
    return this.holidays.updateHoliday(req.user, id, dto);
  }

  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("manage", "foundation-holiday")
  remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.holidays.deleteHoliday(req.user, id);
  }
}
