import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ApplyTemplateDto } from "./template.dto";
import { TemplateService } from "./template.service";
import { TemplateCloneService } from "./template-clone.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * Template clone (G16-3) — tầng PLATFORM. Done-criterion: clone template cho công ty khác.
 * Mọi route gated PermissionGuard + quyền platform sensitive (chỉ platform-admin qua — ADR-0017).
 *   - GET  /admin/platform/templates                       → list catalog (view:platform-company)
 *   - POST /admin/platform/companies/:companyId/apply-template → provision (apply:platform-template)
 */
@Controller("admin/platform")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class TemplateController {
  constructor(
    private readonly templates: TemplateService,
    private readonly clone: TemplateCloneService,
  ) {}

  @Get("templates")
  @RequirePermission("view", "platform-company", { isSensitive: true })
  list(@Req() req: AuthenticatedRequest) {
    return this.templates.listTemplates(req.user.companyId);
  }

  /** Provision/clone template vào 1 công ty đã tồn tại (idempotent + atomic). */
  @Post("companies/:companyId/apply-template")
  @RequirePermission("apply", "platform-template", { isSensitive: true })
  apply(
    @Req() req: AuthenticatedRequest,
    @Param("companyId", ParseUUIDPipe) companyId: string,
    @Body() dto: ApplyTemplateDto,
  ) {
    return this.clone.applyTemplate(companyId, dto.templateCode, req.user.id);
  }
}
