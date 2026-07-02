import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AuditLogQueryDto } from "../foundation/audit/audit.dto";
import {
  ATT_PERMISSIONS,
  ATT_RESOURCES,
  type AttPermissionPair,
  type AttResourceType,
} from "./attendance-permissions.const";
import { AttendanceAuditService } from "./attendance-audit.service";

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

const VIEW_AUDIT = attPair("view", ATT_RESOURCES.AUDIT_LOG);

/**
 * S3-ATT-BE-6 (CO-S4-006, ATT-SCREEN-018) — GET /attendance/audit-logs: ATT's OWN route/controller/
 * guard, DELIBERATELY SEPARATE from foundation AuditController (/foundation/audit-logs). Gate =
 * (view,'attendance-audit-log') — a distinct catalog pair from foundation's (view,'audit-log', mig 0005),
 * seeded Company-scope to hr/company-admin only (mig 0454). Reusing the foundation route/guard directly
 * would over-grant: anyone holding foundation's (view,'audit-log') — a DIFFERENT resource — would read
 * ATT audit rows they were never granted. AttendanceAuditService reuses AuditRepository (SELECT-only) +
 * AuditMaskerService (SAME redact-at-read as foundation, BẤT BIẾN #3) and additionally bounds the read to
 * the ATT object-type allowlist server-side (defense-in-depth beyond the permission gate).
 */
@Controller("attendance")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class AttendanceAuditController {
  constructor(private readonly audit: AttendanceAuditService) {}

  @Get("audit-logs")
  @RequirePermission(VIEW_AUDIT.action, VIEW_AUDIT.resourceType, {
    isSensitive: VIEW_AUDIT.sensitive,
  })
  list(@Req() req: AuthenticatedRequest, @Query() query: AuditLogQueryDto) {
    return this.audit.list(req.user, query);
  }
}
