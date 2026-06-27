import { Controller, Get, Param, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { hrEmployeeListQuerySchema, type HrEmployeeListQuery } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { HrReadService } from "./hr-read.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-HR-BE-1 — HR read core (SPEC-03 / API-10). All routes are GUARDED by PermissionGuard with the
 * engine pairs already seeded (read:employee / read:department / read:position / manage:master-data /
 * preview:employee-code). The guard rejects a caller missing the pair with 403 BEFORE the handler.
 * Field-level salary/PII masking happens in the service (per view-salary / view-sensitive grant).
 */
@Controller("hr")
@UseGuards(PermissionGuard)
export class HrReadController {
  constructor(private readonly hr: HrReadService) {}

  @Get("employees")
  @RequirePermission("read", "employee")
  @UsePipes(new ZodValidationPipe(hrEmployeeListQuerySchema))
  listEmployees(@Req() req: AuthenticatedRequest, @Query() query: HrEmployeeListQuery) {
    return this.hr.listHrEmployees(req.user, query);
  }

  // Static route declared BEFORE the param route so "me" is not captured by ":id".
  @Get("me/profile")
  @RequirePermission("read", "employee")
  getMyProfile(@Req() req: AuthenticatedRequest) {
    return this.hr.getMyProfile(req.user);
  }

  @Get("employees/:id")
  @RequirePermission("read", "employee")
  getEmployee(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.hr.getHrEmployee(req.user, id);
  }

  // ── Lookups ───────────────────────────────────────────────────────────────────────

  @Get("lookups/departments")
  @RequirePermission("read", "department")
  listDepartments(@Req() req: AuthenticatedRequest) {
    return this.hr.listDepartments(req.user);
  }

  @Get("lookups/positions")
  @RequirePermission("read", "position")
  listPositions(@Req() req: AuthenticatedRequest) {
    return this.hr.listPositions(req.user);
  }

  @Get("lookups/job-levels")
  @RequirePermission("manage", "master-data")
  listJobLevels(@Req() req: AuthenticatedRequest) {
    return this.hr.listJobLevels(req.user);
  }

  @Get("lookups/contract-types")
  @RequirePermission("manage", "master-data")
  listContractTypes(@Req() req: AuthenticatedRequest) {
    return this.hr.listContractTypes(req.user);
  }

  @Get("lookups/employee-code/preview")
  @RequirePermission("preview", "employee-code")
  previewEmployeeCode(@Req() req: AuthenticatedRequest) {
    return this.hr.previewEmployeeCode(req.user);
  }
}
