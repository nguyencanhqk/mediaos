import { Body, Controller, Get, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import {
  updateEmployeeCodeConfigSchema,
  type UpdateEmployeeCodeConfigRequest,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { EmployeeCodeConfigService } from "./employee-code-config.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-HR-BE-7 — Employee-code CONFIG admin (API-03 §10.10). Sits under `@Controller("hr")` alongside the
 * read/write cores. Canonical routes (spec wins over the done_when draft `/hr/settings/...`):
 *   GET   /hr/employee-code-config          HR-API-901  gate HR.EMPLOYEE_CODE_CONFIG.VIEW  (view,employee-code-config)
 *   PATCH /hr/employee-code-config          HR-API-902  gate HR.EMPLOYEE_CODE_CONFIG.UPDATE (update,employee-code-config)
 *   POST  /hr/employee-code/preview         HR-API-903  gate HR.EMPLOYEE_CODE.PREVIEW      (preview,employee-code)
 *
 * PermissionGuard rejects a missing pair with 403 BEFORE the handler → a denied caller writes no audit.
 */
@Controller("hr")
@UseGuards(PermissionGuard)
export class EmployeeCodeConfigController {
  constructor(private readonly service: EmployeeCodeConfigService) {}

  @Get("employee-code-config")
  @RequirePermission("view", "employee-code-config")
  getConfig(@Req() req: AuthenticatedRequest) {
    return this.service.getConfig(req.user);
  }

  @Patch("employee-code-config")
  @RequirePermission("update", "employee-code-config")
  updateConfig(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(updateEmployeeCodeConfigSchema))
    dto: UpdateEmployeeCodeConfigRequest,
  ) {
    return this.service.updateConfig(req.user, dto);
  }

  @Post("employee-code/preview")
  @RequirePermission("preview", "employee-code")
  previewEmployeeCode(@Req() req: AuthenticatedRequest) {
    return this.service.preview(req.user);
  }
}
