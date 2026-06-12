import {
  Body,
  Controller,
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
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AttendanceService } from "./attendance.service";
import {
  AdjustmentListQueryDto,
  AttendanceListQueryDto,
  CheckInDto,
  CheckOutDto,
  CreateAdjustmentDto,
  CreateWorkScheduleDto,
  LockPeriodDto,
  ReviewNoteDto,
  UpdateWorkScheduleDto,
} from "./attendance.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * G11-1 — Attendance HTTP surface. Every route gated by PermissionGuard (@RequirePermission,
 * fail-closed). Resource type = 'attendance'. Self-service (check-in/out, own list, own request,
 * cancel-own) vs. management (read others, approve, lock-period) split by action in the catalog (0063).
 */
@Controller("attendance")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  // ─── Check-in / out + today ────────────────────────────────────────────────

  @Get("today")
  @RequirePermission("read", "attendance")
  getToday(@Req() req: AuthenticatedRequest) {
    return this.attendance.getToday(req.user);
  }

  @Post("check-in")
  @RequirePermission("check-in", "attendance")
  checkIn(@Req() req: AuthenticatedRequest, @Body() dto: CheckInDto) {
    return this.attendance.checkIn(req.user, dto);
  }

  @Post("check-out")
  @RequirePermission("check-in", "attendance")
  checkOut(@Req() req: AuthenticatedRequest, @Body() dto: CheckOutDto) {
    return this.attendance.checkOut(req.user, dto);
  }

  // ─── Monthly list ──────────────────────────────────────────────────────────

  @Get()
  @RequirePermission("read", "attendance")
  listMonthly(@Req() req: AuthenticatedRequest, @Query() query: AttendanceListQueryDto) {
    return this.attendance.listMonthly(req.user, query);
  }

  // ─── Work schedules ────────────────────────────────────────────────────────

  @Get("schedules")
  @RequirePermission("read", "attendance")
  listSchedules(@Req() req: AuthenticatedRequest) {
    return this.attendance.listSchedules(req.user.companyId);
  }

  @Post("schedules")
  @RequirePermission("manage", "attendance")
  createSchedule(@Req() req: AuthenticatedRequest, @Body() dto: CreateWorkScheduleDto) {
    return this.attendance.createSchedule(req.user, dto);
  }

  @Patch("schedules/:id")
  @RequirePermission("manage", "attendance")
  updateSchedule(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateWorkScheduleDto,
  ) {
    return this.attendance.updateSchedule(req.user, id, dto);
  }

  // ─── Adjustment requests (→ Task Hub) ──────────────────────────────────────

  @Get("adjustments")
  @RequirePermission("read", "attendance")
  listAdjustments(@Req() req: AuthenticatedRequest, @Query() query: AdjustmentListQueryDto) {
    return this.attendance.listAdjustments(req.user, query);
  }

  @Post("adjustments")
  @RequirePermission("adjust", "attendance")
  createAdjustment(@Req() req: AuthenticatedRequest, @Body() dto: CreateAdjustmentDto) {
    return this.attendance.createAdjustment(req.user, dto);
  }

  @Post("adjustments/:id/approve")
  @RequirePermission("approve", "attendance")
  approveAdjustment(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ReviewNoteDto,
  ) {
    return this.attendance.approveAdjustment(req.user, id, dto.note);
  }

  @Post("adjustments/:id/reject")
  @RequirePermission("approve", "attendance")
  rejectAdjustment(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ReviewNoteDto,
  ) {
    return this.attendance.rejectAdjustment(req.user, id, dto.note);
  }

  @Post("adjustments/:id/cancel")
  @HttpCode(200)
  @RequirePermission("adjust", "attendance")
  cancelAdjustment(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.attendance.cancelAdjustment(req.user, id);
  }

  // ─── Period lock ───────────────────────────────────────────────────────────

  @Get("periods")
  @RequirePermission("read", "attendance")
  listPeriods(@Req() req: AuthenticatedRequest) {
    return this.attendance.listPeriods(req.user.companyId);
  }

  @Post("periods/lock")
  @RequirePermission("lock-period", "attendance")
  lockPeriod(@Req() req: AuthenticatedRequest, @Body() dto: LockPeriodDto) {
    return this.attendance.lockPeriod(req.user, dto.periodMonth);
  }
}
