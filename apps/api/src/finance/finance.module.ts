import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { RevenueService } from "./revenue.service";
import { RevenueRepository } from "./revenue.repository";
import { CostService } from "./cost.service";
import { CostRepository } from "./cost.repository";
import { CostAllocationService } from "./cost-allocation.service";
import { CostAllocationRepository } from "./cost-allocation.repository";
import { ProfitService } from "./profit.service";
import { ProfitRepository } from "./profit.repository";

/**
 * G13 Finance module — sổ cái doanh thu/chi phí/lợi nhuận (BẤT BIẾN #2: append-only).
 *
 * DI: DatabaseService + AuditService/OutboxService đến từ DatabaseModule/EventsModule (@Global).
 * PermissionModule KHÔNG global → import tường minh để *.assertCanWrite gọi
 * PermissionService.can() (fail-closed create:finance).
 *
 * G13-1: RevenueService/RevenueRepository (revenue_records).
 * G13-2: CostService/CostRepository (cost_records, append-only) + CostAllocationService/Repository
 *        (cost_allocations, FIN-003 phân bổ 5+1 kiểu). Controller wire khi build HTTP layer.
 * G13-3: ProfitService/ProfitRepository (profit_snapshots, append-only; profit = revenue − direct −
 *        allocated; mask SERVER-side theo view-finance). Controller wire khi build HTTP layer.
 */
@Module({
  imports: [EventsModule, PermissionModule],
  providers: [
    RevenueService,
    RevenueRepository,
    CostService,
    CostRepository,
    CostAllocationService,
    CostAllocationRepository,
    ProfitService,
    ProfitRepository,
  ],
  exports: [RevenueService, CostService, CostAllocationService, ProfitService],
})
export class FinanceModule {}
