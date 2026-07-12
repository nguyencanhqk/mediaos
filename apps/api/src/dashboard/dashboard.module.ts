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
// S4-DASH-CATALOG-2 (additive): 3 module nguồn cho 9 widget đợt 2 — ModuleCatalogModule (MODULE_STATUS →
// ModuleCatalogService.getAllModules) · UsersModule (USER_SUMMARY → AuthUsersService.listUsers) · AuditModule
// (SYSTEM_LOGS → AuditQueryService.listCompany count-only). DASH là leaf (module nguồn KHÔNG import DASH),
// UsersModule tự forwardRef(AuthModule) nội bộ ⇒ import an toàn, KHÔNG circular-dep.
import { ModuleCatalogModule } from "../foundation/module-catalog/module-catalog.module";
import { UsersModule } from "../users/users.module";
import { AuditModule } from "../foundation/audit/audit.module";
import { DashboardWidgetDataController } from "./dashboard-widget-data.controller";
import { DashboardWidgetDataService } from "./dashboard-widget-data.service";
import { DashboardWidgetHandlersService } from "./dashboard-widget-handlers.service";
import { DashboardWidgetCacheService } from "./dashboard-widget-cache.service";
// S4-DASH-BE-3 (additive): config CRUD — controller THỨ TƯ (/configs + /configs/:id), không đụng khối trên.
import { DashboardConfigController } from "./dashboard-config.controller";
import { DashboardConfigService } from "./dashboard-config.service";
// S4-INT-2 (additive): internal cache invalidation — controller THỨ NĂM (POST /internal/v1/dashboard/
// cache/invalidate), event TASK/NOTI/ATT/LEAVE → widget (dashboard-cache-invalidation.const.ts).
import { InternalDashboardCacheController } from "./internal-dashboard-cache.controller";
import { DashboardCacheInvalidationService } from "./dashboard-cache-invalidation.service";
// S4-INT-2-FIX-1 (additive): registrar OnModuleInit đăng ký 9 consumer EventBus (outbox eventType TASK/LEAVE
// THẬT) → DashboardCacheInvalidationService.invalidate() in-process (mirror S4-INT-1 TaskNotiBridgeRegistrar).
// EventBus đến từ EventsModule (@Global — KHÔNG cần import module) — registrar chỉ cần khai provider.
import { DashboardCacheInvalidationRegistrar } from "./dashboard-cache-invalidation.registrar";

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
    // S4-DASH-CATALOG-2 (additive): + 3 module nguồn cho 9 widget đợt 2. EmployeesModule (đã import) export
    // HrReadService+ContractService; AttendanceModule (đã import) export AttendanceReadService; LeaveModule
    // (đã import) nay export thêm LeaveReadService+LeaveCalendarService.
    ModuleCatalogModule,
    UsersModule,
    AuditModule,
  ],
  controllers: [
    DashboardController,
    DashboardResolverController,
    // S4-DASH-BE-2 (additive): widget DATA + catalog (widgets · widgets/:slug).
    DashboardWidgetDataController,
    // S4-DASH-BE-3 (additive): config CRUD — controller THỨ TƯ (/configs + /configs/:id).
    DashboardConfigController,
    // S4-INT-2 (additive): internal cache invalidation — controller THỨ NĂM.
    InternalDashboardCacheController,
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
    // S4-DASH-BE-3 (additive): config CRUD service.
    DashboardConfigService,
    // S4-INT-2 (additive): internal cache invalidation service.
    DashboardCacheInvalidationService,
    // S4-INT-2-FIX-1 (additive): registrar OnModuleInit — wire outbox eventType TASK/LEAVE THẬT vào cache
    // invalidation (trước lane này endpoint mồ côi, xem doc-block registrar).
    DashboardCacheInvalidationRegistrar,
  ],
})
export class DashboardModule {}
