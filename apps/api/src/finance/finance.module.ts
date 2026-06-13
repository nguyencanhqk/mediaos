import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { RevenueService } from "./revenue.service";
import { RevenueRepository } from "./revenue.repository";

/**
 * G13 Finance module — sổ cái doanh thu/chi phí/lợi nhuận (BẤT BIẾN #2: append-only).
 *
 * DI: DatabaseService + AuditService/OutboxService đến từ DatabaseModule/EventsModule (@Global).
 * PermissionModule KHÔNG global → import tường minh để RevenueService.assertCanWrite gọi
 * PermissionService.can() (fail-closed create:finance).
 *
 * G13-1: RevenueService/RevenueRepository (revenue_records). G13-2/3/4 (cost/profit/expense) sẽ
 * thêm provider vào ĐÂY (additive) — controller wire khi build HTTP layer.
 */
@Module({
  imports: [EventsModule, PermissionModule],
  providers: [RevenueService, RevenueRepository],
  exports: [RevenueService],
})
export class FinanceModule {}
