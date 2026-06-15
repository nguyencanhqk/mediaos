import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { PermissionService } from "../permission/permission.service";
import { DashboardService } from "./dashboard.service";
import { ReportService } from "./report.service";
import { MvDashboardService } from "./mv-dashboard.service";
import { AlertsService } from "./alerts.service";
import { DashboardRefreshService } from "./dashboard-refresh.service";
import { mvStatsQuerySchema, type MvStatsQueryDto } from "@mediaos/contracts";

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
    private readonly reportService: ReportService,
    private readonly permissionService: PermissionService,
    private readonly mvDashboardService: MvDashboardService,
    private readonly alertsService: AlertsService,
    private readonly refreshService: DashboardRefreshService,
  ) {}

  /**
   * GET /dashboard/report — role-filtered report aggregate.
   * Granular masking per permission: finance_report / employee_report / attendance_report.
   * Low-privilege roles receive null fields — not empty objects — for denied sections.
   */
  @Get("report")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "dashboard")
  async getReport(@Req() req: AuthenticatedRequest) {
    const { id: userId, companyId } = req.user;

    const [canReadFinanceReport, canReadEmployeeReport, canReadAttendanceReport] =
      await Promise.all([
        this.permissionService.can({
          userId,
          companyId,
          action: "read",
          resourceType: "finance_report",
        }),
        this.permissionService.can({
          userId,
          companyId,
          action: "read",
          resourceType: "employee_report",
        }),
        this.permissionService.can({
          userId,
          companyId,
          action: "read",
          resourceType: "attendance_report",
        }),
      ]);

    const report = await this.reportService.getReport(
      { id: userId, companyId },
      {
        canReadFinanceReport: canReadFinanceReport.allow,
        canReadEmployeeReport: canReadEmployeeReport.allow,
        canReadAttendanceReport: canReadAttendanceReport.allow,
      },
    );

    return { report, asOf: new Date().toISOString() };
  }

  /**
   * GET /dashboard/mv-stats — MV-backed task-status + output breakdown with optional filters.
   * filter: month (YYYY-MM), channelId, projectId, departmentId.
   * SECURITY: MV does not honor RLS — service always adds WHERE company_id = companyId.
   */
  @Get("mv-stats")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "dashboard")
  async getMvStats(
    @Req() req: AuthenticatedRequest,
    @Query() query: MvStatsQueryDto,
  ) {
    const { companyId } = req.user;
    const filter = mvStatsQuerySchema.parse(query);
    const [taskStatus, output] = await Promise.all([
      this.mvDashboardService.getTaskStatusStats(companyId),
      this.mvDashboardService.getOutputStats(companyId, filter),
    ]);
    return { taskStatus, output, asOf: new Date().toISOString() };
  }

  /**
   * GET /dashboard/alerts — live overdue + channel-risk alerts.
   * Computed from live tables (not MV) so never stale.
   */
  @Get("alerts")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "dashboard")
  async getAlerts(@Req() req: AuthenticatedRequest) {
    const { companyId } = req.user;
    const alerts = await this.alertsService.getAlerts(companyId);
    return { alerts, asOf: new Date().toISOString() };
  }

  /**
   * POST /dashboard/refresh — trigger MV refresh (gated: manage:dashboard).
   * Runs CONCURRENTLY after initial populate. Uses worker/direct pool, not app-pool.
   */
  @Post("refresh")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "dashboard")
  async refresh() {
    return this.refreshService.refresh();
  }

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
