/**
 * S13-PAYROLL-DASH-1 — handler widget DASH của module PAYROLL (SPEC-11 §10 PAYROLL-FUNC-014 · §10.1
 * PAYROLL-WIDGET-001 · PAY-DEC-010, mig 0568):
 *   • PAYROLL_COST (slug `payroll-cost`) — «Chi phí lương kỳ»: tổng gross/net + headcount + trạng thái
 *     của kỳ lương GẦN NHẤT.
 *
 * S15-PAYROLL-DASH-1 (APPEND, mig 0576 · SPEC-11 §10.1b) — thêm 2 widget v2:
 *   • PAYROLL_BUDGET (slug `payroll-budget`) — «Ngân sách lương năm»: kế hoạch · thực hiện · chênh
 *     lệch · tỉ lệ dùng của NĂM HIỆN TẠI. Nguồn `PayrollBudgetsService.yearTotals()` — CÙNG con số với
 *     khối ngân sách của Tổng quan (078) và hàng tổng báo cáo `budget-status`.
 *   • PAYROLL_ADVANCE_PENDING (slug `payroll-advance-pending`) — «Tạm ứng chờ duyệt»: CHỈ `total`
 *     (`PayrollAdvancesService.countPending()`), không tên người, không tiền.
 *
 * Mỗi widget mượn ĐÚNG cặp của route nguồn nó gọi (073 → `view:payroll-budget`, 059 →
 * `view:payroll-advance`) — KHÔNG mượn chéo cặp của widget anh em; xem DASH_WIDGET_GATE_PAIR.
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
import { PayrollBudgetsService } from "../payroll/payroll-budgets.service";
import { PayrollAdvancesService } from "../payroll/payroll-advances.service";
import { ttlSecondsFor } from "./dashboard-widget-data.const";
import { meetsMinDataScope } from "./dashboard-widget-catalog.const";
import { gateWidgetOrThrow } from "./dashboard-widget-gate";
import type {
  WidgetCacheIdentity,
  WidgetFetchResult,
  WidgetHandlerContext,
} from "./dashboard-widget-data.types";

@Injectable()
export class DashboardWidgetPayrollHandlers {
  constructor(
    private readonly permission: PermissionService,
    private readonly dataScope: DataScopeService,
    private readonly payrollCalc: PayrollCalcService,
    // S15-PAYROLL-DASH-1 (additive): nguồn của 2 widget v2 — service ĐÃ-gate, KHÔNG repository.
    private readonly budgets: PayrollBudgetsService,
    private readonly advances: PayrollAdvancesService,
  ) {}

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
    const pair = await gateWidgetOrThrow(this.permission, ctx.user, "PAYROLL_COST");
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

  // ── PAYROLL_BUDGET (PayrollBudgetsService.yearTotals — cùng con số với Tổng quan 078) ────────────

  /**
   * Gate HAI vế, CÙNG hằng với registry: (1) cặp `view:payroll-budget` (403 fail-closed); (2) SÀN scope
   * `Company` — `yearTotalsTx` cộng TOÀN công ty nên grant hẹp hơn mà được serve là rò tiền ngoài scope.
   * Sau sàn, scope ∈ {Company, System} ⇒ payload viewer-independent ⇒ cache company-shared (mirror
   * PAYROLL_COST: PAYROLL không có DTO nửa-mask nên không có nhánh mask-per-người để cache lẫn).
   */
  async gatePayrollBudget(ctx: WidgetHandlerContext): Promise<WidgetCacheIdentity> {
    return this.gateCompanyWide(ctx, "PAYROLL_BUDGET");
  }

  /**
   * `plannedAmount`/`variance`/`usagePct` về `null` khi công ty CHƯA lập ngân sách năm nay — giữ NULL,
   * KHÔNG `?? 0`: «chưa lập kế hoạch» khác «kế hoạch 0 đồng». `actualAmount` luôn có (Σ gross phiếu đã
   * phát hành, `coalesce(...,0)` ở SQL) nên chi thực tế vẫn hiện được dù chưa lập kế hoạch.
   *
   * `Empty` CHỈ khi không có gì để nói: chưa lập kế hoạch VÀ chưa phát hành đồng nào.
   */
  async fetchPayrollBudget(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const t = await this.budgets.yearTotals(ctx.user);
    const planned = t.plannedAmount === null ? null : Number(t.plannedAmount);
    const actual = Number(t.actualAmount);
    if (planned === null && actual === 0) {
      return {
        status: "Empty",
        data: {},
        emptyState: { message: "Chưa lập ngân sách lương năm nay" },
      };
    }
    return {
      status: "Active",
      data: {
        fiscalYear: t.fiscalYear,
        plannedAmount: planned,
        actualAmount: actual,
        variance: t.variance === null ? null : Number(t.variance),
        usagePct: t.usagePct === null ? null : Number(t.usagePct),
      },
      emptyState: null,
    };
  }

  // ── PAYROLL_ADVANCE_PENDING (PayrollAdvancesService.countPending — chỉ `total`) ──────────────────

  /** Gate HAI vế như trên, cặp `view:payroll-advance` + SÀN `Company` (countTx đếm toàn công ty). */
  async gatePayrollAdvancePending(ctx: WidgetHandlerContext): Promise<WidgetCacheIdentity> {
    return this.gateCompanyWide(ctx, "PAYROLL_ADVANCE_PENDING");
  }

  /** `total === 0` ⇒ `Empty` (không có việc chờ duyệt là trạng thái ĐẸP, không phải lỗi). */
  async fetchPayrollAdvancePending(ctx: WidgetHandlerContext): Promise<WidgetFetchResult> {
    const { total } = await this.advances.countPending(ctx.user);
    if (total === 0) {
      return {
        status: "Empty",
        data: {},
        emptyState: { message: "Không có tạm ứng chờ duyệt" },
      };
    }
    return { status: "Active", data: { total }, emptyState: null };
  }

  /**
   * Gate dùng chung cho widget company-wide của PAYROLL (cặp + SÀN scope, đọc CÙNG hằng với registry —
   * memory `read-path-gate-pair-must-match-download-pair`: hai tầng lệch hằng ⇒ deny-path xanh rỗng).
   * Tách hàm để widget thứ tư KHÔNG sinh thêm một bản sao gate dễ trôi.
   */
  private async gateCompanyWide(
    ctx: WidgetHandlerContext,
    widgetCode: "PAYROLL_BUDGET" | "PAYROLL_ADVANCE_PENDING",
  ): Promise<WidgetCacheIdentity> {
    const pair = await gateWidgetOrThrow(this.permission, ctx.user, widgetCode);
    const scope = await this.dataScope.resolveAndAssert(
      ctx.user.id,
      ctx.user.companyId,
      pair.action,
      pair.resourceType,
    );
    if (!meetsMinDataScope(widgetCode, scope)) {
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
}
