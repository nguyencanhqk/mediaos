import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { ReportService } from "./report.service";
import { MvDashboardService } from "./mv-dashboard.service";
import { AlertsService } from "./alerts.service";
import { DashboardRefreshService } from "./dashboard-refresh.service";
import { PermissionModule } from "../permission/permission.module";
import { SeedModule } from "../foundation/seed/seed.module";
import { DashboardConfigSeeder } from "./dashboard-config.seeder";
import { DashSeedRegistrar } from "./dash-seed.registrar";

/**
 * S4-DASH-SEED-1 (additive): import SeedModule (exports MasterDataSeederRegistry) → DashSeedRegistrar
 * (OnModuleInit) đăng ký DashboardConfigSeeder, để runner per-company seed default dashboard_widget_configs.
 * foundation/seed KHÔNG import DASH (inversion of dependency) — mirror AttendanceModule.
 */
@Module({
  imports: [PermissionModule, SeedModule],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    ReportService,
    MvDashboardService,
    AlertsService,
    DashboardRefreshService,
    DashboardConfigSeeder,
    DashSeedRegistrar,
  ],
})
export class DashboardModule {}
