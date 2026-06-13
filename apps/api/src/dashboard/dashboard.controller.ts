import { Controller, Get, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { PermissionService } from "../permission/permission.service";
import { DashboardService } from "./dashboard.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * DashboardController — G14-1 read-only aggregate endpoint.
 * GET /dashboard/summary — returns role-filtered metrics.
 * Global JwtAuthGuard + CompanyGuard already run before this.
 * Requires read:dashboard for basic access; granular masking is performed
 * server-side in DashboardService based on actual capability checks.
 */
@Controller("dashboard")
@UsePipes(ZodValidationPipe)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly permissionService: PermissionService,
  ) {}

  @Get("summary")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "dashboard")
  async getSummary(@Req() req: AuthenticatedRequest) {
    const { id: userId, companyId } = req.user;

    const [canReadTask, canReadAttendance, canReadLeave, canReadAllAttendance] = await Promise.all([
      this.permissionService.can({ userId, companyId, action: "read", resourceType: "task" }),
      this.permissionService.can({ userId, companyId, action: "read", resourceType: "attendance" }),
      this.permissionService.can({ userId, companyId, action: "read", resourceType: "leave" }),
      this.permissionService.can({
        userId,
        companyId,
        action: "read",
        resourceType: "attendance_all",
      }),
    ]);

    return this.dashboardService.getSummary(
      { id: userId, companyId },
      {
        canReadTask: canReadTask.allow,
        canReadAttendance: canReadAttendance.allow,
        canReadLeave: canReadLeave.allow,
        isPrivilegedAttendance: canReadAllAttendance.allow,
      },
    );
  }
}
