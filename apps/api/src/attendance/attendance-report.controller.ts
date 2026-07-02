import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import {
  ATT_PERMISSIONS,
  ATT_RESOURCES,
  type AttPermissionPair,
  type AttResourceType,
} from "./attendance-permissions.const";
import { AttendanceReportService } from "./attendance-report.service";
import { AttendanceReportQueryDto } from "./attendance-report.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string; email: string };
}

/** Same fail-fast lookup as AttendanceController — pair MUST exist in the shared catalog (mig 0454). */
function attPair(action: string, resourceType: AttResourceType): AttPermissionPair {
  const pair = ATT_PERMISSIONS.find((p) => p.action === action && p.resourceType === resourceType);
  if (!pair) {
    throw new Error(`ATT permission pair missing from catalog: ${action}:${resourceType}`);
  }
  return pair;
}

const VIEW_TEAM = attPair("view-team", ATT_RESOURCES.ATTENDANCE);
const VIEW_COMPANY = attPair("view-company", ATT_RESOURCES.ATTENDANCE);

/**
 * S3-ATT-BE-6 (CO-S4-006, API-04) — GET /attendance/reports: per-employee attendance aggregate
 * (present/late/missing/leave) over a period, scoped by the caller's STRONGEST grant of
 * (view-team|view-company, attendance) — mirrors AttendanceController's records-read routes
 * EXACTLY (same pairs, same fail-closed PermissionGuard, same DataScopeService gate→filter contract).
 * There is no export/CSV here — that is ATT.ATTENDANCE.EXPORT, a separate carry-over WO.
 */
@Controller("attendance")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class AttendanceReportController {
  constructor(private readonly reports: AttendanceReportService) {}

  @Get("reports/team")
  @RequirePermission(VIEW_TEAM.action, VIEW_TEAM.resourceType, { isSensitive: VIEW_TEAM.sensitive })
  getTeamReport(@Req() req: AuthenticatedRequest, @Query() query: AttendanceReportQueryDto) {
    return this.reports.getReport(req.user, "view-team", query);
  }

  @Get("reports")
  @RequirePermission(VIEW_COMPANY.action, VIEW_COMPANY.resourceType, {
    isSensitive: VIEW_COMPANY.sensitive,
  })
  getCompanyReport(@Req() req: AuthenticatedRequest, @Query() query: AttendanceReportQueryDto) {
    return this.reports.getReport(req.user, "view-company", query);
  }
}
