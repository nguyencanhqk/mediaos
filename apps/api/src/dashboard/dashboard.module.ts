import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { ReportService } from "./report.service";
import { PermissionModule } from "../permission/permission.module";

@Module({
  imports: [PermissionModule],
  controllers: [DashboardController],
  providers: [DashboardService, ReportService],
})
export class DashboardModule {}
