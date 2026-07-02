import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import {
  LEAVE_PERMISSIONS,
  LEAVE_RESOURCES,
  type LeavePermissionPair,
  type LeaveResourceType,
} from "./leave-permissions.const";
import { LeaveReportService } from "./leave-report.service";
import { LeaveReportQueryDto } from "./leave-report.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string; email: string };
}

/** Same fail-fast lookup as LeaveController — pair MUST exist in the shared catalog (mig 0455). */
function leavePair(action: string, resourceType: LeaveResourceType): LeavePermissionPair {
  const pair = LEAVE_PERMISSIONS.find(
    (p) => p.action === action && p.resourceType === resourceType,
  );
  if (!pair) {
    throw new Error(`LEAVE permission pair missing from catalog: ${action}:${resourceType}`);
  }
  return pair;
}

// export:leave (sensitive, Company-scope ONLY — hr/company-admin, mig 0455 LEAST-PRIVILEGE: manager
// KHÔNG có grant này). Pinned per S3-LEAVE-BE-6 done_when: permission = LEAVE.REQUEST.EXPORT.
const EXPORT_LEAVE = leavePair("export", LEAVE_RESOURCES.LEAVE);

/**
 * S3-LEAVE-BE-6 (CO-S4-006, UI-LEAVE-SCREEN-013) — GET /leave/reports: per-employee LEAVE aggregate
 * (approved leave days/requests) over a period, scoped by the caller's grant of (export, leave).
 * Company-scope only today (no export:leave grant exists at Team/Department — mig 0455 explicitly
 * excludes manager from this pair; UI-04's "actor: HR/Manager" label is NOT backed by the seed —
 * flagged for owner, KHÔNG tự thêm grant ở lane này). No CSV/export file here — pure JSON aggregate,
 * mirrors AttendanceReportController's "reports = aggregate view, not literal export" precedent.
 */
@Controller("leave")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class LeaveReportController {
  constructor(private readonly reports: LeaveReportService) {}

  @Get("reports")
  @RequirePermission(EXPORT_LEAVE.action, EXPORT_LEAVE.resourceType, {
    isSensitive: EXPORT_LEAVE.sensitive,
  })
  getReport(@Req() req: AuthenticatedRequest, @Query() query: LeaveReportQueryDto) {
    return this.reports.getReport(req.user, query);
  }
}
