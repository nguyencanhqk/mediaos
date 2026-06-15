import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { KpiRepository } from "./kpi.repository";
import { KpiService } from "./kpi.service";
import { KpiController } from "./kpi.controller";

/**
 * G8-4 — KPI module (định nghĩa KPI + tính KPI cá nhân/team snapshot append-only).
 *
 * DI: DatabaseService (DatabaseModule) + AuditService/OutboxService (EventsModule @Global).
 * PermissionModule KHÔNG global → import tường minh để KpiService gọi PermissionService.can()
 * (fail-closed manage:kpi-definition / read:kpi / confirm:kpi) + PermissionGuard ở controller.
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule],
  providers: [KpiRepository, KpiService],
  controllers: [KpiController],
  exports: [KpiService],
})
export class KpiModule {}
