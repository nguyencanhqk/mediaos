/**
 * S13-PAYROLL-DASH-1 — handler widget DASH của module PAYROLL (SPEC-11 §10 PAYROLL-FUNC-014 · §10.1
 * PAYROLL-WIDGET-001 · PAY-DEC-010, mig 0568):
 *   • PAYROLL_COST (slug `payroll-cost`) — «Chi phí lương kỳ»: tổng gross/net + headcount + trạng thái
 *     của kỳ lương GẦN NHẤT.
 *
 * VÌ SAO file RIÊNG (mirror dashboard-widget-office/recruit.handlers.ts): `dashboard-widget-handlers.service.ts`
 * đã sát trần 800 dòng của CLAUDE.md §5. Registry vẫn là MỘT (`DashboardWidgetHandlersService.buildRegistry`
 * gọi sang đây) — tách file, KHÔNG tách registry.
 *
 * Cùng hợp đồng với các handler cũ: `gateAndResolve` (403 fail-closed + resolve cache identity) LUÔN chạy
 * trước mọi lần serve kể cả cache hit; `fetch` chỉ chạy khi cache miss/refresh. Handler CHỈ gọi method
 * ĐÃ-gate của module nguồn — KHÔNG raw-query `payroll_periods`/`payroll_period_lines`, KHÔNG thêm method
 * ở module gốc.
 *
 * ⚠️ ĐÂY LÀ WIDGET DASH ĐẦU TIÊN CHỞ TIỀN. Ba điều kéo theo, khác mọi widget trước (đều là phép ĐẾM):
 *   1. Cặp gate phải là cặp ĐỌC-TIỀN `('view-line','payroll-period')` (is_sensitive=TRUE, mig 0565) —
 *      KHÔNG phải `view:payroll-period` (cố ý không nhạy cảm ⇒ cấm chở tiền, SPEC-11 §334) và KHÔNG
 *      phải cặp GHI `calculate` (ai thấy widget sẽ ghi được lương, §329).
 *   2. Sàn scope `Company` là bắt buộc, không phải phòng xa — `latestSummaryTx` SUM toàn company.
 *   3. Cache company-shared vẫn AN TOÀN vì payload viewer-independent: route 018 không nằm trong
 *      `MONEY_FREE_ROUTES` ⇒ `canSeeMoney = true` cho MỌI actor qua được gate ⇒ PAYROLL không có DTO
 *      nửa-mask (SPEC-11 §11.1) nên không có nhánh mask-per-người để cache lẫn.
 */
import { ForbiddenException, Injectable } from "@nestjs/common";
import { PermissionService } from "../permission/permission.service";
import { DataScopeService } from "../permission/data-scope.service";
import { PayrollCalcService } from "../payroll/payroll-calc.service";
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
export class DashboardWidgetPayrollHandlers {
  constructor(
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly payrollCalc: PayrollCalcService,
  ) {}

  // ── gate helper (mirror DashboardWidgetRecruitHandlers.gateOrThrow) ──────────────────────────────

  /**
   * Gate bằng cặp của MODULE NGUỒN. KHÔNG truyền isSensitive — engine tự ép effectivelySensitive = input OR
   * grant.isSensitive, nên wildcard KHÔNG lọt qua ('view-line','payroll-period') dù cặp đó is_sensitive=true
   * (mig 0565). Deny ⇒ 403 fail-closed (runner KHÔNG nuốt ForbiddenException thành Degraded).
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

  // ── PAYROLL_COST (PayrollCalcService.summary — đúng công thức GET /payroll-periods/summary, API-018) ──

  /**
   * Gate HAI vế, đọc CÙNG hằng với registry (memory `read-path-gate-pair-must-match-download-pair`):
   * (1) cặp `view-line:payroll-period` (403 fail-closed); (2) SÀN scope `Company`
   * (`DASH_WIDGET_MIN_DATA_SCOPE`) — `latestSummaryTx` SUM toàn company, nên grant hẹp hơn Company mà
   * được serve là rò TỔNG QUỸ LƯƠNG ra ngoài scope. Registry đã loại widget khỏi METADATA bằng cùng
   * hằng, nên đường bình thường không chạm 403 này — nó gác đường gọi THẲNG slug và trường hợp widget
   * bị bật tay qua `dashboard_widget_configs`.
   *
   * Sàn thứ hai này KHÔNG thừa dù `PayrollAccessService.resolveActor("periodSummary")` cũng ép
   * `companyFloor`: hai tầng nằm trên HAI ĐƯỜNG khác nhau — đường METADATA (`/dashboard/me`, qua
   * `DashboardWidgetRegistryService`) không gọi service PAYROLL lần nào, nên nếu chỉ dựa vào sàn của
   * PayrollAccessService thì grant hẹp VẪN nhận được shell widget rồi mới ăn 403 ở đường data (bẫy
   * `asset-guards-pairs-in-two-layers`).
   *
   * Sau sàn, scope luôn ∈ {Company, System} ⇒ payload viewer-independent ⇒ cache company-shared (xem
   * doc-block đầu file, mục 3).
   */
  async gatePayrollCost(ctx: WidgetHandlerContext): Promise<WidgetCacheIdentity> {
    const pair = await this.gateOrThrow(ctx.user, "PAYROLL_COST");
    const scope = await this.dataScope.resolveAndAssert(
      ctx.user.id,
      ctx.user.companyId,
      pair.action,
      pair.resourceType,
    );
    if (!meetsMinDataScope("PAYROLL_COST", scope)) {
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
   * TÁI DÙNG `PayrollCalcService.summary` — MỘT công thức, MỘT con số với `GET /payroll-periods/summary`
   * (PAYROLL-API-018); nó tự `resolveActor('periodSummary')` (assert LẠI cặp sensitive + sàn Company ở
   * tầng service) rồi đọc kỳ lương gần nhất + SUM dòng bảng lương, và **ghi audit lượt đọc** (SPEC-11
   * §19: mọi lượt XEM dữ liệu lương để lại vết) — đó là lý do widget gọi service chứ không repository.
   *
   * `summary()` trả `null` khi công ty CHƯA có kỳ lương nào (200 `data:null`, KHÔNG 404 — nó cố ý phân
   * biệt «chưa có kỳ» với «không có quyền»). Ở đây map thành `status: 'Empty'` + empty_state, KHÔNG ném.
   *
   * `totalGross`/`totalNet` là `.optional()` trong `payrollSummarySchema` vì DTO strip khoá tiền khi
   * `canSeeMoney=false` (memory `server-masking-needs-optional-fe-schema`). Trên đường này chúng LUÔN có
   * mặt (route 018 chở tiền), nhưng handler vẫn KHÔNG zero-fill: `?? null` giữ đúng ngữ nghĩa «server
   * không gửi khoá này» để FE không vẽ 0đ giả — mask là VẮNG KHOÁ, không phải giá trị 0 (khuôn BE-1).
   */
  async fetchPayrollCost(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const summary = await this.payrollCalc.summary(ctx.user);
    if (!summary) {
      return {
        status: "Empty",
        data: {},
        emptyState: { message: "Chưa có kỳ lương nào" },
      };
    }
    return {
      status: "Active",
      data: {
        period: {
          payrollPeriodId: summary.payrollPeriodId,
          periodMonth: summary.periodMonth,
          status: summary.status,
        },
        summary: {
          headcount: summary.headcount,
          totalGross: summary.totalGross ?? null,
          totalNet: summary.totalNet ?? null,
        },
      },
      emptyState: null,
    };
  }
}
