import { Body, Controller, Get, Param, Post, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { DefectService } from "./defect.service";
import { CreateDefectDto } from "./defect.dto";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

@Controller("defects")
@UsePipes(ZodValidationPipe)
export class DefectController {
  constructor(private readonly defects: DefectService) {}

  /**
   * POST /defects
   * Create a defect record for a step returned for revision.
   * Requires create:defect permission.
   */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "defect")
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateDefectDto) {
    return this.defects.createDefect(req.user.companyId, req.user.id, dto);
  }

  /**
   * GET /defects/steps/:stepId
   * List all defects for a workflow step.
   * Requires view:defect permission.
   */
  @Get("steps/:stepId")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "defect")
  listByStep(@Req() req: AuthenticatedRequest, @Param("stepId") stepId: string) {
    return this.defects.listByStep(req.user.companyId, stepId);
  }
}
