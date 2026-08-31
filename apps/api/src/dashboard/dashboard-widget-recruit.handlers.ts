/**
 * S12-RECRUIT-DASH-1 — handler widget DASH của module RECRUIT (SPEC-12 RC-10 · RECRUIT-FUNC-013 ·
 * RECRUIT-WIDGET-001, mig 0563):
 *   • RECRUIT_FUNNEL (slug `recruit-funnel`) — «Phễu tuyển dụng»: ứng viên theo stage + số vị trí đang Open.
 *
 * VÌ SAO file RIÊNG (mirror dashboard-widget-office.handlers.ts): `dashboard-widget-handlers.service.ts`
 * đã sát trần 800 dòng của CLAUDE.md §5. Registry vẫn là MỘT (`DashboardWidgetHandlersService.buildRegistry`
 * gọi sang đây) — tách file, KHÔNG tách registry.
 *
 * Cùng hợp đồng với các handler cũ: `gateAndResolve` (403 fail-closed + resolve cache identity) LUÔN chạy
 * trước mọi lần serve kể cả cache hit; `fetch` chỉ chạy khi cache miss/refresh. Handler CHỈ gọi method
 * ĐÃ-gate của module nguồn — KHÔNG raw-query bảng `candidates`/`job_openings`, KHÔNG thêm method ở module gốc.
 */
import { ForbiddenException, Injectable } from "@nestjs/common";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import { CandidatesService } from "../recruit/candidates.service";
import { gatePairFor, ttlSecondsFor } from "./dashboard-widget-data.const";
import { meetsMinDataScope } from "./dashboard-widget-catalog.const";
import { DASH_ERR } from "./dashboard-resolver.errors";
import type { EnginePair } from "./dashboard-widget-catalog.const";
import type {
  WidgetCacheIdentity,
  WidgetFetchResult,
  WidgetHandlerContext,
  WidgetRequestUser,
} from "./dashboard-widget-data.types";

@Injectable()
export class DashboardWidgetRecruitHandlers {
  constructor(
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly candidates: CandidatesService,
  ) {}

  // ── gate helper (mirror DashboardWidgetOfficeHandlers.gateOrThrow) ───────────────────────────────

  /**
   * Gate bằng cặp của MODULE NGUỒN. KHÔNG truyền isSensitive — engine tự ép effectivelySensitive = input OR
   * grant.isSensitive, nên wildcard KHÔNG lọt qua ('view','candidate') dù cặp đó is_sensitive=true (mig
   * 0560). Deny ⇒ 403 fail-closed (runner KHÔNG nuốt ForbiddenException thành Degraded).
   */
  private async gateOrThrow(user: WidgetRequestUser, widgetCode: string): Promise<EnginePair> {
    const pair = gatePairFor(widgetCode);
    if (!pair) {
      throw new ForbiddenException(`${DASH_ERR.VALIDATION}: widget thiếu cặp gate (${widgetCode})`);
    }
    const decision = await this.permission.can({
      userId: user.id,
      companyId: user.companyId,
      action: pair.action,
      resourceType: pair.resourceType,
    });
    if (!decision.allow) {
      throw new ForbiddenException(
        `AUTH-ERR-FORBIDDEN: thiếu quyền ${pair.action}:${pair.resourceType}`,
      );
    }
    return pair;
  }

  // ── RECRUIT_FUNNEL (CandidatesService.summary — đúng công thức GET /candidates/summary, API-009) ──

  /**
   * Gate HAI vế, đọc CÙNG hằng với registry (memory `read-path-gate-pair-must-match-download-pair`):
   * (1) cặp `view:candidate` (403 fail-closed); (2) SÀN scope `Company` (`DASH_WIDGET_MIN_DATA_SCOPE`) —
   * KHÔNG phải phòng xa: `summaryTx` đếm TOÀN company (không co theo actor scope), nên grant hẹp hơn
   * Company mà được serve là nhận số liệu ngoài scope của chính nó. Registry đã loại widget khỏi METADATA
   * bằng cùng hằng, nên đường bình thường không chạm 403 này — nó gác đường gọi THẲNG slug và trường hợp
   * widget bị bật tay qua `dashboard_widget_configs`.
   *
   * Sau sàn, scope luôn ∈ {Company, System} ⇒ aggregate viewer-independent ⇒ cache company-shared. An toàn
   * vì payload CHỈ là ĐẾM (byStage/openJobOpenings) — KHÔNG PII ứng viên (fullName/email/phone), KHÔNG
   * lương offer (REC-DEC-003/004).
   */
  async gateRecruitFunnel(ctx: WidgetHandlerContext): Promise<WidgetCacheIdentity> {
    const pair = await this.gateOrThrow(ctx.user, "RECRUIT_FUNNEL");
    const scope = await this.dataScope.resolveAndAssert(
      ctx.user.id,
      ctx.user.companyId,
      pair.action,
      pair.resourceType,
    );
    if (!meetsMinDataScope("RECRUIT_FUNNEL", scope)) {
      throw new ForbiddenException(
        `AUTH-ERR-FORBIDDEN: thiếu quyền ${pair.action}:${pair.resourceType} ở phạm vi đủ rộng`,
      );
    }
    return {
      shareScope: "company",
      cacheScope: "Company",
      keyDiscriminator: null,
      scopeReferenceId: null,
      ttlSeconds: ttlSecondsFor(ctx.entry),
    };
  }

  /**
   * TÁI DÙNG `CandidatesService.summary` — MỘT công thức, MỘT con số với `GET /candidates/summary`
   * (RECRUIT-API-009); nó tự `resolveActor('candidateSummary')` (assert lại cặp sensitive) rồi đếm hồ sơ
   * SỐNG theo stage + vị trí đang Open. `byStage` trả NGUYÊN object của repository (stage vắng = không có
   * key) — FE tự zero-fill 6 cột cố định theo RECRUIT_STAGE_COLUMNS, handler KHÔNG chép danh sách stage
   * sang đây để khỏi trôi hai nơi.
   */
  async fetchRecruitFunnel(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const summary = await this.candidates.summary(ctx.user);
    const totalCandidates = Object.values(summary.byStage).reduce<number>(
      (s, n) => s + (n ?? 0),
      0,
    );
    const isEmpty = totalCandidates === 0 && summary.openJobOpenings === 0;
    return {
      status: isEmpty ? "Empty" : "Active",
      data: {
        byStage: summary.byStage,
        summary: { totalCandidates, openJobOpenings: summary.openJobOpenings },
      },
      emptyState: isEmpty ? { message: "Chưa có vị trí đang mở hay ứng viên trong phễu" } : null,
    };
  }
}
