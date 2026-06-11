import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { WorkflowTemplatesService } from "./workflow-templates.service";
import {
  CreateDependencyDto,
  CreateTemplateDto,
  CreateTemplateStepDto,
  UpdateTemplateDto,
  UpdateTemplateStepDto,
} from "./workflow-templates.dto";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * WorkflowTemplatesController (G7-1c) — base path TÁCH khỏi /workflow để tránh @Get(":instanceId")
 * của WorkflowController nuốt route. Mutation gate quyền `workflow-template` (hyphen — đồng bộ
 * convention `workflow-instance`); catalog seed ở 0036 → tới đó endpoint fail-closed 403 (an toàn).
 * GET list/detail dựa RLS (đúng tiền lệ WorkflowController GET — không gắn PermissionGuard).
 */
@Controller("workflow-templates")
@UsePipes(ZodValidationPipe)
export class WorkflowTemplatesController {
  constructor(private readonly templates: WorkflowTemplatesService) {}

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission("create", "workflow-template")
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTemplateDto) {
    return this.templates.createTemplate(req.user.companyId, req.user.id, dto);
  }

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.templates.listTemplates(req.user.companyId);
  }

  @Get(":id")
  detail(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.templates.getTemplateDetail(req.user.companyId, id);
  }

  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "workflow-template")
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.updateTemplate(req.user.companyId, req.user.id, id, dto);
  }

  // Soft-delete map vào quyền `update:workflow-template` (§3 0036 không seed `delete:` riêng).
  @Delete(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "workflow-template")
  remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.templates.deleteTemplate(req.user.companyId, req.user.id, id);
  }

  // ─── Template steps (1c-ii) — tất cả gate update:workflow-template ────────────

  @Post(":id/steps")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "workflow-template")
  addStep(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: CreateTemplateStepDto,
  ) {
    return this.templates.addStep(req.user.companyId, req.user.id, id, dto);
  }

  @Patch(":id/steps/:stepId")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "workflow-template")
  updateStep(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("stepId") stepId: string,
    @Body() dto: UpdateTemplateStepDto,
  ) {
    return this.templates.updateStep(req.user.companyId, req.user.id, id, stepId, dto);
  }

  @Delete(":id/steps/:stepId")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "workflow-template")
  removeStep(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("stepId") stepId: string,
  ) {
    return this.templates.removeStep(req.user.companyId, req.user.id, id, stepId);
  }

  // ─── Step dependencies (1c-iii) — gate update:workflow-template ───────────────

  @Post(":id/dependencies")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "workflow-template")
  addDependency(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: CreateDependencyDto,
  ) {
    return this.templates.addDependency(req.user.companyId, req.user.id, id, dto);
  }

  @Delete(":id/dependencies/:depId")
  @UseGuards(PermissionGuard)
  @RequirePermission("update", "workflow-template")
  removeDependency(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("depId") depId: string,
  ) {
    return this.templates.removeDependency(req.user.companyId, req.user.id, id, depId);
  }
}
