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
import { LeaveService } from "./leave.service";
import {
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  LeaveCalendarQueryDto,
  LeaveListQueryDto,
  ReviewNoteDto,
  UpdateLeaveTypeDto,
  UpsertLeaveBalanceDto,
} from "./leave.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * G11-2 — Leave HTTP surface. Every route gated by PermissionGuard (@RequirePermission, fail-closed).
 * Resource type = 'leave'. Self-service (read own balance, create/cancel own request) vs. management
 * (manage types/balances, approve/reject, list-all, team calendar) split by action in the catalog (0063).
 */
@Controller("leave")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  // ─── Leave types ─────────────────────────────────────────────────────────────

  @Get("types")
  @RequirePermission("read", "leave")
  listTypes(@Req() req: AuthenticatedRequest) {
    return this.leave.listTypes(req.user.companyId);
  }

  @Post("types")
  @RequirePermission("manage", "leave")
  createType(@Req() req: AuthenticatedRequest, @Body() dto: CreateLeaveTypeDto) {
    return this.leave.createType(req.user, dto);
  }

  @Patch("types/:id")
  @RequirePermission("manage", "leave")
  updateType(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateLeaveTypeDto,
  ) {
    return this.leave.updateType(req.user, id, dto);
  }

  // ─── Leave balances ──────────────────────────────────────────────────────────

  @Get("balances")
  @RequirePermission("read", "leave")
  listBalances(@Req() req: AuthenticatedRequest, @Query() query: LeaveListQueryDto) {
    return this.leave.listBalances(req.user, {
      userId: query.scope === "all" ? undefined : req.user.id,
      year: query.year,
    });
  }

  @Post("balances")
  @RequirePermission("manage", "leave")
  upsertBalance(@Req() req: AuthenticatedRequest, @Body() dto: UpsertLeaveBalanceDto) {
    return this.leave.upsertBalance(req.user, dto);
  }

  // ─── Leave requests (→ Task Hub) ─────────────────────────────────────────────

  @Get("requests")
  @RequirePermission("read", "leave")
  listRequests(@Req() req: AuthenticatedRequest, @Query() query: LeaveListQueryDto) {
    return this.leave.listRequests(req.user, query);
  }

  @Post("requests")
  @RequirePermission("create", "leave")
  createRequest(@Req() req: AuthenticatedRequest, @Body() dto: CreateLeaveRequestDto) {
    return this.leave.createRequest(req.user, dto);
  }

  @Post("requests/:id/approve")
  @RequirePermission("approve", "leave")
  approveRequest(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ReviewNoteDto,
  ) {
    return this.leave.approveRequest(req.user, id, dto.note);
  }

  @Post("requests/:id/reject")
  @RequirePermission("approve", "leave")
  rejectRequest(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ReviewNoteDto,
  ) {
    return this.leave.rejectRequest(req.user, id, dto.note);
  }

  @Post("requests/:id/cancel")
  @HttpCode(200)
  @RequirePermission("create", "leave")
  cancelRequest(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.leave.cancelRequest(req.user, id);
  }

  // ─── Team calendar ───────────────────────────────────────────────────────────

  @Get("calendar")
  @RequirePermission("read", "leave")
  listCalendar(@Req() req: AuthenticatedRequest, @Query() query: LeaveCalendarQueryDto) {
    return this.leave.listCalendar(req.user.companyId, query.month);
  }
}
