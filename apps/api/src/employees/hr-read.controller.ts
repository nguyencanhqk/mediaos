import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request, Response } from "express";
import {
  hrEmployeeExportQuerySchema,
  hrEmployeeListQuerySchema,
  type HrEmployeeExportQuery,
  type HrEmployeeListQuery,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { HrExportService } from "./hr-export.service";
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
  constructor(
    private readonly hr: HrReadService,
    private readonly hrExport: HrExportService,
  ) {}

  @Get("employees")
  @RequirePermission("read", "employee")
  @UsePipes(new ZodValidationPipe(hrEmployeeListQuerySchema))
  listEmployees(@Req() req: AuthenticatedRequest, @Query() query: HrEmployeeListQuery) {
    return this.hr.listHrEmployees(req.user, query);
  }

  // HR-PROFILE-UI-1 — overview aggregates. Static route declared BEFORE ":id" so "summary" is not
  // captured as an employee id. Scope-filtered in the service; byGender gated by view-sensitive.
  @Get("employees/summary")
  @RequirePermission("read", "employee")
  getEmployeesSummary(@Req() req: AuthenticatedRequest) {
    return this.hr.getEmployeesSummary(req.user);
  }

  // Static route declared BEFORE the param route so "me" is not captured by ":id".
  @Get("me/profile")
  @RequirePermission("read", "employee")
  getMyProfile(@Req() req: AuthenticatedRequest) {
    return this.hr.getMyProfile(req.user);
  }

  // HR-PROFILE-UI-2 — CSV export of the scoped employee directory. Declared BEFORE "employees/:id" so
  // Express never resolves "export" to the :id param route (route-collision guard). @Res library-mode ⇒
  // the response bypasses ResponseEnvelopeInterceptor (CSV bytes, not a JSON envelope). Gate
  // export:employee (isSensitive → wildcard *:* fail-closed); the service applies the SAME data-scope
  // filter as the list + a hard row cap (422 over-cap, no truncate) + per-row PII mask.
  @Get("employees/export")
  @RequirePermission("export", "employee", { isSensitive: true })
  @Header("Content-Type", "text/csv; charset=utf-8")
  @UsePipes(new ZodValidationPipe(hrEmployeeExportQuerySchema))
  async exportEmployees(
    @Req() req: AuthenticatedRequest,
    @Query() query: HrEmployeeExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    const { csv, filename } = await this.hrExport.exportEmployeesCsv(req.user, query);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // Send the exact UTF-8 bytes (BOM preserved) — res.send(string) would re-encode/parse.
    res.send(Buffer.from(csv, "utf-8"));
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
