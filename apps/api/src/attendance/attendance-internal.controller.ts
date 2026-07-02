import { Body, Controller, HttpCode, Post, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe, createZodDto } from "nestjs-zod";
import type { Request } from "express";
import { recalculateAttendanceRequestSchema } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { InternalGuard } from "../permission/guards/internal.guard";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AttendanceLeaveSyncService } from "./attendance-leave-sync.service";

export class RecalculateAttendanceDto extends createZodDto(recalculateAttendanceRequestSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S3-INT-1 — POST /internal/v1/attendance/recalculate: manual/retry trigger for LEAVE→ATT sync
 * (S3-SYNC-*). Gated by BOTH the standard JwtAuthGuard→CompanyGuard→PermissionGuard chain
 * (manage:attendance — done_when literal) AND InternalGuard (x-internal-key) — either missing → 403.
 * Idempotent: re-processes ONLY day-rows still 'Pending'/'Failed' via AttendanceLeaveSyncService
 * (which itself only touches 'Pending' rows — a retry after partial success is a safe no-op for the
 * already-Synced days).
 */
@Controller("internal/v1/attendance")
@UseGuards(PermissionGuard, InternalGuard)
@UsePipes(ZodValidationPipe)
export class AttendanceInternalController {
  constructor(
    private readonly db: DatabaseService,
    private readonly sync: AttendanceLeaveSyncService,
  ) {}

  @Post("recalculate")
  @HttpCode(200)
  @RequirePermission("manage", "attendance")
  async recalculate(@Req() req: AuthenticatedRequest, @Body() dto: RecalculateAttendanceDto) {
    const processedDays = await this.db.withTenant(req.user.companyId, (tx) =>
      this.sync.syncApprovedRequestTx(tx, req.user.companyId, dto.leaveRequestId, req.user.id),
    );
    return { leaveRequestId: dto.leaveRequestId, processedDays };
  }
}
