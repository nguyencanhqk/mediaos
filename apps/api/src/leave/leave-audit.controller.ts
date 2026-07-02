import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AuditLogQueryDto } from "../foundation/audit/audit.dto";
import {
  LEAVE_PERMISSIONS,
  LEAVE_RESOURCES,
  type LeavePermissionPair,
  type LeaveResourceType,
} from "./leave-permissions.const";
import { LeaveAuditService } from "./leave-audit.service";

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

const VIEW_AUDIT = leavePair("view", LEAVE_RESOURCES.LEAVE_AUDIT_LOG);

/**
 * S3-LEAVE-BE-6 (UI-LEAVE-SCREEN-014A) — GET /leave/audit-logs: LEAVE's OWN route/controller/guard,
 * DELIBERATELY SEPARATE from foundation AuditController (/foundation/audit-logs) — mirrors
 * AttendanceAuditController EXACTLY. Gate = (view,'leave-audit-log') — a distinct catalog pair from
 * foundation's (view,'audit-log', mig 0005), seeded Company-scope to hr/company-admin only (mig 0455).
 * Reusing the foundation route/guard directly would over-grant: anyone holding foundation's
 * (view,'audit-log') would read LEAVE audit rows they were never granted. LeaveAuditService reuses
 * AuditRepository (SELECT-only) + AuditMaskerService (SAME redact-at-read as foundation, BẤT BIẾN #3)
 * and additionally bounds the read to the LEAVE object-type allowlist server-side (defense-in-depth
 * beyond the permission gate).
 */
@Controller("leave")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class LeaveAuditController {
  constructor(private readonly audit: LeaveAuditService) {}

  @Get("audit-logs")
  @RequirePermission(VIEW_AUDIT.action, VIEW_AUDIT.resourceType, {
    isSensitive: VIEW_AUDIT.sensitive,
  })
  list(@Req() req: AuthenticatedRequest, @Query() query: AuditLogQueryDto) {
    return this.audit.list(req.user, query);
  }
}
