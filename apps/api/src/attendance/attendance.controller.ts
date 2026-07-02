import {
  Body,
  Controller,
  Get,
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
import {
  ATT_PERMISSIONS,
  ATT_RESOURCES,
  type AttPermissionPair,
  type AttResourceType,
} from "./attendance-permissions.const";
import { AttendanceReadService } from "./attendance-read.service";
import { AttendanceService } from "./attendance.service";
import {
  AttendanceListQueryDto,
  AttendanceRecordListQueryDto,
  CheckInDto,
  CheckOutDto,
  CreateWorkScheduleDto,
  LockPeriodDto,
  PeriodListQueryDto,
  UpdateWorkScheduleDto,
} from "./attendance.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string; email: string };
}

/**
 * S3-ATT-BE-1: gắn @RequirePermission từ CẶP catalog THẬT (attendance-permissions.const = nguồn sự thật,
 * đồng bộ mig 0454) — KHÔNG hard-code chuỗi rời (tránh drift action/resource đã gặp ở S1-FND-MODULE).
 * Fail-fast lúc load nếu cặp thiếu khỏi catalog.
 */
function attPair(action: string, resourceType: AttResourceType): AttPermissionPair {
  const pair = ATT_PERMISSIONS.find((p) => p.action === action && p.resourceType === resourceType);
  if (!pair) {
    throw new Error(`ATT permission pair missing from catalog: ${action}:${resourceType}`);
  }
  return pair;
}

const CHECK_IN = attPair("check-in", ATT_RESOURCES.ATTENDANCE);
const CHECK_OUT = attPair("check-out", ATT_RESOURCES.ATTENDANCE);
const VIEW_OWN = attPair("view-own", ATT_RESOURCES.ATTENDANCE);
// S3-ATT-BE-2: scoped records read pairs (mig 0454). view-team/company/detail all is_sensitive=true.
const VIEW_TEAM = attPair("view-team", ATT_RESOURCES.ATTENDANCE);
const VIEW_COMPANY = attPair("view-company", ATT_RESOURCES.ATTENDANCE);
const VIEW_DETAIL = attPair("view-detail", ATT_RESOURCES.ATTENDANCE);

/**
 * G11-1 — Attendance HTTP surface. Every route gated by PermissionGuard (@RequirePermission,
 * fail-closed). Resource type = 'attendance'. Self-service (check-in/out, own list, own request,
 * cancel-own) vs. management (read others, approve, lock-period) split by action in the catalog (0063).
 */
@Controller("attendance")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly attendanceRead: AttendanceReadService,
  ) {}

  // ─── Check-in / out + today ────────────────────────────────────────────────

  @Get("today")
  @RequirePermission(VIEW_OWN.action, VIEW_OWN.resourceType, { isSensitive: VIEW_OWN.sensitive })
  getToday(@Req() req: AuthenticatedRequest) {
    return this.attendance.getToday(req.user);
  }

  @Post("check-in")
  @RequirePermission(CHECK_IN.action, CHECK_IN.resourceType, { isSensitive: CHECK_IN.sensitive })
  checkIn(@Req() req: AuthenticatedRequest, @Body() dto: CheckInDto) {
    return this.attendance.checkIn(req.user, dto);
  }

  @Post("check-out")
  @RequirePermission(CHECK_OUT.action, CHECK_OUT.resourceType, {
    isSensitive: CHECK_OUT.sensitive,
  })
  checkOut(@Req() req: AuthenticatedRequest, @Body() dto: CheckOutDto) {
    return this.attendance.checkOut(req.user, dto);
  }

  // ─── Monthly list ──────────────────────────────────────────────────────────

  @Get()
  @RequirePermission("read", "attendance")
  listMonthly(@Req() req: AuthenticatedRequest, @Query() query: AttendanceListQueryDto) {
    return this.attendance.listMonthly(req.user, query);
  }

  // ─── S3-ATT-BE-2: scoped records read (my/team/company/detail/logs) ──────────
  // Static paths declared BEFORE the /records/:id param route so Express never shadows them.
  // Pairs bound via attPair() (fail-fast on catalog drift). 403 = no grant (PermissionGuard);
  // out-of-scope-but-exists = 404 (no existence leak). location/gps/ip/device masked server-side.

  @Get("my-records")
  @RequirePermission(VIEW_OWN.action, VIEW_OWN.resourceType, { isSensitive: VIEW_OWN.sensitive })
  listMyRecords(@Req() req: AuthenticatedRequest, @Query() query: AttendanceRecordListQueryDto) {
    return this.attendanceRead.listMyRecords(req.user, query);
  }

  @Get("team-records")
  @RequirePermission(VIEW_TEAM.action, VIEW_TEAM.resourceType, { isSensitive: VIEW_TEAM.sensitive })
  listTeamRecords(@Req() req: AuthenticatedRequest, @Query() query: AttendanceRecordListQueryDto) {
    return this.attendanceRead.listTeamRecords(req.user, query);
  }

  @Get("records")
  @RequirePermission(VIEW_COMPANY.action, VIEW_COMPANY.resourceType, {
    isSensitive: VIEW_COMPANY.sensitive,
  })
  listCompanyRecords(
    @Req() req: AuthenticatedRequest,
    @Query() query: AttendanceRecordListQueryDto,
  ) {
    return this.attendanceRead.listCompanyRecords(req.user, query);
  }

  @Get("records/:id/logs")
  @RequirePermission(VIEW_DETAIL.action, VIEW_DETAIL.resourceType, {
    isSensitive: VIEW_DETAIL.sensitive,
  })
  getRecordLogs(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.attendanceRead.getRecordLogs(req.user, id);
  }

  @Get("records/:id")
  @RequirePermission(VIEW_DETAIL.action, VIEW_DETAIL.resourceType, {
    isSensitive: VIEW_DETAIL.sensitive,
  })
  getRecordDetail(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.attendanceRead.getRecordDetail(req.user, id);
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

  // ─── Adjustment requests ─────────────────────────────────────────────────────
  // S3-ATT-BE-4: the adjustment write surface (create/list/detail/approve/reject/direct) was CONVERGED
  // to AttendanceAdjustmentController (/attendance/adjustment-requests, canonical TitleCase FSM + engine
  // pairs create-own/view-*/approve/reject:adjustment). The old lowercase /attendance/adjustments routes
  // (generic read/adjust/approve pairs) were REMOVED — there is no second, divergent writer.

  // ─── Period lock ───────────────────────────────────────────────────────────

  @Get("periods")
  @RequirePermission("read", "attendance")
  listPeriods(@Req() req: AuthenticatedRequest, @Query() query: PeriodListQueryDto) {
    return this.attendance.listPeriods(req.user.companyId, {
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Post("periods/lock")
  @RequirePermission("lock-period", "attendance")
  lockPeriod(@Req() req: AuthenticatedRequest, @Body() dto: LockPeriodDto) {
    return this.attendance.lockPeriod(req.user, dto.periodMonth);
  }
}
