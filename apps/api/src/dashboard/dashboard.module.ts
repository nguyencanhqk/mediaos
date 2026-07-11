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
// S4-DASH-BE-2 (additive): widget DATA + cache + degraded — controller THỨ BA (widgets/:slug). Import module
// nguồn để inject read/aggregate service ĐÃ-scope (KHÔNG re-provide instance thứ 2, KHÔNG raw-query bảng khác):
//   TasksModule (TaskCoreService/TasksService/ProjectsService) · NotificationsModule (MyNotificationsService) ·
//   AttendanceModule (AttendanceReadService) · LeaveModule (LeaveApprovalService) · EmployeesModule
//   (HrReadService). PermissionModule (đã import) export DataScopeService/PermissionService.
import { TasksModule } from "../tasks/tasks.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AttendanceModule } from "../attendance/attendance.module";
import { LeaveModule } from "../leave/leave.module";
import { EmployeesModule } from "../employees/employees.module";
import { DashboardWidgetDataController } from "./dashboard-widget-data.controller";
import { DashboardWidgetDataService } from "./dashboard-widget-data.service";
import { DashboardWidgetHandlersService } from "./dashboard-widget-handlers.service";
import { DashboardWidgetCacheService } from "./dashboard-widget-cache.service";

/**
 * S4-DASH-SEED-1 (additive): import SeedModule (exports MasterDataSeederRegistry) → DashSeedRegistrar
 * (OnModuleInit) đăng ký DashboardConfigSeeder, để runner per-company seed default dashboard_widget_configs.
 * foundation/seed KHÔNG import DASH (inversion of dependency) — mirror AttendanceModule.
 */
@Module({
  imports: [
    PermissionModule,
    SeedModule,
    // S4-DASH-BE-2 (additive): module nguồn cho 7 widget handler.
    TasksModule,
    NotificationsModule,
    AttendanceModule,
    LeaveModule,
    EmployeesModule,
  ],
  controllers: [
    DashboardController,
    DashboardResolverController,
    // S4-DASH-BE-2 (additive): widget DATA + catalog (widgets · widgets/:slug).
    DashboardWidgetDataController,
  ],
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
    // S4-DASH-BE-2 (additive): data orchestrator + 7-handler registry + cache service.
    DashboardWidgetDataService,
    DashboardWidgetHandlersService,
    DashboardWidgetCacheService,
  ],
})
export class DashboardModule {}
