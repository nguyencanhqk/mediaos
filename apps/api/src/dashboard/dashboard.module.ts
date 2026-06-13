import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { ReportService } from "./report.service";
import { MvDashboardService } from "./mv-dashboard.service";
import { AlertsService } from "./alerts.service";
import { DashboardRefreshService } from "./dashboard-refresh.service";
import { PermissionModule } from "../permission/permission.module";

@Module({
  imports: [PermissionModule],
  controllers: [DashboardController],
  providers: [DashboardService, ReportService, MvDashboardService, AlertsService, DashboardRefreshService],
})
export class DashboardModule {}
