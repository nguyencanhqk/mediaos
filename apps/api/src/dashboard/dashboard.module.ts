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
// S4-DASH-BE-1 (additive): resolver + widget registry — song song DashboardController cũ (không đụng).
import { DashboardResolverController } from "./dashboard-resolver.controller";
import { DashboardResolverService } from "./dashboard-resolver.service";
import { DashboardWidgetRegistryService } from "./dashboard-widget-registry.service";
// S4-DASH-BE-3 (additive): config CRUD — controller THỨ TƯ (/configs + /configs/:id), không đụng khối trên.
import { DashboardConfigController } from "./dashboard-config.controller";
import { DashboardConfigService } from "./dashboard-config.service";

/**
 * S4-DASH-SEED-1 (additive): import SeedModule (exports MasterDataSeederRegistry) → DashSeedRegistrar
 * (OnModuleInit) đăng ký DashboardConfigSeeder, để runner per-company seed default dashboard_widget_configs.
 * foundation/seed KHÔNG import DASH (inversion of dependency) — mirror AttendanceModule.
 */
@Module({
  imports: [PermissionModule, SeedModule],
  controllers: [DashboardController, DashboardResolverController, DashboardConfigController],
  providers: [
    DashboardService,
    ReportService,
    MvDashboardService,
    AlertsService,
    DashboardRefreshService,
    DashboardConfigSeeder,
    DashSeedRegistrar,
    DashboardResolverService,
    DashboardWidgetRegistryService,
    DashboardConfigService,
  ],
})
export class DashboardModule {}
