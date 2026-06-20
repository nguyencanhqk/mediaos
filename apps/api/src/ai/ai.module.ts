import { Module } from "@nestjs/common";
import { PermissionModule } from "../permission/permission.module";
import { KpiModule } from "../kpi/kpi.module";
import { FinanceModule } from "../finance/finance.module";
import { AiClient } from "./ai-client";
import { AiInsightService } from "./ai-insight.service";
import { AiController } from "./ai.controller";

/**
 * AI-1 — AI module (READ-ONLY): tóm tắt KPI + chi phí ĐÃ MASK theo permission qua Claude.
 *
 * DI: PermissionModule (fail-closed read:kpi + view-finance) + KpiModule (export KpiService.listResults)
 * + FinanceModule (export CostService.list — MASK amount server-side). KHÔNG provider ghi DB; AiClient là
 * wrapper SDK đọc key từ env. KHÔNG DatabaseModule trực tiếp (đọc qua service có sẵn → withTenant + RLS).
 */
@Module({
  imports: [PermissionModule, KpiModule, FinanceModule],
  providers: [AiClient, AiInsightService],
  controllers: [AiController],
})
export class AiModule {}
