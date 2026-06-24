import { Body, Controller, Get, Patch, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { PatchCompanyDto } from "./company.dto";
import { CompanyService } from "./company.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S1-FND-MODULE-1 — HTTP surface cho company (BACKEND-04 §9.2). Global prefix 'api/v1' (main.ts).
 *
 *  GET   /foundation/company/current   (view:foundation-company)   — company của tenant TỪ AuthContext.
 *  PATCH /foundation/company/current   (update:foundation-company) — cập nhật hồ sơ + audit CONFIG_UPDATE.
 *
 * Cặp engine `view/update:foundation-company` (seed mig 0435, grant company-admin qua resource_type LIKE
 * 'foundation-%') — KHÔNG dùng `read/update:company` (0005, namespace cũ): route Foundation map FOUNDATION.*
 * → *:foundation-* giống settings/holidays/files. PermissionGuard opt-in (KHÔNG global) — fail-closed.
 */
@Controller("foundation")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Get("company/current")
  @RequirePermission("view", "foundation-company")
  getCurrent(@Req() req: AuthenticatedRequest) {
    return this.company.getCurrent(req.user);
  }

  @Patch("company/current")
  @RequirePermission("update", "foundation-company")
  updateCurrent(@Req() req: AuthenticatedRequest, @Body() dto: PatchCompanyDto) {
    return this.company.updateCompany(req.user, dto);
  }
}
