import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AiInsightDto, AiInsightQuery, CostRecordDto } from "@mediaos/contracts";
import { PermissionService } from "../permission/permission.service";
import { KpiService } from "../kpi/kpi.service";
import { CostService } from "../finance/cost.service";
import { AiClient } from "./ai-client";
import { buildInsightPrompt } from "./ai-prompt";

/**
 * AI-1 — AiInsightService: orchestrator READ-ONLY. Đọc kpi_results + cost_records ĐÃ MASK theo permission
 * → build prompt → gọi Claude → trả summary. KHÔNG ghi DB, KHÔNG audit/outbox, KHÔNG bảng mới.
 *
 * 5 chốt fail-closed:
 *  (a) Permission — assertCan read:kpi TRƯỚC mọi I/O (DB đọc + gọi Claude). Deny ⇒ ForbiddenException,
 *      KHÔNG gọi LLM (kiểm 0 lần ở test), KHÔNG lộ dữ liệu. Lỗi can() → DENY (fail-closed).
 *  (b) RLS 2-tenant — TÁI DÙNG KpiService.listResults + CostService.list (đã withTenant + RLS + scope
 *      server-driven). KHÔNG raw query. Login A chỉ tổng hợp dữ liệu A.
 *  (c) MASK trước LLM — cost amount đi qua CostService.list (mask null khi thiếu view-finance). Prompt
 *      build từ DTO đã mask → số tiền KHÔNG rời server dạng thô tới Claude (bất biến #3).
 *  (d) Read-only — KHÔNG INSERT/UPDATE/DELETE; KHÔNG mở withTenant write-tx; KHÔNG ghi audit_logs/outbox.
 *  (e) Config — AiClient fail-fast khi thiếu ANTHROPIC_API_KEY (KHÔNG hardcode, KHÔNG nuốt lỗi).
 */

const KPI_RESOURCE = "kpi";
const KPI_ACTION = "read";
const FINANCE_VIEW_RESOURCE = "finance";
const FINANCE_VIEW_ACTION = "view-finance";

@Injectable()
export class AiInsightService {
  constructor(
    private readonly permissions: PermissionService,
    private readonly kpi: KpiService,
    private readonly cost: CostService,
    private readonly client: AiClient,
  ) {}

  /**
   * Tổng hợp insight cho 1 tenant. Permission read:kpi check NGOÀI mọi I/O (fail-closed). view-finance
   * quyết MASK số tiền — KHÔNG quyết quyền chạy (mask = che, không chặn). Đọc KPI + cost (đã mask) → prompt
   * → Claude → InsightDto. companyId/userId LẤY TỪ caller (controller lấy từ req.user — không tin client).
   */
  async summarizeInsight(
    companyId: string,
    userId: string,
    query: AiInsightQuery,
  ): Promise<AiInsightDto> {
    // (a) FAIL-CLOSED: check read:kpi TRƯỚC mọi I/O (DB + LLM). Deny ⇒ KHÔNG gọi Claude, KHÔNG lộ data.
    await this.assertCanReadKpi(companyId, userId);

    // (c) FAIL-SAFE MASK: view-finance quyết che số tiền. Lỗi can() → mask (coi như không quyền).
    const canViewFinance = await this.canViewFinance(companyId, userId);

    // (b) RLS + scope qua service có sẵn (read-only). CostService.list MASK amount khi !canViewFinance.
    const [kpiResults, costRecords] = await Promise.all([
      this.kpi.listResults(companyId, userId, {
        definitionId: query.definitionId,
        subjectUserId: query.subjectUserId,
        subjectTeamId: query.subjectTeamId,
        confirmedOnly: false,
        limit: query.limit,
      }),
      this.cost.list(companyId, userId, { limit: query.limit }),
    ]);

    // financeMasked = true nếu thiếu quyền HOẶC bất kỳ amount nào bị mask (null) — UI hint + prompt note.
    const financeMasked = !canViewFinance || hasMaskedAmount(costRecords);

    const prompt = buildInsightPrompt({
      period: query.period,
      scope: query.scope,
      kpiResults,
      costRecords,
      financeMasked,
    });

    const { summary, model } = await this.client.summarize(prompt);

    return {
      summary,
      model,
      period: query.period,
      scope: query.scope,
      financeMasked,
      kpiCount: kpiResults.length,
      costCount: costRecords.length,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Fail-closed gate read:kpi. Lỗi hạ tầng trong can() → DENY (ForbiddenException), KHÔNG fail-open. */
  private async assertCanReadKpi(companyId: string, userId: string): Promise<void> {
    let allow = false;
    try {
      const decision = await this.permissions.can({
        userId,
        companyId,
        action: KPI_ACTION,
        resourceType: KPI_RESOURCE,
      });
      allow = decision.allow;
    } catch {
      allow = false; // fail-closed.
    }
    if (!allow) {
      throw new ForbiddenException("Permission denied: read:kpi");
    }
  }

  /**
   * view-finance(isSensitive) — quyết MASK số tiền. FAIL-SAFE MASK: mọi lỗi can() → coi KHÔNG có quyền
   * (mask), KHÔNG fail-open ra số thật. Mirror CostService.canViewFinance.
   */
  private async canViewFinance(companyId: string, userId: string): Promise<boolean> {
    try {
      const decision = await this.permissions.can({
        userId,
        companyId,
        action: FINANCE_VIEW_ACTION,
        resourceType: FINANCE_VIEW_RESOURCE,
        isSensitive: true,
      });
      return decision.allow;
    } catch {
      return false; // fail-safe mask.
    }
  }
}

/** true nếu bất kỳ cost record nào có amount bị mask (null) — báo phần tài chính chưa đầy đủ. */
function hasMaskedAmount(rows: CostRecordDto[]): boolean {
  return rows.some((r) => r.amount == null);
}
