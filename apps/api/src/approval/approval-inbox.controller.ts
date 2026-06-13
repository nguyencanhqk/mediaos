import { Body, Controller, Get, Param, Post, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { ApprovalMultilevelService } from "./approval-multilevel.service";
import { ApproveLevelDto, RejectLevelDto } from "./approval-inbox.dto";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * G8-1 — Approval Inbox (multi-type) + per-level approve/reject (APR-001/002).
 *
 * approve/reject carry @UseGuards(PermissionGuard) + @RequirePermission — PermissionGuard is
 * fail-closed (403 if the actor lacks approve|reject:approval-request). The per-level reviewer gate
 * lives in the service on top of the permission check. Hyphen spelling 'approval-request' is
 * byte-identical to the seed in migration 0082 (avoid a permanent 403).
 */
@Controller("approval")
@UsePipes(ZodValidationPipe)
export class ApprovalInboxController {
  constructor(private readonly approval: ApprovalMultilevelService) {}

  /** GET /approval/inbox — pending requests awaiting the actor's decision at their current level. */
  @Get("inbox")
  inbox(@Req() req: AuthenticatedRequest) {
    return this.approval.inbox(req.user.companyId, req.user.id);
  }

  /** POST /approval/requests/:id/approve — approve at the request's current level. */
  @Post("requests/:id/approve")
  @UseGuards(PermissionGuard)
  @RequirePermission("approve", "approval-request")
  approve(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ApproveLevelDto,
  ) {
    return this.approval.approveLevel(req.user.companyId, id, req.user.id, dto.comment ?? undefined);
  }

  /** POST /approval/requests/:id/reject — reject at the current level (closes the request). */
  @Post("requests/:id/reject")
  @UseGuards(PermissionGuard)
  @RequirePermission("reject", "approval-request")
  reject(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: RejectLevelDto,
  ) {
    return this.approval.rejectLevel(
      req.user.companyId,
      id,
      req.user.id,
      dto.description,
      dto.comment ?? undefined,
    );
  }
}
